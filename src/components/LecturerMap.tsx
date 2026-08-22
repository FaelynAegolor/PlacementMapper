import { Fragment } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { normalisePostcode } from "../lib/geocode";
import type { LecturerAllocation } from "../lib/lecturerAllocation";
import { useGeocodedPoints } from "../lib/useGeocodedPoints";
import type { LatLng } from "../types";
import { categoricalColor, dotIcon, squareIcon } from "./mapIcons";
import { FitBounds } from "./FitBounds";

interface LecturerMapProps {
  allocation: LecturerAllocation[];
}

export function LecturerMap({ allocation }: LecturerMapProps) {
  const postcodes = allocation.flatMap((a) => [
    a.lecturer.postcode,
    ...a.placements.map((p) => p.placement.postcode),
  ]);
  const points = useGeocodedPoints(postcodes);
  const allPoints: LatLng[] = postcodes
    .map((postcode) => points.get(normalisePostcode(postcode)))
    .filter((p): p is LatLng => p != null);

  return (
    <div>
      <div className="map-legend">
        {allocation.map((a, i) => (
          <span key={a.lecturer.id}>
            <i style={{ background: categoricalColor(i, allocation.length) }} /> {a.lecturer.name}
          </span>
        ))}
        <span>◼ Lecturer home · ● Placement</span>
      </div>
      <MapContainer center={[51.5, -0.1]} zoom={10} style={{ height: "55vh", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {allocation.map((a, i) => {
          const color = categoricalColor(i, allocation.length);
          const homePoint = points.get(normalisePostcode(a.lecturer.postcode));

          return (
            <Fragment key={a.lecturer.id}>
              {homePoint && (
                <Marker position={[homePoint.lat, homePoint.lng]} icon={squareIcon(color)}>
                  <Popup>
                    <strong>{a.lecturer.name}</strong>
                    <br />
                    Home · {a.placements.length} placement{a.placements.length === 1 ? "" : "s"}
                  </Popup>
                </Marker>
              )}
              {a.placements.map(({ placement, distanceMeters }) => {
                const point = points.get(normalisePostcode(placement.postcode));
                if (!point) return null;
                return (
                  <Marker key={placement.id} position={[point.lat, point.lng]} icon={dotIcon(color)}>
                    <Popup>
                      <strong>{placement.name}</strong>
                      <br />
                      Allocated to {a.lecturer.name}
                      <br />
                      {(distanceMeters / 1609.344).toFixed(1)} mi from their home
                    </Popup>
                  </Marker>
                );
              })}
            </Fragment>
          );
        })}
        <FitBounds points={allPoints} />
      </MapContainer>
    </div>
  );
}
