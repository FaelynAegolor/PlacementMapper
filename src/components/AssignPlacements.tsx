import { useLiveQuery } from "dexie-react-hooks";
import { Fragment, useEffect, useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { formatDistance, formatDuration, formatMode } from "../lib/routing";
import { useStickyState } from "../lib/stickyState";
import {
  DEFAULT_MAX_STUDENT_MINUTES,
  getMaxStudentMinutes,
  ordinal,
  suggestAssignments,
  type Suggestion,
} from "../lib/suggest";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";
import { StudentDetailPanel } from "./StudentDetailPanel";

export function AssignPlacements() {
  const students = useLiveQuery(() => db.students.toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];

  // Kept across tab switches — this view unmounts when you navigate away, and
  // losing the year, filters, and a whole run of suggestions is worse than
  // holding them in memory.
  const [year, setYear] = useStickyState<Year>("assign.year", 1);
  const [categoryFilter, setCategoryFilter] = useStickyState<Category | "all">("assign.category", "all");
  const [suggestions, setSuggestions] = useStickyState<Suggestion[] | null>("assign.suggestions", null);
  const [overrides, setOverrides] = useStickyState<Record<string, string | null>>("assign.overrides", {});
  const [expandedStudentId, setExpandedStudentId] = useStickyState<string | null>("assign.expanded", null);
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useStickyState("assign.onlyUnresolved", true);

  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState(DEFAULT_MAX_STUDENT_MINUTES);

  useEffect(() => {
    getMaxStudentMinutes().then(setMaxMinutes);
  }, []);

  // Results belong to the year and category they were run for, so changing
  // either clears them rather than leaving mismatched rows on screen.
  function changeFilters(next: { year?: Year; category?: Category | "all" }) {
    if (next.year !== undefined) setYear(next.year);
    if (next.category !== undefined) setCategoryFilter(next.category);
    setSuggestions(null);
    setOverrides({});
    setExpandedStudentId(null);
  }

  async function run() {
    setRunning(true);
    setOverrides({});
    try {
      const result = await suggestAssignments(year, categoryFilter === "all" ? null : categoryFilter);
      setSuggestions(result);
      const proposed = result.filter((s) => s.status === "suggested").length;
      const stuck = result.filter((s) => s.status === "unassigned").length;
      toast(
        `${proposed} new suggestion${proposed === 1 ? "" : "s"} — ${result.length - proposed - stuck} already handled` +
          (stuck ? `, ${stuck} with no eligible placement` : ""),
      );
    } finally {
      setRunning(false);
    }
  }

  async function commit() {
    if (!suggestions) return;
    setCommitting(true);
    try {
      let count = 0;
      for (const s of suggestions) {
        const overridden = overrides[s.studentId] !== undefined;
        const placementId = overridden ? overrides[s.studentId] : s.placementId;
        if (!placementId) continue;
        // A suggestion only lands over capacity when there was nowhere else
        // for the student to go, so let it save; a manual override still has
        // to respect the limit.
        const result = await setAssignment(s.studentId, placementId, year, {
          allowOverCapacity: !overridden && s.overCapacity,
        });
        if (result.ok) count++;
        else {
          const student = students.find((st) => st.id === s.studentId);
          toast(`Could not assign ${student?.name ?? s.studentId}: ${result.reason}`, "error");
        }
      }
      if (count > 0) toast(`Committed ${count} assignment${count === 1 ? "" : "s"}`);
      await run();
    } finally {
      setCommitting(false);
    }
  }

  const eligiblePlacementsFor = (studentId: string) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return [];
    return placements.filter((p) => isEligible(student, p, categoryFilter === "all" ? null : categoryFilter));
  };

  /** The override options for a row: everything this student is eligible for,
   * plus whatever they are currently on if that no longer qualifies — leaving
   * it out would show "None" for a student who is in fact still assigned. */
  const overrideOptionsFor = (studentId: string, currentPlacementId: string | null) => {
    const eligible = eligiblePlacementsFor(studentId);
    const current = currentPlacementId ? placements.find((p) => p.id === currentPlacementId) : null;
    if (!current || eligible.some((p) => p.id === current.id)) {
      return eligible.map((placement) => ({ placement, ineligible: false }));
    }
    return [
      { placement: current, ineligible: true },
      ...eligible.map((placement) => ({ placement, ineligible: false })),
    ];
  };

  /** Settled: committed, with nothing flagged for review. A committed
   * student who is too far, over capacity or on the wrong type of placement
   * still needs looking at, so "unresolved" keeps them on screen. */
  const isResolved = (s: Suggestion) =>
    s.status === "committed" && !s.tooFar && !s.overCapacity && !s.typeMismatch;

  const journeyLabel = (s: Suggestion) => {
    if (s.durationSeconds == null || s.distanceMeters == null) return "—";
    const time = formatDuration(s.durationSeconds);
    return s.estimated
      ? `~${time} (${formatDistance(s.distanceMeters)}, estimated)`
      : `${time} (${formatDistance(s.distanceMeters)})`;
  };

  const visibleSuggestions = (suggestions ?? []).filter((s) => !showOnlyUnresolved || !isResolved(s));

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Assign Placements</h2>
      </div>
      <div className="filter-row">
        <label>
          Year:
          <select value={year} onChange={(e) => changeFilters({ year: Number(e.target.value) as Year })}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          Category:
          <select
            value={categoryFilter}
            onChange={(e) => changeFilters({ category: e.target.value as Category | "all" })}
          >
            <option value="all">All</option>
            <option value="paediatric">Paediatric</option>
            <option value="adult">Adult</option>
          </select>
        </label>
        <button onClick={run} disabled={running}>
          {running ? "Working…" : suggestions ? "Re-run suggestions" : "Run suggestions"}
        </button>
      </div>
      <p className="hint">
        Proposes each unassigned student's closest eligible placement by travel time. Every student gets a
        placement: if nothing nearby has room, they go to the nearest eligible placement anyway and are flagged
        as over capacity, and anything further than {maxMinutes} minutes is flagged as too far (change that
        limit on the Settings tab). Only a student with no eligible placement at all — no placement taking their
        year, driver status, or required type — is left unassigned. Already-committed assignments are left alone
        and their capacity is respected; re-run after committing or overriding to see the rest adjust. Click a
        student's row for their map, routes, and journey detail.
      </p>

      {suggestions && (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.status === "committed").length}</div>
              <div className="stat-label">Already assigned</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.status === "suggested").length}</div>
              <div className="stat-label">Suggested, ready to commit</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.tooFar).length}</div>
              <div className="stat-label">Further than {maxMinutes} min</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.overCapacity).length}</div>
              <div className="stat-label">Over the placement's capacity</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.typeMismatch).length}</div>
              <div className="stat-label">Wrong placement type</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{suggestions.filter((s) => s.status === "unassigned").length}</div>
              <div className="stat-label">No eligible placement</div>
            </div>
          </div>
          <label className="filter-row">
            <input
              type="checkbox"
              checked={showOnlyUnresolved}
              onChange={(e) => setShowOnlyUnresolved(e.target.checked)}
            />
            Show only unresolved (hide assigned students with nothing flagged)
          </label>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Student</th>
                <th>Status</th>
                <th>Placement</th>
                <th>Mode</th>
                <th>Time</th>
                <th>Why this choice</th>
                <th>Override</th>
              </tr>
            </thead>
            <tbody>
              {visibleSuggestions.map((s) => {
                const student = students.find((st) => st.id === s.studentId);
                const placement = placements.find((p) => p.id === s.placementId);
                const overrideValue = overrides[s.studentId] !== undefined ? overrides[s.studentId] : s.placementId;
                const expanded = expandedStudentId === s.studentId;
                const rowClass = [
                  expanded ? "selected-row" : "",
                  s.tooFar || s.typeMismatch ? "row-warning" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Fragment key={s.studentId}>
                    <tr
                      className={rowClass}
                      onClick={() => setExpandedStudentId(expanded ? null : s.studentId)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{expanded ? "▼" : "▶"}</td>
                      <td>{student?.name ?? "—"}</td>
                      <td>
                        {s.status === "committed" && <span className="badge">assigned</span>}
                        {s.status === "suggested" && <span className="badge">suggested</span>}
                        {s.status === "unassigned" && <span className="badge badge-full">no placement</span>}
                        {s.tooFar && <span className="badge badge-warning">too far</span>}
                        {s.overCapacity && <span className="badge badge-full">over capacity</span>}
                        {s.typeMismatch && <span className="badge badge-full">wrong type</span>}
                        {s.needsSetup && <span className="badge">setup needed</span>}
                      </td>
                      <td>
                        {placement ? placement.name : <span className="text-error">{s.reason ?? "Unassigned"}</span>}
                      </td>
                      <td>{formatMode(s.mode)}</td>
                      <td>{journeyLabel(s)}</td>
                      <td>
                        {s.rank != null && <span className="badge">{ordinal(s.rank)} closest</span>}
                        {s.explanation && <div className="hint">{s.explanation}</div>}
                        {s.tooFar && (
                          <div className="hint text-warning">
                            Longer than the {maxMinutes} minute limit — check this one before committing.
                          </div>
                        )}
                        {s.typeMismatch && (
                          <div className="hint text-warning">
                            This placement isn't the type the student needs — it was assigned before that was
                            set. Pick another below, or clear the requirement on the Students tab.
                          </div>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          value={overrideValue ?? ""}
                          onChange={(e) =>
                            setOverrides((prev) => ({ ...prev, [s.studentId]: e.target.value || null }))
                          }
                        >
                          <option value="">None</option>
                          {overrideOptionsFor(s.studentId, overrideValue).map(({ placement, ineligible }) => (
                            <option key={placement.id} value={placement.id}>
                              {placement.name}
                              {ineligible ? " (doesn't match this student)" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8}>
                          <StudentDetailPanel
                            studentId={s.studentId}
                            categoryFilter={categoryFilter}
                            initialPlacementId={overrideValue}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {visibleSuggestions.length === 0 && (
            <p className="hint">
              {suggestions.length === 0
                ? `No students in year ${year}.`
                : "Nothing left to review — untick above to see the assigned students."}
            </p>
          )}
          <button onClick={commit} disabled={committing}>
            {committing ? "Saving…" : "Commit assignments"}
          </button>
        </>
      )}
    </div>
  );
}
