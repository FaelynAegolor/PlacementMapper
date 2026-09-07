import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db } from "../db";
import { downloadSampleStudentsCsv, importStudentsCsv } from "../lib/csv";
import { isOutwardCodeOnly } from "../lib/geocode";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";

export function StudentsTable() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  // The table is live-sorted by name, so committing every keystroke would
  // re-sort (and jump focus) mid-edit. Buffer name edits locally and only
  // write through on blur.
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { rows, errors } = await importStudentsCsv(file);
    setImportErrors(errors);
    if (rows.length) {
      await db.students.bulkAdd(rows);
      toast(`Imported ${rows.length} student${rows.length === 1 ? "" : "s"}`);
    }
    if (errors.length) toast(`${errors.length} row${errors.length === 1 ? "" : "s"} skipped — see details below`, "error");
  }

  async function updateField(
    id: string,
    patch: Partial<{
      name: string;
      postcode: string;
      year: Year;
      isDriver: boolean;
      requiredCategory: Category | null;
    }>,
  ) {
    await db.students.update(id, patch);
  }

  /** A student can hold assignments from earlier years of their course, but
   * not for a year they haven't reached — those would sit in the database
   * taking up a place at a placement for a student who isn't there. */
  async function changeYear(id: string, name: string, year: Year) {
    await db.students.update(id, { year });
    const held = await db.assignments.where("studentId").equals(id).toArray();
    const ahead = held.filter((a) => a.year > year);
    if (ahead.length === 0) return;
    await db.assignments.bulkDelete(ahead.map((a) => a.id));
    const years = ahead.map((a) => a.year).sort().join(" and ");
    toast(`Removed ${name}'s year ${years} placement${ahead.length === 1 ? "" : "s"} — they're now year ${year}`);
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
    await db.students.delete(id);
    await db.assignments.where("studentId").equals(id).delete();
    toast(`Removed ${name}`);
  }

  async function addStudent() {
    await db.students.add({
      id: crypto.randomUUID(),
      name: "New student",
      postcode: "",
      year: 1,
      isDriver: false,
      requiredCategory: null,
    });
    toast("Student added");
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Students</h2>
        <div>
          <button onClick={addStudent}>Add student</button>
          <button onClick={() => fileInput.current?.click()}>Import CSV</button>
          <button onClick={downloadSampleStudentsCsv}>Download sample CSV</button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            hidden
            onChange={handleFile}
          />
        </div>
      </div>
      <p className="hint">
        CSV columns: <code>name, postcode, year, isDriver, requiredCategory</code> (requiredCategory is
        optional — "paediatric", "adult", or blank for either). Postcodes can be full or just the outward code
        (e.g. <code>SE9</code>) if you'd rather not hold students' full addresses; an outward code is placed at
        the centre of that area, so travel times are approximate.
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
            <th>Postcode</th>
            <th>Year</th>
            <th>Driver?</th>
            <th>Needs placement type</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {students?.map((s) => (
            <tr key={s.id}>
              <td>
                <input
                  value={nameDrafts[s.id] ?? s.name}
                  onChange={(e) => setNameDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  onBlur={() => commitName(s.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </td>
              <td>
                <input
                  value={s.postcode}
                  onChange={(e) => updateField(s.id, { postcode: e.target.value })}
                />
                {isOutwardCodeOnly(s.postcode) && <div className="hint">area centre</div>}
              </td>
              <td>
                <select
                  value={s.year}
                  onChange={(e) => changeYear(s.id, s.name, Number(e.target.value) as Year)}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={s.isDriver}
                  onChange={(e) => updateField(s.id, { isDriver: e.target.checked })}
                />
              </td>
              <td>
                <select
                  value={s.requiredCategory ?? ""}
                  onChange={(e) =>
                    updateField(s.id, { requiredCategory: (e.target.value || null) as Category | null })
                  }
                >
                  <option value="">Either</option>
                  <option value="paediatric">Paediatric</option>
                  <option value="adult">Adult</option>
                </select>
              </td>
              <td>
                <button className="link-danger" onClick={() => remove(s.id, s.name)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {students?.length === 0 && <p className="hint">No students yet — import a CSV to get started.</p>}
    </div>
  );
}
