export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
}

/** Searches OpenStreetMap (Nominatim) for a place by name, restricted to
 * the UK. Free and keyless, but rate-limited by their usage policy — only
 * call this from an explicit user action, never on every keystroke. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(trimmed)}&countrycodes=gb&format=jsonv2&limit=5`,
  );
  if (!res.ok) throw new Error("Place search failed");

  const body: { display_name: string; lat: string; lon: string }[] = await res.json();
  return body.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/** Finds the nearest real UK postcode to a coordinate, via postcodes.io's
 * reverse-geocoding endpoint. Large sites (hospital grounds, campuses) can
 * sit more than 100m from the nearest addressed postcode point, so this
 * widens the search radius if the first, tighter attempt comes back empty. */
export async function nearestPostcode(lat: number, lng: number): Promise<string> {
  for (const radius of [250, 1000, 2000]) {
    const res = await fetch(
      `https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=${radius}`,
    );
    if (!res.ok) throw new Error("Postcode lookup failed");
    const body = await res.json();
    const nearest = body.result?.[0];
    if (nearest) return nearest.postcode;
  }
  throw new Error("No postcode found near this location");
}
