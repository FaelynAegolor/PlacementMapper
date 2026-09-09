import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { formatDistance } from "../lib/routing";
import type { Opportunity } from "../lib/opportunityMatching";
import type { LatLng } from "../types";
import { dotIcon, kindColor, squareIcon, STUDENT_COLOR } from "./mapIcons";
import { FitBounds } from "./FitBounds";

interface OpportunityMapProps {
  origin: LatLng;
  originLabel: string;
  opportunities: Opportunity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function OpportunityMap({ origin, originLabel, opportunities, selectedId, onSelect }: OpportunityMapProps) {
  const points = [origin, ...opportunities.map((o) => o.point)];

  return (
    <div>
      <div className="map-legend">
        <span>
          <i style={{ background: STUDENT_COLOR, borderRadius: 2 }} /> Search from {originLabel}
        </span>
        <span>Colours match the types ticked above · click a pin for detail</span>
      </div>
      <MapContainer center={[origin.lat, origin.lng]} zoom={12} style={{ height: "55vh", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[origin.lat, origin.lng]} icon={squareIcon(STUDENT_COLOR)}>
          <Popup>{originLabel}</Popup>
        </Marker>
        {opportunities.map((o) => (
          <Marker
            key={o.id}
            position={[o.point.lat, o.point.lng]}
            icon={dotIcon(kindColor(o.kind), o.id === selectedId)}
            eventHandlers={{ click: () => onSelect(o.id) }}
          >
            <Popup>
              <strong>{o.name}</strong>
              <br />
              {o.detail} · {formatDistance(o.distanceMeters)} away
              {o.postcode && (
                <>
                  <br />
                  {o.postcode}
                </>
              )}
              {o.sltSignals.length > 0 && (
                <>
                  <br />
                  Look for: {o.sltSignals.join(", ")}
                </>
              )}
            </Popup>
          </Marker>
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
