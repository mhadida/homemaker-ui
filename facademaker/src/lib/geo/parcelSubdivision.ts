import type {
  CadastralParcel,
  ParcelPoint,
  ParcelPolygon,
} from "./cadastralParcels";

const EPS = 1e-7;
export const MIN_SUBDIVIDED_PARCEL_AREA = 4;

export interface BoundaryHit {
  point: ParcelPoint;
  edge: number;
  t: number;
  distance: number;
}

export interface ParcelSubdivisionEdit {
  /** Official BRK parcel replaced by these locally designed parcels. */
  sourceId: string;
  replacements: CadastralParcel[];
}

export type ParcelSplitResult =
  | {
      ok: true;
      parcels: [CadastralParcel, CadastralParcel];
      snapped: [ParcelPoint, ParcelPoint];
    }
  | { ok: false; error: string };

export type ParcelBatchResult =
  | { ok: true; parcels: CadastralParcel[] }
  | { ok: false; error: string };

export type ParcelMergeResult =
  | { ok: true; parcel: CadastralParcel }
  | { ok: false; error: string };

function distanceSquared(a: ParcelPoint, b: ParcelPoint): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

/** Closest point on a parcel's exterior boundary. */
export function nearestParcelBoundaryPoint(
  point: ParcelPoint,
  outline: readonly ParcelPoint[],
): BoundaryHit | null {
  if (outline.length < 3) return null;
  let best: BoundaryHit | null = null;
  for (let edge = 0; edge < outline.length; edge++) {
    const a = outline[edge];
    const b = outline[(edge + 1) % outline.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    const t =
      length2 <= EPS
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) /
                length2,
            ),
          );
    const snapped: ParcelPoint = [a[0] + dx * t, a[1] + dz * t];
    const distance = Math.sqrt(distanceSquared(point, snapped));
    if (!best || distance < best.distance)
      best = { point: snapped, edge, t, distance };
  }
  return best;
}

function signedArea(ring: readonly ParcelPoint[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}

function polygonArea(polygon: ParcelPolygon): number {
  return Math.max(
    0,
    Math.abs(signedArea(polygon[0])) -
      polygon
        .slice(1)
        .reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0),
  );
}

function pointInRing(point: ParcelPoint, ring: readonly ParcelPoint[]): boolean {
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

function orientation(a: ParcelPoint, b: ParcelPoint, c: ParcelPoint): number {
  return (
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0])
  );
}

function properIntersection(
  a: ParcelPoint,
  b: ParcelPoint,
  c: ParcelPoint,
  d: ParcelPoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    ((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) &&
    ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))
  );
}

function pushUnique(points: ParcelPoint[], point: ParcelPoint): void {
  const last = points[points.length - 1];
  if (!last || distanceSquared(last, point) > EPS * EPS)
    points.push([point[0], point[1]]);
}

/** Walk the source boundary forward from one snapped edge hit to the other. */
function boundaryPath(
  outline: readonly ParcelPoint[],
  from: BoundaryHit,
  to: BoundaryHit,
): ParcelPoint[] {
  const path: ParcelPoint[] = [];
  pushUnique(path, from.point);
  const steps = (to.edge - from.edge + outline.length) % outline.length;
  for (let step = 1; step <= steps; step++)
    pushUnique(path, outline[(from.edge + step) % outline.length]);
  pushUnique(path, to.point);
  return path;
}

function sameRing(
  a: readonly ParcelPoint[],
  b: readonly ParcelPoint[],
): boolean {
  if (a.length !== b.length) return false;
  const start = b.findIndex((p) => distanceSquared(p, a[0]) <= EPS * EPS);
  if (start < 0) return false;
  const forward = a.every(
    (p, i) => distanceSquared(p, b[(start + i) % b.length]) <= EPS * EPS,
  );
  const reverse = a.every(
    (p, i) =>
      distanceSquared(p, b[(start - i + b.length * 2) % b.length]) <=
      EPS * EPS,
  );
  return forward || reverse;
}

