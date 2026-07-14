import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";
import { WALL_THICKNESS } from "./layout";
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
  "roofType",
  "roofHeight",
  "roofColor",
  "dormers",
  "gableStyle",
  "gableHeight",
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

/** Concave slabs already interpenetrate (overlapping opaque solids are
 * invisible); the trim exists only to break face coplanarity, which
 * occurs near 90° turns. Capped at 0.12 m — below the layout engine's
 * minimum edge pier (MIN_PIER / 2 = 0.15 m) — so a trim can never reach
 * an opening, and small enough that it can never overshoot the partner
 * slab. */
const CONCAVE_TRIM_MAX = 0.12;

/** A corner-side END section with nonzero offset would shear the miter
 * joint open (miters assume flush slabs), so sync flattens it — the exact
 * depthOffset precedent: destructive, not restored on dissolve, never marks
 * `customized`. Sections stay per-frontage otherwise (FACE, not shell).
 * For symmetric lots the stored FIRST section is zeroed — resolveSections
 * mirrors stored[0] onto the far end, so both ends sit flush and the
 * symmetric composition survives. Identity return when already flush. */
function flattenEndSection(
  params: FacadeParams,
  lotSide: "left" | "right",
): FacadeParams {
  const secs = params.sections;
  if (!secs || secs.length === 0) return params;
  // resolveSections renders at most `bays` sections; the rendered end is
  // the last SURVIVING stored entry, not the last stored one.
  const count = Math.min(secs.length, params.bays);
  const idx = lotSide === "left" || params.sectionsSymmetrical ? 0 : count - 1;
  if (!secs[idx] || secs[idx].offset === 0) return params;
  return {
    ...params,
    sections: secs.map((s, i) => (i === idx ? { ...s, offset: 0 } : s)),
  };
}

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
    // Roof style + height + covering + dormer count are shell (both wings
    // match); roofOrientation is per-wing (each faces its own street) — not
    // copied.
    roofType: source.roofType,
    roofHeight: source.roofHeight,
    roofColor: source.roofColor,
    dormers: source.dormers,
    gableStyle: source.gableStyle,
    gableHeight: source.gableHeight,
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
    next.roofType === target.roofType &&
    next.roofHeight === target.roofHeight &&
    next.roofColor === target.roofColor &&
    next.dormers === target.dormers &&
    next.gableStyle === target.gableStyle &&
    next.gableHeight === target.gableHeight &&
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
 * safe inside React setState updaters.
 *
 * Corners form a graph over blocks — a single-lot block can bridge two
 * corners (e.g. a chamfer block in a D–C–E chain) — so syncing pairwise,
 * independently per corner, clobbers shared lots and breaks idempotence
 * (whichever corner is processed last wins, and re-sourcing from a
 * neighbour that hasn't seen the edit yet undoes it). Instead the shell
 * PROPAGATES: breadth-first from a root through each connected component
 * of blocks-with-corners, syncing every corner exactly once in the
 * direction the BFS discovered it. One user edit therefore restyles an
 * entire connected chain, and a second call is a no-op (identity return). */
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
    const merged = flattenEndSection(params ?? lot.params, side.lotSide);
    const paramsChanged = merged !== lot.params;
    const needsDepth = zeroDepth && (lot.depthOffset ?? 0) !== 0;
    if (!paramsChanged && !needsDepth) return;
    const lots = block.lots.map((l, i) =>
      i === side.lotIndex
        ? { ...l, params: merged, ...(needsDepth ? { depthOffset: 0 } : {}) }
        : l,
    );
    work.set(side.blockId, { ...block, lots });
  };
  const syncEdge = (corner: Corner, srcSide: "a" | "b", dstSide: "a" | "b") => {
    const choice = cornerChoice(choices, corner, blocks);
    const src = corner[srcSide];
    const dst = corner[dstSide];
    // Read the CURRENT (possibly already-patched) state so propagation
    // carries forward through lots that a prior step in this same call
    // already synced — that's what lets the shell cross a chain.
    const srcLot = get(src.blockId).lots[src.lotIndex];
    const dstLot = get(dst.blockId).lots[dst.lotIndex];
    patchLot(
      dst,
      syncedParams(srcLot.params, dstLot.params, choice.mode === "unified"),
      true,
    );
    patchLot(src, null, true); // depthOffset zeroing on the source side too
  };

  // Adjacency over blocks that participate in at least one corner.
  const adjacency = new Map<string, Corner[]>();
  for (const corner of corners) {
    for (const blockId of [corner.a.blockId, corner.b.blockId]) {
      const list = adjacency.get(blockId);
      if (list) list.push(corner);
      else adjacency.set(blockId, [corner]);
    }
  }

  const processed = new Set<string>(); // corner.key, each synced exactly once
  const globallyVisited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (globallyVisited.has(start)) continue;

    // Connected component: every block reachable from `start` via corners.
    const compNodes = new Set<string>([start]);
    const compCorners = new Set<Corner>();
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const corner of adjacency.get(x)!) {
        compCorners.add(corner);
        const other =
          corner.a.blockId === x ? corner.b.blockId : corner.a.blockId;
        if (!compNodes.has(other)) {
          compNodes.add(other);
          stack.push(other);
        }
      }
    }
    for (const id of compNodes) globallyVisited.add(id);

    // Root: the edited block when it's in this component; otherwise the
    // primary side of the component's first corner in sorted key order.
    let root: string;
    if (editedBlockId && compNodes.has(editedBlockId)) {
      root = editedBlockId;
    } else {
      const first = [...compCorners].sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      )[0];
      root = first[cornerChoice(choices, first, blocks).primary].blockId;
    }

    // BFS from root: each tree edge syncs visited (X) -> unvisited (Y).
    const order = new Map<string, number>([[root, 0]]);
    const queue = [root];
    for (let qi = 0; qi < queue.length; qi++) {
      const x = queue[qi];
      for (const corner of adjacency.get(x)!) {
        if (processed.has(corner.key)) continue;
        const xSide: "a" | "b" = corner.a.blockId === x ? "a" : "b";
        const otherSide: "a" | "b" = xSide === "a" ? "b" : "a";
        const other = corner[otherSide].blockId;
        if (order.has(other)) continue; // cycle edge — handled below
        syncEdge(corner, xSide, otherSide);
        processed.add(corner.key);
        order.set(other, order.size);
        queue.push(other);
      }
    }

    // Cycle edges: corners whose both blocks were already visited by the
    // time BFS reached them (e.g. a triangular loop of blocks), so they
    // were never a tree edge above. Still sync each exactly once, from
    // whichever side entered BFS earlier — deterministic, but a cycle has
    // no unique root so the resulting seam is arbitrary.
    for (const corner of compCorners) {
      if (processed.has(corner.key)) continue;
      const srcSide: "a" | "b" =
        order.get(corner.a.blockId)! <= order.get(corner.b.blockId)!
          ? "a"
          : "b";
      syncEdge(corner, srcSide, srcSide === "a" ? "b" : "a");
      processed.add(corner.key);
    }
  }

  if (work.size === 0) return blocks;
  return blocks.map((b) => work.get(b.id) ?? b);
}

/** Per-lot wall extension at each end, metres. */
export interface LotMiter {
  left: number;
  right: number;
}

/** How far each side's wall extends (+) or trims (−) at the corner so the
 * two slabs meet without a wedge gap (convex) or z-fighting overlap
 * (concave). Only side a is corrected: one slab fills the corner while the
 * other butts against it — extending both would create exactly coincident
 * faces. Openings never enter the correction (layout engine untouched). */
export function miterFor(corner: Corner): { a: number; b: number } {
  const turnRad = (corner.turn * Math.PI) / 180;
  const base = Math.min(
    Math.tan(turnRad / 2) * WALL_THICKNESS,
    3 * WALL_THICKNESS,
  );
  if (base < 1e-9) return { a: 0, b: 0 };
  return {
    a: corner.convex
      ? base
      : -Math.min((Math.tan(turnRad / 2) * WALL_THICKNESS) / 2, CONCAVE_TRIM_MAX),
    b: 0,
  };
}
