import type { FacadeParams, OpeningKind } from "./types";

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
        if (b === doorBay) row.push(t === "garage" ? "garage" : "door");
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
export const GARAGE_WIDTH_MAX = 2.6;
export const GARAGE_HEIGHT_MAX = 2.4;
export const SHOPFRONT_FASCIA = 0.5; // wall band above shopfront glazing
export const SHOPFRONT_MULLION = 0.06; // half-gap between adjacent shopfront bays
export const STOOP_RISE = 0.15;
export const STOOP_RUN = 0.3;
export const STOOP_STEPS = 2;
export const CORNICE_HEIGHT = 0.35;
export const CORNICE_PROJECTION = 0.25;
export const PARAPET_HEIGHT = 0.75;
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
}

export interface FacadeLayout {
  width: number;
  /** top of the wall body (bottom of cornice, if any) */
  wallTop: number;
  /** wallTop + cornice + parapet */
  totalHeight: number;
  /** y of each storey floor, length storeys+1 (last = wallTop) */
  storeyLevels: number[];
  /** resolved [storey][bay] kinds (same as resolveGrid) */
  grid: OpeningKind[][];
  openings: OpeningRect[];
  cornice: { y: number; height: number; projection: number } | null;
  parapet: { y: number; height: number } | null;
  /** one per window when ornament.sills */
  sills: { x: number; y: number; w: number }[];
  /** window rects to frame when ornament.surrounds */
  surrounds: OpeningRect[];
  stoop: {
    x: number;
    w: number;
    steps: number;
    rise: number;
    run: number;
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
        h = Math.min(DOOR_HEIGHT_MAX, sh - DOOR_HEAD_GAP - yOff);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY + yOff;
      } else if (kind === "garage") {
        w = Math.min(GARAGE_WIDTH_MAX, maxW);
        h = Math.min(GARAGE_HEIGHT_MAX, sh - 0.4);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY;
      } else {
        // shopfront: fill the bay; MIN_PIER at party edges, slim mullion gap
        // against interior neighbors
        const left = b === 0 ? bayLeft + MIN_PIER : bayLeft + SHOPFRONT_MULLION;
        const right =
          b === bays - 1
            ? bayLeft + bayWidth - MIN_PIER
            : bayLeft + bayWidth - SHOPFRONT_MULLION;
        w = right - left;
        if (w < MIN_OPENING_WIDTH) continue;
        h = sh - SHOPFRONT_FASCIA;
        if (h < 1.8) continue;
        x = left;
        y = floorY;
      }
      openings.push({ kind, storey: s, bay: b, x, y, w, h });
    }
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
    ? windows.map((o) => ({ x: o.x - 0.06, y: o.y - 0.07, w: o.w + 0.12 }))
    : [];
  const surrounds = params.ornament.surrounds ? [...windows] : [];

  const door = openings.find((o) => o.kind === "door" && o.storey === 0);
  const stoop =
    door &&
    params.groundFloor.stoop &&
    params.groundFloor.treatment === "residential"
      ? {
          x: door.x - 0.2,
          w: door.w + 0.4,
          steps: STOOP_STEPS,
          rise: STOOP_RISE,
          run: STOOP_RUN,
        }
      : null;

  return {
    width,
    wallTop,
    totalHeight,
    storeyLevels,
    grid,
    openings,
    cornice,
    parapet,
    sills,
    surrounds,
    stoop,
  };
}
