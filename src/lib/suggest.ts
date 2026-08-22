import { db } from "../db";
import type { Category, Placement, Student, TravelMode, Year } from "../types";
import { isEligible } from "./assignments";
import { haversineDistanceMeters } from "./distance";
import { geocodePostcode } from "./geocode";
import { getRoute, MissingApiKeyError } from "./routing";

const CANDIDATES_PER_STUDENT = 5;

export interface Suggestion {
  studentId: string;
  placementId: string | null;
  mode: TravelMode | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** 1 = closest eligible placement by travel time, 2 = second-closest, etc. */
  rank: number | null;
  /** Human-readable explanation of why this placement was chosen. */
  explanation?: string;
  reason?: string;
  /** "committed" = already has a saved assignment for this year (left
   * untouched by re-runs); "suggested" = a fresh proposal; "unassigned" =
   * no viable placement found. */
  status: "committed" | "suggested" | "unassigned";
  /** True when the only reason this student is unassigned is a missing
   * Google API key — a setup issue, not a genuinely unplaceable student. */
  needsSetup?: boolean;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface Candidate {
  studentId: string;
  placementId: string;
  straightLineMeters: number;
}

export async function suggestAssignments(
  year: Year,
  categoryFilter: Category | null = null,
): Promise<Suggestion[]> {
  const students = await db.students.where("year").equals(year).toArray();
  const placements = await db.placements.toArray();

  const otherYear = year === 2 ? 3 : year === 3 ? 2 : null;
  const excludedForStudent = new Map<string, string>();
  if (otherYear) {
    const otherAssignments = await db.assignments.where("year").equals(otherYear).toArray();
    for (const a of otherAssignments) excludedForStudent.set(a.studentId, a.placementId);
  }

  // Students already committed for this year are left untouched by a
  // re-run, and their slot is subtracted from capacity up front so new
  // suggestions correctly avoid placements that are already filled.
  const thisYearAssignments = await db.assignments.where("year").equals(year).toArray();
  const committedByStudent = new Map(thisYearAssignments.map((a) => [a.studentId, a]));
  const placementCounts = new Map<string, number>();
  for (const a of thisYearAssignments) {
    placementCounts.set(a.placementId, (placementCounts.get(a.placementId) ?? 0) + 1);
  }

  const placementById = new Map<string, Placement>(placements.map((p) => [p.id, p]));
  const suggestions = new Map<string, Suggestion>();
  for (const student of students) {
    const committed = committedByStudent.get(student.id);
    if (committed) {
      suggestions.set(student.id, {
        studentId: student.id,
        placementId: committed.placementId,
        mode: null,
        durationSeconds: null,
        distanceMeters: null,
        rank: null,
        status: "committed",
      });
    }
  }

  const toSuggest = students.filter((s) => !committedByStudent.has(s.id));

  // Build eligible pairs, per student.
  const eligibleByStudent = new Map<string, Placement[]>();
  for (const student of toSuggest) {
    const excluded = excludedForStudent.get(student.id);
    const eligible = placements.filter(
      (p) => isEligible(student, p, categoryFilter) && p.id !== excluded,
    );
    eligibleByStudent.set(student.id, eligible);
  }

  // Geocode everything up front (cached, so cheap on repeat runs).
  const geocodeErrors = new Map<string, string>();
  const studentLatLng = new Map<string, { lat: number; lng: number }>();
  for (const student of toSuggest) {
    try {
      studentLatLng.set(student.id, await geocodePostcode(student.postcode));
    } catch {
      geocodeErrors.set(student.id, `Could not locate postcode "${student.postcode}"`);
    }
  }
  const placementLatLng = new Map<string, { lat: number; lng: number }>();
  for (const placement of placements) {
    try {
      placementLatLng.set(placement.id, await geocodePostcode(placement.postcode));
    } catch {
      // Placement drops out of candidacy below if it has no coordinates.
    }
  }

  // Pre-filter to nearest N candidates per student by straight-line distance.
  const candidates: Candidate[] = [];
  for (const student of toSuggest) {
    const from = studentLatLng.get(student.id);
    if (!from) continue;
    const eligible = eligibleByStudent.get(student.id) ?? [];
    const withDistance = eligible
      .map((p) => {
        const to = placementLatLng.get(p.id);
        if (!to) return null;
        return {
          studentId: student.id,
          placementId: p.id,
          straightLineMeters: haversineDistanceMeters(from, to),
        };
      })
      .filter((c): c is Candidate => c !== null)
      .sort((a, b) => a.straightLineMeters - b.straightLineMeters)
      .slice(0, CANDIDATES_PER_STUDENT);
    candidates.push(...withDistance);
  }

  const studentById = new Map<string, Student>(toSuggest.map((s) => [s.id, s]));

  // Fetch real travel times for the shortlisted candidates.
  interface RankedCandidate extends Candidate {
    mode: TravelMode;
    durationSeconds: number;
    distanceMeters: number;
  }
  const ranked: RankedCandidate[] = [];
  const routeErrorByStudent = new Map<string, string>();
  const missingKeyStudents = new Set<string>();
  const routedCountByStudent = new Map<string, number>();
  for (const candidate of candidates) {
    const student = studentById.get(candidate.studentId)!;
    const placement = placementById.get(candidate.placementId)!;
    const mode: TravelMode = student.isDriver ? "driving" : "transit";
    try {
      const route = await getRoute(student.postcode, placement.postcode, mode);
      ranked.push({
        ...candidate,
        mode,
        durationSeconds: route.durationSeconds,
        distanceMeters: route.distanceMeters,
      });
      routedCountByStudent.set(candidate.studentId, (routedCountByStudent.get(candidate.studentId) ?? 0) + 1);
    } catch (err) {
      // Candidate drops out if routing fails (e.g. no transit route available).
      const isMissingKey = err instanceof MissingApiKeyError;
      if (isMissingKey) missingKeyStudents.add(candidate.studentId);
      const message = isMissingKey ? err.message : "A travel time lookup failed";
      routeErrorByStudent.set(candidate.studentId, message);
    }
  }
  ranked.sort((a, b) => a.durationSeconds - b.durationSeconds);

  // Greedily assign shortest-travel-time first, respecting one assignment
  // per student and placement capacity for this year (placementCounts was
  // seeded above from already-committed assignments). Track which closer
  // candidates were skipped (and why) so the choice can be explained.
  const assignedStudents = new Set<string>();
  const skippedFull = new Map<string, string[]>(); // studentId -> placement names skipped as full

  for (const candidate of ranked) {
    if (assignedStudents.has(candidate.studentId)) continue;
    const placement = placementById.get(candidate.placementId)!;
    const count = placementCounts.get(candidate.placementId) ?? 0;
    if (placement.capacity != null && count >= placement.capacity) {
      const list = skippedFull.get(candidate.studentId) ?? [];
      list.push(placement.name);
      skippedFull.set(candidate.studentId, list);
      continue;
    }

    assignedStudents.add(candidate.studentId);
    placementCounts.set(candidate.placementId, count + 1);

    const ownRanking = ranked.filter((c) => c.studentId === candidate.studentId);
    const rank = ownRanking.findIndex((c) => c.placementId === candidate.placementId) + 1;
    const skipped = skippedFull.get(candidate.studentId) ?? [];
    const explanation =
      rank <= 1
        ? "Closest eligible placement by travel time."
        : `${ordinal(rank)} closest by travel time — closer option${skipped.length === 1 ? "" : "s"} already full: ${skipped.join(", ")}.`;

    suggestions.set(candidate.studentId, {
      studentId: candidate.studentId,
      placementId: candidate.placementId,
      mode: candidate.mode,
      durationSeconds: candidate.durationSeconds,
      distanceMeters: candidate.distanceMeters,
      rank,
      explanation,
      status: "suggested",
    });
  }

  // Fill in anyone left unassigned, with a reason.
  for (const student of toSuggest) {
    if (suggestions.has(student.id)) continue;
    const geocodeError = geocodeErrors.get(student.id);
    const hadEligible = (eligibleByStudent.get(student.id) ?? []).length > 0;
    const routedCount = routedCountByStudent.get(student.id) ?? 0;
    const routeError = routeErrorByStudent.get(student.id);

    let reason: string;
    if (geocodeError) {
      reason = geocodeError;
    } else if (!hadEligible) {
      reason = "No eligible placements for this student";
    } else if (routedCount === 0 && routeError) {
      reason = routeError;
    } else if (routedCount === 0) {
      reason = "Could not compute a travel time to any nearby eligible placement";
    } else {
      reason = "All nearby eligible placements are full for this year";
    }

    suggestions.set(student.id, {
      studentId: student.id,
      placementId: null,
      mode: null,
      durationSeconds: null,
      distanceMeters: null,
      rank: null,
      status: "unassigned",
      reason,
      needsSetup: routedCount === 0 && missingKeyStudents.has(student.id),
    });
  }

  return students.map((s) => suggestions.get(s.id)!);
}
