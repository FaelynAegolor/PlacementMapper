import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { LatLng, Placement } from "../types";
import {
  ADULT_COLOR,
  DRIVING_ROUTE_COLOR,
  dotIcon,
  PAEDIATRIC_COLOR,
  STUDENT_COLOR,
  TRANSIT_ROUTE_COLOR,
} from "./mapIcons";

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
      return;
    }
    map.fitBounds(
      points.map((p) => [p.lat, p.lng]),
      { padding: [32, 32] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)]);
  return null;
}

interface MatchMapProps {
  studentName: string;
  studentPoint: LatLng;
  placements: { placement: Placement; point: LatLng }[];
  selectedPlacementId: string | null;
  onSelect: (id: string) => void;
  drivingGeometry: LatLng[] | null;
  transitGeometry: LatLng[] | null;
}

export function MatchMap({
  studentName,
  studentPoint,
  placements,
  selectedPlacementId,
  onSelect,
  drivingGeometry,
  transitGeometry,
}: MatchMapProps) {
  const boundsPoints =
    selectedPlacementId && (drivingGeometry?.length || transitGeometry?.length)
      ? [studentPoint, ...(drivingGeometry ?? []), ...(transitGeometry ?? [])]
      : [studentPoint, ...placements.map((p) => p.point)];

  return (
    <MapContainer center={[studentPoint.lat, studentPoint.lng]} zoom={12} style={{ height: "50vh", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[studentPoint.lat, studentPoint.lng]} icon={dotIcon(STUDENT_COLOR)}>
        <Popup>{studentName}</Popup>
      </Marker>
      {placements.map(({ placement, point }) => (
        <Marker
          key={placement.id}
          position={[point.lat, point.lng]}
          icon={dotIcon(
            placement.category === "paediatric" ? PAEDIATRIC_COLOR : ADULT_COLOR,
            placement.requiresDriver,
          )}
          eventHandlers={{ click: () => onSelect(placement.id) }}
        >
          <Popup>{placement.name}</Popup>
        </Marker>
      ))}
      {drivingGeometry && drivingGeometry.length > 0 && (
        <Polyline
          positions={drivingGeometry.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: DRIVING_ROUTE_COLOR, weight: 4 }}
        />
      )}
      {transitGeometry && transitGeometry.length > 0 && (
        <Polyline
          positions={transitGeometry.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: TRANSIT_ROUTE_COLOR, weight: 4, dashArray: "2 10" }}
        />
      )}
      <FitBounds points={boundsPoints} />
    </MapContainer>
  );
}
