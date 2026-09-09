import { destinationPoint, haversineDistanceMeters } from "./distance";
import {
  bulkGeocodePostcodes,
  geocodePostcode,
  lookupPostcodeCountry,
  normalisePostcode,
} from "./geocode";
import {
  classifyOds,
  classifyOsm,
  dedupeOpportunities,
  inferClientGroup,
  sltSignalsIn,
  tidyName,
  type OdsOrganisation,
  type Opportunity,
  type OsmElement,
} from "./opportunityMatching";
import type { LatLng } from "../types";

const METERS_PER_MILE = 1609.344;
/** The main Overpass instance allows two queries at a time per address and
 * turns the rest away. The mirror is slower, but worth a try when that
 * happens. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ODS_URL = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations";
/** The NHS register is searched by postcode district, so a radius has to be
 * turned into a list of them. Districts are small in cities, so this has to
 * be generous or a city search silently loses its outer half. */
const MAX_OUTCODES = 24;
/** postcodes.io caps its outcode radius here, so a wider search has to ask
 * from several points to reach the edge. */
const MAX_OUTCODE_RADIUS_METERS = 25000;
/** Sample points around the edge of a search too wide for one request. Eight
 * keeps their 25km discs overlapping. */
const RING_SAMPLES = 8;
/** A successful search comes back in 10-15 seconds, so anything past this is
 * a server sitting on the request rather than working on it. */
const OVERPASS_TIMEOUT_MS = 30000;

export interface OpportunitySearch {
  postcode: string;
  origin: LatLng;
  radiusMiles: number;
  opportunities: Opportunity[];
  /** Records that matched but couldn't be put on the map, usually a postcode
   * the register holds that no longer resolves. */
  notLocated: number;
  /** A source that failed, so the results are known to be partial. */
  warnings: string[];
  /** Things worth knowing about this particular search — patchy coverage in
   * this part of the country, for instance. */
  notes: string[];
  searchedAt: number;
}

function overpassQuery(origin: LatLng, radiusMeters: number): string {
  const around = `around:${Math.round(radiusMeters)},${origin.lat},${origin.lng}`;
  // Two statements, both matching on a bare tag key. Narrowing the healthcare
  // values here looks tidier but is far slower — Overpass re-runs the radius
  // search per statement and can't lean on the tag index for a value regex,
  // which turns a 12-second London search into a timeout. The unwanted
  // pharmacies and dentists are cheaper to drop in classifyOsm.
  return `[out:json][timeout:120];
(
  nwr(${around})[amenity~"^(hospital|clinic|doctors|social_facility|school|kindergarten)$"];
  nwr(${around})[healthcare];
);
out center tags;`;
}

function overpassProblem(status: number): string {
  // Both of these mean the shared public server is under load rather than
  // anything being wrong with the search.
  if (status === 429) return "OpenStreetMap is busy — wait a minute and search again";
  if (status === 504) {
    return "OpenStreetMap took too long — it's usually just busy, so try again in a minute or narrow the radius";
  }
  return `OpenStreetMap search failed (${status})`;
}

async function fetchOsm(origin: LatLng, radiusMeters: number): Promise<OsmElement[]> {
  const data = overpassQuery(origin, radiusMeters);
  let lastProblem = "OpenStreetMap search failed";

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const abort = new AbortController();
    const giveUp = setTimeout(() => abort.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data }),
        signal: abort.signal,
      });
      if (!res.ok) {
        lastProblem = overpassProblem(res.status);
        continue;
      }
      const body = await res.json();
      return (body.elements ?? []) as OsmElement[];
    } catch {
      // A stall means the instance is sitting on the request. The mirror is
      // slower still, so it won't do better — stop rather than doubling the
      // wait. A genuine network error is worth retrying elsewhere.
      if (abort.signal.aborted) {
        throw new Error("OpenStreetMap didn't answer in time — it's usually busy, so try again in a minute");
      }
      lastProblem = "Could not reach OpenStreetMap";
    } finally {
      clearTimeout(giveUp);
    }
  }

  throw new Error(lastProblem);
}

interface OutcodeCentre {
  outcode: string;
  latitude: number;
  longitude: number;
}

async function outcodesAround(point: LatLng, radiusMeters: number): Promise<OutcodeCentre[]> {
  const res = await fetch(
    `https://api.postcodes.io/outcodes?lon=${point.lng}&lat=${point.lat}` +
      `&limit=${MAX_OUTCODES}&radius=${Math.round(radiusMeters)}`,
  );
  if (!res.ok) throw new Error(`Could not list postcode districts (${res.status})`);
  const body = await res.json();
  return (body.result ?? []) as OutcodeCentre[];
}

/** The postcode districts covering the search area, nearest first. One
 * request only reaches 25km, so a wider search also asks from a ring of
 * points near its edge. */
async function outcodesNear(origin: LatLng, radiusMeters: number): Promise<string[]> {
  const centres: LatLng[] = [origin];
  if (radiusMeters > MAX_OUTCODE_RADIUS_METERS) {
    const ringDistance = radiusMeters - MAX_OUTCODE_RADIUS_METERS / 2;
    for (let i = 0; i < RING_SAMPLES; i++) {
      centres.push(destinationPoint(origin, (360 / RING_SAMPLES) * i, ringDistance));
    }
  }

  const perCentre = Math.min(Math.round(radiusMeters), MAX_OUTCODE_RADIUS_METERS);
  const results = await Promise.all(
    centres.map((centre) => outcodesAround(centre, perCentre).catch(() => [] as OutcodeCentre[])),
  );

  const nearest = new Map<string, number>();
  for (const entry of results.flat()) {
    const distance = haversineDistanceMeters(origin, { lat: entry.latitude, lng: entry.longitude });
    // A district's centre can sit outside the search while part of it is
    // inside, so allow a district's own width beyond the edge.
    if (distance > radiusMeters + MAX_OUTCODE_RADIUS_METERS / 2) continue;
    const existing = nearest.get(entry.outcode);
    if (existing == null || distance < existing) nearest.set(entry.outcode, distance);
  }

  if (results.every((list) => list.length === 0)) {
    throw new Error("Could not list postcode districts");
  }

  return [...nearest.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_OUTCODES)
    .map(([outcode]) => outcode);
}

