import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../db";
import { allocateLecturers, type AllocationResult } from "../lib/lecturerAllocation";
import { formatDistance } from "../lib/routing";
import { useStickyState } from "../lib/stickyState";
import { toast } from "../lib/toast";
import { categoricalColor } from "./mapIcons";
import { LecturerMap } from "./LecturerMap";

export function LecturerAllocationView() {
  const lecturers = useLiveQuery(() => db.lecturers.toArray(), []) ?? [];
  const [result, setResult] = useStickyState<AllocationResult | null>("allocation.result", null);
  const [allocating, setAllocating] = useState(false);

  async function runAllocation() {
    setAllocating(true);
    try {
      const allocation = await allocateLecturers();
      setResult(allocation);
      const withStudents = allocation.allocations.filter((a) => a.studentCount > 0).length;
      toast(
        `Shared ${allocation.totalStudents} student${allocation.totalStudents === 1 ? "" : "s"} across ${withStudents} of ${allocation.allocations.length} lecturer${allocation.allocations.length === 1 ? "" : "s"}`,
      );
    } finally {
      setAllocating(false);
    }
  }

  const perLecturer = result?.allocations.map((a) => a.studentCount) ?? [];
  const busiest = perLecturer.length ? Math.max(...perLecturer) : 0;
  const quietest = perLecturer.length ? Math.min(...perLecturer) : 0;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Lecturer Allocation</h2>
      </div>
      <p className="hint">
        Once students have been assigned, this shares every in-use placement across all of your link lecturers —
        keeping each round as close to home as it can while giving everyone a comparable number of students to
        visit. A lecturer stops picking up placements once they are carrying more than their share, so the
        lecturers who don't live near a cluster still get a round rather than nothing.
      </p>
      <button onClick={runAllocation} disabled={allocating || !lecturers.length}>
        {allocating ? "Allocating…" : "Allocate placements to lecturers"}
      </button>
      {!lecturers.length && <p className="hint">Add lecturers on the Lecturers tab first.</p>}

      {result && (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-value">{result.totalStudents}</div>
              <div className="stat-label">Students to visit</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{result.allocations.length}</div>
              <div className="stat-label">Lecturers sharing them</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{result.evenShare.toFixed(1)}</div>
              <div className="stat-label">An even share each</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">
                {quietest}–{busiest}
              </div>
              <div className="stat-label">Students per lecturer</div>
            </div>
          </div>

          {result.skipped.length > 0 && (
            <div className="error-box">
              {result.skipped.map(({ placement, reason }) => (
                <div key={placement.id}>
                  {placement.name}: {reason}
                </div>
              ))}
            </div>
          )}

          <LecturerMap allocation={result.allocations} />
          <div className="year-columns">
            {result.allocations.map(({ lecturer, placements, studentCount, note }, i) => (
              <div className="year-column" key={lecturer.id}>
                <h3>
                  <i
                    style={{
                      background: categoricalColor(i, result.allocations.length),
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      marginRight: 6,
                    }}
                  />
                  {lecturer.name}{" "}
                  <span className="hint">
                    ({studentCount} student{studentCount === 1 ? "" : "s"}, {placements.length} placement
                    {placements.length === 1 ? "" : "s"})
                  </span>
                </h3>
                {placements.length === 0 ? (
                  <p className="hint">{note ?? "No placements allocated."}</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Placement</th>
                        <th>Students</th>
                        <th>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placements.map(({ placement, distanceMeters, studentCount: students }) => (
                        <tr key={placement.id}>
                          <td>{placement.name}</td>
                          <td>{students}</td>
                          <td>{formatDistance(distanceMeters)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
