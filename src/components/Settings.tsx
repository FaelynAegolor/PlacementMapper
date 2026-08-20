import { useEffect, useRef, useState } from "react";
import { db, getSetting, setSetting } from "../db";

interface Backup {
  students: unknown[];
  placements: unknown[];
  assignments: unknown[];
  geocodeCache: unknown[];
  routeCache: unknown[];
}

export function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting("googleApiKey").then((v) => {
      setApiKey(v ?? "");
      setKeyLoaded(true);
    });
  }, []);

  async function saveKey() {
    await setSetting("googleApiKey", apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function exportData() {
    const backup: Backup = {
      students: await db.students.toArray(),
      placements: await db.placements.toArray(),
      assignments: await db.assignments.toArray(),
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
      [db.students, db.placements, db.assignments, db.geocodeCache, db.routeCache],
      async () => {
        await Promise.all([
          db.students.clear(),
          db.placements.clear(),
          db.assignments.clear(),
          db.geocodeCache.clear(),
          db.routeCache.clear(),
        ]);
        await Promise.all([
          db.students.bulkAdd(backup.students as never[]),
          db.placements.bulkAdd(backup.placements as never[]),
          db.assignments.bulkAdd(backup.assignments as never[]),
          db.geocodeCache.bulkAdd(backup.geocodeCache as never[]),
          db.routeCache.bulkAdd(backup.routeCache as never[]),
        ]);
      },
    );
    alert("Import complete.");
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Settings</h2>
      </div>

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
