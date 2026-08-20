import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { formatDistance, formatDuration } from "../lib/routing";
import { suggestAssignments, type Suggestion } from "../lib/suggest";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";

export function SuggestAndAssign() {
  const students = useLiveQuery(() => db.students.toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];

  const [year, setYear] = useState<Year>(2);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);

  async function run() {
    setRunning(true);
    setSuggestions(null);
    setOverrides({});
    try {
      const result = await suggestAssignments(year, categoryFilter === "all" ? null : categoryFilter);
      setSuggestions(result);
      toast(`Suggestions ready for ${result.length} student${result.length === 1 ? "" : "s"}`);
    } finally {
      setRunning(false);
    }
  }

  async function commit() {
    if (!suggestions) return;
    setCommitting(true);
    try {
      let assignedCount = 0;
      for (const s of suggestions) {
        const placementId = overrides[s.studentId] !== undefined ? overrides[s.studentId] : s.placementId;
        if (!placementId) continue;
        const result = await setAssignment(s.studentId, placementId, year);
        if (result.ok) {
          assignedCount++;
        } else {
          const student = students.find((st) => st.id === s.studentId);
          toast(`Could not assign ${student?.name ?? s.studentId}: ${result.reason}`, "error");
        }
      }
      if (assignedCount > 0) toast(`Committed ${assignedCount} assignment${assignedCount === 1 ? "" : "s"}`);
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
        <h2>Suggest & Assign</h2>
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
          {running ? "Working…" : "Run suggestions"}
        </button>
      </div>
      <p className="hint">
        Proposes a placement per student, minimising travel time (driving for drivers, public transport for
        everyone else), while respecting driver-only placements, capacity, and the year 2/3 repeat rule. Review
        and override below, then commit.
      </p>

      {suggestions && (
        <>
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Suggested placement</th>
                <th>Mode</th>
                <th>Time</th>
                <th>Override</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => {
                const student = students.find((st) => st.id === s.studentId);
                const placement = placements.find((p) => p.id === s.placementId);
                const overrideValue = overrides[s.studentId] !== undefined ? overrides[s.studentId] : s.placementId;
                return (
                  <tr key={s.studentId}>
                    <td>{student?.name ?? "—"}</td>
                    <td>{placement ? placement.name : <span className="text-error">{s.reason ?? "Unassigned"}</span>}</td>
                    <td>{s.mode ?? "—"}</td>
                    <td>
                      {s.durationSeconds != null && s.distanceMeters != null
                        ? `${formatDuration(s.durationSeconds)} (${formatDistance(s.distanceMeters)})`
                        : "—"}
                    </td>
                    <td>
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
