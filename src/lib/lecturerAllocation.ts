import { db } from "../db";
import { haversineDistanceMeters } from "./distance";
import { geocodePostcode } from "./geocode";
import type { LatLng, Lecturer, Placement } from "../types";

export interface LecturerAllocation {
  lecturer: Lecturer;
  placements: { placement: Placement; distanceMeters: number }[];
}

/** Assigns every in-use placement (one with at least one student assigned)
 * to its nearest lecturer by straight-line distance, so each lecturer's
 * round is geographically clustered. No per-lecturer cap — always nearest
 * wins. */
export async function allocateLecturers(): Promise<LecturerAllocation[]> {
  const lecturers = await db.lecturers.toArray();
  const placements = await db.placements.toArray();
  const assignments = await db.assignments.toArray();

  const inUseIds = new Set(assignments.map((a) => a.placementId));
  const inUsePlacements = placements.filter((p) => inUseIds.has(p.id));

  const lecturerPoints = new Map<string, LatLng>();
  for (const l of lecturers) {
    try {
      lecturerPoints.set(l.id, await geocodePostcode(l.postcode));
    } catch {
      // Lecturer drops out of consideration if their postcode won't geocode.
    }
  }
  const placementPoints = new Map<string, LatLng>();
  for (const p of inUsePlacements) {
    try {
      placementPoints.set(p.id, await geocodePostcode(p.postcode));
    } catch {
      // Placement is skipped below if it has no coordinates.
    }
  }

  const grouped = new Map<string, { placement: Placement; distanceMeters: number }[]>();
  for (const l of lecturers) grouped.set(l.id, []);

  for (const placement of inUsePlacements) {
    const pPoint = placementPoints.get(placement.id);
    if (!pPoint) continue;
    let best: { lecturerId: string; distanceMeters: number } | null = null;
    for (const l of lecturers) {
      const lPoint = lecturerPoints.get(l.id);
      if (!lPoint) continue;
      const distanceMeters = haversineDistanceMeters(pPoint, lPoint);
      if (!best || distanceMeters < best.distanceMeters) best = { lecturerId: l.id, distanceMeters };
    }
    if (best) grouped.get(best.lecturerId)!.push({ placement, distanceMeters: best.distanceMeters });
  }

  return lecturers.map((lecturer) => ({
    lecturer,
    placements: (grouped.get(lecturer.id) ?? []).sort((a, b) => a.distanceMeters - b.distanceMeters),
  }));
}
