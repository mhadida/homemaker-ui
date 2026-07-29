import type { FacadeParams, PresetId } from "./types";

export interface BlockGenSettings {
  lotWidth: { min: number; max: number };
  storeys: { min: number; max: number };
  /** Generated opening width as a fraction of its bay width. Optional only
   * for backward compatibility with saved scenes created before this range. */
  windowWidthRatio: { min: number; max: number };
  /** Generated opening height as a fraction of its storey height. */
  windowHeightRatio: { min: number; max: number };
  /** Allowed preset pool the generator draws characters from. */
  presets: PresetId[];
  /** 0–1 chance a lot's ground floor is retail. */
  shopfrontShare: number;
  /** 0–1 jitter on ratios/colors/ornament. */
  variation: number;
  /** 0–0.3 m: lots offset ±depthJitter/2 around the line. */
  depthJitter: number;
}

/** Template — always structuredClone() when assigning to a block. */
export const DEFAULT_GEN: BlockGenSettings = {
  lotWidth: { min: 5, max: 9 },
  storeys: { min: 2, max: 4 },
  windowWidthRatio: { min: 0.35, max: 0.65 },
  windowHeightRatio: { min: 0.45, max: 0.7 },
  presets: ["georgian", "victorian-shopfront", "modern"],
  shopfrontShare: 0.3,
  variation: 0.5,
  depthJitter: 0.12,
};

export interface LotState {
  /** A full v1 citizen — the entire existing stack consumes it unchanged. */
  params: FacadeParams;
  /** Sparse alternate use for this frontage slot. Absent means a normal
   * building facade, preserving every existing scene byte-for-byte. */
  kind?: "arch-gate";
  /** Hand-edited → reroll must not touch it. */
  customized: boolean;
  /** Signed setback along the block normal (m); + is street-side proud.
   * Straddles the drawn line so streets get natural shadow lines. */
  depthOffset?: number;
}

/** An arch gate is a replacement for one interior facade slot: it must have a
 * building on both sides. Adjacent gates would not have masonry support
 * between them, so neither is considered valid. */
export function isArchGateLot(block: FacadeBlock, index: number): boolean {
  return (
    block.lots[index]?.kind === "arch-gate" &&
    index > 0 &&
    index < block.lots.length - 1 &&
    block.lots[index - 1]?.kind !== "arch-gate" &&
    block.lots[index + 1]?.kind !== "arch-gate"
  );
}

/** Drop stale gate uses after a lot deletion/refit leaves them without two
 * neighboring buildings. Identity-preserving when every block is valid. */
export function normalizeArchGateLots(
  blocks: readonly FacadeBlock[],
): FacadeBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    const invalid = block.lots.some(
      (lot, index) => lot.kind === "arch-gate" && !isArchGateLot(block, index),
    );
    if (!invalid) return block;
    changed = true;
    return {
      ...block,
      lots: block.lots.map((lot, index) => {
        if (lot.kind !== "arch-gate" || isArchGateLot(block, index)) return lot;
        const normalized = { ...lot };
        delete normalized.kind;
        return normalized;
      }),
    };
  });
  return changed ? next : (blocks as FacadeBlock[]);
}

export interface FacadeBlock {
  id: string;
  /** Drawn segment in plan coords [x, z], meters. */
  line: { a: [number, number]; b: [number, number] };
  /** Facades face the line's left side; flipped swaps sides. */
  flipped: boolean;
  gen: BlockGenSettings;
  seed: number;
  /** In order along the (effective) line. */
  lots: LotState[];
  /** Set on blocks auto-derived from a street edge (SP-2c). Absent on
   * hand-drawn blocks. Drives street-driven regeneration/refit. */
  source?: { streetId: string; segment: number; part: number; side: "left" | "right" };
  /** Set on blocks promoted from an imported real footprint (M4). The real
   * parcel polygon in local metres, the source OSM id, and the CLAMPED plot
   * depth. Depth is stored rather than re-derived because the parcel is fixed
   * while the block line is not: after a node drag, re-deriving would change
   * a depth whose plot has not moved. Absent on drawn and street-derived
   * blocks — absent means every M4 path is skipped. */
  parcel?: {
    /** Cadastral parcel id for new promotions; legacy saves may hold an OSM id. */
    source: string;
    outline: [number, number][];
    depth: number;
    /** OSM context building replaced by this editable building. */
    contextBuildingId?: string;
  };
}

export interface Selection {
  blockId: string;
  lot: number;
  level: "lot" | "block" | "corner";
  /** Set when level === "corner". */
  cornerKey?: string;
}

/** How buildings render in the 3D scene. `full` = detailed facades (default);
 * `massing` = plain volume boxes, no windows/ornament; `outline` = wireframe
 * lot volumes; `off` = buildings hidden (streets/ground/lot lines remain). */
export type BuildingDisplay = "full" | "massing" | "outline" | "off";

