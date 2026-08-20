import { getSetting } from "../../db";
import type { LatLng } from "../../types";
import { nextPeakDeparture } from "../peakTime";
import { decodePolyline } from "./polyline";

export interface ManifestStep {
  mode: "walk" | "transit";
  instructions?: string;
  line?: string;
  vehicleType?: string;
  headsign?: string;
  fromStop?: string;
  toStop?: string;
  stopCount?: number;
  durationSeconds: number;
  distanceMeters: number;
}

interface TransitResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
  summary: string;
  manifest: ManifestStep[];
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("No Google API key set. Add one in Settings to look up public transport times.");
    this.name = "MissingApiKeyError";
  }
}

const VEHICLE_LABELS: Record<string, string> = {
  BUS: "Bus",
  SUBWAY: "Underground",
  TRAIN: "Train",
  RAIL: "Train",
  LIGHT_RAIL: "Tram",
  TRAM: "Tram",
  FERRY: "Ferry",
};

interface RawStep {
  travelMode?: string;
  staticDuration?: string;
  distanceMeters?: number;
  navigationInstruction?: { instructions?: string };
  transitDetails?: {
    stopDetails?: { departureStop?: { name?: string }; arrivalStop?: { name?: string } };
    headsign?: string;
    stopCount?: number;
    transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } };
  };
}

function parseDuration(value?: string): number {
  return value ? parseInt(value.replace("s", ""), 10) : 0;
}

function buildManifest(steps: RawStep[]): ManifestStep[] {
  return steps.map((step) => {
    const durationSeconds = parseDuration(step.staticDuration);
    const distanceMeters = step.distanceMeters ?? 0;

    if (step.travelMode === "TRANSIT" && step.transitDetails) {
      const td = step.transitDetails;
      const type = td.transitLine?.vehicle?.type;
      return {
        mode: "transit" as const,
        line: td.transitLine?.nameShort || td.transitLine?.name,
        vehicleType: (type && VEHICLE_LABELS[type]) || "Transit",
        headsign: td.headsign,
        fromStop: td.stopDetails?.departureStop?.name,
        toStop: td.stopDetails?.arrivalStop?.name,
        stopCount: td.stopCount,
        durationSeconds,
        distanceMeters,
      };
    }

    return {
      mode: "walk" as const,
      instructions: step.navigationInstruction?.instructions,
      durationSeconds,
      distanceMeters,
    };
  });
}

function summarise(manifest: ManifestStep[]): string {
  const modes: string[] = [];
  for (const step of manifest) {
    if (step.mode !== "transit") continue;
    const label = step.vehicleType ?? "Transit";
    if (modes[modes.length - 1] !== label) modes.push(label);
  }
  return modes.length > 0 ? modes.join(" → ") : "Walking only";
}

export async function fetchTransitRoute(from: LatLng, to: LatLng): Promise<TransitResult> {
  const apiKey = await getSetting("googleApiKey");
  if (!apiKey) throw new MissingApiKeyError();

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "routes.duration",
        "routes.distanceMeters",
        "routes.polyline.encodedPolyline",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.staticDuration",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.navigationInstruction.instructions",
        "routes.legs.steps.transitDetails.stopDetails.departureStop.name",
        "routes.legs.steps.transitDetails.stopDetails.arrivalStop.name",
        "routes.legs.steps.transitDetails.headsign",
        "routes.legs.steps.transitDetails.stopCount",
        "routes.legs.steps.transitDetails.transitLine.name",
        "routes.legs.steps.transitDetails.transitLine.nameShort",
        "routes.legs.steps.transitDetails.transitLine.vehicle.type",
      ].join(","),
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "TRANSIT",
      departureTime: nextPeakDeparture().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Transit route lookup failed: ${body}`);
  }

  const body = await res.json();
  const route = body.routes?.[0];
  if (!route) {
    throw new Error("No public transport route found");
  }

  const rawSteps: RawStep[] = (route.legs ?? []).flatMap((leg: { steps?: RawStep[] }) => leg.steps ?? []);
  const manifest = buildManifest(rawSteps);

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: parseInt(route.duration.replace("s", ""), 10),
    geometry: decodePolyline(route.polyline.encodedPolyline),
    summary: summarise(manifest),
    manifest,
  };
}
