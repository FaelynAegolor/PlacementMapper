import Dexie, { type Table } from "dexie";
import type { Assignment, LatLng, Placement, RouteResult, Student } from "./types";

interface GeocodeEntry {
  postcode: string;
  latLng: LatLng;
}

interface SettingEntry {
  key: string;
  value: string;
}

class PlacementMapperDB extends Dexie {
  students!: Table<Student, string>;
  placements!: Table<Placement, string>;
  assignments!: Table<Assignment, string>;
  geocodeCache!: Table<GeocodeEntry, string>;
  routeCache!: Table<RouteResult, string>;
  settings!: Table<SettingEntry, string>;

  constructor() {
    super("placement-mapper");
    this.version(1).stores({
      students: "id, name, year, isDriver",
      placements: "id, name, category, requiresDriver",
      assignments: "id, studentId, placementId, year, [studentId+year]",
      geocodeCache: "postcode",
      routeCache: "key, mode",
      settings: "key",
    });
  }
}

export const db = new PlacementMapperDB();

export async function getSetting(key: string): Promise<string | undefined> {
  const entry = await db.settings.get(key);
  return entry?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}
