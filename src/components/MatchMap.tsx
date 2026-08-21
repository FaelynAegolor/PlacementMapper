import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { placesAvailableLabel } from "../lib/assignments";
import type { Assignment, LatLng, Placement } from "../types";
import {
  ADULT_COLOR,
  DRIVING_ROUTE_COLOR,
  dotIcon,
  PAEDIATRIC_COLOR,
  STUDENT_COLOR,
  TRANSIT_ROUTE_COLOR,
} from "./mapIcons";
import { FitBounds } from "./FitBounds";

interface MatchMapProps {
  studentName: string;
  studentPoint: LatLng;
  placements: { placement: Placement; point: LatLng }[];
  assignments: Assignment[];
  selectedPlacementId: string | null;
  onSelect: (id: string) => void;
  drivingGeometry: LatLng[] | null;
  transitGeometry: LatLng[] | null;
}

export function MatchMap({
  studentName,
  studentPoint,
  placements,
  assignments,
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
          <Popup>
            <strong>{placement.name}</strong>
            <br />
            {placesAvailableLabel(placement, assignments)}
          </Popup>
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
