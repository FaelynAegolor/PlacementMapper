import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../db";
import { allocateLecturers, type LecturerAllocation } from "../lib/lecturerAllocation";
import { formatDistance } from "../lib/routing";
import { toast } from "../lib/toast";
import { categoricalColor } from "./mapIcons";
import { LecturerMap } from "./LecturerMap";

export function LecturerAllocationView() {
  const lecturers = useLiveQuery(() => db.lecturers.toArray(), []) ?? [];
  const [allocation, setAllocation] = useState<LecturerAllocation[] | null>(null);
  const [allocating, setAllocating] = useState(false);

  async function runAllocation() {
    setAllocating(true);
    try {
      const result = await allocateLecturers();
      setAllocation(result);
      const totalPlacements = result.reduce((sum, r) => sum + r.placements.length, 0);
      toast(
        `Allocated ${totalPlacements} in-use placement${totalPlacements === 1 ? "" : "s"} across ${result.length} lecturer${result.length === 1 ? "" : "s"}`,
      );
    } finally {
      setAllocating(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Lecturer Allocation</h2>
      </div>
      <p className="hint">
        Once students have been assigned, group every in-use placement by proximity to the nearest link
        lecturer's home — so no one travels further than they need to for their visits.
      </p>
      <button onClick={runAllocation} disabled={allocating || !lecturers.length}>
        {allocating ? "Allocating…" : "Allocate placements to lecturers"}
      </button>
      {!lecturers.length && <p className="hint">Add lecturers on the Lecturers tab first.</p>}

      {allocation && (
        <>
          <LecturerMap allocation={allocation} />
          <div className="year-columns">
            {allocation.map(({ lecturer, placements }, i) => (
              <div className="year-column" key={lecturer.id}>
                <h3>
                  <i
                    style={{
                      background: categoricalColor(i, allocation.length),
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      marginRight: 6,
                    }}
                  />
                  {lecturer.name} <span className="hint">({placements.length})</span>
                </h3>
                {placements.length === 0 ? (
                  <p className="hint">No placements allocated.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Placement</th>
                        <th>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placements.map(({ placement, distanceMeters }) => (
                        <tr key={placement.id}>
                          <td>{placement.name}</td>
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