function splitPolygon(
  polygon: ParcelPolygon,
  rawA: ParcelPoint,
  rawB: ParcelPoint,
): { polygons: [ParcelPolygon, ParcelPolygon]; snapped: [ParcelPoint, ParcelPoint] } | null {
  const outline = polygon[0];
  const a = nearestParcelBoundaryPoint(rawA, outline);
  const b = nearestParcelBoundaryPoint(rawB, outline);
  if (!a || !b || a.edge === b.edge) return null;
  if (distanceSquared(a.point, b.point) < 0.25) return null;

  // The cut must remain inside the parcel and may not cross its exterior or a
  // hole. Sampling catches concave excursions; proper intersections catch a
  // narrow notch that could fall between samples.
  for (let sample = 1; sample < 16; sample++) {
    const t = sample / 16;
    const p: ParcelPoint = [
      a.point[0] + (b.point[0] - a.point[0]) * t,
      a.point[1] + (b.point[1] - a.point[1]) * t,
    ];
    if (
      !pointInRing(p, outline) ||
      polygon.slice(1).some((hole) => pointInRing(p, hole))
    )
      return null;
  }
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      if (
        ring === outline &&
        (i === a.edge || i === b.edge)
      )
        continue;
      if (
        properIntersection(
          a.point,
          b.point,
          ring[i],
          ring[(i + 1) % ring.length],
        )
      )
        return null;
    }
  }

  const exteriorA = boundaryPath(outline, a, b);
  const exteriorB = boundaryPath(outline, b, a);
  if (exteriorA.length < 3 || exteriorB.length < 3) return null;
  const resultA: ParcelPolygon = [exteriorA];
  const resultB: ParcelPolygon = [exteriorB];
  for (const hole of polygon.slice(1)) {
    const probe = hole[0];
    if (pointInRing(probe, exteriorA)) resultA.push(hole);
    else if (pointInRing(probe, exteriorB)) resultB.push(hole);
    else return null;
  }
  if (
    polygonArea(resultA) < MIN_SUBDIVIDED_PARCEL_AREA ||
    polygonArea(resultB) < MIN_SUBDIVIDED_PARCEL_AREA
  )
    return null;
  return { polygons: [resultA, resultB], snapped: [a.point, b.point] };
}

/** Split the selected cadastral polygon with one boundary-to-boundary cut.
 * The source record is deliberately restricted to one polygon: assigning the
 * other disconnected pieces of a MultiPolygon to a new legal parcel would be
 * an arbitrary cadastral decision. */
export function splitCadastralParcel(
  parcel: CadastralParcel,
  selectedOutline: readonly ParcelPoint[],
  rawA: ParcelPoint,
  rawB: ParcelPoint,
): ParcelSplitResult {
  if (parcel.polygons.length !== 1)
    return {
      ok: false,
      error: "Disconnected parcels cannot be split yet.",
    };
  const polygon = parcel.polygons[0];
  if (!sameRing(polygon[0], selectedOutline))
    return { ok: false, error: "The selected parcel changed. Select it again." };
  const split = splitPolygon(polygon, rawA, rawB);
  if (!split)
    return {
      ok: false,
      error: "Draw a clean cut between two different parcel edges.",
    };
  const base = {
    municipality: parcel.municipality,
    section: parcel.section,
  };
  const sourceId = parcel.sourceId ?? parcel.id;
  const parcels: [CadastralParcel, CadastralParcel] = [
    {
      id: `${parcel.id}~1`,
      sourceId,
      polygons: [split.polygons[0]],
      ...base,
      area: polygonArea(split.polygons[0]),
    },
    {
      id: `${parcel.id}~2`,
      sourceId,
      polygons: [split.polygons[1]],
      ...base,
      area: polygonArea(split.polygons[1]),
    },
  ];
  return { ok: true, parcels, snapped: split.snapped };
}

function polygonBounds(polygon: ParcelPolygon): {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
} {
  const points = polygon.flat();
  return {
    x0: Math.min(...points.map((point) => point[0])),
    x1: Math.max(...points.map((point) => point[0])),
    z0: Math.min(...points.map((point) => point[1])),
    z1: Math.max(...points.map((point) => point[1])),
  };
}

/** Find an axis-aligned cut whose two areas best match the requested ratio.
 * Both axes are searched because a long parcel may run in either direction.
 * The existing validity checks remain the final authority for concavity,
 * holes, and minimum-area slivers. */
