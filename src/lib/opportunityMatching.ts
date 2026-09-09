import type { Category, LatLng } from "../types";

/** Turning open map and NHS records into candidate placement sites. Kept free
 * of the database and the network so the rules can be reasoned about (and
 * exercised) on their own. */

export type OpportunityKind =
  | "hospital"
  | "clinic"
  | "community"
  | "special_school"
  | "school"
  | "nursery"
  | "care_home"
  | "rehab";

export interface KindMeta {
  label: string;
  /** Why a speech and language therapy student might go there. */
  blurb: string;
  clientGroup: Category | "both";
  /** Mainstream schools are numerous enough to bury everything else, so they
   * start switched off. */
  defaultOn: boolean;
}

export const OPPORTUNITY_KINDS: Record<OpportunityKind, KindMeta> = {
  hospital: {
    label: "Hospitals",
    blurb: "Acute wards, stroke units, ENT and paediatrics",
    clientGroup: "both",
    defaultOn: true,
  },
  community: {
    label: "NHS community services",
    blurb: "Community teams, child development centres, health centres",
    clientGroup: "both",
    defaultOn: true,
  },
  clinic: {
    label: "Clinics & health centres",
    blurb: "Outpatient clinics and independent providers",
    clientGroup: "both",
    defaultOn: true,
  },
  special_school: {
    label: "Special schools & language units",
    blurb: "SEN schools, language units, resource bases, PRUs",
    clientGroup: "paediatric",
    defaultOn: true,
  },
  care_home: {
    label: "Care & nursing homes",
    blurb: "Dysphagia, dementia and adult communication work",
    clientGroup: "adult",
    defaultOn: true,
  },
  rehab: {
    label: "Rehab, hospices & day services",
    blurb: "Neuro-rehab, palliative care and day centres",
    clientGroup: "adult",
    defaultOn: true,
  },
  nursery: {
    label: "Nurseries & pre-schools",
    blurb: "Early years language development",
    clientGroup: "paediatric",
    defaultOn: true,
  },
  school: {
    label: "Mainstream schools",
    blurb: "Primary and secondary — many have SLT input",
    clientGroup: "paediatric",
    defaultOn: false,
  },
};

export const KIND_ORDER: OpportunityKind[] = [
  "hospital",
  "community",
  "clinic",
  "special_school",
  "care_home",
  "rehab",
  "nursery",
  "school",
];

export interface Opportunity {
  /** Stable across searches: "osm:way/123" or "nhs:RPGGP". */
  id: string;
  name: string;
  kind: OpportunityKind;
  sources: ("osm" | "nhs")[];
  point: LatLng;
  postcode?: string;
  distanceMeters: number;
  clientGroup: Category | "both";
  /** What the record says it is, in plain words. */
  detail: string;
  /** Wording that points at speech and language work. */
  sltSignals: string[];
  website?: string;
}

/** Words in a name that suggest speech and language therapy involvement.
 * Rough by nature — a prompt to go and check, not a claim. */
const SLT_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /speech|\bslt\b|\bsalt\b/i, label: "speech" },
  { pattern: /language/i, label: "language" },
  { pattern: /communicat/i, label: "communication" },
  { pattern: /swallow|dysphagi/i, label: "dysphagia" },
  { pattern: /voice|stammer|stutter|fluency/i, label: "voice & fluency" },
  { pattern: /autis|\basd\b/i, label: "autism" },
  { pattern: /special (school|educational)|\bsen\b|additional needs|resource base|pupil referral/i, label: "SEN" },
  { pattern: /child development|children'?s centre|paediatric|pediatric/i, label: "child development" },
  { pattern: /stroke|neuro|rehabilitat/i, label: "stroke & neuro" },
  { pattern: /learning disabilit/i, label: "learning disability" },
  { pattern: /dementia|alzheimer/i, label: "dementia" },
  { pattern: /hearing|\bdeaf|audiolog/i, label: "hearing" },
  { pattern: /cleft|head (and|&) neck|laryng|\bent\b|maxillofacial/i, label: "ENT & cleft" },
  { pattern: /hospice|palliative/i, label: "palliative" },
];

