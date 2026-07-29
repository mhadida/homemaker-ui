/** Dutch cadastral parcels loaded from Kadaster's BRK Kadastrale Kaart.
 * Pure — no React, Three.js, or network access. */
import type { GeoAnchor } from "./project";
import { project } from "./project";

export type ParcelPoint = [number, number];

/** GeoJSON's Polygon shape: an exterior ring followed by optional hole rings. */
export type ParcelPolygon = ParcelPoint[][];

export interface CadastralParcel {
  /** Stable BRK local identifier where available; GeoJSON feature id otherwise. */
  id: string;
  /** Original BRK id for a locally subdivided design parcel. */
  sourceId?: string;
  /** A parcel may be a MultiPolygon. Every polygon retains all boundary rings. */
  polygons: ParcelPolygon[];
  municipality?: string;
  section?: string;
  number?: number;
  /** Registered cadastral area in square metres, when published. */
  area?: number;
}

export interface CadastralPlot {
  id: string;
  /** The exterior property boundary used by Facademaker's rectangular fitter. */
  outline: ParcelPoint[];
}

export interface CadastralParcelFetchResult {
  parcels: CadastralParcel[];
  /** True when the server-side safety cap stopped pagination. */
  truncated: boolean;
}

interface PdokParcelProperties {
  identificatie_lokaal_id?: unknown;
  kadastrale_gemeente_waarde?: unknown;
  sectie?: unknown;
  perceelnummer?: unknown;
  kadastrale_grootte_waarde?: unknown;
}

export interface PdokParcelFeature {
  id?: unknown;
  properties?: PdokParcelProperties;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
}

const finiteCoordinate = (
  value: unknown,
): value is [number, number, ...number[]] =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]);

function projectRing(raw: unknown, anchor: GeoAnchor): ParcelPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const points = raw
    .filter(finiteCoordinate)
    .map(([lon, lat]) => project(lat, lon, anchor));
  if (points.length > 3) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points.length >= 3 ? points : null;
}

function projectPolygon(raw: unknown, anchor: GeoAnchor): ParcelPolygon | null {
  if (!Array.isArray(raw)) return null;
  const rings = raw
    .map((ring) => projectRing(ring, anchor))
    .filter((ring): ring is ParcelPoint[] => ring !== null);
  return rings.length > 0 ? rings : null;
}

/** Convert PDOK GeoJSON features to the scene's local ENU metre frame. */
export function pdokToCadastralParcels(
  features: PdokParcelFeature[],
  anchor: GeoAnchor,
): CadastralParcel[] {
  const parcels: CadastralParcel[] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) continue;
    const rawPolygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    const polygons = rawPolygons
      .map((polygon) => projectPolygon(polygon, anchor))
      .filter((polygon): polygon is ParcelPolygon => polygon !== null);
    if (polygons.length === 0) continue;

    const props = feature.properties ?? {};
    const localId = props.identificatie_lokaal_id;
    const featureId = feature.id;
    const id =
      typeof localId === "string"
        ? localId
        : typeof featureId === "string" || typeof featureId === "number"
          ? String(featureId)
          : `parcel-${parcels.length + 1}`;
    parcels.push({
      id,
      polygons,
      ...(typeof props.kadastrale_gemeente_waarde === "string"
        ? { municipality: props.kadastrale_gemeente_waarde }
        : {}),
      ...(typeof props.sectie === "string" ? { section: props.sectie } : {}),
      ...(typeof props.perceelnummer === "number" &&
      Number.isFinite(props.perceelnummer)
        ? { number: props.perceelnummer }
        : {}),
      ...(typeof props.kadastrale_grootte_waarde === "number" &&
      Number.isFinite(props.kadastrale_grootte_waarde)
        ? { area: props.kadastrale_grootte_waarde }
        : {}),
    });
  }
  return parcels;
}

/** Every exterior and hole ring that should be drawn as a parcel boundary. */
export function cadastralBoundaryRings(
  parcels: readonly CadastralParcel[],
): ParcelPoint[][] {
  return parcels.flatMap((parcel) =>
    parcel.polygons.flatMap((polygon) => polygon),
  );
}

function pointInRing(point: ParcelPoint, ring: ParcelPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] <
        ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: ParcelPoint, polygon: ParcelPolygon): boolean {
  return (
    pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole))
  );
}

function ringArea(ring: ParcelPoint[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}

/** Smallest cadastral polygon containing a point. Choosing the smallest makes
 * a click deterministic where source polygons overlap at a boundary. */
export function cadastralPlotAtPoint(
  point: ParcelPoint,
  parcels: readonly CadastralParcel[],
): CadastralPlot | null {
  let match: CadastralPlot | null = null;
  let matchArea = Infinity;
  for (const parcel of parcels) {
    for (const polygon of parcel.polygons) {
      if (!pointInPolygon(point, polygon)) continue;
      const area = ringArea(polygon[0]);
      if (area < matchArea) {
        match = { id: parcel.id, outline: polygon[0] };
        matchArea = area;
      }
    }
  }
  return match;
}

/** Area centroid for a footprint; mean fallback covers degenerate source data. */
function footprintCentroid(footprint: ParcelPoint[]): ParcelPoint {
  let twiceArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cz += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) > 1e-8)
    return [cx / (3 * twiceArea), cz / (3 * twiceArea)];
  return [
    footprint.reduce((sum, point) => sum + point[0], 0) / footprint.length,
    footprint.reduce((sum, point) => sum + point[1], 0) / footprint.length,
  ];
}

/** Resolve a building footprint to the cadastral lot that contains it.
 *
 * The centroid is the primary representative point. Vertices are fallbacks
 * for concave footprints whose mathematical centroid can fall outside the
 * polygon. This deliberately returns the PARCEL exterior, never the building
 * footprint, so promotion preserves the property→building hierarchy.
 */
export function cadastralPlotForFootprint(
  footprint: ParcelPoint[],
  parcels: readonly CadastralParcel[],
): CadastralPlot | null {
  if (footprint.length < 3) return null;
  const probes = [footprintCentroid(footprint), ...footprint];
  for (const point of probes) {
    const match = cadastralPlotAtPoint(point, parcels);
    if (match) return match;
  }
  return null;
}