export interface BlockFrame {
  origin: [number, number];
  /** Unit vector along the effective line. */
  dir: [number, number];
  /** Unit outward facade normal, plan coords. */
  normal: [number, number];
  length: number;
}

/** flipped swaps the endpoints HERE so all downstream math ignores it.
 * For the v1 starting line a=(-w/2,0)→b=(w/2,0) the normal is [0,1] (+z),
 * matching the v1 facade orientation — a binding invariant. */
export function blockFrame(
  block: Pick<FacadeBlock, "line" | "flipped">,
): BlockFrame {
  const a = block.flipped ? block.line.b : block.line.a;
  const b = block.flipped ? block.line.a : block.line.b;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const inv = length > 0 ? 1 / length : 1;
  const dir: [number, number] = [dx * inv, dz * inv];
  const normal: [number, number] = [-dir[1], dir[0]];
  return { origin: [a[0], a[1]], dir, normal, length };
}

export interface LotPlacement {
  /** World position of the lot's facade centerline at ground level. */
  position: [number, number, number];
  rotationY: number;
  width: number;
}

/** Lay the lots along the frame in order. rotationY maps the lot's local
 * +x to the frame dir and local +z to the frame normal. */
export function lotPlacements(block: FacadeBlock): LotPlacement[] {
  const { origin, dir, normal } = blockFrame(block);
  const rotationY = Math.atan2(-dir[1], dir[0]);
  let t = 0;
  return block.lots.map((lot) => {
    const w = lot.params.width;
    const mid = t + w / 2;
    t += w;
    const off = lot.depthOffset ?? 0;
    return {
      position: [
        origin[0] + dir[0] * mid + normal[0] * off,
        0,
        origin[1] + dir[1] * mid + normal[1] * off,
      ],
      rotationY,
      width: w,
    };
  });
}

export function totalLotsWidth(block: FacadeBlock): number {
  return block.lots.reduce((s, l) => s + l.params.width, 0);
}

/** Lot edits change widths — keep the line in sync so the drawn segment and
 * the built street never drift. The effective origin stays fixed. */
export function syncLineToLots(block: FacadeBlock): FacadeBlock {
  const { origin, dir } = blockFrame(block);
  const len = totalLotsWidth(block);
  const end: [number, number] = [
    origin[0] + dir[0] * len,
    origin[1] + dir[1] * len,
  ];
  return {
    ...block,
    line: block.flipped
      ? { a: end, b: origin }
      : { a: origin, b: end },
  };
}

let idCounter = 0;
/** Session-unique ids (no persistence in v1). */
export function nextBlockId(): string {
  idCounter += 1;
  return `block-${idCounter}`;
}

/** After loading a saved scene, bump the id counter past every loaded
 * `block-N` id so freshly-drawn blocks can never collide with loaded ones.
 * (Ids are session-local strings; only the numeric suffix matters.) */
export function reserveBlockIds(blocks: FacadeBlock[]): void {
  for (const b of blocks) {
    const m = /^block-(\d+)$/.exec(b.id);
    if (m) idCounter = Math.max(idCounter, Number(m[1]));
  }
}

/** The v1 single-facade world: one block, one unpinned lot. */
export function initialWorld(params: FacadeParams): FacadeBlock {
  return {
    id: nextBlockId(),
    line: { a: [-params.width / 2, 0], b: [params.width / 2, 0] },
    flipped: false,
    gen: structuredClone(DEFAULT_GEN),
    seed: 1,
    lots: [{ params, customized: false }],
  };
}

/** Endpoint snapping for the drawing tool. */
export function snapPoint(
  p: [number, number],
  blocks: FacadeBlock[],
  radius = 1,
): [number, number] {
  let best = p;
  let bestD = radius;
  for (const b of blocks) {
    for (const e of [b.line.a, b.line.b]) {
      const d = Math.hypot(p[0] - e[0], p[1] - e[1]);
      if (d < bestD) {
        bestD = d;
        best = [e[0], e[1]];
      }
    }
  }
  return best;
}

/** Force every lot of a PROMOTED block back onto its parcel depth, with no
 * depth jitter. `generateLot` redraws `massingDepth` from 6-12 m, and both
 * `rerollBlock` and `refit` call it — without this, a reroll or a node drag
 * would push the building out through the back of its own parcel outline.
 * Depth is plot geometry, not generated character. A block with no `parcel`
 * is returned by identity, so this is free on every drawn block. Pure. */
export function applyParcelDepth(block: FacadeBlock): FacadeBlock {
  const parcel = block.parcel;
  if (!parcel) return block;
  const needsFix = block.lots.some(
    (l) => l.params.massingDepth !== parcel.depth || l.depthOffset !== 0,
  );
  if (!needsFix) return block;
  return {
    ...block,
    lots: block.lots.map((l) => ({
      ...l,
      params: { ...l.params, massingDepth: parcel.depth },
      depthOffset: 0,
    })),
  };
}
