import type { LatLng, ManifestStep } from "../../types";
import { nextPeakDeparture } from "../peakTime";
import { decodePolyline } from "./polyline";

interface DrivingResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
  summary: string;
  manifest?: ManifestStep[];
}

/** Free, keyless, but has no traffic data — always a free-flow estimate
 * regardless of time of day. */
export async function fetchDrivingRouteOsrm(from: LatLng, to: LatLng): Promise<DrivingResult> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Driving route lookup failed");
  }
  const body = await res.json();
  const route = body.routes?.[0];
  if (!route) {
    throw new Error("No driving route found");
  }

  const geometry: LatLng[] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => ({ lat, lng }),
  );

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry,
    summary: "Free-flow estimate (no traffic data)",
  };
}

/** Traffic-aware driving for a peak-time departure, via Google Routes API.
 * Requires an API key. */
export async function fetchDrivingRouteGoogle(
  from: LatLng,
  to: LatLng,
  apiKey: string,
): Promise<DrivingResult> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: nextPeakDeparture().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Driving route lookup failed: ${body}`);
  }

  const body = await res.json();
  const route = body.routes?.[0];
  if (!route) {
    throw new Error("No driving route found");
  }

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: parseInt(route.duration.replace("s", ""), 10),
    geometry: decodePolyline(route.polyline.encodedPolyline),
    summary: "Traffic-aware estimate (peak time)",
  };
}
