/** The lecturer/placement sharing algorithm, kept free of the database and
 * geocoding so it can be reasoned about (and exercised) on its own. */

export interface BalanceItem {
  id: string;
  /** How much work this item is worth — students to visit at a placement. */
  studentCount: number;
}

export interface BalanceInput {
  /** Lecturers to share the work between, all of whom have a known location. */
  lecturerIds: string[];
  placements: BalanceItem[];
  /** Straight-line distance from a placement to a lecturer's home. */
  distance: (placementId: string, lecturerId: string) => number;
  /** How far above an even share a lecturer may be loaded before they stop
   * taking on new placements. */
  slack?: number;
}

export interface BalanceResult {
  /** placementId -> lecturerId. */
  assignedTo: Map<string, string>;
  /** The load at which a lecturer stops taking on further placements. */
  cap: number;
}

/** Sweeps of the tidy-up pass — it converges in one or two in practice. */
const IMPROVEMENT_SWEEPS = 4;

/** Shares placements across every lecturer, keeping rounds geographically
 * tight while giving everyone a comparable number of students.
 *
 * Nearest-lecturer-wins on its own leaves any lecturer who doesn't live near a
 * cluster with nothing at all, so this:
 *   1. deals placements out nearest-first, but a lecturer stops taking them
 *      once they are carrying more than their share;
 *   2. tops the quietest lecturers back up with the placements nearest to
 *      them, while that makes the split more even;
 *   3. sweeps back through, moving placements to a nearer lecturer wherever
 *      that neither overloads them nor undoes step 2.
 */
export function sharePlacements({
  lecturerIds,
  placements,
  distance,
  slack = 0.25,
}: BalanceInput): BalanceResult {
  const assignedTo = new Map<string, string>();
  if (lecturerIds.length === 0 || placements.length === 0) return { assignedTo, cap: 0 };

  const holdings = new Map<string, Set<string>>(lecturerIds.map((id) => [id, new Set<string>()]));
  const load = new Map<string, number>(lecturerIds.map((id) => [id, 0]));
  const countOf = new Map<string, number>(placements.map((p) => [p.id, p.studentCount]));

  function place(placementId: string, lecturerId: string) {
    const count = countOf.get(placementId)!;
    const previous = assignedTo.get(placementId);
    if (previous) {
      holdings.get(previous)!.delete(placementId);
      load.set(previous, load.get(previous)! - count);
    }
    assignedTo.set(placementId, lecturerId);
    holdings.get(lecturerId)!.add(placementId);
    load.set(lecturerId, load.get(lecturerId)! + count);
  }

  const totalStudents = placements.reduce((sum, p) => sum + p.studentCount, 0);
  const evenShare = totalStudents / lecturerIds.length;
  // The cap is a stopping point, not a hard ceiling: a lecturer takes a
  // placement while they are still under it, so a placement bigger than the
  // cap can always go somewhere and one large site can't inflate the limit
  // for everyone else.
  const cap = Math.max(1, Math.ceil(evenShare * (1 + slack)));

  const nearestFirst = new Map<string, string[]>(
    placements.map((p) => [
      p.id,
      lecturerIds.slice().sort((a, b) => distance(p.id, a) - distance(p.id, b)),
    ]),
  );

  // Deal out the placements with the most to lose first — the ones whose
  // nearest and second-nearest lecturers are furthest apart — so the awkward
  // outliers get their pick before the caps fill up.
  const regret = new Map<string, number>(
    placements.map((p) => {
      const order = nearestFirst.get(p.id)!;
      const nearest = distance(p.id, order[0]);
      const second = order[1] ? distance(p.id, order[1]) : nearest;
      return [p.id, second - nearest];
    }),
  );

  for (const placement of [...placements].sort((a, b) => regret.get(b.id)! - regret.get(a.id)!)) {
    const order = nearestFirst.get(placement.id)!;
    const target =
      order.find((id) => load.get(id)! < cap) ??
      // Everyone is at their cap: give it to whoever is carrying the least,
      // nearest first (the order is already sorted by distance).
      order.reduce((best, id) => (load.get(id)! < load.get(best)! ? id : best), order[0]);
    place(placement.id, target);
  }

  // Top the quietest lecturers back up. Everyone should end up with a round,
  // so the least-loaded lecturer takes the placement nearest to them from
  // someone carrying more — as long as the swap actually evens things out.
  const floor = Math.max(1, Math.floor(evenShare * (1 - slack)));
  const imbalance = (donorLoad: number, receiverLoad: number) =>
    Math.abs(donorLoad - evenShare) + Math.abs(receiverLoad - evenShare);

  for (let move = 0; move < placements.length * 2; move++) {
    const receiver = lecturerIds.reduce((quietest, id) =>
      load.get(id)! < load.get(quietest)! ? id : quietest,
    );
    if (load.get(receiver)! >= floor) break;

    const candidates = placements
      .filter((p) => {
        const owner = assignedTo.get(p.id)!;
        // A lecturer with a single placement has nothing to spare, and the
        // move has to leave the two of them more evenly loaded than before.
        if (owner === receiver || holdings.get(owner)!.size <= 1) return false;
        return (
          imbalance(load.get(owner)! - p.studentCount, load.get(receiver)! + p.studentCount) <
          imbalance(load.get(owner)!, load.get(receiver)!)
        );
      })
      .sort((a, b) => distance(a.id, receiver) - distance(b.id, receiver));
    if (candidates.length === 0) break; // e.g. fewer placements than lecturers

    place(candidates[0].id, receiver);
  }

  for (let sweep = 0; sweep < IMPROVEMENT_SWEEPS; sweep++) {
    let moved = false;
    for (const placement of placements) {
      const from = assignedTo.get(placement.id)!;
      if (holdings.get(from)!.size <= 1) continue;
      const current = distance(placement.id, from);
      // Don't strip the lecturer handing it over back below their share —
      // that would undo the balancing above.
      if (load.get(from)! - placement.studentCount < floor) continue;
      const better = nearestFirst
        .get(placement.id)!
        .find(
          (id) =>
            id !== from &&
            distance(placement.id, id) < current &&
            load.get(id)! + placement.studentCount <= cap,
        );
      if (better) {
        place(placement.id, better);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return { assignedTo, cap };
}
