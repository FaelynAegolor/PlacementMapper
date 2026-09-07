import { db, getSetting } from "../db";
import type { Category, Placement, Student, TravelMode, Year } from "../types";
import { categoryWithArticle, isEligible } from "./assignments";
import { haversineDistanceMeters } from "./distance";
import { geocodePostcode } from "./geocode";
import { getRoute, MissingApiKeyError } from "./routing";

const CANDIDATES_PER_STUDENT = 5;
/** How many of the nearest placements to try routing for a student who has to
 * be placed by the fallback pass. */
const FALLBACK_ROUTE_ATTEMPTS = 3;
/** Rough door-to-door speed (~18 mph), used only to turn a straight-line
 * distance into an indicative time when no route can be fetched at all. */
const ESTIMATED_METERS_PER_SECOND = 8;

export const DEFAULT_MAX_STUDENT_MINUTES = 60;

/** Journey time above which a student's placement is flagged as too far.
 * Set on the Settings tab. */
export async function getMaxStudentMinutes(): Promise<number> {
  const raw = await getSetting("maxStudentMinutes");
  const value = raw != null ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_STUDENT_MINUTES;
}

export interface Suggestion {
  studentId: string;
  placementId: string | null;
  mode: TravelMode | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  /** 1 = closest eligible placement by travel time, 2 = second-closest, etc.
   * Null when the student was placed by the fallback pass. */
  rank: number | null;
  /** Human-readable explanation of why this placement was chosen. */
  explanation?: string;
  reason?: string;
  /** "committed" = already has a saved assignment for this year (left
   * untouched by re-runs); "suggested" = a fresh proposal; "unassigned" =
   * no placement this student is eligible for at all. */
  status: "committed" | "suggested" | "unassigned";
  /** Journey is longer than the configured limit — worth a second look. */
  tooFar?: boolean;
  /** The placement doesn't match the type this student needs. Only reachable
   * for an assignment made before that requirement was set. */
  typeMismatch?: boolean;
  /** Placed here even though the placement is already full for this year. */
  overCapacity?: boolean;
  /** Time and distance are a straight-line estimate, not a real route. */
  estimated?: boolean;
  /** True when travel times are missing only because there's no Google API
   * key — a setup issue, not a genuinely unreachable placement. */
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
  const maxSeconds = (await getMaxStudentMinutes()) * 60;

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

