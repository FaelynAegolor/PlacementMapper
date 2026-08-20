import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { Year } from "../types";

const YEARS: Year[] = [1, 2, 3];

export function StatusDashboard() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.orderBy("name").toArray(), []) ?? [];
  const assignments = useLiveQuery(() => db.assignments.toArray(), []) ?? [];

  const placementById = new Map(placements.map((p) => [p.id, p]));
  const studentById = new Map(students.map((s) => [s.id, s]));

  const assignmentForCurrentYear = new Map(
    assignments.filter((a) => studentById.get(a.studentId)?.year === a.year).map((a) => [a.studentId, a]),
  );

  const waiting = students.filter((s) => !assignmentForCurrentYear.has(s.id));
  const assigned = students
    .filter((s) => assignmentForCurrentYear.has(s.id))
    .map((s) => ({ student: s, assignment: assignmentForCurrentYear.get(s.id)! }));

  const placementFill = placements.map((p) => {
    const byYear = YEARS.map((year) => ({
      year,
      count: assignments.filter((a) => a.placementId === p.id && a.year === year).length,
      offered: p.yearsOffered.includes(year),
    }));
    return { placement: p, byYear };
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Status</h2>
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-value">{students.length}</div>
          <div className="stat-label">Students</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{assigned.length}</div>
          <div className="stat-label">Assigned (current year)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{waiting.length}</div>
          <div className="stat-label">Waiting to be assigned</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{placements.length}</div>
          <div className="stat-label">Placements</div>
        </div>
      </div>

      <h3>Waiting to be assigned</h3>
      {waiting.length === 0 ? (
        <p className="hint">Every student has a placement for their current year.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Year</th>
              <th>Driver?</th>
              <th>Postcode</th>
            </tr>
          </thead>
          <tbody>
            {waiting
              .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
              .map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.year}</td>
                  <td>{s.isDriver ? "Yes" : "No"}</td>
                  <td>{s.postcode}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <h3>Assigned placements</h3>
      {assigned.length === 0 ? (
        <p className="hint">No assignments yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Year</th>
              <th>Placement</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {assigned
              .sort((a, b) => a.assignment.year - b.assignment.year || a.student.name.localeCompare(b.student.name))
              .map(({ student, assignment }) => {
                const placement = placementById.get(assignment.placementId);
                return (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>{assignment.year}</td>
                    <td>{placement?.name ?? "—"}</td>
                    <td>{placement?.category ?? "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}

      <h3>Placement capacity</h3>
      {placementFill.length === 0 ? (
        <p className="hint">No placements yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Placement</th>
              <th>Category</th>
              {YEARS.map((y) => (
                <th key={y}>Year {y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placementFill.map(({ placement, byYear }) => (
              <tr key={placement.id}>
                <td>{placement.name}</td>
                <td>{placement.category}</td>
                {byYear.map(({ year, count, offered }) => (
                  <td key={year}>
                    {!offered ? (
                      <span className="hint">not offered</span>
                    ) : placement.capacity != null ? (
                      <span className={count >= placement.capacity ? "text-error" : ""}>
                        {count} / {placement.capacity}
                        {count >= placement.capacity ? " (full)" : ""}
                      </span>
                    ) : (
                      `${count} (no cap)`
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
