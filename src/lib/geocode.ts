import { db } from "../db";
import type { LatLng } from "../types";

export function normalisePostcode(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function geocodePostcode(postcode: string): Promise<LatLng> {
  const normalised = normalisePostcode(postcode);
  const cached = await db.geocodeCache.get(normalised);
  if (cached) return cached.latLng;

  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`,
  );
  if (!res.ok) {
    throw new Error(`Could not find postcode "${postcode}"`);
  }
  const body = await res.json();
  const latLng: LatLng = { lat: body.result.latitude, lng: body.result.longitude };
  await db.geocodeCache.put({ postcode: normalised, latLng });
  return latLng;
}

export async function geocodeMany(
  postcodes: string[],
): Promise<Map<string, LatLng | Error>> {
  const results = new Map<string, LatLng | Error>();
  for (const postcode of postcodes) {
    try {
      results.set(postcode, await geocodePostcode(postcode));
    } catch (err) {
      results.set(postcode, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return results;
}
