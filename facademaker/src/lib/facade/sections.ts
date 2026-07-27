import type { FacadeParams, FacadeSection } from "./types";
import { resolveSections, SECTION_OFFSET_MAX } from "./layout";

/** AI-facing named relief patterns. "custom" is the echo/no-touch value. */
export type SectionPattern =
  | "custom"
  | "flush"
  | "recessed-center"
  | "projected-center"
  | "alternating";

/** Relief used by named patterns (m). Deliberately inside ±SECTION_OFFSET_MAX. */
export const SECTION_PATTERN_OFFSET = 0.12;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Even partition of `total` bays into `count` sections, extra bays leftward. */
export function evenPartition(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const rem = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Canonical write-back: store exactly what resolveSections renders, so the
 * panel is WYSIWYG (symmetry enforcement included). */
function canonical(params: FacadeParams): FacadeParams {
  return {
    ...params,
    sections: resolveSections(params).map((s) => ({
      bays: s.bays,
      offset: s.offset,
    })),
  };
}

const asStored = (s: { bays: number; offset: number }): FacadeSection => ({
  bays: s.bays,
  offset: s.offset,
});

/** Set the section count: even split, offsets carried over by index (new
 * sections flush). Count <= 1 clears `sections` (byte-identical default). */
export function withSectionCount(
  params: FacadeParams,
  count: number,
): FacadeParams {
  const n = clamp(Math.round(count), 1, params.bays);
  if (n <= 1) return { ...params, sections: undefined };
  const current = resolveSections(params);
  const sections = evenPartition(params.bays, n).map((bays, i) => ({
    bays,
    offset: current[i]?.offset ?? 0,
  }));
  return canonical({ ...params, sections });
}

/** Set one section's offset. In symmetric mode the mirror section follows
 * (editing either half works). Out-of-range index is a no-op. */
export function withSectionOffset(
  params: FacadeParams,
  index: number,
  offset: number,
): FacadeParams {
  const secs = resolveSections(params).map(asStored);
  if (index < 0 || index >= secs.length) return params;
  const o = clamp(offset, -SECTION_OFFSET_MAX, SECTION_OFFSET_MAX);
  secs[index] = { ...secs[index], offset: o };
  if (params.sectionsSymmetrical) {
    const j = secs.length - 1 - index;
    secs[j] = { ...secs[j], offset: o };
  }
  return canonical({ ...params, sections: secs });
}

/** Grow (+1) or shrink (−1) a section by one bay against its right neighbor
 * (the last section borrows from the left). Clamped so no section drops
 * below 1 bay. Asymmetric mode only — symmetric partitions come from the
 * count + canonical mirroring. */
export function withSectionBays(
  params: FacadeParams,
  index: number,
  delta: 1 | -1,
): FacadeParams {
  if (params.sectionsSymmetrical) return params;
  const secs = resolveSections(params).map(asStored);
  const n = secs.length;
  if (n < 2 || index < 0 || index >= n) return params;
  const neighbor = index < n - 1 ? index + 1 : index - 1;
  const src = delta > 0 ? neighbor : index;
  const dst = delta > 0 ? index : neighbor;
  if (secs[src].bays <= 1) return params;
  secs[src] = { ...secs[src], bays: secs[src].bays - 1 };
  secs[dst] = { ...secs[dst], bays: secs[dst].bays + 1 };
  return canonical({ ...params, sections: secs });
}

/** Toggle the symmetry flag. Turning it ON canonicalizes the stored array to
 * the mirrored form (WYSIWYG — the pre-symmetric values are not archived). */
export function withSectionsSymmetry(
  params: FacadeParams,
  on: boolean,
): FacadeParams {
  const next = { ...params, sectionsSymmetrical: on };
  return next.sections && next.sections.length > 0 ? canonical(next) : next;
}

/** Build a named relief pattern at `count` sections. Center patterns need at
 * least 3 sections (count is bumped; a facade under 3 bays falls back to
 * flush). Alternating clears symmetry; center patterns set it. */
export function applySectionPattern(
  params: FacadeParams,
  count: number,
  pattern: Exclude<SectionPattern, "custom">,
): FacadeParams {
  let n = clamp(Math.round(count), 1, params.bays);
  const center = pattern === "recessed-center" || pattern === "projected-center";
  if (center) n = clamp(Math.max(n, 3), 1, params.bays);
  if (n <= 1 || (center && n < 3)) {
    return { ...params, sections: undefined };
  }
  const mid1 = Math.floor((n - 1) / 2);
  const mid2 = Math.ceil((n - 1) / 2);
  const offsetFor = (i: number): number => {
    if (pattern === "flush") return 0;
    if (pattern === "alternating")
      return i % 2 === 1 ? -SECTION_PATTERN_OFFSET : 0;
    const inCenter = i >= mid1 && i <= mid2;
    if (!inCenter) return 0;
    return pattern === "recessed-center"
      ? -SECTION_PATTERN_OFFSET
      : SECTION_PATTERN_OFFSET;
  };
  const sections = evenPartition(params.bays, n).map((bays, i) => ({
    bays,
    offset: offsetFor(i),
  }));
  const sectionsSymmetrical = center
    ? true
    : pattern === "alternating"
      ? false
      : params.sectionsSymmetrical;
  return canonical({ ...params, sections, sectionsSymmetrical });
}

const EPS = 0.005;

/** Classify the current relief for the AI echo. "custom" = no named match. */
export function classifySectionPattern(params: FacadeParams): SectionPattern {
  const secs = resolveSections(params);
  const n = secs.length;
  const offs = secs.map((s) => s.offset);
  if (n === 1 || offs.every((o) => Math.abs(o) < EPS)) return "flush";
  if (n >= 3) {
    const mid1 = Math.floor((n - 1) / 2);
    const mid2 = Math.ceil((n - 1) / 2);
    const ends = offs.filter((_, i) => i < mid1 || i > mid2);
    const center = offs.slice(mid1, mid2 + 1);
    const endsFlat = ends.every((o) => Math.abs(o - ends[0]) < EPS);
    const centerFlat = center.every((o) => Math.abs(o - center[0]) < EPS);
    if (endsFlat && centerFlat && ends.length > 0) {
      if (center[0] < ends[0] - EPS) return "recessed-center";
      if (center[0] > ends[0] + EPS) return "projected-center";
    }
  }
  if (n >= 2) {
    const evenO = offs[0];
    const oddO = offs[1];
    const alternates = offs.every(
      (o, i) => Math.abs(o - (i % 2 === 0 ? evenO : oddO)) < EPS,
    );
    if (alternates && oddO < evenO - EPS) return "alternating";
  }
  return "custom";
}
