import type { FacadeParams, OpeningKind } from "./types";
import { resolveRoof, type RoofPlan } from "./roof";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Resolve the (storeys × bays) grid of opening kinds: defaults from the
 * ground-floor treatment + upper-storey windows, then sparse overrides.
 * Indexed [storey][bay]; storey 0 = ground, bay 0 = leftmost. */
export function resolveGrid(params: FacadeParams): OpeningKind[][] {
  const { storeys, bays } = params;
  const doorBay = clamp(params.groundFloor.doorBay, 0, bays - 1);
  const t = params.groundFloor.treatment;

  const grid: OpeningKind[][] = [];
  for (let s = 0; s < storeys; s++) {
    const row: OpeningKind[] = [];
    for (let b = 0; b < bays; b++) {
      if (s === 0) {
        if (b === doorBay)
          row.push(
            t === "garage" ? "garage" : t === "passage" ? "passage" : "door",
          );
        else row.push(t === "shopfront" ? "shopfront" : "window");
      } else {
        row.push("window");
      }
    }
    grid.push(row);
  }

  for (const o of params.cellOverrides ?? []) {
    if (o.storey >= 0 && o.storey < storeys && o.bay >= 0 && o.bay < bays) {
      grid[o.storey][o.bay] = o.kind;
    }
  }
  return grid;
}

// ── Layout constants (meters) ────────────────────────────────────────────────
export const WALL_THICKNESS = 0.35;
export const MIN_PIER = 0.3; // min wall between adjacent openings / at party edges
export const SILL_HEIGHT = 0.9; // window sill above storey floor
export const WINDOW_HEAD_GAP = 0.3; // min wall above a window within its storey
export const DOOR_WIDTH = 1.0;
export const DOOR_HEIGHT_MAX = 2.3;
export const DOOR_HEAD_GAP = 0.3;
export const DOOR_LEAF_HEIGHT = 2.1; // fixed door-leaf height; transom fills above
export const TRANSOM_MIN = 0.3; // no sliver transoms — leaf stretches instead
export const GARAGE_WIDTH_MAX = 2.6;
export const GARAGE_HEIGHT_MAX = 2.4;
export const PASSAGE_WIDTH_MAX = 3.2; // carriage-arch mouth, wider than a garage
export const PASSAGE_HEAD_GAP = 0.25; // wall above the arch crown within the storey
export const PASSAGE_MIN_SIDE = 1.4; // min straight jamb below the arch springline
export const SHOPFRONT_FASCIA = 0.5; // wall band above shopfront glazing
export const SHOPFRONT_MULLION = 0.06; // half-gap between adjacent shopfront bays
export const STOOP_RISE = 0.15;
export const STOOP_RUN = 0.3;
export const STOOP_STEPS = 2;
export const CORNICE_HEIGHT = 0.35;
export const CORNICE_PROJECTION = 0.25;
export const PARAPET_HEIGHT = 0.75;
export const MASSING_DEPTH_MIN = 3;
export const MASSING_DEPTH_MAX = 20;
export const MASSING_DEPTH_DEFAULT = 8;
export const SECTION_OFFSET_MAX = 0.15; // max perpendicular relief (m); keeps
// the max relative step (0.30) below WALL_THICKNESS so strips always overlap
export const SECTION_LAP = 0.05; // anti-coplanar underlap at offset steps (m);
// below SHOPFRONT_MULLION (0.06), the smallest opening-to-bay-edge margin
const MIN_OPENING_WIDTH = 0.2;
const MIN_WINDOW_HEIGHT = 0.4;

export interface OpeningRect {
  kind: Exclude<OpeningKind, "blank">;
  storey: number;
  bay: number;
  /** left edge, facade coords */
  x: number;
  /** bottom edge, facade coords */
  y: number;
  w: number;
  h: number;
  /** Glazed transom height above a DOOR_LEAF_HEIGHT leaf (door kind only;
   * absent when the leaf fills the whole opening). */
  transomH?: number;
  /** Round-headed hole (passage kind): a semicircular head of radius w/2 at
   * springline `y + h − w/2` (crown at `y + h`). Absent = rectangular. */
  arched?: boolean;
}

/** The pass-through tunnel void that pierces one section strip's massing box.
 * Facade-local x range + the crown height the mass must clear. */
export interface PassagePlan {
  x0: number;
  x1: number;
  top: number;
}

export interface ResolvedSection {
  /** First bay index (inclusive). */
  startBay: number;
  bays: number;
  offset: number;
}

/** THE section sanitizer (all clamps live in this file): sanitize entries,
 * cap the count at the bay count, refit stale partitions proportionally so
 * the sum is exactly `bays` (min 1 each), then enforce symmetry. Total and
 * deterministic — the mesh renders whatever this returns. */
