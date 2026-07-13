import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";
import { deriveNodes } from "./nodes";
import type { FacadeParams } from "./types";

/** One block's side of a corner. lotSide names which end of that LOT's
 * local x-axis touches the node (frame origin = "left"). */
export interface CornerSide {
  blockId: string;
  end: "a" | "b";
  lotIndex: number;
  lotSide: "left" | "right";
}

export interface Corner {
  /** Sorted pair key — stable across drags, dies with block deletion. */
  key: string;
  node: [number, number];
  a: CornerSide;
  b: CornerSide;
  /** Turn at the node in degrees: 0 = straight through, 90 = right angle. */
  turn: number;
  /** Facades wrap the outer corner (wedge gap) vs interpenetrate (concave). */
  convex: boolean;
}

export const DEFAULT_MAX_CORNER_ANGLE = 150;

/** Unit vector pointing from the node INTO the block along its line. */
function awayDir(block: FacadeBlock, end: "a" | "b"): [number, number] {
  const from = block.line[end];
  const to = block.line[end === "a" ? "b" : "a"];
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

function sideFor(block: FacadeBlock, end: "a" | "b"): CornerSide {
  // Frame origin sits at line.a unless flipped (see blockFrame).
  const atOrigin = (end === "a") !== block.flipped;
  return {
    blockId: block.id,
    end,
    lotIndex: atOrigin ? 0 : block.lots.length - 1,
    lotSide: atOrigin ? "left" : "right",
  };
}

export function detectCorners(
  blocks: FacadeBlock[],
  maxTurnDeg: number,
): Corner[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const corners: Corner[] = [];
  for (const node of deriveNodes(blocks)) {
    if (node.refs.length !== 2) continue;
    const [r1, r2] = node.refs;
    if (r1.blockId === r2.blockId) continue; // zero-length self-weld
    const [ra, rb] =
      `${r1.blockId}:${r1.end}` < `${r2.blockId}:${r2.end}` ? [r1, r2] : [r2, r1];
    const A = byId.get(ra.blockId)!;
    const B = byId.get(rb.blockId)!;
    // Continuous-frontage requirement: the two facades only meet as a
    // corner when one block's node-end sits at its frame ORIGIN and the
    // other's at its frame END (opposite atOrigin parity). Same-parity
    // junctions are discontinuous frontage (one street flipped relative
    // to the chain) — not a corner, and convexity is ill-defined there
    // (order-dependent), so skip.
    const atOriginA = (ra.end === "a") !== A.flipped;
    const atOriginB = (rb.end === "a") !== B.flipped;
    if (atOriginA === atOriginB) continue;
    const uA = awayDir(A, ra.end);
    const uB = awayDir(B, rb.end);
    const dot = Math.max(-1, Math.min(1, uA[0] * uB[0] + uA[1] * uB[1]));
    const turn = 180 - (Math.acos(dot) * 180) / Math.PI;
    if (turn > maxTurnDeg) continue;
    const nA = blockFrame(A).normal;
    const convex = uB[0] * nA[0] + uB[1] * nA[1] > 1e-9;
    corners.push({
      key: `${ra.blockId}:${ra.end}|${rb.blockId}:${rb.end}`,
      node: node.pos,
      a: sideFor(A, ra.end),
      b: sideFor(B, rb.end),
      turn,
      convex,
    });
  }
  return corners;
}

export interface CornerChoice {
  mode: "unified" | "two-facades";
  /** Which side is the design source in unified mode (and the default
   * shell source when no edited side is known). */
  primary: "a" | "b";
}

/** The shared shell — the single source of truth for what "one building"
 * means across a corner. Width, bays, openings, colors of doors etc. stay
 * per-frontage (unless unified mirrors some of them). */
export const SHELL_FIELDS = [
  "storeys",
  "storeyHeight",
  "storeyHeights",
  "wallColor",
  "trimColor",
  "ornament",
  "windowStyle",
] as const;

const lotOf = (blocks: FacadeBlock[], side: CornerSide) =>
  blocks.find((b) => b.id === side.blockId)!.lots[side.lotIndex];

export function cornerChoice(
  choices: ReadonlyMap<string, CornerChoice>,
  corner: Corner,
  blocks: FacadeBlock[],
): CornerChoice {
  const existing = choices.get(corner.key);
  if (existing) return existing;
  const wa = lotOf(blocks, corner.a).params.width;
  const wb = lotOf(blocks, corner.b).params.width;
  return { mode: "two-facades", primary: wa >= wb ? "a" : "b" };
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Copy the shell (and, when unified, the face) from source to target.
 * Returns null when the target already matches (idempotence). */
function syncedParams(
  source: FacadeParams,
  target: FacadeParams,
  unified: boolean,
): FacadeParams | null {
  const next: FacadeParams = {
    ...target,
    storeys: source.storeys,
    storeyHeight: source.storeyHeight,
    storeyHeights: source.storeyHeights ? [...source.storeyHeights] : source.storeyHeights,
    wallColor: source.wallColor,
    trimColor: source.trimColor,
    ornament: { ...source.ornament },
    windowStyle: source.windowStyle,
  };
  if (unified) {
    const rhythm = source.width / source.bays;
    next.bays = clamp(Math.round(target.width / rhythm), 1, 9);
    next.windowWidthRatio = source.windowWidthRatio;
    next.windowHeightRatio = source.windowHeightRatio;
    next.groundFloor = {
      treatment: source.groundFloor.treatment,
      doorBay: clamp(source.groundFloor.doorBay, 0, next.bays - 1),
      stoop: source.groundFloor.stoop,
    };
  }
  const same =
    next.storeys === target.storeys &&
    next.storeyHeight === target.storeyHeight &&
    (next.storeyHeights === target.storeyHeights ||
      (Array.isArray(next.storeyHeights) &&
        Array.isArray(target.storeyHeights) &&
        next.storeyHeights.length === target.storeyHeights.length &&
        next.storeyHeights.every((h, i) => h === target.storeyHeights![i]))) &&
    next.wallColor === target.wallColor &&
    next.trimColor === target.trimColor &&
    next.windowStyle === target.windowStyle &&
    next.ornament.cornice === target.ornament.cornice &&
    next.ornament.parapet === target.ornament.parapet &&
    next.ornament.sills === target.ornament.sills &&
    next.ornament.surrounds === target.ornament.surrounds &&
    (!unified ||
      (next.bays === target.bays &&
        next.windowWidthRatio === target.windowWidthRatio &&
        next.windowHeightRatio === target.windowHeightRatio &&
        next.groundFloor.treatment === target.groundFloor.treatment &&
        next.groundFloor.doorBay === target.groundFloor.doorBay &&
        next.groundFloor.stoop === target.groundFloor.stoop));
  return same ? null : next;
}

/** The one choke point: every block mutation funnels its result through
 * here so corner pairs always share a truthful shell. Pure and idempotent —
 * safe inside React setState updaters. */
export function syncCorners(
  blocks: FacadeBlock[],
  choices: ReadonlyMap<string, CornerChoice>,
  maxTurnDeg: number,
  editedBlockId?: string,
): FacadeBlock[] {
  const corners = detectCorners(blocks, maxTurnDeg);
  if (corners.length === 0) return blocks;
  const work = new Map<string, FacadeBlock>();
  const get = (id: string) =>
    work.get(id) ?? blocks.find((b) => b.id === id)!;
  const patchLot = (
    side: CornerSide,
    params: FacadeParams | null,
    zeroDepth: boolean,
  ) => {
    const block = get(side.blockId);
    const lot = block.lots[side.lotIndex];
    const needsDepth = zeroDepth && (lot.depthOffset ?? 0) !== 0;
    if (!params && !needsDepth) return;
    const lots = block.lots.map((l, i) =>
      i === side.lotIndex
        ? { ...l, params: params ?? l.params, ...(needsDepth ? { depthOffset: 0 } : {}) }
        : l,
    );
    work.set(side.blockId, { ...block, lots });
  };
  for (const corner of corners) {
    const choice = cornerChoice(choices, corner, blocks);
    const sourceSide =
      editedBlockId === corner.a.blockId
        ? "a"
        : editedBlockId === corner.b.blockId
          ? "b"
          : choice.primary;
    const src = corner[sourceSide];
    const dst = corner[sourceSide === "a" ? "b" : "a"];
    const srcLot = get(src.blockId).lots[src.lotIndex];
    const dstLot = get(dst.blockId).lots[dst.lotIndex];
    patchLot(
      dst,
      syncedParams(srcLot.params, dstLot.params, choice.mode === "unified"),
      true,
    );
    patchLot(src, null, true); // depthOffset zeroing on the source side too
  }
  if (work.size === 0) return blocks;
  return blocks.map((b) => work.get(b.id) ?? b);
}
