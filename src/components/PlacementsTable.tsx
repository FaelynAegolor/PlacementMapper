import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db } from "../db";
import { downloadSamplePlacementsCsv, importPlacementsCsv } from "../lib/csv";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";
import { PostcodeLookup } from "./PostcodeLookup";

export function PlacementsTable() {
  const placements = useLiveQuery(() => db.placements.orderBy("name").toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { rows, errors } = await importPlacementsCsv(file);
    setImportErrors(errors);
    if (rows.length) {
      await db.placements.bulkAdd(rows);
      toast(`Imported ${rows.length} placement${rows.length === 1 ? "" : "s"}`);
    }
    if (errors.length) toast(`${errors.length} row${errors.length === 1 ? "" : "s"} skipped — see details below`, "error");
  }

  async function updateField(
    id: string,
    patch: Partial<{
      name: string;
      postcode: string;
      category: Category;
      yearsOffered: Year[];
      requiresDriver: boolean;
      capacity: number | null;
    }>,
  ) {
    await db.placements.update(id, patch);
  }

  async function remove(id: string, name: string) {
    await db.placements.delete(id);
    await db.assignments.where("placementId").equals(id).delete();
    toast(`Removed ${name}`);
  }

  function toggleYear(current: Year[], year: Year): Year[] {
    return current.includes(year) ? current.filter((y) => y !== year) : [...current, year].sort();
  }

  async function addPlacement() {
    await db.placements.add({
      id: crypto.randomUUID(),
      name: "New placement",
      postcode: "",
      category: "adult",
      yearsOffered: [1],
      requiresDriver: false,
      capacity: null,
    });
    toast("Placement added");
  }

  const filtered = placements?.filter((p) => categoryFilter === "all" || p.category === categoryFilter);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Placements</h2>
        <div>
          <button onClick={addPlacement}>Add placement</button>
          <button onClick={() => fileInput.current?.click()}>Import CSV</button>
          <button onClick={downloadSamplePlacementsCsv}>Download sample CSV</button>
          <input ref={fileInput} type="file" accept=".csv" hidden onChange={handleFile} />
        </div>
      </div>
      <p className="hint">
        CSV columns: <code>name, postcode, category, yearsOffered, requiresDriver, capacity</code> (category is
        "paediatric" or "adult"; yearsOffered e.g. "2;3")
      </p>
      {importErrors.length > 0 && (
        <div className="error-box">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <div className="filter-row">
        <label>
          Category:
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}>
            <option value="all">All</option>
            <option value="paediatric">Paediatric</option>
            <option value="adult">Adult</option>
          </select>
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Postcode</th>
            <th>Category</th>
            <th>Years offered</th>
            <th>Driver only?</th>
            <th>Capacity</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered?.map((p) => (
            <tr key={p.id}>
              <td>
                <input value={p.name} onChange={(e) => updateField(p.id, { name: e.target.value })} />
              </td>
              <td>
                <input value={p.postcode} onChange={(e) => updateField(p.id, { postcode: e.target.value })} />
                <PostcodeLookup
                  defaultQuery={p.name}
                  onSelect={(postcode) => {
                    updateField(p.id, { postcode });
                    toast(`Postcode set to ${postcode}`);
                  }}
                />
              </td>
              <td>
                <select
                  value={p.category}
                  onChange={(e) => updateField(p.id, { category: e.target.value as Category })}
                >
                  <option value="paediatric">Paediatric</option>
                  <option value="adult">Adult</option>
                </select>
              </td>
              <td>
                {[1, 2, 3].map((y) => (
                  <label key={y} className="year-checkbox">
                    <input
                      type="checkbox"
                      checked={p.yearsOffered.includes(y as Year)}
                      onChange={() => updateField(p.id, { yearsOffered: toggleYear(p.yearsOffered, y as Year) })}
                    />
                    {y}
                  </label>
                ))}
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={p.requiresDriver}
                  onChange={(e) => updateField(p.id, { requiresDriver: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  value={p.capacity ?? ""}
                  placeholder="∞"
                  onChange={(e) =>
                    updateField(p.id, { capacity: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  style={{ width: "4rem" }}
                />
              </td>
              <td>
                <button className="link-danger" onClick={() => remove(p.id, p.name)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered?.length === 0 && <p className="hint">No placements yet — import a CSV to get started.</p>}
    </div>
  );
}
