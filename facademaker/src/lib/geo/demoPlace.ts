/** The offline "demo place" — a frozen snapshot of one central-Amsterdam
 * area, captured once (`npm run fixture:amsterdam` / `scripts/capture-
 * fixture.mjs`) and committed under `public/fixtures/amsterdam/` so the app
 * can load a fully-populated place (terrain + context buildings + streets)
 * with ZERO network calls to Overpass or the AWS DEM — those services are
 * slow (12-15s) and rate-limit hard during development.
 *
 * IMPORTANT: the three fixture JSON files are pre-projected against
 * `DEMO_ANCHOR` over `DEMO_BBOX` — every building footprint, street
 * polyline, and heightfield cell is baked in local plan metres relative to
 * that exact lat0/lon0. Changing either constant here WITHOUT recapturing
 * the fixtures corrupts the geometry (buildings/streets land at the wrong
 * place relative to the terrain). Keep this file and
 * `public/fixtures/amsterdam/*.json` in lockstep — see
 * `public/fixtures/amsterdam/ATTRIBUTION.md` for sources and how to
 * regenerate. Pure data — no React.
 */

import type { GeoAnchor, LngLatBBox } from "./project";

/** The captured area (must match the bbox the fixtures were fetched for). */
export const DEMO_BBOX: LngLatBBox = {
  west: 4.8952,
  south: 52.3643,
  east: 4.913,
  north: 52.3709,
};

/** The local-metre projection origin every fixture payload is baked against. */
export const DEMO_ANCHOR: GeoAnchor = { lat0: 52.3676, lon0: 4.9041 };

/** Static JSON served from `public/` (Next serves it with no server code) —
 * fetched at runtime, never `import`ed (that would bundle ~1 MB into every
 * page load). */
export const DEMO_TERRAIN_URL = "/fixtures/amsterdam/terrain.json";
export const DEMO_BUILDINGS_URL = "/fixtures/amsterdam/buildings.json";
export const DEMO_STREETS_URL = "/fixtures/amsterdam/streets.json";

/** Recognize a serialized demo scene so autosave/file restore keeps using the
 * committed fixtures instead of silently turning into a live Overpass call. */
export function isDemoPlaceFrame(
  bbox: LngLatBBox | null,
  anchor: GeoAnchor | null,
): boolean {
  return (
    bbox !== null &&
    anchor !== null &&
    bbox.west === DEMO_BBOX.west &&
    bbox.south === DEMO_BBOX.south &&
    bbox.east === DEMO_BBOX.east &&
    bbox.north === DEMO_BBOX.north &&
    anchor.lat0 === DEMO_ANCHOR.lat0 &&
    anchor.lon0 === DEMO_ANCHOR.lon0
  );
}
