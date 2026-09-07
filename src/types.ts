export type Year = 1 | 2 | 3;
export type Category = "paediatric" | "adult";
export type TravelMode = "driving" | "transit";

export interface Student {
  id: string;
  name: string;
  postcode: string;
  year: Year;
  isDriver: boolean;
  /** The kind of placement this student has to be given. Undefined or null
   * means either kind is fine. */
  requiredCategory?: Category | null;
}

export interface Placement {
  id: string;
  name: string;
  postcode: string;
  category: Category;
  yearsOffered: Year[];
  requiresDriver: boolean;
  capacity: number | null;
}

export interface Assignment {
  id: string;
  studentId: string;
  placementId: string;
  year: Year;
}

export interface Lecturer {
  id: string;
  name: string;
  postcode: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

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

export interface RouteResult {
  key: string;
  mode: TravelMode;
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
  fetchedAt: number;
  /** e.g. "Bus → Underground" for transit; "Traffic-aware estimate (peak
   * time)" or "Free-flow estimate (no traffic data)" for driving. */
  summary?: string;
  /** Step-by-step transit journey, only populated for transit routes. */
  manifest?: ManifestStep[];
}
