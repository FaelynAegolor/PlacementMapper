import L from "leaflet";

/** Coloured circle markers via divIcon, avoiding the default Leaflet marker
 * image assets (which don't resolve cleanly under Vite). */
export function dotIcon(color: string, dashed = false): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;
      width:16px;height:16px;
      background:${color};
      border:2px ${dashed ? "dashed" : "solid"} white;
      border-radius:50%;
      box-shadow:0 0 2px rgba(0,0,0,0.6);
    "></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** A square marker (vs. the round dotIcon), used to visually distinguish
 * lecturer homes from placement markers on the same map. */
export function squareIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;
      width:15px;height:15px;
      background:${color};
      border:2px solid white;
      border-radius:3px;
      box-shadow:0 0 2px rgba(0,0,0,0.6);
    "></span>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7],
  });
}

/** Evenly-spaced hues so any number of lecturers get visually distinct
 * colours without maintaining a fixed palette. */
export function categoricalColor(index: number, total: number): string {
  const hue = (360 / Math.max(total, 1)) * index;
  return `hsl(${hue}, 65%, 42%)`;
}

export const STUDENT_COLOR = "#0f766e";
export const PAEDIATRIC_COLOR = "#2563eb";
export const ADULT_COLOR = "#b45309";
export const DRIVING_ROUTE_COLOR = "#0f766e";
export const TRANSIT_ROUTE_COLOR = "#7c3aed";
