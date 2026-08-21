import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db } from "../db";
import { downloadSampleLecturersCsv, importLecturersCsv } from "../lib/csv";
import { allocateLecturers, type LecturerAllocation } from "../lib/lecturerAllocation";
import { formatDistance } from "../lib/routing";
import { toast } from "../lib/toast";

export function LecturersTable() {
  const lecturers = useLiveQuery(() => db.lecturers.orderBy("name").toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [allocation, setAllocation] = useState<LecturerAllocation[] | null>(null);
  const [allocating, setAllocating] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { rows, errors } = await importLecturersCsv(file);
    setImportErrors(errors);
    if (rows.length) {
      await db.lecturers.bulkAdd(rows);
      toast(`Imported ${rows.length} lecturer${rows.length === 1 ? "" : "s"}`);
    }
    if (errors.length) toast(`${errors.length} row${errors.length === 1 ? "" : "s"} skipped — see details below`, "error");
  }

  async function updateField(id: string, patch: Partial<{ name: string; postcode: string }>) {
    await db.lecturers.update(id, patch);
  }

  function commitName(id: string) {
    const draft = nameDrafts[id];
    setNameDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (draft !== undefined) updateField(id, { name: draft });
  }

  async function remove(id: string, name: string) {
    await db.lecturers.delete(id);
    toast(`Removed ${name}`);
  }

  async function addLecturer() {
    await db.lecturers.add({ id: crypto.randomUUID(), name: "New lecturer", postcode: "" });
    toast("Lecturer added");
  }

  async function runAllocation() {
    setAllocating(true);
    try {
      const result = await allocateLecturers();
      setAllocation(result);
      const totalPlacements = result.reduce((sum, r) => sum + r.placements.length, 0);
      toast(`Allocated ${totalPlacements} in-use placement${totalPlacements === 1 ? "" : "s"} across ${result.length} lecturer${result.length === 1 ? "" : "s"}`);
    } finally {
      setAllocating(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Lecturers</h2>
        <div>
          <button onClick={addLecturer}>Add lecturer</button>
          <button onClick={() => fileInput.current?.click()}>Import CSV</button>
          <button onClick={downloadSampleLecturersCsv}>Download sample CSV</button>
          <input ref={fileInput} type="file" accept=".csv" hidden onChange={handleFile} />
        </div>
      </div>
      <p className="hint">
        CSV columns: <code>name, postcode</code> (home postcode, used to find each lecturer's nearest
        placements).
      </p>
      {importErrors.length > 0 && (
        <div className="error-box">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Home postcode</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lecturers?.map((l) => (
            <tr key={l.id}>
              <td>
                <input
                  value={nameDrafts[l.id] ?? l.name}
                  onChange={(e) => setNameDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                  onBlur={() => commitName(l.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </td>
              <td>
                <input value={l.postcode} onChange={(e) => updateField(l.id, { postcode: e.target.value })} />
              </td>
              <td>
                <button className="link-danger" onClick={() => remove(l.id, l.name)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lecturers?.length === 0 && <p className="hint">No lecturers yet — add one or import a CSV.</p>}

      <h3>Link lecturer allocation</h3>
      <p className="hint">
        Groups every placement that currently has at least one student assigned by proximity, giving each
        lecturer the nearest ones — so no one travels further than they need to.
      </p>
      <button onClick={runAllocation} disabled={allocating || !lecturers?.length}>
        {allocating ? "Allocating…" : "Allocate placements to lecturers"}
      </button>

      {allocation && (
        <div className="year-columns">
          {allocation.map(({ lecturer, placements }) => (
            <div className="year-column" key={lecturer.id}>
              <h3>
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
      )}
    </div>
  );
}
