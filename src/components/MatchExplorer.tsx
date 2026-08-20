import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { formatDistance, formatDuration, getRoute, MissingApiKeyError } from "../lib/routing";
import { useGeocodedPoints } from "../lib/useGeocodedPoints";
import { normalisePostcode } from "../lib/geocode";
import type { Category, LatLng, ManifestStep, Placement } from "../types";
import { MatchMap } from "./MatchMap";
import { toast } from "../lib/toast";

type RouteState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      durationSeconds: number;
      distanceMeters: number;
      geometry: LatLng[];
      summary?: string;
      manifest?: ManifestStep[];
    };

export function MatchExplorer() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];
  const assignments = useLiveQuery(() => db.assignments.toArray(), []) ?? [];

  const [studentId, setStudentId] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [routes, setRoutes] = useState<Record<string, { driving?: RouteState; transit?: RouteState }>>({});
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);

  const student = students.find((s) => s.id === studentId);
  const eligible = student
    ? placements.filter((p) => isEligible(student, p, categoryFilter === "all" ? null : categoryFilter))
    : [];

  const mapPoints = useGeocodedPoints(student ? [student.postcode, ...eligible.map((p) => p.postcode)] : []);

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
                  summary: result.summary,
                  manifest: result.manifest,
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

  const primaryMode = student?.isDriver ? "driving" : "transit";
  const sorted = [...eligible].sort((a, b) => {
    const ra = routes[a.id]?.[primaryMode];
    const rb = routes[b.id]?.[primaryMode];
    const da = ra?.status === "ok" ? ra.durationSeconds : Infinity;
    const db_ = rb?.status === "ok" ? rb.durationSeconds : Infinity;
    return da - db_;
  });

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const studentPoint = student ? mapPoints.get(normalisePostcode(student.postcode)) : undefined;
  const mapPlacements = eligible
    .map((placement) => {
      const point = mapPoints.get(normalisePostcode(placement.postcode));
      return point ? { placement, point } : null;
    })
    .filter((x): x is { placement: Placement; point: LatLng } => x !== null);

  const selectedDriving = selectedPlacementId ? routes[selectedPlacementId]?.driving : undefined;
  const selectedTransit = selectedPlacementId ? routes[selectedPlacementId]?.transit : undefined;

  function isPlacementFull(placement: Placement): boolean {
    if (!student || placement.capacity == null) return false;
    const count = assignments.filter((a) => a.placementId === placement.id && a.year === student.year).length;
    const alreadyHolds = assignments.some(
      (a) => a.studentId === student.id && a.year === student.year && a.placementId === placement.id,
    );
    return !alreadyHolds && count >= placement.capacity;
  }

  async function assign(placement: Placement) {
    if (!student) return;
    const result = await setAssignment(student.id, placement.id, student.year);
    if (result.ok) toast(`Assigned ${student.name} to ${placement.name}`);
    else toast(result.reason ?? "Could not assign", "error");
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

          {studentPoint && mapPlacements.length > 0 && (
            <>
              <MatchMap
                studentName={student.name}
                studentPoint={studentPoint}
                placements={mapPlacements}
                selectedPlacementId={selectedPlacementId}
                onSelect={setSelectedPlacementId}
                drivingGeometry={selectedDriving?.status === "ok" ? selectedDriving.geometry : null}
                transitGeometry={selectedTransit?.status === "ok" ? selectedTransit.geometry : null}
              />
              <div className="map-legend">
                <span>
                  <i style={{ background: "#0f766e" }} /> Student
                </span>
                <span>
                  <i style={{ background: "#2563eb" }} /> Paediatric placement
                </span>
                <span>
                  <i style={{ background: "#b45309" }} /> Adult placement
                </span>
                <span>— Driving route</span>
                <span>┄ Transit route</span>
              </div>
              {selectedPlacement && (
                <div className="route-summary-row">
                  <div className="route-summary-tile">
                    <strong>Driving</strong>
                    <div>{renderRouteSummary(selectedDriving)}</div>
                  </div>
                  <div className="route-summary-tile">
                    <strong>Public transport</strong>
                    <div>{renderRouteSummary(selectedTransit)}</div>
                  </div>
                </div>
              )}
              {selectedTransit?.status === "ok" && selectedTransit.manifest && selectedTransit.manifest.length > 0 && (
                <div className="journey-manifest">
                  <h4>Public transport journey</h4>
                  <ol>
                    {selectedTransit.manifest.map((step, i) => (
                      <li key={i}>{renderManifestStep(step)}</li>
                    ))}
                  </ol>
                </div>
              )}
            </>
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
                const full = isPlacementFull(p);
                return (
                  <tr
                    key={p.id}
                    className={selectedPlacementId === p.id ? "selected-row" : ""}
                    onClick={() => setSelectedPlacementId(p.id)}
                  >
                    <td>
                      {p.name}
                      {p.requiresDriver && <span className="badge">driver only</span>}
                      {full && <span className="badge badge-full">full</span>}
                    </td>
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

function renderManifestStep(step: ManifestStep) {
  if (step.mode === "walk") {
    return (
      <>
        Walk {formatDuration(step.durationSeconds)} ({formatDistance(step.distanceMeters)})
        {step.instructions ? ` — ${step.instructions}` : ""}
      </>
    );
  }
  return (
    <>
      <strong>
        {step.vehicleType}
        {step.line ? ` ${step.line}` : ""}
      </strong>
      {step.headsign ? ` towards ${step.headsign}` : ""}
      {step.fromStop || step.toStop ? `: ${step.fromStop ?? "?"} → ${step.toStop ?? "?"}` : ""}
      {step.stopCount ? ` (${step.stopCount} stop${step.stopCount === 1 ? "" : "s"})` : ""}
      {" — "}
      {formatDuration(step.durationSeconds)}
    </>
  );
}

function renderRouteSummary(state?: RouteState) {
  if (!state) return "—";
  if (state.status === "loading") return "Looking up…";
  if (state.status === "error") return <span className="text-error">{state.message}</span>;
  return (
    <>
      {formatDuration(state.durationSeconds)} ({formatDistance(state.distanceMeters)})
      {state.summary && <div className="hint">{state.summary}</div>}
    </>
  );
}
