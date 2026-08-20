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

export const STUDENT_COLOR = "#0f766e";
export const PAEDIATRIC_COLOR = "#2563eb";
export const ADULT_COLOR = "#b45309";
export const DRIVING_ROUTE_COLOR = "#0f766e";
export const TRANSIT_ROUTE_COLOR = "#7c3aed";