function proportionalSplit(
  polygon: ParcelPolygon,
  targetRatio: number,
): [ParcelPolygon, ParcelPolygon] | null {
  const bounds = polygonBounds(polygon);
  const pad = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0, 1);
  let best:
    | {
        polygons: [ParcelPolygon, ParcelPolygon];
        score: number;
      }
    | null = null;
  for (const axis of ["x", "z"] as const) {
    const lo = axis === "x" ? bounds.x0 : bounds.z0;
    const hi = axis === "x" ? bounds.x1 : bounds.z1;
    if (hi - lo < EPS) continue;
    for (let step = 1; step < 96; step++) {
      const value = lo + ((hi - lo) * step) / 96;
      const rawA: ParcelPoint =
        axis === "x"
          ? [value, bounds.z0 - pad]
          : [bounds.x0 - pad, value];
      const rawB: ParcelPoint =
        axis === "x"
          ? [value, bounds.z1 + pad]
          : [bounds.x1 + pad, value];
      const candidate = splitPolygon(polygon, rawA, rawB);
      if (!candidate) continue;
      const total =
        polygonArea(candidate.polygons[0]) + polygonArea(candidate.polygons[1]);
      const ratio = polygonArea(candidate.polygons[0]) / total;
      const direct = Math.abs(ratio - targetRatio);
      const reversed = Math.abs(1 - ratio - targetRatio);
      const score = Math.min(direct, reversed);
      const polygons =
        direct <= reversed
          ? candidate.polygons
          : ([candidate.polygons[1], candidate.polygons[0]] as [
              ParcelPolygon,
              ParcelPolygon,
            ]);
      if (!best || score < best.score) best = { polygons, score };
      if (score < 0.0025) return polygons;
    }
  }
  return best?.polygons ?? null;
}

function dividePolygon(
  polygon: ParcelPolygon,
  count: number,
): ParcelPolygon[] | null {
  if (count === 1) return [polygon];
  const firstCount = Math.floor(count / 2);
  const secondCount = count - firstCount;
  const split = proportionalSplit(polygon, firstCount / count);
  if (!split) return null;
  const first = dividePolygon(split[0], firstCount);
  const second = dividePolygon(split[1], secondCount);
  return first && second ? [...first, ...second] : null;
}

/** Automatically subdivide one connected parcel into approximately equal-area
 * parcels. Count is deliberately capped: this is an interactive planning tool,
 * not a bulk cadastral mutation engine. */
export function autoSplitCadastralParcel(
  parcel: CadastralParcel,
  selectedOutline: readonly ParcelPoint[],
  count: number,
): ParcelBatchResult {
  const integerCount = Math.floor(count);
  if (integerCount < 2 || integerCount > 50)
    return { ok: false, error: "Choose between 2 and 50 parcels." };
  if (parcel.polygons.length !== 1)
    return {
      ok: false,
      error: "Disconnected parcels cannot be split automatically.",
    };
  const polygon = parcel.polygons[0];
  if (!sameRing(polygon[0], selectedOutline))
    return { ok: false, error: "The selected parcel changed. Select it again." };
  if (polygonArea(polygon) / integerCount < MIN_SUBDIVIDED_PARCEL_AREA)
    return {
      ok: false,
      error: `Each parcel must be at least ${MIN_SUBDIVIDED_PARCEL_AREA} m².`,
    };
  const polygons = dividePolygon(polygon, integerCount);
  if (!polygons || polygons.length !== integerCount)
    return {
      ok: false,
      error:
        "This shape cannot be divided into that many clean parcels automatically.",
    };
  const sourceId = parcel.sourceId ?? parcel.id;
  const parcels = polygons.map((next, index): CadastralParcel => ({
    id: `${parcel.id}~auto-${index + 1}`,
    sourceId,
    polygons: [next],
    municipality: parcel.municipality,
    section: parcel.section,
    area: polygonArea(next),
  }));
  return { ok: true, parcels };
}

/** Resolve an approximate target area to the closest equal-size parcel count. */
export function autoParcelCountForArea(
  area: number,
  targetArea: number,
): number {
  if (!Number.isFinite(area) || !Number.isFinite(targetArea) || targetArea <= 0)
    return 1;
  return Math.max(1, Math.min(50, Math.round(area / targetArea)));
}

const MERGE_EPS = 1e-5;

