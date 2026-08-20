import { db, getSetting } from "../../db";
import type { RouteResult, TravelMode } from "../../types";
import { geocodePostcode } from "../geocode";
import { fetchDrivingRouteGoogle, fetchDrivingRouteOsrm } from "./driving";
import { fetchTransitRoute } from "./transit";

export { MissingApiKeyError } from "./transit";

function routeCacheKey(fromPostcode: string, toPostcode: string, engine: string): string {
  return `${fromPostcode.trim().toUpperCase()}|${toPostcode.trim().toUpperCase()}|${engine}`;
}

export async function getRoute(
  fromPostcode: string,
  toPostcode: string,
  mode: TravelMode,
  options: { forceRefresh?: boolean } = {},
): Promise<RouteResult> {
  const apiKey = mode === "driving" ? await getSetting("googleApiKey") : undefined;
  const engine = mode === "transit" ? "transit" : apiKey ? "driving-google" : "driving-osrm";
  const key = routeCacheKey(fromPostcode, toPostcode, engine);

  if (!options.forceRefresh) {
    const cached = await db.routeCache.get(key);
    if (cached) return cached;
  }

  const [from, to] = await Promise.all([
    geocodePostcode(fromPostcode),
    geocodePostcode(toPostcode),
  ]);

  const result =
    mode === "transit"
      ? await fetchTransitRoute(from, to)
      : apiKey
        ? await fetchDrivingRouteGoogle(from, to, apiKey)
        : await fetchDrivingRouteOsrm(from, to);

  const record: RouteResult = {
    key,
    mode,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    geometry: result.geometry,
    fetchedAt: Date.now(),
    summary: result.summary,
    manifest: result.manifest,
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

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return `${miles.toFixed(1)} mi`;
}
