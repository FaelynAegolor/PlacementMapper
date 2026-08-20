import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { LatLng } from "../types";

/** Fits the map to the given points whenever they change. A single point
 * gets a reasonable fixed zoom rather than Leaflet's default max-zoom. */
export function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
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
