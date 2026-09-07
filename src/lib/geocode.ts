import { db } from "../db";
import type { LatLng } from "../types";

/** "SW1A" — the outward half of a postcode on its own. Accepted anywhere a
 * full postcode is, so home addresses can be held at area level rather than
 * down to the individual house. */
const OUTWARD_CODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;

/** Canonical form, used as the cache key: uppercased, with the single space
 * before the inward code restored ("sw1a1aa" -> "SW1A 1AA"). An outward code
 * on its own comes back unspaced ("sw1a" -> "SW1A"). */
export function normalisePostcode(postcode: string): string {
  const compact = postcode.trim().toUpperCase().replace(/[^A-Z\d]/g, "");
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** True when only the outward code was given, i.e. the location is the centre
 * of a postcode area rather than a specific address. */
export function isOutwardCodeOnly(postcode: string): boolean {
  return OUTWARD_CODE_RE.test(normalisePostcode(postcode));
}

/** True for either a full postcode or an outward code on its own. */
export function isValidPostcode(postcode: string): boolean {
  const normalised = normalisePostcode(postcode);
  return OUTWARD_CODE_RE.test(normalised) || FULL_POSTCODE_RE.test(normalised);
}

export async function geocodePostcode(postcode: string): Promise<LatLng> {
  const normalised = normalisePostcode(postcode);
  if (!normalised) throw new Error("No postcode given");

  const cached = await db.geocodeCache.get(normalised);
  if (cached) return cached.latLng;

  // Outward codes have their own endpoint, which returns the centre of the
  // area instead of a single delivery point.
  const areaOnly = isOutwardCodeOnly(normalised);
  const res = await fetch(
    areaOnly
      ? `https://api.postcodes.io/outcodes/${encodeURIComponent(normalised)}`
      : `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`,
  );
  if (!res.ok) {
    throw new Error(
      areaOnly
        ? `Could not find postcode area "${postcode}"`
        : `Could not find postcode "${postcode}"`,
    );
  }
  const body = await res.json();
  const latLng: LatLng = { lat: body.result.latitude, lng: body.result.longitude };
  await db.geocodeCache.put({ postcode: normalised, latLng });
  return latLng;
}
