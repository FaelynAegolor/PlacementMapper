import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../db";
import { isEligible, setAssignment } from "../lib/assignments";
import { normalisePostcode } from "../lib/geocode";
import { formatDistance, formatDuration, getRoute, MissingApiKeyError } from "../lib/routing";
import { toast } from "../lib/toast";
import { useGeocodedPoints } from "../lib/useGeocodedPoints";
import type { Category, LatLng, ManifestStep, Placement, TravelMode } from "../types";
import { MatchMap } from "./MatchMap";

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

interface StudentDetailPanelProps {
  studentId: string;
  categoryFilter: Category | "all";
}

export function StudentDetailPanel({ studentId, categoryFilter }: StudentDetailPanelProps) {
  const students = useLiveQuery(() => db.students.toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];
  const assignments = useLiveQuery(() => db.assignments.toArray(), []) ?? [];

  const [sortMode, setSortMode] = useState<TravelMode>("driving");
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

  if (!student) return null;

  const sorted = [...eligible].sort((a, b) => {
    const ra = routes[a.id]?.[sortMode];
    const rb = routes[b.id]?.[sortMode];
    const da = ra?.status === "ok" ? ra.durationSeconds : Infinity;
    const db_ = rb?.status === "ok" ? rb.durationSeconds : Infinity;
    return da - db_;
  });

  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const studentPoint = mapPoints.get(normalisePostcode(student.postcode));
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

  return (
    <div className="student-detail-panel">
      {studentPoint && mapPlacements.length > 0 && (
        <>
          <MatchMap
            studentName={student.name}
            studentPoint={studentPoint}
            placements={mapPlacements}
            assignments={assignments}
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
            <span>┄ Public transport route</span>
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
            <th className="sortable-th" onClick={() => setSortMode("driving")}>
              Driving{sortMode === "driving" && " ▲"}
            </th>
            <th className="sortable-th" onClick={() => setSortMode("transit")}>
              Public transport{sortMode === "transit" && " ▲"}
            </th>
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
    </div>
  );
}

function renderRouteCell(state?: RouteState) {
  if (!state) return "—";
  if (state.status === "loading") return "…";
  if (state.status === "error") return <span className="text-error">{state.message}</span>;
  return `${formatDuration(state.durationSeconds)} (${formatDistance(state.distanceMeters)})`;
}

const VEHICLE_ICONS: Record<string, string> = {
  Bus: "🚌",
  Coach: "🚍",
  "Shared taxi": "🚕",
  Underground: "🚇",
  Tram: "🚋",
  Monorail: "🚝",
  Train: "🚆",
  Ferry: "⛴️",
  "Cable car": "🚡",
  Funicular: "🚞",
  "Public transport": "🚏",
};

const VEHICLE_BADGE_CLASSES: Record<string, string> = {
  Bus: "mode-badge mode-bus",
  Coach: "mode-badge mode-bus",
  "Shared taxi": "mode-badge mode-bus",
  Underground: "mode-badge mode-underground",
  Tram: "mode-badge mode-tram",
  Monorail: "mode-badge mode-tram",
  Train: "mode-badge mode-train",
  Ferry: "mode-badge mode-ferry",
  "Cable car": "mode-badge mode-ferry",
  Funicular: "mode-badge mode-ferry",
};

function renderManifestStep(step: ManifestStep) {
  if (step.mode === "walk") {
    return (
      <>
        <span className="mode-badge mode-walk">🚶 Walk</span>{" "}
        {formatDuration(step.durationSeconds)} ({formatDistance(step.distanceMeters)})
        {step.instructions ? ` — ${step.instructions}` : ""}
      </>
    );
  }
  const label = step.vehicleType ?? "Transit";
  return (
    <>
      <span className={VEHICLE_BADGE_CLASSES[label] ?? "mode-badge"}>
        {VEHICLE_ICONS[label] ?? "🚏"} {label}
        {step.line ? ` ${step.line}` : ""}
      </span>
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

  const transitLabels = Array.from(
    new Set((state.manifest ?? []).filter((s) => s.mode === "transit").map((s) => s.vehicleType ?? "Transit")),
  );

  return (
    <>
      {formatDuration(state.durationSeconds)} ({formatDistance(state.distanceMeters)})
      {transitLabels.length > 0 ? (
        <div className="mode-badge-row">
          {transitLabels.map((label) => (
            <span key={label} className={VEHICLE_BADGE_CLASSES[label] ?? "mode-badge"}>
              {VEHICLE_ICONS[label] ?? "🚏"} {label}
            </span>
          ))}
        </div>
      ) : (
        state.summary && <div className="hint">{state.summary}</div>
      )}
    </>
  );
}