async function fetchOds(outcode: string): Promise<OdsOrganisation[]> {
  const res = await fetch(
    `${ODS_URL}?PostCode=${encodeURIComponent(outcode)}&Limit=1000&Status=Active`,
  );
  if (!res.ok) throw new Error(`NHS register search failed for ${outcode} (${res.status})`);
  const body = await res.json();
  return (body.Organisations ?? []) as OdsOrganisation[];
}

function osmPoint(element: OsmElement): LatLng | null {
  if (element.center) return { lat: element.center.lat, lng: element.center.lon };
  if (element.lat != null && element.lon != null) return { lat: element.lat, lng: element.lon };
  return null;
}

/** Looks for places a speech and language therapy student could be placed,
 * within a radius of a postcode, from two open sources: OpenStreetMap (where
 * the buildings are) and the NHS organisation register (which knows about
 * community services, schools and registered care that the map doesn't). */
export async function findOpportunities(
  postcode: string,
  radiusMiles: number,
  onProgress?: (message: string) => void,
): Promise<OpportunitySearch> {
  const radiusMeters = radiusMiles * METERS_PER_MILE;
  onProgress?.(`Locating ${normalisePostcode(postcode)}…`);
  const origin = await geocodePostcode(postcode);

  const warnings: string[] = [];
  const notes: string[] = [];
  const candidates: Opportunity[] = [];
  let notLocated = 0;

  // The NHS organisation register is an England-and-Wales affair. Say so,
  // rather than quietly returning a thinner list.
  const country = await lookupPostcodeCountry(postcode);
  if (country === "Scotland") {
    notes.push(
      "The NHS organisation register doesn't cover Scotland, so everything here comes from OpenStreetMap alone — expect community services and special schools to be missing.",
    );
  } else if (country === "Northern Ireland") {
    notes.push(
      "Northern Ireland is only thinly covered by the NHS organisation register, so most of this comes from OpenStreetMap.",
    );
  } else if (country === "Wales") {
    notes.push("Welsh health boards are listed more sparsely than English trusts in the NHS register.");
  }

  onProgress?.("Searching OpenStreetMap for nearby sites…");
  try {
    for (const element of await fetchOsm(origin, radiusMeters)) {
      const tags = element.tags ?? {};
      const name = tags.name;
      if (!name) continue;
      const classified = classifyOsm(tags);
      if (!classified) continue;
      const point = osmPoint(element);
      if (!point) continue;
      const distanceMeters = haversineDistanceMeters(origin, point);
      if (distanceMeters > radiusMeters) continue;
      candidates.push({
        id: `osm:${element.type}/${element.id}`,
        name,
        kind: classified.kind,
        detail: classified.detail,
        sources: ["osm"],
        point,
        postcode: tags["addr:postcode"] ? normalisePostcode(tags["addr:postcode"]) : undefined,
        distanceMeters,
        clientGroup: inferClientGroup(classified.kind, name),
        sltSignals: sltSignalsIn(`${name} ${classified.detail}`),
        website: tags.website ?? tags["contact:website"],
      });
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "OpenStreetMap search failed");
  }

  onProgress?.("Searching the NHS organisation register…");
  try {
    const outcodes = await outcodesNear(origin, radiusMeters);
    const registers = await Promise.all(
      outcodes.map((outcode) => fetchOds(outcode).catch(() => [] as OdsOrganisation[])),
    );
    const matched = registers
      .flat()
      .map((org) => ({ org, classified: classifyOds(org) }))
      .filter((entry) => entry.classified != null && entry.org.PostCode);

    onProgress?.(`Locating ${matched.length} NHS records…`);
    const points = await bulkGeocodePostcodes(matched.map((entry) => entry.org.PostCode!));

    for (const { org, classified } of matched) {
      const key = normalisePostcode(org.PostCode!);
      const point = points.get(key);
      if (!point) {
        notLocated++;
        continue;
      }
      const distanceMeters = haversineDistanceMeters(origin, point);
      if (distanceMeters > radiusMeters) continue;
      const name = tidyName(org.Name);
      candidates.push({
        id: `nhs:${org.OrgId}`,
        name,
        kind: classified!.kind,
        detail: classified!.detail,
        sources: ["nhs"],
        point,
        postcode: key,
        distanceMeters,
        clientGroup: inferClientGroup(classified!.kind, name),
        sltSignals: sltSignalsIn(`${name} ${classified!.detail}`),
      });
    }
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "NHS register search failed");
  }

  // OpenStreetMap holds a node and a way for the same hospital, and the NHS
  // register lists it again under its official name.
  const opportunities = dedupeOpportunities(candidates, haversineDistanceMeters).sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );

  return {
    postcode: normalisePostcode(postcode),
    origin,
    radiusMiles,
    opportunities,
    notLocated,
    warnings,
    notes,
    searchedAt: Date.now(),
  };
}
