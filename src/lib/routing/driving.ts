import type { LatLng } from "../../types";

interface DrivingResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
}

export async function fetchDrivingRoute(
  from: LatLng,
  to: LatLng,
): Promise<DrivingResult> {
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
  };
}
