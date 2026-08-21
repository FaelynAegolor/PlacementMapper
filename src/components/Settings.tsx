import { useEffect, useRef, useState } from "react";
import { db, getSetting, setSetting } from "../db";
import { computeIsochrone } from "../lib/isochrone";
import { loadSampleData } from "../lib/sampleData";
import { toast } from "../lib/toast";

interface Backup {
  students: unknown[];
  placements: unknown[];
  assignments: unknown[];
  lecturers: unknown[];
  geocodeCache: unknown[];
  routeCache: unknown[];
}

const DEFAULT_MAX_MINUTES = 90;

export function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [basePostcode, setBasePostcode] = useState("");
  const [maxMinutes, setMaxMinutes] = useState(DEFAULT_MAX_MINUTES);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    getSetting("googleApiKey").then((v) => {
      setApiKey(v ?? "");
      setKeyLoaded(true);
    });
    Promise.all([getSetting("basePostcode"), getSetting("baseMaxMinutes")]).then(([pc, mins]) => {
      setBasePostcode(pc ?? "");
      setMaxMinutes(mins ? Number(mins) : DEFAULT_MAX_MINUTES);
      setBaseLoaded(true);
    });
  }, []);

  async function saveBaseLocation() {
    await setSetting("basePostcode", basePostcode.trim());
    await setSetting("baseMaxMinutes", String(maxMinutes));
    toast("Base location saved");
  }

  async function recalculateBoundary() {
    if (!basePostcode.trim()) {
      toast("Set a base postcode first", "error");
      return;
    }
    const key = await getSetting("googleApiKey");
    if (!key) {
      toast("Add a Google API key first — the boundary is based on public transport time", "error");
      return;
    }
    await saveBaseLocation();
    setComputing(true);
    setProgress({ done: 0, total: 12 });
    try {
      await computeIsochrone(basePostcode.trim(), maxMinutes, "transit", (done, total) => setProgress({ done, total }));
      toast("Boundary computed — see the Overview Map");
    } catch {
      toast("Could not compute the boundary — check the base postcode", "error");
    } finally {
      setComputing(false);
      setProgress(null);
    }
  }

  async function saveKey() {
    await setSetting("googleApiKey", apiKey.trim());
    setSaved(true);
    toast("API key saved");
    setTimeout(() => setSaved(false), 1500);
  }

  async function exportData() {
    const backup: Backup = {
      students: await db.students.toArray(),
      placements: await db.placements.toArray(),
      assignments: await db.assignments.toArray(),
      lecturers: await db.lecturers.toArray(),
      geocodeCache: await db.geocodeCache.toArray(),
      routeCache: await db.routeCache.toArray(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `placement-mapper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded");
  }

  async function importData(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const backup: Backup = JSON.parse(text);

    if (!confirm("This will replace all current data with the contents of this backup. Continue?")) return;

    await db.transaction(
      "rw",
      [db.students, db.placements, db.assignments, db.lecturers, db.geocodeCache, db.routeCache],
      async () => {
        await Promise.all([
          db.students.clear(),
          db.placements.clear(),
          db.assignments.clear(),
          db.lecturers.clear(),
          db.geocodeCache.clear(),
          db.routeCache.clear(),
        ]);
        await Promise.all([
          db.students.bulkAdd(backup.students as never[]),
          db.placements.bulkAdd(backup.placements as never[]),
          db.assignments.bulkAdd(backup.assignments as never[]),
          db.lecturers.bulkAdd((backup.lecturers ?? []) as never[]),
          db.geocodeCache.bulkAdd(backup.geocodeCache as never[]),
          db.routeCache.bulkAdd(backup.routeCache as never[]),
        ]);
      },
    );
    toast("Backup imported");
  }

  async function handleLoadSampleData() {
    const existing = (await db.students.count()) + (await db.placements.count()) + (await db.lecturers.count());
    if (existing > 0 && !confirm("Add sample students, placements, and lecturers alongside your existing data?"))
      return;
    await loadSampleData();
    toast("Sample data loaded");
  }

  async function handleClearAllData() {
    if (!confirm("This will permanently delete all students, placements, lecturers, and assignments. Continue?"))
      return;
    await db.transaction("rw", [db.students, db.placements, db.assignments, db.lecturers], async () => {
      await Promise.all([db.students.clear(), db.placements.clear(), db.assignments.clear(), db.lecturers.clear()]);
    });
    toast("All data cleared");
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Settings</h2>
      </div>

      <section>
        <h3>Sample data</h3>
        <p className="hint">
          For trying the app out: adds 30 made-up students on real residential London postcodes, a set of real
          London hospitals/placements, and 5 sample link lecturers, so routing and maps work properly.
        </p>
        <button onClick={handleLoadSampleData}>Load sample data</button>
        <button className="link-danger" onClick={handleClearAllData}>
          Clear all data
        </button>
      </section>

      <section>
        <h3>Google API key</h3>
        <p className="hint">
          Needed for public transport routing (Google Routes API, TRANSIT mode). Stored only in this browser's
          local database — never sent anywhere except directly to Google when looking up a route.
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyLoaded ? "AIza…" : "Loading…"}
          disabled={!keyLoaded}
          style={{ width: "24rem" }}
        />
        <button onClick={saveKey} disabled={!keyLoaded}>
          Save
        </button>
        {saved && <span className="hint"> Saved.</span>}
      </section>

      <section>
        <h3>Base location (campus)</h3>
        <p className="hint">
          Placements are expected to be within a set travel time of this postcode (e.g. your university campus).
          The Overview Map draws an approximate boundary at that travel time by public transport, and the
          Placements table flags anything outside it. Works for any base postcode, so it's reusable for other
          sites too.
        </p>
        <input
          value={basePostcode}
          onChange={(e) => setBasePostcode(e.target.value)}
          placeholder={baseLoaded ? "e.g. SE9 2UG" : "Loading…"}
          disabled={!baseLoaded}
          style={{ width: "10rem" }}
        />
        <input
          type="number"
          min={1}
          value={maxMinutes}
          onChange={(e) => setMaxMinutes(Number(e.target.value))}
          disabled={!baseLoaded}
          style={{ width: "5rem" }}
        />
        <span className="hint" style={{ marginRight: "0.5rem" }}>
          minutes
        </span>
        <button onClick={saveBaseLocation} disabled={!baseLoaded}>
          Save
        </button>
        <button onClick={recalculateBoundary} disabled={!baseLoaded || computing}>
          {computing
            ? `Computing… (${progress?.done ?? 0}/${progress?.total ?? 12})`
            : "Recalculate boundary"}
        </button>
      </section>

      <section>
        <h3>Backup / restore</h3>
        <p className="hint">
          All data lives only in this browser. Export a backup before clearing browser storage, switching
          browsers, or moving to another machine.
        </p>
        <button onClick={exportData}>Export backup (JSON)</button>
        <button onClick={() => fileInput.current?.click()}>Import backup</button>
        <input ref={fileInput} type="file" accept=".json" hidden onChange={importData} />
      </section>
    </div>
  );
}
