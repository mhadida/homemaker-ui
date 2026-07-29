/** Frozen, offline demo places.
 *
 * Each place's terrain, buildings, parcels, and streets are pre-projected against its
 * exact `anchor` over its exact `bbox`. The frame and fixture files must move
 * together; changing either coordinate object without recapturing silently
 * misaligns the three layers.
 *
 * Capture with `npm run fixture:amsterdam` or `npm run fixture:utrecht`.
 * Static JSON is fetched at runtime from `public/fixtures/`, never imported
 * into the client bundle.
 */

import type { GeoAnchor, LngLatBBox } from "./project";

export type DemoPlaceId = "amsterdam" | "utrecht";

export interface DemoPlace {
  id: DemoPlaceId;
  /** Short city name used in compact controls and loading feedback. */
  city: string;
  /** Specific area name shown in the demo selector. */
  label: string;
  bbox: LngLatBBox;
  anchor: GeoAnchor;
  terrainUrl: string;
  buildingsUrl: string;
  parcelsUrl: string;
  streetsUrl: string;
}

export const AMSTERDAM_DEMO_PLACE: DemoPlace = {
  id: "amsterdam",
  city: "Amsterdam",
  label: "Amsterdam centrum",
  bbox: {
    west: 4.8952,
    south: 52.3643,
    east: 4.913,
    north: 52.3709,
  },
  anchor: { lat0: 52.3676, lon0: 4.9041 },
  terrainUrl: "/fixtures/amsterdam/terrain.json",
  buildingsUrl: "/fixtures/amsterdam/buildings.json",
  parcelsUrl: "/fixtures/amsterdam/parcels.json",
  streetsUrl: "/fixtures/amsterdam/streets.json",
};

/** The site marked by the user: Smakkelaarsveld / Hoog Catharijne between the
 * Utrecht Centraal rail approaches, Weerdsingel Westzijde, Catharijnesingel,
 * and TivoliVredenburg. The rectangular frame includes a small amount of
 * surrounding street context so the imported network is useful in Walk mode.
 */
export const UTRECHT_DEMO_PLACE: DemoPlace = {
  id: "utrecht",
  city: "Utrecht",
  label: "Utrecht · Smakkelaarsveld",
  bbox: {
    west: 5.1035,
    south: 52.0915,
    east: 5.1135,
    north: 52.0962,
  },
  anchor: { lat0: 52.09385, lon0: 5.1085 },
  terrainUrl: "/fixtures/utrecht/terrain.json",
  buildingsUrl: "/fixtures/utrecht/buildings.json",
  parcelsUrl: "/fixtures/utrecht/parcels.json",
  streetsUrl: "/fixtures/utrecht/streets.json",
};

export const DEMO_PLACES: readonly DemoPlace[] = [
  AMSTERDAM_DEMO_PLACE,
  UTRECHT_DEMO_PLACE,
];

export const DEFAULT_DEMO_PLACE_ID: DemoPlaceId = "amsterdam";

function sameFrame(
  place: DemoPlace,
  bbox: LngLatBBox,
  anchor: GeoAnchor,
): boolean {
  return (
    bbox.west === place.bbox.west &&
    bbox.south === place.bbox.south &&
    bbox.east === place.bbox.east &&
    bbox.north === place.bbox.north &&
    anchor.lat0 === place.anchor.lat0 &&
    anchor.lon0 === place.anchor.lon0
  );
}

/** Resolve a serialized scene frame back to its committed demo fixture. */
export function demoPlaceForFrame(
  bbox: LngLatBBox | null,
  anchor: GeoAnchor | null,
): DemoPlace | null {
  if (!bbox || !anchor) return null;
  return DEMO_PLACES.find((place) => sameFrame(place, bbox, anchor)) ?? null;
}

/** Boolean convenience retained for callers that only need recognition. */
export function isDemoPlaceFrame(
  bbox: LngLatBBox | null,
  anchor: GeoAnchor | null,
): boolean {
  return demoPlaceForFrame(bbox, anchor) !== null;
}

// Backward-compatible Amsterdam aliases for saved tests/callers that treated
// the original single demo as global constants.
export const DEMO_BBOX = AMSTERDAM_DEMO_PLACE.bbox;
export const DEMO_ANCHOR = AMSTERDAM_DEMO_PLACE.anchor;
export const DEMO_TERRAIN_URL = AMSTERDAM_DEMO_PLACE.terrainUrl;
export const DEMO_BUILDINGS_URL = AMSTERDAM_DEMO_PLACE.buildingsUrl;
export const DEMO_STREETS_URL = AMSTERDAM_DEMO_PLACE.streetsUrl;
