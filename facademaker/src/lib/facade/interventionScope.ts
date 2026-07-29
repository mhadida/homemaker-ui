import type { CadastralParcel } from "../geo/cadastralParcels";
import { cadastralPlotAtPoint } from "../geo/cadastralParcels";
import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";
import { MASSING_DEPTH_DEFAULT } from "./layout";

export type ScopePoint = [number, number];

export interface InterventionScope {
  kind: "parcel" | "rectangle";
  /** Selected intervention boundary in world [x,z] metres. */
  outline: ScopePoint[];
  /** Cadastral and editable lots touched by this scope. Namespaced ids. */
  lotIds: string[];
}

export interface LotShape {
  id: string;
  outline: ScopePoint[];
}

/** Exact property rectangles owned by the editable block model. */
export function editableLotShapes(blocks: readonly FacadeBlock[]): LotShape[] {
  const shapes: LotShape[] = [];
  for (const block of blocks) {
    const { origin, dir, normal } = blockFrame(block);
    let along = 0;
    block.lots.forEach((lot, index) => {
      const width = lot.params.width;
      const depth = lot.params.massingDepth ?? MASSING_DEPTH_DEFAULT;
      const offset = lot.depthOffset ?? 0;
      const frontA: ScopePoint = [
        origin[0] + dir[0] * along + normal[0] * offset,
        origin[1] + dir[1] * along + normal[1] * offset,
      ];
      const frontB: ScopePoint = [
        origin[0] + dir[0] * (along + width) + normal[0] * offset,
        origin[1] + dir[1] * (along + width) + normal[1] * offset,
      ];
      shapes.push({
        id: `edit:${block.id}:${index}`,
        outline: [
          frontA,
          frontB,
          [frontB[0] - normal[0] * depth, frontB[1] - normal[1] * depth],
          [frontA[0] - normal[0] * depth, frontA[1] - normal[1] * depth],
        ],
      });
      along += width;
    });
  }
  return shapes;
}

function pointInLoop(point: ScopePoint, loop: ScopePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] <
        ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function orientation(a: ScopePoint, b: ScopePoint, c: ScopePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(
  a: ScopePoint,
  b: ScopePoint,
  c: ScopePoint,
  d: ScopePoint,
): boolean {
  const epsilon = 1e-9;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    ((abC > epsilon && abD < -epsilon) ||
      (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) ||
      (cdA < -epsilon && cdB > epsilon))
  )
    return true;

  const onSegment = (p: ScopePoint, q: ScopePoint, r: ScopePoint) =>
    Math.abs(orientation(p, q, r)) <= epsilon &&
    r[0] >= Math.min(p[0], q[0]) - epsilon &&
    r[0] <= Math.max(p[0], q[0]) + epsilon &&
    r[1] >= Math.min(p[1], q[1]) - epsilon &&
    r[1] <= Math.max(p[1], q[1]) + epsilon;
  return (
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

function loopsIntersect(a: ScopePoint[], b: ScopePoint[]): boolean {
  if (a.some((point) => pointInLoop(point, b))) return true;
  if (b.some((point) => pointInLoop(point, a))) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsIntersect(
          a[i],
          a[(i + 1) % a.length],
          b[j],
          b[(j + 1) % b.length],
        )
      )
        return true;
    }
  }
  return false;
}

function cadastralShapes(
  parcels: readonly CadastralParcel[],
): LotShape[] {
  return parcels.flatMap((parcel) =>
    parcel.polygons.map((polygon) => ({
      id: `brk:${parcel.id}`,
      outline: polygon[0],
    })),
  );
}

/** Click selects one property parcel; editable lots are the fallback when no
 * BRK parcel exists at that point. */
export function scopeFromPoint(
  point: ScopePoint,
  blocks: readonly FacadeBlock[],
  parcels: readonly CadastralParcel[],
): InterventionScope | null {
  const parcel = cadastralPlotAtPoint(point, parcels);
  if (parcel)
    return {
      kind: "parcel",
      outline: parcel.outline,
      lotIds: [`brk:${parcel.id}`],
    };
  const editable = editableLotShapes(blocks)
    .filter((shape) => pointInLoop(point, shape.outline))
    .sort((a, b) => scopeArea(a.outline) - scopeArea(b.outline))[0];
  return editable
    ? { kind: "parcel", outline: editable.outline, lotIds: [editable.id] }
    : null;
}

/** Drag defines a rectangular intervention boundary and records every property
 * lot it touches. The scope remains useful when no parcel data exists. */
export function scopeFromRect(
  a: ScopePoint,
  b: ScopePoint,
  blocks: readonly FacadeBlock[],
  parcels: readonly CadastralParcel[],
): InterventionScope | null {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 0.1 || z1 - z0 < 0.1) return null;
  const outline: ScopePoint[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  // Official property parcels are authoritative when available. Editable
  // lots are only the offline/manual-world fallback; combining both would
  // double-count a promoted parcel and its editable building.
  const shapes =
    parcels.length > 0 ? cadastralShapes(parcels) : editableLotShapes(blocks);
  const lotIds = Array.from(
    new Set(
      shapes
        .filter((shape) => loopsIntersect(outline, shape.outline))
        .map((shape) => shape.id),
    ),
  );
  return { kind: "rectangle", outline, lotIds };
}

export function scopeArea(outline: readonly ScopePoint[]): number {
  let twice = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}
