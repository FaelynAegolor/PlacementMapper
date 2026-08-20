import { getSetting } from "../../db";
import type { LatLng } from "../../types";

interface TransitResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
}

/** Decodes a Google encoded polyline into lat/lng points. */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("No Google API key set. Add one in Settings to look up public transport times.");
    this.name = "MissingApiKeyError";
  }
}

export async function fetchTransitRoute(
  from: LatLng,
  to: LatLng,
): Promise<TransitResult> {
  const apiKey = await getSetting("googleApiKey");
  if (!apiKey) throw new MissingApiKeyError();

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "TRANSIT",
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Transit route lookup failed: ${body}`);
  }

  const body = await res.json();
  const route = body.routes?.[0];
  if (!route) {
    throw new Error("No public transport route found");
  }

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: parseInt(route.duration.replace("s", ""), 10),
    geometry: decodePolyline(route.polyline.encodedPolyline),
  };
}
