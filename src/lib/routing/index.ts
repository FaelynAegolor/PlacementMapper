import { db } from "../../db";
import type { RouteResult, TravelMode } from "../../types";
import { geocodePostcode } from "../geocode";
import { fetchDrivingRoute } from "./driving";
import { fetchTransitRoute } from "./transit";

export { MissingApiKeyError } from "./transit";

export function routeCacheKey(
  fromPostcode: string,
  toPostcode: string,
  mode: TravelMode,
): string {
  return `${fromPostcode.trim().toUpperCase()}|${toPostcode.trim().toUpperCase()}|${mode}`;
}

export async function getRoute(
  fromPostcode: string,
  toPostcode: string,
  mode: TravelMode,
  options: { forceRefresh?: boolean } = {},
): Promise<RouteResult> {
  const key = routeCacheKey(fromPostcode, toPostcode, mode);

  if (!options.forceRefresh) {
    const cached = await db.routeCache.get(key);
    if (cached) return cached;
  }

  const [from, to] = await Promise.all([
    geocodePostcode(fromPostcode),
    geocodePostcode(toPostcode),
  ]);

  const result =
    mode === "driving"
      ? await fetchDrivingRoute(from, to)
      : await fetchTransitRoute(from, to);

  const record: RouteResult = {
    key,
    mode,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    geometry: result.geometry,
    fetchedAt: Date.now(),
  };

  await db.routeCache.put(record);
  return record;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}
