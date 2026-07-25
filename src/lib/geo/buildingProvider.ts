import type { GeoAnchor, LngLatBBox } from "./project";
import type { FetchResult, OsmElement } from "./buildings";
import { osmToContextBuildings } from "./buildings";

/** Source-agnostic footprint lookup: the route is the only caller, and the
 * OpenStreetMap adapter below is the only thing that knows where the
 * footprints come from (an Esri adapter implements this same interface later). */
export interface BuildingProvider {
  fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Buildings scale far worse than terrain: M1's 0.5 degree terrain span would be
// ~10^6 footprints here. 0.05 degrees is ~5 km — a generous city-district pick,
// and small enough to keep one Overpass query bounded.
export const MAX_BUILDING_SPAN_DEG = 0.05;
// Hard cap on returned footprints. Exceeding it truncates and REPORTS it
// (FetchResult.truncated/total) so the UI can say so — never a silent cap.
export const MAX_BUILDINGS = 4000;

/** Validate an untrusted request body. Exported so the route and its test share
 * one definition. Mirrors parseTerrainRequest's guards with the tighter span. */
export function parseBuildingsRequest(
  body: unknown,
): { bbox: LngLatBBox; anchor: GeoAnchor } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = (body as { bbox?: unknown }).bbox as Partial<LngLatBBox> | undefined;
  const a = (body as { anchor?: unknown }).anchor as Partial<GeoAnchor> | undefined;
  if (!b || !a) return null;
  if (!isNum(b.west) || !isNum(b.south) || !isNum(b.east) || !isNum(b.north)) return null;
  if (!isNum(a.lat0) || !isNum(a.lon0)) return null;
  if (!(b.west < b.east && b.south < b.north)) return null;
  if (b.east - b.west > MAX_BUILDING_SPAN_DEG || b.north - b.south > MAX_BUILDING_SPAN_DEG) {
    return null;
  }
  return {
    bbox: { west: b.west, south: b.south, east: b.east, north: b.north },
    anchor: { lat0: a.lat0, lon0: a.lon0 },
  };
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export class OsmBuildingProvider implements BuildingProvider {
  async fetchBuildings(bbox: LngLatBBox, anchor: GeoAnchor): Promise<FetchResult> {
    // Ways only — multipolygon relations (courtyard holes) are deferred.
    // `out geom` inlines each way's node coordinates so one request suffices.
    const query =
      `[out:json][timeout:25];` +
      `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
      `out geom;`;
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      const hint =
        res.status === 429 || res.status === 504
          ? " — Overpass is rate-limiting or busy; try again shortly"
          : "";
      throw new Error(`Overpass HTTP ${res.status}${hint}`);
    }
    const json = (await res.json()) as { elements?: OsmElement[] };
    return osmToContextBuildings(json.elements ?? [], anchor, MAX_BUILDINGS);
  }
}
