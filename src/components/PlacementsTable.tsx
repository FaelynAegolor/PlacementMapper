import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { db, getSetting } from "../db";
import { downloadSamplePlacementsCsv, importPlacementsCsv } from "../lib/csv";
import { formatDuration, getRoute } from "../lib/routing";
import { toast } from "../lib/toast";
import type { Category, Year } from "../types";
import { PostcodeLookup } from "./PostcodeLookup";

type CampusCheck = { status: "loading" } | { status: "error" } | { status: "ok"; minutes: number };

export function PlacementsTable() {
  const placements = useLiveQuery(() => db.placements.orderBy("name").toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  // The table is live-sorted by name, so committing every keystroke would
  // re-sort (and jump focus) mid-edit. Buffer name edits locally and only
  // write through on blur.
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  const [basePostcode, setBasePostcode] = useState<string | null>(null);
  const [baseMaxMinutes, setBaseMaxMinutes] = useState<number | null>(null);
  const [campusChecks, setCampusChecks] = useState<Record<string, CampusCheck>>({});
  const [checkingCampus, setCheckingCampus] = useState(false);

  useEffect(() => {
    Promise.all([getSetting("basePostcode"), getSetting("baseMaxMinutes")]).then(([pc, mins]) => {
      setBasePostcode(pc ?? null);
      setBaseMaxMinutes(mins ? Number(mins) : null);
    });
  }, []);

  async function checkCampusDistances() {
    if (!basePostcode || !placements) return;
    setCheckingCampus(true);
    for (const p of placements) {
      setCampusChecks((prev) => ({ ...prev, [p.id]: { status: "loading" } }));
      try {
        const route = await getRoute(basePostcode, p.postcode, "transit");
        setCampusChecks((prev) => ({ ...prev, [p.id]: { status: "ok", minutes: Math.round(route.durationSeconds / 60) } }));
      } catch {
        setCampusChecks((prev) => ({ ...prev, [p.id]: { status: "error" } }));
      }
    }
    setCheckingCampus(false);
  }

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
          {basePostcode && (
            <button onClick={checkCampusDistances} disabled={checkingCampus}>
              {checkingCampus ? "Checking…" : "Check distance from base"}
            </button>
          )}
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
            {basePostcode && <th>From base</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered?.map((p) => (
            <tr key={p.id}>
              <td>
                <input
                  value={nameDrafts[p.id] ?? p.name}
                  onChange={(e) => setNameDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  onBlur={() => commitName(p.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
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
              {basePostcode && (
                <td>{renderCampusCheck(campusChecks[p.id], baseMaxMinutes)}</td>
              )}
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

function renderCampusCheck(check: CampusCheck | undefined, maxMinutes: number | null) {
  if (!check) return <span className="hint">—</span>;
  if (check.status === "loading") return "…";
  if (check.status === "error") return <span className="text-error">Lookup failed</span>;
  const over = maxMinutes != null && check.minutes > maxMinutes;
  return (
    <span className={over ? "text-error" : ""}>
      {over ? "⚠ " : "✓ "}
      {formatDuration(check.minutes * 60)}
      {over ? ` (over ${maxMinutes})` : ""}
    </span>
  );
}
