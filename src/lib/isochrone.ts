import { db } from "../db";
import type { LatLng, TravelMode } from "../types";
import { geocodePostcode, normalisePostcode } from "./geocode";
import { fetchDrivingRouteGoogle, fetchDrivingRouteOsrm } from "./routing/driving";
import { fetchTransitRoute } from "./routing/transit";
import { getSetting } from "../db";

const BEARING_COUNT = 12;
const COARSE_STEPS_MILES = [8, 16, 24, 32, 40];
const REFINEMENT_STEPS = 2;
const METERS_PER_MILE = 1609.344;

function destinationPoint(start: LatLng, bearingDeg: number, distanceMeters: number): LatLng {
  const R = 6371000;
  const delta = distanceMeters / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (start.lat * Math.PI) / 180;
  const lambda1 = (start.lng * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: (phi2 * 180) / Math.PI, lng: (((lambda2 * 180) / Math.PI + 540) % 360) - 180 };
}

async function travelSeconds(from: LatLng, to: LatLng, mode: TravelMode, apiKey?: string): Promise<number | null> {
  try {
    if (mode === "transit") {
      const result = await fetchTransitRoute(from, to);
      return result.durationSeconds;
    }
    const result = apiKey ? await fetchDrivingRouteGoogle(from, to, apiKey) : await fetchDrivingRouteOsrm(from, to);
    return result.durationSeconds;
  } catch {
    return null;
  }
}

async function findBoundaryDistance(
  base: LatLng,
  bearing: number,
  maxSeconds: number,
  mode: TravelMode,
  apiKey?: string,
): Promise<number> {
  let lastUnder = 0;
  let firstOver: number | null = null;

  for (const miles of COARSE_STEPS_MILES) {
    const meters = miles * METERS_PER_MILE;
    const point = destinationPoint(base, bearing, meters);
    const seconds = await travelSeconds(base, point, mode, apiKey);
    if (seconds == null) {
      firstOver = meters;
      break;
    }
    if (seconds <= maxSeconds) {
      lastUnder = meters;
    } else {
      firstOver = meters;
      break;
    }
  }

  if (firstOver == null) return lastUnder;

  let lo = lastUnder;
  let hi = firstOver;
  for (let i = 0; i < REFINEMENT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const point = destinationPoint(base, bearing, mid);
    const seconds = await travelSeconds(base, point, mode, apiKey);
    if (seconds != null && seconds <= maxSeconds) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function isochroneCacheKey(postcode: string, maxMinutes: number, mode: TravelMode): string {
  return `${normalisePostcode(postcode)}|${maxMinutes}|${mode}`;
}

/** Approximates a travel-time boundary around a postcode by sampling real
 * travel time outward along several bearings and binary-searching for where
 * each crosses maxMinutes. Not a precise isochrone, but reflects the real
 * road/transit network rather than a naive circle. Progress is reported via
 * onProgress(done, total) since this can take a while (dozens of live route
 * lookups). Results are cached in IndexedDB by (postcode, minutes, mode). */
export async function computeIsochrone(
  basePostcode: string,
  maxMinutes: number,
  mode: TravelMode,
  onProgress?: (done: number, total: number) => void,
): Promise<LatLng[]> {
  const base = await geocodePostcode(basePostcode);
  const maxSeconds = maxMinutes * 60;
  const apiKey = mode === "driving" ? await getSetting("googleApiKey") : undefined;

  const points: LatLng[] = [];
  for (let i = 0; i < BEARING_COUNT; i++) {
    const bearing = (360 / BEARING_COUNT) * i;
    const distance = await findBoundaryDistance(base, bearing, maxSeconds, mode, apiKey);
    points.push(destinationPoint(base, bearing, distance));
    onProgress?.(i + 1, BEARING_COUNT);
  }

  const key = isochroneCacheKey(basePostcode, maxMinutes, mode);
  await db.isochroneCache.put({ key, points, computedAt: Date.now() });
  return points;
}

export async function getCachedIsochrone(
  basePostcode: string,
  maxMinutes: number,
  mode: TravelMode,
): Promise<LatLng[] | null> {
  const entry = await db.isochroneCache.get(isochroneCacheKey(basePostcode, maxMinutes, mode));
  return entry?.points ?? null;
}
