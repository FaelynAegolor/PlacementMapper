import { useLiveQuery } from "dexie-react-hooks";
import { Fragment, useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { formatDistance, formatDuration, formatMode } from "../lib/routing";
import { ordinal, suggestAssignments, type Suggestion } from "../lib/suggest";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";
import { StudentDetailPanel } from "./StudentDetailPanel";

export function AssignPlacements() {
  const students = useLiveQuery(() => db.students.toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];

  const [year, setYear] = useState<Year>(1);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);

  async function run() {
    setRunning(true);
    setOverrides({});
    try {
      const result = await suggestAssignments(year, categoryFilter === "all" ? null : categoryFilter);
      setSuggestions(result);
      const proposed = result.filter((s) => s.status === "suggested").length;
      toast(`${proposed} new suggestion${proposed === 1 ? "" : "s"} — ${result.length - proposed} already handled`);
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
        const placementId = overrides[s.studentId] !== undefined ? overrides[s.studentId] : s.placementId;
        if (!placementId) continue;
        const result = await setAssignment(s.studentId, placementId, year);
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

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Assign Placements</h2>
      </div>
      <div className="filter-row">
        <label>
          Year:
          <select value={year} onChange={(e) => setYear(Number(e.target.value) as Year)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          Category:
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}>
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
        Proposes each unassigned student's closest eligible placement by travel time. Already-committed
        assignments are left alone and their capacity is respected — re-run after committing or overriding to
        see the rest adjust. Click a student's row to see their map, routes, and journey detail; use the
        override dropdown to pick something else before committing.
      </p>

      {suggestions && (
        <>
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
              {suggestions.map((s) => {
                const student = students.find((st) => st.id === s.studentId);
                const placement = placements.find((p) => p.id === s.placementId);
                const overrideValue = overrides[s.studentId] !== undefined ? overrides[s.studentId] : s.placementId;
                const expanded = expandedStudentId === s.studentId;
                return (
                  <Fragment key={s.studentId}>
                    <tr
                      className={expanded ? "selected-row" : ""}
                      onClick={() => setExpandedStudentId(expanded ? null : s.studentId)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{expanded ? "▼" : "▶"}</td>
                      <td>{student?.name ?? "—"}</td>
                      <td>
                        {s.status === "committed" && <span className="badge">assigned</span>}
                        {s.status === "suggested" && <span className="badge">suggested</span>}
                        {s.status === "unassigned" && <span className="badge badge-full">waiting</span>}
                      </td>
                      <td>
                        {placement ? placement.name : <span className="text-error">{s.reason ?? "Unassigned"}</span>}
                      </td>
                      <td>{formatMode(s.mode)}</td>
                      <td>
                        {s.durationSeconds != null && s.distanceMeters != null
                          ? `${formatDuration(s.durationSeconds)} (${formatDistance(s.distanceMeters)})`
                          : "—"}
                      </td>
                      <td>
                        {s.rank != null && <span className="badge">{ordinal(s.rank)} closest</span>}
                        {s.explanation && <div className="hint">{s.explanation}</div>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          value={overrideValue ?? ""}
                          onChange={(e) =>
                            setOverrides((prev) => ({ ...prev, [s.studentId]: e.target.value || null }))
                          }
                        >
                          <option value="">None</option>
                          {eligiblePlacementsFor(s.studentId).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8}>
                          <StudentDetailPanel studentId={s.studentId} categoryFilter={categoryFilter} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <button onClick={commit} disabled={committing}>
            {committing ? "Saving…" : "Commit assignments"}
          </button>
        </>
      )}
    </div>
  );
}
