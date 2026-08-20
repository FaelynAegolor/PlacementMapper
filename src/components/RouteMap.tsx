import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLng } from "../types";
import { dotIcon, PAEDIATRIC_COLOR, STUDENT_COLOR } from "./mapIcons";

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  if (points.length >= 2) {
    map.fitBounds(
      points.map((p) => [p.lat, p.lng]),
      { padding: [24, 24] },
    );
  }
  return null;
}

interface RouteMapProps {
  from: LatLng;
  to: LatLng;
  geometry: LatLng[];
  fromLabel: string;
  toLabel: string;
}

export function RouteMap({ from, to, geometry, fromLabel, toLabel }: RouteMapProps) {
  const bounds = geometry.length > 0 ? geometry : [from, to];

  return (
    <MapContainer center={[from.lat, from.lng]} zoom={11} style={{ height: "40vh", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[from.lat, from.lng]} icon={dotIcon(STUDENT_COLOR)}>
        <Popup>{fromLabel}</Popup>
      </Marker>
      <Marker position={[to.lat, to.lng]} icon={dotIcon(PAEDIATRIC_COLOR)}>
        <Popup>{toLabel}</Popup>
      </Marker>
      {geometry.length > 0 && (
        <Polyline positions={geometry.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#2563eb", weight: 4 }} />
      )}
      <FitBounds points={bounds} />
    </MapContainer>
  );
}
