import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { db } from "../db";
import { normalisePostcode } from "../lib/geocode";
import { useGeocodedPoints } from "../lib/useGeocodedPoints";
import type { Category, Year } from "../types";
import { ADULT_COLOR, dotIcon, PAEDIATRIC_COLOR, STUDENT_COLOR } from "./mapIcons";
import { FitBounds } from "./FitBounds";

const ALL_YEARS: Year[] = [1, 2, 3];

export function OverviewMap() {
  const students = useLiveQuery(() => db.students.toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];

  const [years, setYears] = useState<Set<Year>>(new Set(ALL_YEARS));
  const [category, setCategory] = useState<Category | "all">("all");
  const [driverFilter, setDriverFilter] = useState<"all" | "driverOnly" | "noDriverNeeded">("all");
  const [showStudents, setShowStudents] = useState(true);
  const [showPlacements, setShowPlacements] = useState(true);

  const visibleStudents = students.filter((s) => years.has(s.year));
  const visiblePlacements = placements.filter((p) => {
    if (!p.yearsOffered.some((y) => years.has(y))) return false;
    if (category !== "all" && p.category !== category) return false;
    if (driverFilter === "driverOnly" && !p.requiresDriver) return false;
    if (driverFilter === "noDriverNeeded" && p.requiresDriver) return false;
    return true;
  });

  const postcodes = [
    ...(showStudents ? visibleStudents.map((s) => s.postcode) : []),
    ...(showPlacements ? visiblePlacements.map((p) => p.postcode) : []),
  ];
  const points = useGeocodedPoints(postcodes);
  const visiblePoints = postcodes
    .map((postcode) => points.get(normalisePostcode(postcode)))
    .filter((p): p is NonNullable<typeof p> => p != null);

  function toggleYear(y: Year) {
    setYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Overview Map</h2>
      </div>
      <div className="filter-row">
        <label>
          <input type="checkbox" checked={showStudents} onChange={(e) => setShowStudents(e.target.checked)} />
          Students
        </label>
        <label>
          <input type="checkbox" checked={showPlacements} onChange={(e) => setShowPlacements(e.target.checked)} />
          Placements
        </label>
        {ALL_YEARS.map((y) => (
          <label key={y}>
            <input type="checkbox" checked={years.has(y)} onChange={() => toggleYear(y)} />
            Year {y}
          </label>
        ))}
        <label>
          Category:
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "all")}>
            <option value="all">All</option>
            <option value="paediatric">Paediatric</option>
            <option value="adult">Adult</option>
          </select>
        </label>
        <label>
          Driver requirement:
          <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value as typeof driverFilter)}>
            <option value="all">All</option>
            <option value="driverOnly">Driver only</option>
            <option value="noDriverNeeded">No driver needed</option>
          </select>
        </label>
      </div>

      <div className="map-legend">
        <span>
          <i style={{ background: STUDENT_COLOR }} /> Student
        </span>
        <span>
          <i style={{ background: PAEDIATRIC_COLOR }} /> Paediatric placement
        </span>
        <span>
          <i style={{ background: ADULT_COLOR }} /> Adult placement
        </span>
        <span>Dashed border = requires a driver</span>
      </div>

      <MapContainer center={[54.5, -3]} zoom={6} style={{ height: "60vh", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showStudents &&
          visibleStudents.map((s) => {
            const pos = points.get(normalisePostcode(s.postcode));
            if (!pos) return null;
            return (
              <Marker key={s.id} position={[pos.lat, pos.lng]} icon={dotIcon(STUDENT_COLOR)}>
                <Popup>
                  <strong>{s.name}</strong>
                  <br />
                  Year {s.year} {s.isDriver ? "· Driver" : ""}
                  <br />
                  {s.postcode}
                </Popup>
              </Marker>
            );
          })}
        {showPlacements &&
          visiblePlacements.map((p) => {
            const pos = points.get(normalisePostcode(p.postcode));
            if (!pos) return null;
            const color = p.category === "paediatric" ? PAEDIATRIC_COLOR : ADULT_COLOR;
            return (
              <Marker key={p.id} position={[pos.lat, pos.lng]} icon={dotIcon(color, p.requiresDriver)}>
                <Popup>
                  <strong>{p.name}</strong>
                  <br />
                  {p.category} · Years {p.yearsOffered.join(", ")}
                  {p.requiresDriver && (
                    <>
                      <br />
                      Requires a driver
                    </>
                  )}
                  <br />
                  {p.postcode}
                </Popup>
              </Marker>
            );
          })}
        <FitBounds points={visiblePoints} />
      </MapContainer>
    </div>
  );
}
