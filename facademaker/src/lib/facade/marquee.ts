import {
  lotPlacements,
  type FacadeBlock,
  type LotState,
} from "./blocks";
import { deriveNodes, moveNode } from "./nodes";
import { deleteLot } from "./generate";
import type { Street } from "../street/types";

/** Axis-aligned plan-coord rectangle, min/max normalized. */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A unified, mixed marquee selection. Blocks are whole (delete/move/restyle
 * hit all their lots); lots and nodes belong to PARTIALLY-enclosed blocks (a
 * fully-enclosed block subsumes its own lots and nodes). */
export interface Marquee {
  /** Fully-enclosed block ids (both line endpoints inside the rect). */
  blocks: string[];
  /** `${blockId}:${index}` for each selected lot of a partial block. */
  lots: string[];
  /** Enclosed node positions (partial-block welds / endpoints). */
  nodes: [number, number][];
  /** Selected road-network street ids. Optional (absent = none) so every
   * pre-street marquee literal stays valid and byte-identical. */
  streets?: string[];
}

export function normalizeRect(
  a: [number, number],
  b: [number, number],
): Rect {
  return {
    x0: Math.min(a[0], b[0]),
    x1: Math.max(a[0], b[0]),
    z0: Math.min(a[1], b[1]),
    z1: Math.max(a[1], b[1]),
  };
}

const inside = (rect: Rect, x: number, z: number) =>
  x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;

export function marqueeEmpty(m: Marquee): boolean {
  return (
    m.blocks.length === 0 &&
    m.lots.length === 0 &&
    m.nodes.length === 0 &&
    (m.streets?.length ?? 0) === 0
  );
}

/** The enclosure rule (see the marquee design spec):
 *  - block  → both endpoints inside the rect (fully enclosed, whole-block op);
 *  - lot    → its center inside AND its block NOT fully enclosed;
 *  - node   → its position inside AND it is not an endpoint of a fully-
 *             enclosed block (a fully-enclosed block subsumes its welds).
 * A box over a whole street yields whole-block ops; a box over part of it
 * yields per-lot / per-node ops — no mode toggle. */
export function hitTest(
  blocks: FacadeBlock[],
  rect: Rect,
  streets: Street[] = [],
): Marquee {
  const enclosed = new Set<string>();
  for (const b of blocks) {
    if (
      inside(rect, b.line.a[0], b.line.a[1]) &&
      inside(rect, b.line.b[0], b.line.b[1])
    ) {
      enclosed.add(b.id);
    }
  }

  const lots: string[] = [];
  for (const b of blocks) {
    if (enclosed.has(b.id)) continue; // subsumed by the whole block
    const placements = lotPlacements(b);
    placements.forEach((p, i) => {
      if (inside(rect, p.position[0], p.position[2])) lots.push(`${b.id}:${i}`);
    });
  }

  const nodes: [number, number][] = [];
  for (const node of deriveNodes(blocks)) {
    if (!inside(rect, node.pos[0], node.pos[1])) continue;
    if (node.refs.some((r) => enclosed.has(r.blockId))) continue; // subsumed
    nodes.push([node.pos[0], node.pos[1]]);
  }

  // A street is selected when EVERY vertex is enclosed (whole-street op,
  // consistent with the block "both endpoints inside" rule).
  const selStreets: string[] = [];
  for (const s of streets) {
    if (
      s.points.length > 0 &&
      s.points.every((p) => inside(rect, p[0], p[1]))
    ) {
      selStreets.push(s.id);
    }
  }

  return { blocks: [...enclosed], lots, nodes, streets: selStreets };
}

/** Split a `${blockId}:${index}` lot key. Block ids contain no ':'. */
function parseLotKey(key: string): { blockId: string; index: number } {
  const sep = key.lastIndexOf(":");
  return { blockId: key.slice(0, sep), index: Number(key.slice(sep + 1)) };
}

/** Every block the selection affects: enclosed blocks ∪ blocks of selected
 * lots ∪ blocks touching a selected node. Used for reroll + move ripple. */
export function affectedBlockIds(
  m: Marquee,
  blocks: FacadeBlock[],
): Set<string> {
  const ids = new Set<string>(m.blocks);
  for (const key of m.lots) ids.add(parseLotKey(key).blockId);
  if (m.nodes.length > 0) {
    const nodeKeys = new Set(m.nodes.map(([x, z]) => `${x}:${z}`));
    for (const b of blocks) {
      for (const p of [b.line.a, b.line.b]) {
        if (nodeKeys.has(`${p[0]}:${p[1]}`)) ids.add(b.id);
      }
    }
  }
  return ids;
}