function mergePointKey(point: ParcelPoint): string {
  return `${Math.round(point[0] / MERGE_EPS)}:${Math.round(point[1] / MERGE_EPS)}`;
}

function pointFromMergeKey(key: string): ParcelPoint {
  const [x, z] = key.split(":").map(Number);
  return [x * MERGE_EPS, z * MERGE_EPS];
}

function normalizedRing(
  ring: readonly ParcelPoint[],
  clockwise: boolean,
): ParcelPoint[] {
  const isClockwise = signedArea(ring) < 0;
  const points = ring.map((point): ParcelPoint => [point[0], point[1]]);
  return isClockwise === clockwise ? points : points.reverse();
}

function pointOnSegment(
  point: ParcelPoint,
  a: ParcelPoint,
  b: ParcelPoint,
): number | null {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length2 = dx * dx + dz * dz;
  if (length2 <= MERGE_EPS * MERGE_EPS) return null;
  const cross = dx * (point[1] - a[1]) - dz * (point[0] - a[0]);
  if (Math.abs(cross) > MERGE_EPS * Math.sqrt(length2)) return null;
  const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2;
  return t >= -MERGE_EPS && t <= 1 + MERGE_EPS
    ? Math.max(0, Math.min(1, t))
    : null;
}

/** Cancel shared, oppositely directed boundary segments after splitting every
 * edge at every collinear source vertex. This handles adjacent BRK parcels
 * whose common edge is segmented differently on each side. */
function mergedBoundaryLoops(parcels: readonly CadastralParcel[]): ParcelPoint[][] {
  const rings = parcels.flatMap((parcel) =>
    parcel.polygons.flatMap((polygon) => [
      normalizedRing(polygon[0], false),
      ...polygon.slice(1).map((hole) => normalizedRing(hole, true)),
    ]),
  );
  const allPoints = rings.flat();
  const directed = new Map<string, number>();
  const add = (from: string, to: string) => {
    const key = `${from}>${to}`;
    directed.set(key, (directed.get(key) ?? 0) + 1);
  };
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const cuts = allPoints
        .map((point) => ({ point, t: pointOnSegment(point, a, b) }))
        .filter(
          (entry): entry is { point: ParcelPoint; t: number } =>
            entry.t !== null,
        )
        .sort((left, right) => left.t - right.t);
      const unique = cuts.filter(
        (entry, cutIndex) =>
          cutIndex === 0 ||
          Math.abs(entry.t - cuts[cutIndex - 1].t) > MERGE_EPS,
      );
      for (let cutIndex = 0; cutIndex < unique.length - 1; cutIndex++) {
        const from = mergePointKey(unique[cutIndex].point);
        const to = mergePointKey(unique[cutIndex + 1].point);
        if (from !== to) add(from, to);
      }
    }
  }

  const remaining = new Map<string, string[]>();
  const handled = new Set<string>();
  for (const [key, count] of directed) {
    if (handled.has(key)) continue;
    const [from, to] = key.split(">");
    const reverse = `${to}>${from}`;
    const reverseCount = directed.get(reverse) ?? 0;
    const net = count - reverseCount;
    handled.add(key);
    handled.add(reverse);
    if (net === 0) continue;
    const start = net > 0 ? from : to;
    const end = net > 0 ? to : from;
    const outgoing = remaining.get(start) ?? [];
    if (!outgoing.includes(end)) outgoing.push(end);
    remaining.set(start, outgoing);
  }

  const loops: ParcelPoint[][] = [];
  const used = new Set<string>();
  for (const [start, outgoing] of remaining) {
    for (const first of outgoing) {
      const firstEdge = `${start}>${first}`;
      if (used.has(firstEdge)) continue;
      const keys = [start];
      let from = start;
      let to = first;
      for (let guard = 0; guard <= remaining.size * 2; guard++) {
        used.add(`${from}>${to}`);
        keys.push(to);
        if (to === start) break;
        const next = (remaining.get(to) ?? []).find(
          (candidate) => !used.has(`${to}>${candidate}`),
        );
        if (!next) return [];
        from = to;
        to = next;
      }
      if (keys[keys.length - 1] !== start) return [];
      keys.pop();
      if (keys.length >= 3) loops.push(keys.map(pointFromMergeKey));
    }
  }
  return loops;
}

