import { db } from "../db";
import { sharePlacements } from "./allocationBalance";
import { haversineDistanceMeters } from "./distance";
import { geocodePostcode } from "./geocode";
import type { LatLng, Lecturer, Placement } from "../types";

export interface AllocatedPlacement {
  placement: Placement;
  distanceMeters: number;
  studentCount: number;
}

export interface LecturerAllocation {
  lecturer: Lecturer;
  placements: AllocatedPlacement[];
  /** Students this lecturer is responsible for visiting, across all their
   * placements. */
  studentCount: number;
  /** Why this lecturer has nothing, on the rare occasion that happens. */
  note?: string;
}

export interface AllocationResult {
  allocations: LecturerAllocation[];
  totalStudents: number;
  /** Students per lecturer if the load were split perfectly evenly. */
  evenShare: number;
  /** In-use placements that had to be left out, and why. */
  skipped: { placement: Placement; reason: string }[];
}

/** Shares every in-use placement (one with at least one student assigned)
 * out across all lecturers, keeping each lecturer's round geographically
 * tight while giving everyone a comparable number of students to visit.
 * Nearest-lecturer-wins on its own leaves the lecturers who don't live near a
 * cluster with nothing, so a lecturer stops taking placements once they are
 * carrying more than their share, and anyone still empty at the end is given
 * the placement that costs the least to hand over. */
export async function allocateLecturers(): Promise<AllocationResult> {
  const lecturers = await db.lecturers.toArray();
  const placements = await db.placements.toArray();
  const assignments = await db.assignments.toArray();

  // Students to visit at each placement. A student assigned there in two
  // different years is still one student to see.
  const studentsByPlacement = new Map<string, Set<string>>();
  for (const a of assignments) {
    const seen = studentsByPlacement.get(a.placementId) ?? new Set<string>();
    seen.add(a.studentId);
    studentsByPlacement.set(a.placementId, seen);
  }
  const studentCount = (placement: Placement) => studentsByPlacement.get(placement.id)?.size ?? 0;
  const inUse = placements.filter((p) => studentCount(p) > 0);

  const lecturerPoints = new Map<string, LatLng>();
  for (const lecturer of lecturers) {
    try {
      lecturerPoints.set(lecturer.id, await geocodePostcode(lecturer.postcode));
    } catch {
      // Lecturer drops out of consideration if their postcode won't geocode.
    }
  }
  const placementPoints = new Map<string, LatLng>();
  for (const placement of inUse) {
    try {
      placementPoints.set(placement.id, await geocodePostcode(placement.postcode));
    } catch {
      // Reported as skipped below.
    }
  }

  const located = lecturers.filter((l) => lecturerPoints.has(l.id));
  const placeable = inUse.filter((p) => placementPoints.has(p.id));
  const skipped = inUse
    .filter((p) => !placementPoints.has(p.id))
    .map((placement) => ({ placement, reason: `Could not locate postcode "${placement.postcode}"` }));

  const totalStudents = placeable.reduce((sum, p) => sum + studentCount(p), 0);
  const evenShare = located.length > 0 ? totalStudents / located.length : 0;

  const emptyResult = (note: (lecturer: Lecturer) => string | undefined): AllocationResult => ({
    allocations: lecturers.map((lecturer) => ({
      lecturer,
      placements: [],
      studentCount: 0,
      note: note(lecturer),
    })),
    totalStudents,
    evenShare,
    skipped,
  });

  const locationNote = (lecturer: Lecturer) =>
    lecturerPoints.has(lecturer.id)
      ? undefined
      : `Home postcode "${lecturer.postcode}" could not be located.`;

  if (located.length === 0 || placeable.length === 0) {
    const nothingToAllocate =
      inUse.length === 0
        ? "No placements have students assigned yet."
        : "None of the in-use placements could be located from their postcode.";
    return emptyResult((lecturer) =>
      locationNote(lecturer) ??
      (placeable.length === 0 ? nothingToAllocate : "No lecturer home postcode could be located."),
    );
  }

  // Straight-line distance from every placement to every lecturer's home.
  const distances = new Map<string, Map<string, number>>();
  for (const placement of placeable) {
    const row = new Map<string, number>();
    for (const lecturer of located) {
      row.set(
        lecturer.id,
        haversineDistanceMeters(placementPoints.get(placement.id)!, lecturerPoints.get(lecturer.id)!),
      );
    }
    distances.set(placement.id, row);
  }
  const distanceTo = (placementId: string, lecturerId: string) =>
    distances.get(placementId)!.get(lecturerId)!;

  const { assignedTo } = sharePlacements({
    lecturerIds: located.map((l) => l.id),
    placements: placeable.map((p) => ({ id: p.id, studentCount: studentCount(p) })),
    distance: distanceTo,
  });

  const holdings = new Map<string, Placement[]>(located.map((l) => [l.id, []]));
  for (const placement of placeable) {
    holdings.get(assignedTo.get(placement.id)!)!.push(placement);
  }

  const allocations = lecturers.map((lecturer) => {
    const allocated = (holdings.get(lecturer.id) ?? [])
      .map((placement) => ({
        placement,
        distanceMeters: distanceTo(placement.id, lecturer.id),
        studentCount: studentCount(placement),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {
      lecturer,
      placements: allocated,
      studentCount: allocated.reduce((sum, p) => sum + p.studentCount, 0),
      note:
        allocated.length > 0
          ? undefined
          : (locationNote(lecturer) ??
            "There are fewer placements in use than lecturers, so there was nothing left to allocate."),
    };
  });

  return { allocations, totalStudents, evenShare, skipped };
}