// Track which lots to delete across deleteLot's internal refit — which can
// split one lot into two and thereby re-index the array — by tagging the
// selected LotStates with a marker symbol. Object spread (refit copies the
// absorber via `{ ...lot }`) and array reference-preservation carry the marker
// onto the surviving/absorbing lot objects, while freshly split lots never
// carry it. Re-finding marked lots each pass is therefore reindex-safe, unlike
// a precomputed index list. deleteLot preserves street length (it only grows /
// splits, never shrinks a lot below min), so it removes exactly the tagged lot.
const MARK = Symbol("marqueeDelete");
type MarkedLot = LotState & { [MARK]?: true };

function stripMark(l: LotState): LotState {
  if (!(l as MarkedLot)[MARK]) return l;
  const copy = { ...(l as MarkedLot) };
  delete copy[MARK];
  return copy;
}

/** Remove fully-enclosed blocks; deleteLot each partial-block lot (highest
 * index first, re-found each pass so a split can't strand a stale index). A
 * block whose every lot is selected is dropped whole. Nodes are NOT deleted
 * (weld-merge deferred). Returns the new blocks array — the caller syncCorners.
 * Pure. */
export function deleteMarquee(blocks: FacadeBlock[], m: Marquee): FacadeBlock[] {
  const enclosed = new Set(m.blocks);
  const selByBlock = new Map<string, Set<number>>();
  for (const key of m.lots) {
    const { blockId, index } = parseLotKey(key);
    let s = selByBlock.get(blockId);
    if (!s) {
      s = new Set();
      selByBlock.set(blockId, s);
    }
    s.add(index);
  }

  const out: FacadeBlock[] = [];
  for (const b of blocks) {
    if (enclosed.has(b.id)) continue; // whole block removed
    const sel = selByBlock.get(b.id);
    if (!sel || sel.size === 0) {
      out.push(b);
      continue;
    }
    if (sel.size >= b.lots.length) continue; // every lot selected → drop block
    let cur: FacadeBlock = {
      ...b,
      lots: b.lots.map((l, i) =>
        sel.has(i) ? ({ ...l, [MARK]: true } as MarkedLot) : l,
      ),
    };
    for (;;) {
      let idx = -1;
      for (let i = cur.lots.length - 1; i >= 0; i--) {
        if ((cur.lots[i] as MarkedLot)[MARK]) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break; // no tagged lots remain
      const next = deleteLot(cur, idx);
      if (!next) {
        // Nothing can absorb (every other lot pinned) — leave this lot in
        // place, untag it so the loop moves on.
        cur = {
          ...cur,
          lots: cur.lots.map((l, i) => (i === idx ? stripMark(l) : l)),
        };
        continue;
      }
      cur = next;
    }
    out.push(cur);
  }
  return out;
}

/** Remove the marquee's selected road-network streets. Pure; the caller
 * prunes roundabouts whose junctions the removed streets defined. A no-op when
 * no street is selected (returns the same array reference untouched). */
export function deleteMarqueeStreets(streets: Street[], m: Marquee): Street[] {
  if (!m.streets || m.streets.length === 0) return streets;
  const sel = new Set(m.streets);
  return streets.filter((s) => !sel.has(s.id));
}

/** Move: translate every fully-enclosed block rigidly by (dx,dz) — both
 * endpoints shift, so no refit and lot widths are unchanged. Additionally
 * shift each selected loose node's endpoint(s) on its blocks and refit those
 * blocks (via moveNode). Enclosed blocks and node-attached blocks are disjoint
 * (the enclosure rule subsumes an enclosed block's own nodes), so the two
 * steps never conflict. Pure. */
export function translateMarquee(
  blocks: FacadeBlock[],
  m: Marquee,
  dx: number,
  dz: number,
): FacadeBlock[] {
  if (dx === 0 && dz === 0) return blocks;
  const enclosed = new Set(m.blocks);
  let out: FacadeBlock[] = blocks.map((b) =>
    enclosed.has(b.id)
      ? {
          ...b,
          line: {
            a: [b.line.a[0] + dx, b.line.a[1] + dz] as [number, number],
            b: [b.line.b[0] + dx, b.line.b[1] + dz] as [number, number],
          },
        }
      : b,
  );
  // Node positions name ORIGINAL coordinates; the node-attached blocks were
  // not shifted above, so their endpoints still sit at those coordinates.
  for (const [nx, nz] of m.nodes) {
    const moved = moveNode(out, [nx, nz], [nx + dx, nz + dz]);
    if (moved) out = moved;
  }
  return out;
}
