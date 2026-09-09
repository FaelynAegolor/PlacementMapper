import { db } from "../db";
import type { LatLng } from "../types";

/** "SW1A" — the outward half of a postcode on its own. Accepted anywhere a
 * full postcode is, so home addresses can be held at area level rather than
 * down to the individual house. */
/** postcodes.io accepts up to 100 postcodes per bulk request. */
const BULK_LOOKUP_SIZE = 100;

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

/** Looks up many full postcodes at once, using and filling the same cache as
 * geocodePostcode. Postcodes that can't be found are simply absent from the
 * returned map. Outward codes aren't supported by the bulk endpoint, so they
 * are looked up individually. */
export async function bulkGeocodePostcodes(postcodes: string[]): Promise<Map<string, LatLng>> {
  const found = new Map<string, LatLng>();
  const outstanding: string[] = [];

  for (const postcode of new Set(postcodes.map(normalisePostcode))) {
    if (!postcode) continue;
    const cached = await db.geocodeCache.get(postcode);
    if (cached) found.set(postcode, cached.latLng);
    else if (isOutwardCodeOnly(postcode)) {
      try {
        found.set(postcode, await geocodePostcode(postcode));
      } catch {
        // Left out of the map, like any other postcode that won't resolve.
      }
    } else outstanding.push(postcode);
  }

  for (let i = 0; i < outstanding.length; i += BULK_LOOKUP_SIZE) {
    const batch = outstanding.slice(i, i + BULK_LOOKUP_SIZE);
    const res = await fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch }),
    });
    if (!res.ok) continue;
    const body = await res.json();
    for (const entry of body.result ?? []) {
      if (!entry?.result) continue;
      const postcode = normalisePostcode(entry.query);
      const latLng: LatLng = { lat: entry.result.latitude, lng: entry.result.longitude };
      found.set(postcode, latLng);
      await db.geocodeCache.put({ postcode, latLng });
    }
  }

  return found;
}

/** Which UK nation a postcode is in, or null if it can't be determined. The
 * NHS organisation register is an England-and-Wales affair, so this decides
 * whether to warn that results are thinner than usual. */
export async function lookupPostcodeCountry(postcode: string): Promise<string | null> {
  const normalised = normalisePostcode(postcode);
  if (!normalised) return null;
  try {
    const res = await fetch(
      isOutwardCodeOnly(normalised)
        ? `https://api.postcodes.io/outcodes/${encodeURIComponent(normalised)}`
        : `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`,
    );
    if (!res.ok) return null;
    const body = await res.json();
    const country = body.result?.country;
    return Array.isArray(country) ? (country[0] ?? null) : (country ?? null);
  } catch {
    return null;
  }
}