export function resolveSections(params: FacadeParams): ResolvedSection[] {
  const total = params.bays;
  const raw = params.sections ?? [];
  if (raw.length === 0) return [{ startBay: 0, bays: total, offset: 0 }];

  const count = Math.min(raw.length, total);
  const bays = raw
    .slice(0, count)
    .map((s) => (Number.isFinite(s.bays) ? Math.max(1, Math.round(s.bays)) : 1));
  const offsets = raw
    .slice(0, count)
    .map((s) =>
      Number.isFinite(s.offset)
        ? clamp(s.offset, -SECTION_OFFSET_MAX, SECTION_OFFSET_MAX)
        : 0,
    );

  // Proportional refit (largest remainder, min 1). count <= total, so a
  // minimum of 1 bay per section is always feasible.
  const sum = bays.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    const quotas = bays.map((b) => (b * total) / sum);
    const fitted = quotas.map((q) => Math.max(1, Math.floor(q)));
    let acc = fitted.reduce((a, b) => a + b, 0);
    if (acc < total) {
      const order = quotas
        .map((q, i) => ({ i, frac: q - Math.floor(q) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
      for (let k = 0; acc < total; k = (k + 1) % order.length) {
        fitted[order[k].i] += 1;
        acc += 1;
      }
    } else {
      while (acc > total) {
        let d = -1;
        for (let i = 0; i < fitted.length; i++) {
          if (fitted[i] > 1 && (d < 0 || fitted[i] >= fitted[d])) d = i;
        }
        fitted[d] -= 1;
        acc -= 1;
      }
    }
    for (let i = 0; i < count; i++) bays[i] = fitted[i];
  }

  // Symmetry: right half mirrors the left (left wins). The middle (odd
  // count) absorbs the remainder, borrowing innermost-left when short; even
  // counts adjust the innermost pair, any odd leftover bay landing on the
  // innermost RIGHT section (no exact palindrome exists then).
  if (params.sectionsSymmetrical && count >= 2) {
    const half = Math.floor(count / 2);
    for (let i = 0; i < half; i++) offsets[count - 1 - i] = offsets[i];
    const left = bays.slice(0, half);
    if (count % 2 === 1) {
      let mid = total - 2 * left.reduce((a, b) => a + b, 0);
      while (mid < 1) {
        let d = half - 1;
        while (left[d] <= 1) d--;
        left[d] -= 1;
        mid += 2;
      }
      bays.splice(0, count, ...left, mid, ...[...left].reverse());
    } else {
      const rem = total - 2 * left.reduce((a, b) => a + b, 0);
      let add = Math.trunc(rem / 2);
      const leftover = rem - 2 * add;
      for (let i = half - 1; add !== 0 && i >= 0; i--) {
        if (add > 0) {
          left[i] += add;
          add = 0;
        } else {
          const take = Math.min(left[i] - 1, -add);
          left[i] -= take;
          add += take;
        }
      }
      const right = [...left].reverse();
      if (leftover > 0) right[0] += leftover;
      else if (leftover < 0) {
        let d = 0;
        while (right[d] <= 1) d++;
        right[d] -= 1;
      }
      bays.splice(0, count, ...left, ...right);
    }
  }

  const out: ResolvedSection[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    out.push({ startBay: start, bays: bays[i], offset: offsets[i] });
    start += bays[i];
  }
  return out;
}

export interface SectionStrip extends ResolvedSection {
  /** Wall-strip x-extents, lap included. First strip x0 = -width/2, last
   * strip x1 = +width/2 (corner miters are a mesh concern). */
  x0: number;
  x1: number;
}

export interface FacadeLayout {
  width: number;
  /** top of the wall body (bottom of cornice, if any) */
  wallTop: number;
  /** clamped building-body depth (m); the mesh renders one box per section
   * strip using this + each strip's x0/x1 */
  massingDepth: number;
  /** roof plan over the mass, or null for a flat roof (no roof mesh) */
  roof: RoofPlan | null;
  /** pass-through tunnel piercing one strip's mass, or null when no passage */
  passage: PassagePlan | null;
  /** wallTop + cornice + parapet */
  totalHeight: number;
  /** y of each storey floor, length storeys+1 (last = wallTop) */
  storeyLevels: number[];
  /** resolved [storey][bay] kinds (same as resolveGrid) */
  grid: OpeningKind[][];
  openings: OpeningRect[];
  /** vertical strips (>= 1, covering the full width) the mesh renders as
   * z-offset groups; at an offset step the recessed strip laps under the
   * prouder neighbor so their boundary faces are never coplanar */
  sections: SectionStrip[];
  cornice: { y: number; height: number; projection: number } | null;
  parapet: { y: number; height: number } | null;
  /** one per window when ornament.sills; bay assigns it to a section */
  sills: { x: number; y: number; w: number; bay: number }[];
  /** window rects to frame when ornament.surrounds */
  surrounds: OpeningRect[];
  stoop: {
    x: number;
    w: number;
    steps: number;
    rise: number;
    run: number;
    /** the door's bay — assigns the stoop to a section */
    bay: number;
  } | null;
}

/** storeyHeights padded/truncated to `storeys`, falling back to storeyHeight. */
function resolveStoreyHeights(params: FacadeParams): number[] {
  const hs = params.storeyHeights ?? [];
  const out: number[] = [];
  for (let s = 0; s < params.storeys; s++) out.push(hs[s] ?? params.storeyHeight);
  return out;
}

/** Pure layout: FacadeParams → flat rectangles. All validity clamps live
 * HERE (single source of truth) — the mesh layer renders whatever this
 * returns without further checks. Degenerate cells (too narrow/short after
 * clamping) are silently skipped, never emitted invalid. */
export function computeLayout(params: FacadeParams): FacadeLayout {
  const width = params.width;
  const bays = params.bays;
  const rawDepth = params.massingDepth;
  const massingDepth =
    rawDepth === undefined || !Number.isFinite(rawDepth)
      ? MASSING_DEPTH_DEFAULT
      : clamp(rawDepth, MASSING_DEPTH_MIN, MASSING_DEPTH_MAX);
  const heights = resolveStoreyHeights(params);
  const storeyLevels: number[] = [0];
  for (const h of heights) storeyLevels.push(storeyLevels[storeyLevels.length - 1] + h);
  const wallTop = storeyLevels[params.storeys];
  const grid = resolveGrid(params);
  const bayWidth = width / bays;
  const stoopRise = STOOP_RISE * STOOP_STEPS;

  const openings: OpeningRect[] = [];
  for (let s = 0; s < params.storeys; s++) {
    const floorY = storeyLevels[s];
    const sh = heights[s];
    for (let b = 0; b < bays; b++) {
      const kind = grid[s][b];
      if (kind === "blank") continue;
      const bayLeft = -width / 2 + b * bayWidth;
      const bayCenter = bayLeft + bayWidth / 2;
      const maxW = bayWidth - MIN_PIER;
      if (maxW < MIN_OPENING_WIDTH) continue; // degenerate bay — skip

      let x: number, y: number, w: number, h: number;
      let transomH: number | undefined;
      if (kind === "window") {
        w = clamp(params.windowWidthRatio * bayWidth, MIN_OPENING_WIDTH, maxW);
        const maxH = sh - SILL_HEIGHT - WINDOW_HEAD_GAP;
        if (maxH < MIN_WINDOW_HEIGHT) continue;
        h = clamp(params.windowHeightRatio * sh, MIN_WINDOW_HEIGHT, maxH);
        x = bayCenter - w / 2;
        y = floorY + SILL_HEIGHT;
      } else if (kind === "door") {
        const raised = s === 0 && params.groundFloor.stoop &&
          params.groundFloor.treatment === "residential";
        const yOff = raised ? stoopRise : 0;
        w = Math.min(DOOR_WIDTH, maxW);
        // Base rule is the floor — head alignment only ever GROWS the door.
        const baseH = Math.min(DOOR_HEIGHT_MAX, sh - DOOR_HEAD_GAP - yOff);
        // Alignment target (head height above the storey floor): the row's
        // window head, else the shopfront glazing head, else none.
        let alignedHead = 0;
        const windowMaxH = sh - SILL_HEIGHT - WINDOW_HEAD_GAP;
        if (grid[s].includes("window") && windowMaxH >= MIN_WINDOW_HEIGHT) {
          const windowH = clamp(
            params.windowHeightRatio * sh,
            MIN_WINDOW_HEIGHT,
            windowMaxH,
          );
          alignedHead = SILL_HEIGHT + windowH;
        } else if (grid[s].includes("shopfront")) {
          alignedHead = sh - SHOPFRONT_FASCIA;
        }
        // Defensive cap: alignment targets are ≤ sh − DOOR_HEAD_GAP by
        // construction, but the head-gap clamp must always win.
        h = Math.min(
          Math.max(baseH, alignedHead - yOff),
          sh - DOOR_HEAD_GAP - yOff,
        );
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY + yOff;
        if (h >= DOOR_LEAF_HEIGHT + TRANSOM_MIN) {
          transomH = h - DOOR_LEAF_HEIGHT;
        }
      } else if (kind === "garage") {
        w = Math.min(GARAGE_WIDTH_MAX, maxW);
        h = Math.min(GARAGE_HEIGHT_MAX, sh - 0.4);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY;
      } else if (kind === "passage") {
        // Tall carriage arch with a semicircular head (radius w/2). Nearly the
        // full ground storey; shrink the width if a short storey wouldn't
        // leave a straight jamb of at least PASSAGE_MIN_SIDE below the spring.
        h = sh - PASSAGE_HEAD_GAP;
        w = Math.min(PASSAGE_WIDTH_MAX, maxW);
        if (h - w / 2 < PASSAGE_MIN_SIDE) w = 2 * (h - PASSAGE_MIN_SIDE);
        if (w < MIN_OPENING_WIDTH || w > maxW) continue; // can't host a real arch
        x = bayCenter - w / 2;
        y = floorY;
        openings.push({ kind, storey: s, bay: b, x, y, w, h, arched: true });
        continue; // fully built (arched set); skip the generic rectangular push
      } else {
        // shopfront: fill the bay; MIN_PIER at party edges, slim mullion gap
        // against a shopfront neighbor, else half a pier (the neighbor's own
        // opening contributes the other half) so the combined gap is MIN_PIER.
        const edgeInset = (neighborBay: number, isPartyEdge: boolean): number => {
          if (isPartyEdge) return MIN_PIER;
          return grid[s][neighborBay] === "shopfront" ? SHOPFRONT_MULLION : MIN_PIER / 2;
        };
        const left = bayLeft + edgeInset(b - 1, b === 0);
        const right = bayLeft + bayWidth - edgeInset(b + 1, b === bays - 1);
        w = right - left;
        if (w < MIN_OPENING_WIDTH) continue;
        h = sh - SHOPFRONT_FASCIA;
        if (h < 1.8) continue;
        x = left;
        y = floorY;
      }
      const rect: OpeningRect = { kind, storey: s, bay: b, x, y, w, h };
      if (transomH !== undefined) rect.transomH = transomH;
      openings.push(rect);
    }
  }

  // ── Sections: vertical strips with perpendicular relief ──
  const sections: SectionStrip[] = resolveSections(params).map((s) => ({
    ...s,
    x0: -width / 2 + s.startBay * bayWidth,
    x1: -width / 2 + (s.startBay + s.bays) * bayWidth,
  }));
  sections[0].x0 = -width / 2;
  sections[sections.length - 1].x1 = width / 2;
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    if (a.offset < b.offset - 1e-9) a.x1 += SECTION_LAP;
    else if (a.offset > b.offset + 1e-9) b.x0 -= SECTION_LAP;
  }

  // ── Ornament ──
  const cornice = params.ornament.cornice
    ? { y: wallTop, height: CORNICE_HEIGHT, projection: CORNICE_PROJECTION }
    : null;
  const parapet = params.ornament.parapet
    ? { y: wallTop + (cornice ? cornice.height : 0), height: PARAPET_HEIGHT }
    : null;
  const totalHeight =
    wallTop + (cornice ? cornice.height : 0) + (parapet ? parapet.height : 0);

  const windows = openings.filter((o) => o.kind === "window");
  const sills = params.ornament.sills
    ? windows.map((o) => ({ x: o.x - 0.06, y: o.y - 0.07, w: o.w + 0.12, bay: o.bay }))
    : [];
  const surrounds = params.ornament.surrounds ? [...windows] : [];

  // Pass-through tunnel: the void the mesh cuts through the mass behind the
  // passage arch (full massing depth). null when there's no passage.
  const passageOpening = openings.find((o) => o.kind === "passage");
  const passage: PassagePlan | null = passageOpening
    ? {
        x0: passageOpening.x,
        x1: passageOpening.x + passageOpening.w,
        top: passageOpening.y + passageOpening.h,
      }
    : null;

  const door = openings.find((o) => o.kind === "door" && o.storey === 0);
  const stoop =
    door &&
    params.groundFloor.stoop &&
    params.groundFloor.treatment === "residential"
      ? (() => {
          const stoopX = Math.max(door.x - 0.2, -width / 2);
          const stoopRight = Math.min(door.x + door.w + 0.2, width / 2);
          return {
            x: stoopX,
            w: stoopRight - stoopX,
            steps: STOOP_STEPS,
            rise: STOOP_RISE,
            run: STOOP_RUN,
            bay: door.bay,
          };
        })()
      : null;

  return {
    width,
    wallTop,
    massingDepth,
    roof: resolveRoof(params, wallTop, massingDepth),
    passage,
    totalHeight,
    storeyLevels,
    grid,
    openings,
    sections,
    cornice,
    parapet,
    sills,
    surrounds,
    stoop,
  };
}
