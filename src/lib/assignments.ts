import { db } from "../db";
import type { Assignment, Category, Placement, Student, Year } from "../types";

export function placesAvailableLabel(placement: Placement, assignments: Assignment[]): string {
  if (placement.capacity == null) return "Unlimited places";
  let total = 0;
  let filled = 0;
  for (const year of placement.yearsOffered) {
    total += placement.capacity;
    filled += assignments.filter((a) => a.placementId === placement.id && a.year === year).length;
  }
  return `${total - filled} of ${total} places available`;
}

export function isEligible(
  student: Student,
  placement: Placement,
  categoryFilter?: Category | null,
): boolean {
  if (!placement.yearsOffered.includes(student.year)) return false;
  if (placement.requiresDriver && !student.isDriver) return false;
  if (categoryFilter && placement.category !== categoryFilter) return false;
  return true;
}

export interface AssignmentCheck {
  ok: boolean;
  reason?: string;
}

/** Checks the year-2/year-3 "must differ" rule and, if capacity is set,
 * that the placement isn't already full for that year. */
export async function isValidAssignment(
  studentId: string,
  placementId: string,
  year: Year,
): Promise<AssignmentCheck> {
  if (year === 2 || year === 3) {
    const otherYear = year === 2 ? 3 : 2;
    const otherAssignment = await db.assignments
      .where("[studentId+year]")
      .equals([studentId, otherYear])
      .first();
    if (otherAssignment && otherAssignment.placementId === placementId) {
      return {
        ok: false,
        reason: `Student is already assigned to this placement in year ${otherYear}`,
      };
    }
  }

  const placement = await db.placements.get(placementId);
  if (placement?.capacity != null) {
    const currentCount = await db.assignments
      .where({ placementId, year })
      .count();
    const existing = await db.assignments
      .where("[studentId+year]")
      .equals([studentId, year])
      .first();
    const alreadyCountsTowardsCapacity = existing?.placementId === placementId;
    if (!alreadyCountsTowardsCapacity && currentCount >= placement.capacity) {
      return { ok: false, reason: "This placement is already at capacity for this year" };
    }
  }

  return { ok: true };
}

export async function setAssignment(
  studentId: string,
  placementId: string,
  year: Year,
): Promise<AssignmentCheck> {
  const check = await isValidAssignment(studentId, placementId, year);
  if (!check.ok) return check;

  const existing = await db.assignments
    .where("[studentId+year]")
    .equals([studentId, year])
    .first();

  if (existing) {
    await db.assignments.update(existing.id, { placementId });
  } else {
    await db.assignments.add({
      id: crypto.randomUUID(),
      studentId,
      placementId,
      year,
    });
  }
  return { ok: true };
}

export async function clearAssignment(studentId: string, year: Year): Promise<void> {
  const existing = await db.assignments
    .where("[studentId+year]")
    .equals([studentId, year])
    .first();
  if (existing) await db.assignments.delete(existing.id);
}
