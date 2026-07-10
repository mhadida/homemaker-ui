import type { FacadeBlock } from "./blocks";
import { refit } from "./generate";

/** A derived node: every block endpoint whose coordinates are exactly
 * equal (bit-identical floats). The weld invariant — welded endpoints
 * always hold copied, never independently recomputed, values — makes
 * exact equality safe here. */
export interface WorldNode {
  pos: [number, number];
  refs: { blockId: string; end: "a" | "b" }[];
}

const eq = (p: [number, number], q: [number, number]) =>
  p[0] === q[0] && p[1] === q[1];

export function deriveNodes(blocks: FacadeBlock[]): WorldNode[] {
  const map = new Map<string, WorldNode>();
  for (const b of blocks) {
    for (const end of ["a", "b"] as const) {
      const p = b.line[end];
      const key = `${p[0]}:${p[1]}`;
      let node = map.get(key);
      if (!node) {
        node = { pos: [p[0], p[1]], refs: [] };
        map.set(key, node);
      }
      node.refs.push({ blockId: b.id, end });
    }
  }
  return [...map.values()];
}

/** Move every endpoint at `from` to `to` and re-fit every attached block.
 * Returns null when the move must be rejected: an attached block cannot
 * absorb it, a block would collapse to zero length, or nothing sits at
 * `from` (a stale drag frame — rejecting makes it a harmless no-op). */
export function moveNode(
  blocks: FacadeBlock[],
  from: [number, number],
  to: [number, number],
): FacadeBlock[] | null {
  if (eq(from, to)) return blocks;
  let matched = false;
  const out: FacadeBlock[] = [];
  for (const b of blocks) {
    const hitA = eq(b.line.a, from);
    const hitB = eq(b.line.b, from);
    if (!hitA && !hitB) {
      out.push(b);
      continue;
    }
    matched = true;
    if (hitA && hitB) return null; // degenerate zero-length block
    const line = {
      a: hitA ? ([to[0], to[1]] as [number, number]) : b.line.a,
      b: hitB ? ([to[0], to[1]] as [number, number]) : b.line.b,
    };
    const refitted = refit({ ...b, line }, hitA ? "a" : "b");
    if (!refitted) return null;
    out.push(refitted);
  }
  return matched ? out : null;
}