/** Merge adjacent connected parcels into one parcel, removing their shared
 * internal boundaries. Point-touching or disconnected selections are rejected. */
export function mergeCadastralParcels(
  parcels: readonly CadastralParcel[],
): ParcelMergeResult {
  if (parcels.length < 2)
    return { ok: false, error: "Select at least two parcels to merge." };
  if (parcels.length > 50)
    return {
      ok: false,
      error: "Merge at most 50 parcels in one operation.",
    };
  const loops = mergedBoundaryLoops(parcels);
  if (loops.length === 0)
    return {
      ok: false,
      error: "The selected parcels do not share a clean boundary.",
    };
  const exteriors = loops
    .filter((loop) => signedArea(loop) > 0)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const holes = loops.filter((loop) => signedArea(loop) < 0);
  if (exteriors.length !== 1)
    return {
      ok: false,
      error: "Only one connected group of adjacent parcels can be merged.",
    };
  const exterior = exteriors[0];
  if (holes.some((hole) => !pointInRing(hole[0], exterior)))
    return { ok: false, error: "The selected parcel boundaries are invalid." };
  const polygon: ParcelPolygon = [exterior, ...holes];
  const primary = parcels[0];
  const sourceId = primary.sourceId ?? primary.id;
  const suffix = parcels
    .map((parcel) => parcel.id)
    .sort()
    .join("|")
    .split("")
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
    .toString(36);
  return {
    ok: true,
    parcel: {
      id: `${sourceId}~merge-${suffix}`,
      sourceId,
      polygons: [polygon],
      municipality: primary.municipality,
      section: primary.section,
      area: polygonArea(polygon),
    },
  };
}

/** Apply sparse local design edits after the authoritative parcel layer loads. */
export function applyParcelSubdivisionEdits(
  parcels: readonly CadastralParcel[],
  edits: readonly ParcelSubdivisionEdit[],
): CadastralParcel[] {
  const bySource = new Map(edits.map((edit) => [edit.sourceId, edit]));
  return parcels.flatMap(
    (parcel) => bySource.get(parcel.id)?.replacements ?? [parcel],
  );
}

/** Record a split, including a split of an already synthetic child parcel. */
export function recordParcelSplit(
  edits: readonly ParcelSubdivisionEdit[],
  source: CadastralParcel,
  replacements: readonly CadastralParcel[],
): ParcelSubdivisionEdit[] {
  const sourceId = source.sourceId ?? source.id;
  const existing = edits.find((edit) => edit.sourceId === sourceId);
  const nextReplacements = existing
    ? existing.replacements.flatMap((parcel) =>
        parcel.id === source.id ? [...replacements] : [parcel],
      )
    : [...replacements];
  return [
    ...edits.filter((edit) => edit.sourceId !== sourceId),
    { sourceId, replacements: nextReplacements },
  ];
}

/** Record a merge across one or more authoritative sources. The primary source
 * owns the merged replacement; every other source records an empty replacement
 * list so reload removes its original parcel without duplicating the merge. */
export function recordParcelMerge(
  edits: readonly ParcelSubdivisionEdit[],
  sources: readonly CadastralParcel[],
  merged: CadastralParcel,
): ParcelSubdivisionEdit[] {
  const selectedIds = new Set(sources.map((parcel) => parcel.id));
  const sourceIds = Array.from(
    new Set(sources.map((parcel) => parcel.sourceId ?? parcel.id)),
  );
  const primarySourceId = merged.sourceId ?? sourceIds[0];
  const retained = edits.filter((edit) => !sourceIds.includes(edit.sourceId));
  const updates = sourceIds.map((sourceId): ParcelSubdivisionEdit => {
    const existing = edits.find((edit) => edit.sourceId === sourceId);
    const sourceParcel = sources.find(
      (parcel) => (parcel.sourceId ?? parcel.id) === sourceId,
    );
    const current = existing?.replacements ?? (sourceParcel ? [sourceParcel] : []);
    const replacements = current.filter((parcel) => !selectedIds.has(parcel.id));
    if (sourceId === primarySourceId) replacements.push(merged);
    return { sourceId, replacements };
  });
  return [...retained, ...updates];
}