  // Geocode everything up front (cached, so cheap on repeat runs). Committed
  // students are included so their journey can still be estimated when it
  // can't be routed.
  const geocodeErrors = new Map<string, string>();
  const studentLatLng = new Map<string, { lat: number; lng: number }>();
  for (const student of students) {
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

  const studentById = new Map<string, Student>(students.map((s) => [s.id, s]));

  // Fetch real travel times for the shortlisted candidates.
  interface RankedCandidate extends Candidate {
    mode: TravelMode;
    durationSeconds: number;
    distanceMeters: number;
  }
  const ranked: RankedCandidate[] = [];
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
      // Candidate drops out of the ranked pass if routing fails (e.g. no
      // transit route available); the fallback pass below still places the
      // student, on a straight-line estimate if it has to.
      if (err instanceof MissingApiKeyError) missingKeyStudents.add(candidate.studentId);
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

  // Nobody is left without a placement for want of a nearby or non-full
  // option. Anyone the ranked pass could not place is given the nearest
  // eligible placement anyway — over capacity if every one of them is full,
  // and on a straight-line estimate if no route can be fetched — flagged so
  // it can be reviewed rather than silently dropped.
  for (const student of toSuggest) {
    if (suggestions.has(student.id)) continue;
    const from = studentLatLng.get(student.id);
    const eligible = eligibleByStudent.get(student.id) ?? [];
    if (!from || eligible.length === 0) continue; // genuinely unplaceable — reported below

    const byDistance = eligible
      .map((placement) => {
        const to = placementLatLng.get(placement.id);
        return to ? { placement, straightLineMeters: haversineDistanceMeters(from, to) } : null;
      })
      .filter((c): c is { placement: Placement; straightLineMeters: number } => c !== null)
      .sort((a, b) => a.straightLineMeters - b.straightLineMeters);
    if (byDistance.length === 0) continue;

    const hasSpace = (placement: Placement) =>
      placement.capacity == null || (placementCounts.get(placement.id) ?? 0) < placement.capacity;
    const withSpace = byDistance.filter((c) => hasSpace(c.placement));
    const overCapacity = withSpace.length === 0;
    const pool = overCapacity ? byDistance : withSpace;

    // Try for a real travel time on the nearest few before falling back to a
    // straight-line estimate.
    const mode: TravelMode = student.isDriver ? "driving" : "transit";
    let best: { placement: Placement; durationSeconds: number; distanceMeters: number } | null = null;
    for (const candidate of pool.slice(0, FALLBACK_ROUTE_ATTEMPTS)) {
      try {
        const route = await getRoute(student.postcode, candidate.placement.postcode, mode);
        if (!best || route.durationSeconds < best.durationSeconds) {
          best = {
            placement: candidate.placement,
            durationSeconds: route.durationSeconds,
            distanceMeters: route.distanceMeters,
          };
        }
      } catch (err) {
        if (err instanceof MissingApiKeyError) missingKeyStudents.add(student.id);
      }
    }

    const nearest = pool[0];
    const chosen = best ?? {
      placement: nearest.placement,
      durationSeconds: Math.round(nearest.straightLineMeters / ESTIMATED_METERS_PER_SECOND),
      distanceMeters: nearest.straightLineMeters,
    };
    const estimated = best === null;

    placementCounts.set(chosen.placement.id, (placementCounts.get(chosen.placement.id) ?? 0) + 1);
    suggestions.set(student.id, {
      studentId: student.id,
      placementId: chosen.placement.id,
      mode: estimated ? null : mode,
      durationSeconds: chosen.durationSeconds,
      distanceMeters: chosen.distanceMeters,
      rank: null,
      status: "suggested",
      overCapacity,
      estimated,
      needsSetup: estimated && missingKeyStudents.has(student.id),
      explanation: overCapacity
        ? `Every eligible placement is full for year ${year} — placed at the nearest one, which puts it over capacity.`
        : estimated
          ? "No travel time could be fetched — nearest eligible placement with space, by straight-line distance."
          : "Nearest eligible placement with space — nothing closer could be routed or had room.",
    });
  }

  // Committed students are routed too (cached after the first run) so the
  // table shows their real journey and keeps flagging anyone travelling too
  // far, rather than losing the warning the moment it's committed.
  for (const student of students) {
    const suggestion = suggestions.get(student.id);
    if (suggestion?.status !== "committed" || !suggestion.placementId) continue;
    const placement = placementById.get(suggestion.placementId);
    if (!placement) continue;
    const mode: TravelMode = student.isDriver ? "driving" : "transit";
    try {
      const route = await getRoute(student.postcode, placement.postcode, mode);
      suggestion.mode = mode;
      suggestion.durationSeconds = route.durationSeconds;
      suggestion.distanceMeters = route.distanceMeters;
    } catch (err) {
      // Fall back to the same straight-line estimate the fallback pass uses.
      const from = studentLatLng.get(student.id);
      const to = placementLatLng.get(placement.id);
      if (!from || !to) continue;
      const straightLineMeters = haversineDistanceMeters(from, to);
      suggestion.distanceMeters = straightLineMeters;
      suggestion.durationSeconds = Math.round(straightLineMeters / ESTIMATED_METERS_PER_SECOND);
      suggestion.estimated = true;
      if (err instanceof MissingApiKeyError) suggestion.needsSetup = true;
    }
  }

  // Anyone left has no placement they are eligible for at all — the one case
  // that can't be solved by travelling further.
  for (const student of toSuggest) {
    if (suggestions.has(student.id)) continue;
    const geocodeError = geocodeErrors.get(student.id);
    const eligible = eligibleByStudent.get(student.id) ?? [];

    let reason: string;
    const driverNote = student.isDriver ? "" : " who don't drive";
    if (geocodeError) {
      reason = geocodeError;
    } else if (eligible.length > 0) {
      reason = "None of this student's eligible placements could be located";
    } else if (categoryFilter && student.requiredCategory && student.requiredCategory !== categoryFilter) {
      reason = `This run is filtered to ${categoryFilter} placements, but this student needs ${categoryWithArticle(student.requiredCategory)} one`;
    } else if (student.requiredCategory) {
      reason = `No ${student.requiredCategory} placement takes year ${year} students${driverNote}`;
    } else if (categoryFilter) {
      reason = `No ${categoryFilter} placement takes year ${year} students${driverNote} — this run is filtered to ${categoryFilter} placements`;
    } else {
      reason = `No placement takes year ${year} students${driverNote}`;
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
    });
  }

  // Flag long journeys, placements now over capacity for the year, and any
  // assignment that predates the student's required placement type.
  for (const suggestion of suggestions.values()) {
    if (suggestion.durationSeconds != null && suggestion.durationSeconds > maxSeconds) {
      suggestion.tooFar = true;
    }
    const placement = suggestion.placementId ? placementById.get(suggestion.placementId) : null;
    if (!placement) continue;
    if (placement.capacity != null && (placementCounts.get(placement.id) ?? 0) > placement.capacity) {
      suggestion.overCapacity = true;
    }
    const required = studentById.get(suggestion.studentId)?.requiredCategory;
    if (required && placement.category !== required) suggestion.typeMismatch = true;
  }

  return students.map((s) => suggestions.get(s.id)!);
}
