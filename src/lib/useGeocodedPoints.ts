import { useEffect, useState } from "react";
import { geocodePostcode, normalisePostcode } from "./geocode";
import type { LatLng } from "../types";

/** Geocodes a set of postcodes (cached via geocode.ts) and returns a map,
 * keyed by normalised postcode, of postcode -> LatLng as results come in. */
export function useGeocodedPoints(postcodes: string[]): Map<string, LatLng> {
  const [points, setPoints] = useState<Map<string, LatLng>>(new Map());
  const key = postcodes.slice().sort().join("|");

  useEffect(() => {
    let cancelled = false;
    setPoints(new Map());

    (async () => {
      const unique = Array.from(new Set(postcodes));
      for (const postcode of unique) {
        try {
          const latLng = await geocodePostcode(postcode);
          if (cancelled) return;
          setPoints((prev) => new Map(prev).set(normalisePostcode(postcode), latLng));
        } catch {
          // Skip postcodes that fail to geocode; caller can detect
          // missing entries by checking the returned map.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return points;
}
