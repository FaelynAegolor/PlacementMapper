import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { geocodePostcode } from "../lib/geocode";
import { formatDistance, formatDuration, getRoute, MissingApiKeyError } from "../lib/routing";
import type { Category, LatLng, Placement, TravelMode } from "../types";
import { RouteMap } from "./RouteMap";

type RouteState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; durationSeconds: number; distanceMeters: number; geometry: LatLng[] };

export function MatchExplorer() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];
  const assignments = useLiveQuery(() => db.assignments.toArray(), []) ?? [];

  const [studentId, setStudentId] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [routes, setRoutes] = useState<Record<string, { driving?: RouteState; transit?: RouteState }>>({});
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<TravelMode>("driving");

  const student = students.find((s) => s.id === studentId);
  const eligible = student
    ? placements.filter((p) => isEligible(student, p, categoryFilter === "all" ? null : categoryFilter))
    : [];

  useEffect(() => {
    if (!student) return;
    setRoutes({});
    setSelectedPlacementId(null);
    let cancelled = false;

    (async () => {
      for (const placement of eligible) {
        for (const mode of ["driving", "transit"] as const) {
          setRoutes((prev) => ({ ...prev, [placement.id]: { ...prev[placement.id], [mode]: { status: "loading" } } }));
          try {
            const result = await getRoute(student.postcode, placement.postcode, mode);
            if (cancelled) return;
            setRoutes((prev) => ({
              ...prev,
              [placement.id]: {
                ...prev[placement.id],
                [mode]: {
                  status: "ok",
                  durationSeconds: result.durationSeconds,
                  distanceMeters: result.distanceMeters,
                  geometry: result.geometry,
                },
              },
            }));
          } catch (err) {
            if (cancelled) return;
            const message = err instanceof MissingApiKeyError ? err.message : "Lookup failed";
            setRoutes((prev) => ({
              ...prev,
              [placement.id]: { ...prev[placement.id], [mode]: { status: "error", message } },
            }));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, categoryFilter]);

  const primaryMode: TravelMode = student?.isDriver ? "driving" : "transit";
  const sorted = [...eligible].sort((a, b) => {
    const ra = routes[a.id]?.[primaryMode];
    const rb = routes[b.id]?.[primaryMode];
    const da = ra?.status === "ok" ? ra.durationSeconds : Infinity;
    const db_ = rb?.status === "ok" ? rb.durationSeconds : Infinity;
    return da - db_;
  });

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const [mapPoints, setMapPoints] = useState<{ from: LatLng; to: LatLng } | null>(null);

  useEffect(() => {
    if (!student || !selectedPlacement) {
      setMapPoints(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [from, to] = await Promise.all([
          geocodePostcode(student.postcode),
          geocodePostcode(selectedPlacement.postcode),
        ]);
        if (!cancelled) setMapPoints({ from, to });
      } catch {
        if (!cancelled) setMapPoints(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [student, selectedPlacement]);

  async function assign(placement: Placement) {
    if (!student) return;
    const result = await setAssignment(student.id, placement.id, student.year);
    if (!result.ok) alert(result.reason);
  }

  const currentAssignment = student ? assignments.find((a) => a.studentId === student.id && a.year === student.year) : undefined;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Match & Assign</h2>
      </div>
      <div className="filter-row">
        <label>
          Student:
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select a student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (Year {s.year}{s.isDriver ? ", driver" : ""})
              </option>
            ))}
          </select>
        </label>
        <label>
          Category:
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}>
            <option value="all">All</option>
            <option value="paediatric">Paediatric</option>
            <option value="adult">Adult</option>
          </select>
        </label>
      </div>

      {student && (
        <>
          {currentAssignment && (
            <p className="hint">
              Currently assigned (year {student.year}):{" "}
              <strong>{placements.find((p) => p.id === currentAssignment.placementId)?.name ?? "—"}</strong>
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Placement</th>
                <th>Category</th>
                <th>Driving</th>
                <th>Transit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const driving = routes[p.id]?.driving;
                const transit = routes[p.id]?.transit;
                return (
                  <tr
                    key={p.id}
                    className={selectedPlacementId === p.id ? "selected-row" : ""}
                    onClick={() => setSelectedPlacementId(p.id)}
                  >
                    <td>{p.name}{p.requiresDriver && <span className="badge">driver only</span>}</td>
                    <td>{p.category}</td>
                    <td>{renderRouteCell(driving)}</td>
                    <td>{renderRouteCell(transit)}</td>
                    <td>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          assign(p);
                        }}
                      >
                        Assign
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length === 0 && <p className="hint">No eligible placements for this student.</p>}

          {selectedPlacement && mapPoints && (
            <div>
              <div className="filter-row">
                <label>
                  Show route by:
                  <select value={mapMode} onChange={(e) => setMapMode(e.target.value as TravelMode)}>
                    <option value="driving">Driving</option>
                    <option value="transit">Public transport</option>
                  </select>
                </label>
              </div>
              <RouteMap
                from={mapPoints.from}
                to={mapPoints.to}
                geometry={
                  routes[selectedPlacement.id]?.[mapMode]?.status === "ok"
                    ? (routes[selectedPlacement.id]![mapMode] as Extract<RouteState, { status: "ok" }>).geometry
                    : []
                }
                fromLabel={student.name}
                toLabel={selectedPlacement.name}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function renderRouteCell(state?: RouteState) {
  if (!state) return "—";
  if (state.status === "loading") return "…";
  if (state.status === "error") return <span className="text-error">{state.message}</span>;
  return `${formatDuration(state.durationSeconds)} (${formatDistance(state.distanceMeters)})`;
}
