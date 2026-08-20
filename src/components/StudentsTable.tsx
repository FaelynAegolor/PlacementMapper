import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db } from "../db";
import { downloadSampleStudentsCsv, importStudentsCsv } from "../lib/csv";
import { toast } from "../lib/toast";
import type { Year } from "../types";

export function StudentsTable() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

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

  async function updateField(id: string, patch: Partial<{ name: string; postcode: string; year: Year; isDriver: boolean }>) {
    await db.students.update(id, patch);
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
        CSV columns: <code>name, postcode, year, isDriver</code>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {students?.map((s) => (
            <tr key={s.id}>
              <td>
                <input
                  value={s.name}
                  onChange={(e) => updateField(s.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  value={s.postcode}
                  onChange={(e) => updateField(s.id, { postcode: e.target.value })}
                />
              </td>
              <td>
                <select
                  value={s.year}
                  onChange={(e) => updateField(s.id, { year: Number(e.target.value) as Year })}
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