export function sltSignalsIn(text: string): string[] {
  return SLT_SIGNALS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

const SPECIAL_SCHOOL_RE =
  /special school|special educational|language (impairment )?(unit|centre|base)|communication (unit|centre|base)|resource (base|provision|unit)|pupil referral|\bsen\b|additional (learning )?needs|autis|\basd\b|learning disabilit|hearing impair|visual impair|\bdeaf\b/i;
const NURSERY_RE = /nursery|pre-?school|playgroup|kindergarten|early years/i;
const PAEDIATRIC_RE =
  /child|children|paediatric|pediatric|young people|youth|school|nursery|infant|junior|primary|secondary|academy|college|\bcamhs\b/i;
const ADULT_RE =
  /elderly|older people|nursing home|care home|residential home|stroke|dementia|alzheimer|neuro|rehab|hospice|palliative|adult|geriatric/i;

/** Best guess at who a student would be seeing there — the user can change it
 * before adding the site to their placements. */
export function inferClientGroup(kind: OpportunityKind, name: string): Category | "both" {
  const fromKind = OPPORTUNITY_KINDS[kind].clientGroup;
  if (fromKind !== "both") return fromKind;
  const paediatric = PAEDIATRIC_RE.test(name);
  const adult = ADULT_RE.test(name);
  if (paediatric && !adult) return "paediatric";
  if (adult && !paediatric) return "adult";
  return "both";
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const CARE_HOME_RE = /care home|nursing home|residential home|care centre|care & nursing|rest home/i;
const CARE_HOME_FACILITIES = ["nursing_home", "assisted_living", "group_home", "care_home"];
const COMMUNITY_FACILITIES = ["day_care", "outreach", "ambulatory_care", "healthcare"];

/** Maps an OpenStreetMap record to a kind, or null for anything a speech and
 * language student wouldn't be placed at (pharmacies, dentists, opticians,
 * GP surgeries and so on). */
export function classifyOsm(tags: Record<string, string>): { kind: OpportunityKind; detail: string } | null {
  const { amenity, healthcare, social_facility: social, name = "" } = tags;

  if (amenity === "hospital" || healthcare === "hospital") return { kind: "hospital", detail: "Hospital" };
  if (healthcare === "hospice") return { kind: "rehab", detail: "Hospice" };
  if (healthcare === "rehabilitation") return { kind: "rehab", detail: "Rehabilitation centre" };

  if (amenity === "social_facility" || social) {
    // Hospices are often tagged as nursing homes; the name is the giveaway.
    if (/hospice/i.test(name)) return { kind: "rehab", detail: "Hospice" };
    if (CARE_HOME_RE.test(name)) return { kind: "care_home", detail: "Care home" };
    if (CARE_HOME_FACILITIES.includes(social)) {
      return { kind: "care_home", detail: social === "nursing_home" ? "Nursing home" : "Residential care" };
    }
    if (COMMUNITY_FACILITIES.includes(social)) return { kind: "community", detail: "Day & outreach service" };
    return { kind: "community", detail: "Social facility" };
  }

  if (amenity === "kindergarten") return { kind: "nursery", detail: "Nursery or pre-school" };

  if (amenity === "school") {
    if (tags.school === "special" || "school:SEN" in tags || SPECIAL_SCHOOL_RE.test(name)) {
      return { kind: "special_school", detail: "Special school or unit" };
    }
    if (NURSERY_RE.test(name)) return { kind: "nursery", detail: "Nursery or pre-school" };
    const phase = tags.school === "primary" ? "Primary school" : tags.school === "secondary" ? "Secondary school" : "School";
    return { kind: "school", detail: phase };
  }

  if (healthcare === "speech_therapist") return { kind: "clinic", detail: "Speech therapy service" };
  if (NOT_A_PLACEMENT_RE.test(name)) return null;
  if (amenity === "clinic" || ["clinic", "centre", "health_centre", "medical_centre"].includes(healthcare)) {
    return { kind: "clinic", detail: "Clinic or health centre" };
  }
  // GP surgeries are rarely placements, but community clinics and children's
  // centres are often tagged as one, so keep only those.
  if (amenity === "doctors" && /health centre|children|community|child development/i.test(name)) {
    return { kind: "clinic", detail: "Health centre" };
  }

  return null;
}

export interface OdsOrganisation {
  Name: string;
  OrgId: string;
  PostCode?: string;
  PrimaryRoleDescription?: string;
  Status?: string;
}

/** Only the NHS organisation roles a student could be placed at. Everything
 * else in the register — pharmacies, opticians, dental practices, prescribing
 * cost centres, provider head offices — is left out. */
const ODS_ROLE_KINDS: Record<string, OpportunityKind> = {
  "NHS TRUST SITE": "community",
  SCHOOL: "school",
  "SOCIAL CARE SITE": "care_home",
  "CARE HOME": "care_home",
  "INDEPENDENT SECTOR H/C PROVIDER SITE": "clinic",
  HOSPICE: "rehab",
};

/** Services in other specialties. A clinic is only worth listing if a speech
 * and language student could plausibly be placed there. */
const NOT_A_PLACEMENT_RE = new RegExp(
  [
    "sexual health|contracept|genito|fertility|\\bivf\\b|gynae|obstetric|maternity",
    "podiatr|chiropod|phlebotom|blood (donor|donation)|donor centre",
    "imaging|radiolog|x-?ray|ultrasound|endoscop|mammograph|breast screening",
    "orthopaed|\\bmsk\\b|physiotherap|osteopath|chiropract|acupunctur",
    "dermatolog|cardiolog|ophthalm|urolog|diabet|renal|dialysis|oncolog",
    "cosmetic|aesthetic|botox|laser clinic|slimming|weight loss|veterinar",
  ].join("|"),
  "i",
);

/** Names that show up under otherwise useful roles but aren't places a
 * speech and language student would go: GP practices, high-street opticians
 * and hearing-aid retailers, and clinical services in other specialties. */
const ODS_NAME_EXCLUSIONS = new RegExp(
  [
    "\\bsurgery\\b|medical (practice|centre)|\\bgp\\b|dental|pharmac|ambulance station|head office",
    "optic|specsavers|hearcare|hearing (aid|care)|vision express|scrivens|\\bboots\\b",
  ].join("|"),
  "i",
);

export function classifyOds(org: OdsOrganisation): { kind: OpportunityKind; detail: string } | null {
  const role = org.PrimaryRoleDescription ?? "";
  const kind = ODS_ROLE_KINDS[role];
  if (!kind) return null;
  const name = org.Name ?? "";
  if (ODS_NAME_EXCLUSIONS.test(name) || NOT_A_PLACEMENT_RE.test(name)) return null;

  if (/hospital/i.test(name)) return { kind: "hospital", detail: "NHS hospital site" };
  if (/hospice/i.test(name)) return { kind: "rehab", detail: "Hospice" };
  if (kind === "school") {
    if (SPECIAL_SCHOOL_RE.test(name)) return { kind: "special_school", detail: "Special school or unit" };
    if (NURSERY_RE.test(name)) return { kind: "nursery", detail: "Nursery or pre-school" };
    return { kind: "school", detail: "School" };
  }
  if (kind === "community" && SPECIAL_SCHOOL_RE.test(name)) {
    return { kind: "community", detail: "NHS community service" };
  }
  const detail =
    kind === "community"
      ? "NHS community service"
      : kind === "care_home"
        ? "Registered care service"
        : "Independent healthcare site";
  return { kind, detail };
}

/** Acronyms the NHS register is full of, which shouldn't be title-cased. */
const ACRONYMS = new Set([
  "NHS", "GSTT", "LGT", "ENT", "CDC", "ASD", "SEN", "PRU", "CAMHS", "GP", "UK",
  "LTD", "MSK", "IAPT", "CIC", "LLP", "SLT", "ADHD", "HIV", "CCG", "ICB", "QMS", "SEND",
]);
const SMALL_WORDS = new Set(["and", "of", "the", "at", "in", "for", "on", "to", "with"]);

/** The NHS register stores names in capitals. This makes them readable
 * without flattening the acronyms, and leaves mixed-case names alone. */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (ACRONYMS.has(word.replace(/[^a-z0-9]/gi, "").toUpperCase())) return word.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      // First letter of each word, but not the "s" in "Mary's".
      return word.replace(/(?<!')\b[a-z]/g, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

/** Same site, two records: OpenStreetMap holds a node and a way for one
 * hospital, and the NHS register lists it again under its official name. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|ltd|limited|llp|plc|nhs|foundation|trust)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How far apart two records can be and still be treated as one site. */
const MERGE_METERS = 800;

export function dedupeOpportunities(
  found: Opportunity[],
  distanceBetween: (a: LatLng, b: LatLng) => number,
): Opportunity[] {
  const kept: Opportunity[] = [];
  for (const item of found) {
    const key = normaliseName(item.name);
    const match = kept.find(
      (other) =>
        normaliseName(other.name) === key &&
        (distanceBetween(other.point, item.point) <= MERGE_METERS ||
          (item.postcode != null && item.postcode === other.postcode)),
    );
    if (!match) {
      kept.push({ ...item });
      continue;
    }
    // Keep the more specific classification, the properly-cased name, and
    // whichever record actually knows the postcode.
    if (KIND_ORDER.indexOf(item.kind) < KIND_ORDER.indexOf(match.kind)) {
      match.kind = item.kind;
      match.detail = item.detail;
      match.clientGroup = item.clientGroup;
    }
    // The NHS register shouts; OpenStreetMap doesn't. Prefer the readable one.
    const keptIsShouty = match.name === match.name.toUpperCase();
    const incomingIsShouty = item.name === item.name.toUpperCase();
    if (keptIsShouty && !incomingIsShouty) match.name = item.name;
    match.postcode ??= item.postcode;
    match.website ??= item.website;
    match.distanceMeters = Math.min(match.distanceMeters, item.distanceMeters);
    match.sltSignals = [...new Set([...match.sltSignals, ...item.sltSignals])];
    for (const source of item.sources) if (!match.sources.includes(source)) match.sources.push(source);
  }
  return kept;
}
