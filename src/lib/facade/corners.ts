import type { FacadeBlock } from "./blocks";
import { blockFrame } from "./blocks";
import { deriveNodes } from "./nodes";

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
