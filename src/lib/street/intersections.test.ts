import { describe, it, expect } from "vitest";
import { deriveIntersections, moveStreetNode, pruneRoundabouts } from "./intersections";
import type { Intersection } from "./intersections";
import type { StreetNetwork, Street, Vec2 } from "./types";

const net = (streets: StreetNetwork["streets"]): StreetNetwork => ({ streets, roundabouts: [] });

describe("deriveIntersections", () => {
  it("two streets sharing an endpoint → one intersection, both incident", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[10, 0], [10, 10]] },
    ]));
    expect(is).toHaveLength(1);
    expect(is[0].pos).toEqual([10, 0]);
    expect(is[0].incident.map((i) => i.streetId).sort()).toEqual(["a", "b"]);
  });

  it("disjoint streets → no intersection", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[0, 20], [10, 20]] },
    ]));
    expect(is).toHaveLength(0);
  });

  it("a three-street junction at one point → one intersection, three incident", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [5, 5]] },
      { id: "b", type: "street", points: [[10, 0], [5, 5]] },
      { id: "c", type: "street", points: [[5, 5], [5, 15]] },
    ]));
    expect(is).toHaveLength(1);
    expect(is[0].incident).toHaveLength(3);
  });

  it("a single street touching itself is not an intersection (needs 2+ streets)", () => {
    const is = deriveIntersections(net([
      { id: "a", type: "street", points: [[0, 0], [10, 0], [0, 0]] },
    ]));
    expect(is).toHaveLength(0);
  });
});

describe("pruneRoundabouts", () => {
  it("drops a roundabout whose intersection no longer exists after a street is removed", () => {
    const before: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ],
      roundabouts: [["10:0", { kind: "fountain" }]],
    };
    // Confirm the fixture's key actually matches the derived intersection key.
    expect(deriveIntersections(before).map((i) => i.key)).toEqual(["10:0"]);

    const after: StreetNetwork = { ...before, streets: [before.streets[0]] };
    const pruned = pruneRoundabouts(after);
    expect(pruned.roundabouts).toEqual([]);
  });

  it("keeps a roundabout whose intersection is still derived", () => {
    const net: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
        { id: "c", type: "street", points: [[10, 10], [20, 10]] },
        { id: "d", type: "street", points: [[10, 10], [10, 20]] },
      ],
      roundabouts: [
        ["10:0", { kind: "fountain" }],
        ["10:10", { kind: "obelisk" }],
      ],
    };
    const pruned = pruneRoundabouts(net);
    expect(pruned.roundabouts).toEqual([
      ["10:0", { kind: "fountain" }],
      ["10:10", { kind: "obelisk" }],
    ]);
  });

  it("empty roundabouts list stays empty (no-op)", () => {
    const net: StreetNetwork = {
      streets: [{ id: "a", type: "street", points: [[0, 0], [10, 0]] }],
      roundabouts: [],
    };
    expect(pruneRoundabouts(net).roundabouts).toEqual([]);
  });
});

describe("deriveIntersections — T and X", () => {
  it("still derives a shared-endpoint junction as kind 'node'", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].pos).toEqual([10, 0]);
    expect(out[0].kind).toBe("node");
  });

  it("derives a T where one street's endpoint lands on another's segment", () => {
    const out = deriveIntersections(
      net([
        { id: "main", type: "street", points: [[0, 0], [20, 0]] },
        { id: "branch", type: "street", points: [[10, 0], [10, 10]] }, // ends ON main mid-span
      ]),
    );
    const t = out.find((i) => i.kind === "t");
    expect(t).toBeTruthy();
    expect(t!.pos).toEqual([10, 0]);
  });

  it("derives an X where two segments cross mid-span", () => {
    const out = deriveIntersections(
      net([
        { id: "h", type: "street", points: [[0, 0], [20, 0]] },
        { id: "v", type: "street", points: [[10, -10], [10, 10]] },
      ]),
    );
    const x = out.find((i) => i.kind === "x");
    expect(x).toBeTruthy();
    expect(x!.pos[0]).toBeCloseTo(10, 6);
    expect(x!.pos[1]).toBeCloseTo(0, 6);
  });

  it("does NOT derive an X for endpoint-touch (that's a node/T, not a cross)", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [20, 0]] },
      ]),
    );
    expect(out.some((i) => i.kind === "x")).toBe(false);
  });

  it("ignores a vertex lying on its OWN street's segment", () => {
    const out = deriveIntersections(
      net([{ id: "a", type: "street", points: [[0, 0], [10, 0], [20, 0]] }]),
    );
    expect(out).toHaveLength(0);
  });

  it("does not double-count a shared vertex as a T", () => {
    const out = deriveIntersections(
      net([
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ]),
    );
    expect(out.filter((i) => i.pos[0] === 10 && i.pos[1] === 0)).toHaveLength(1);
  });
});

describe("deriveIntersections — no duplicate junction at a shared point", () => {
  it("a T vertex and an X crossing at the SAME sub-grid point yield one junction, not two", () => {
    // branch ends on main at x=10.00005 (a T, keyed exactly); cross also passes
    // through that exact point (an X, keyed ROUNDED). The rounded X key differs
    // from the exact T key, so without position-dedup two markers would appear.
    const out = deriveIntersections({
      streets: [
        { id: "main", type: "street", points: [[0, 0], [20, 0]] },
        { id: "branch", type: "street", points: [[10.00005, 0], [10.00005, 8]] },
        { id: "cross", type: "street", points: [[8, -2], [12.0001, 2]] },
      ],
      roundabouts: [],
    });
    const here = out.filter(
      (i) => Math.abs(i.pos[0] - 10.00005) < 1e-3 && Math.abs(i.pos[1]) < 1e-3,
    );
    expect(here).toHaveLength(1);
  });
});

describe("moveStreetNode", () => {
  it("moves every welded copy of a shared endpoint as one", () => {
    const before = net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      { id: "b", type: "street", points: [[10, 0], [10, 10]] },
    ]);
    const out = moveStreetNode(before, [10, 0], [12, 2]);
    expect(out).not.toBeNull();
    expect(out!.streets[0].points[1]).toEqual([12, 2]);
    expect(out!.streets[1].points[0]).toEqual([12, 2]);
    // still one junction, at the new spot
    const is = deriveIntersections(out!);
    expect(is).toHaveLength(1);
    expect(is[0].pos).toEqual([12, 2]);
  });

  it("returns null when nothing sits at `from`", () => {
    const before = net([{ id: "a", type: "street", points: [[0, 0], [10, 0]] }]);
    expect(moveStreetNode(before, [5, 5], [6, 6])).toBeNull();
  });

  it("rejects a move that would degenerate a segment (< 1 m)", () => {
    const before = net([{ id: "a", type: "street", points: [[0, 0], [10, 0]] }]);
    expect(moveStreetNode(before, [10, 0], [0.5, 0])).toBeNull();
  });

  it("leaves untouched streets by reference (no spurious rebuilds)", () => {
    const other = { id: "c", type: "street" as const, points: [[50, 50], [60, 50]] as [number, number][] };
    const before = net([
      { id: "a", type: "street", points: [[0, 0], [10, 0]] },
      other,
    ]);
    const out = moveStreetNode(before, [10, 0], [12, 0]);
    expect(out!.streets[1]).toBe(other);
  });

  it("a roundabout keyed at the junction follows the move", () => {
    const before: StreetNetwork = {
      streets: [
        { id: "a", type: "street", points: [[0, 0], [10, 0]] },
        { id: "b", type: "street", points: [[10, 0], [10, 10]] },
      ],
      roundabouts: [["10:0", { kind: "obelisk" }]],
    };
    const out = moveStreetNode(before, [10, 0], [12, 2]);
    expect(out!.roundabouts).toEqual([["12:2", { kind: "obelisk" }]]);
  });

  it("a roundabout is pruned when the move breaks its junction", () => {
    // A T-junction: the branch tip sits ON the through street. Moving the
    // tip away un-derives the junction, so the roundabout entry (remapped to
    // the new position) no longer matches a derived key and is pruned.
    const before: StreetNetwork = {
      streets: [
        { id: "main", type: "street", points: [[0, 0], [20, 0]] },
        { id: "branch", type: "street", points: [[10, 0], [10, 8]] },
      ],
      roundabouts: [["10:0", { kind: "fountain" }]],
    };
    const out = moveStreetNode(before, [10, 0], [30, 5]);
    expect(out!.roundabouts).toEqual([]);
  });

  it("closed loops treat the wrap-around segment in the degeneracy check", () => {
    const before = net([
      { id: "ring", type: "street", points: [[0, 0], [20, 0], [20, 20], [0, 20]], closed: true },
    ]);
    // moving the last vertex onto the first would collapse the closing segment
    expect(moveStreetNode(before, [0, 20], [0, 0.5])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression guard for the spatial-grid refactor: a verbatim, independent
// brute-force O(vertices×segments + segments²) reference — the exact
// algorithm `deriveIntersections` used before it was bucketed through a grid
// — compared against the (now bucketed) real implementation on a moderately
// large synthetic network. If a future change to the grid ever silently
// drops or duplicates a candidate, this is what catches it.
function bruteForceDeriveIntersections(net: StreetNetwork): Intersection[] {
  const WELD = 1e-6;
  const ON_SEG = 1e-4;
  const keyOf = (p: Vec2) => `${p[0]}:${p[1]}`;
  const roundKey = (p: Vec2) =>
    `${Math.round(p[0] / ON_SEG) * ON_SEG}:${Math.round(p[1] / ON_SEG) * ON_SEG}`;
  const byKey = new Map<string, Intersection>();
  const add = (
    key: string,
    pos: Vec2,
    kind: Intersection["kind"],
    inc: { streetId: string; vertex: number },
  ) => {
    let e = byKey.get(key);
    if (!e) {
      e = { key, pos, kind, incident: [] };
      byKey.set(key, e);
    }
    if (!e.incident.some((i) => i.streetId === inc.streetId && i.vertex === inc.vertex)) {
      e.incident.push(inc);
    }
    return e;
  };
  const nearExisting = (p: Vec2) =>
    [...byKey.values()].some(
      (e) => Math.abs(e.pos[0] - p[0]) < ON_SEG && Math.abs(e.pos[1] - p[1]) < ON_SEG,
    );

  const closestPointOnSegment = (p: Vec2, a: Vec2, b: Vec2) => {
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const denom = abx * abx + abz * abz;
    let t = denom === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / denom;
    t = Math.max(0, Math.min(1, t));
    const point: Vec2 = [a[0] + abx * t, a[1] + abz * t];
    return { point, t, dist: Math.hypot(p[0] - point[0], p[1] - point[1]) };
  };

  const segCross = (p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null => {
    const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2z = p4[1] - p3[1];
    const denom = d1x * d2z - d1z * d2x;
    if (Math.abs(denom) < WELD) return null;
    const s = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / denom;
    const t = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / denom;
    const e = ON_SEG;
    if (s > e && s < 1 - e && t > e && t < 1 - e) return [p1[0] + s * d1x, p1[1] + s * d1z];
    return null;
  };

  // Pass 1 — shared vertices.
  const vByKey = new Map<string, { pos: Vec2; inc: { streetId: string; vertex: number }[] }>();
  for (const s of net.streets) {
    s.points.forEach((p, vertex) => {
      const k = keyOf(p);
      let v = vByKey.get(k);
      if (!v) { v = { pos: [p[0], p[1]], inc: [] }; vByKey.set(k, v); }
      v.inc.push({ streetId: s.id, vertex });
    });
  }
  for (const [k, v] of vByKey) {
    if (new Set(v.inc.map((i) => i.streetId)).size >= 2) {
      for (const i of v.inc) add(k, v.pos, "node", i);
    }
  }

  // Pass 2 — T junctions, brute O(vertices × segments).
  for (const a of net.streets) {
    a.points.forEach((v, vertex) => {
      if (byKey.has(keyOf(v))) return;
      for (const b of net.streets) {
        if (b.id === a.id) continue;
        for (let j = 0; j < b.points.length - 1; j++) {
          const b0 = b.points[j], b1 = b.points[j + 1];
          if (
            (Math.abs(v[0] - b0[0]) < WELD && Math.abs(v[1] - b0[1]) < WELD) ||
            (Math.abs(v[0] - b1[0]) < WELD && Math.abs(v[1] - b1[1]) < WELD)
          ) continue;
          const c = closestPointOnSegment(v, b0, b1);
          if (c.dist < ON_SEG && c.t > ON_SEG && c.t < 1 - ON_SEG) {
            add(keyOf(v), [v[0], v[1]], "t", { streetId: a.id, vertex });
            add(keyOf(v), [v[0], v[1]], "t", { streetId: b.id, vertex: j });
          }
        }
      }
    });
  }

  // Pass 3 — X junctions, brute O(segments²).
  const streets = net.streets;
  for (let ai = 0; ai < streets.length; ai++) {
    for (let bi = ai + 1; bi < streets.length; bi++) {
      const a = streets[ai], b = streets[bi];
      for (let i = 0; i < a.points.length - 1; i++) {
        for (let j = 0; j < b.points.length - 1; j++) {
          const p = segCross(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1]);
          if (!p) continue;
          const k = roundKey(p);
          if (byKey.has(k) || nearExisting(p)) continue;
          add(k, p, "x", { streetId: a.id, vertex: i });
          add(k, p, "x", { streetId: b.id, vertex: j });
        }
      }
    }
  }
  return [...byKey.values()];
}

/** Normalizes an intersections list so array-order differences (junction
 * order, incident order) that neither implementation guarantees don't fail
 * an otherwise-correct comparison. */
function normalizeIntersections(list: Intersection[]) {
  return list
    .map((it) => ({
      kind: it.kind,
      pos: [Math.round(it.pos[0] * 1e6) / 1e6, Math.round(it.pos[1] * 1e6) / 1e6],
      incident: [...it.incident]
        .sort((a, b) => a.streetId.localeCompare(b.streetId) || a.vertex - b.vertex),
    }))
    .sort(
      (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.kind.localeCompare(b.kind),
    );
}

/** A 15×15 grid of horizontal/vertical streets (shared-endpoint corner
 * "node"s, dozens of interior-interior "x" grid crossings), three long
 * diagonals cutting across at non-grid-aligned angles (more "x"s, at
 * positions that stress the roundKey/grid-cell-boundary logic), and several
 * short stub streets ending mid-span of a grid line (isolated "t"s). Fully
 * deterministic (no Math.random) — same network every run. */
function syntheticStreetGridNetwork(): StreetNetwork {
  const streets: Street[] = [];
  const N = 15;
  const spacing = 10;
  const span = (N - 1) * spacing;
  for (let r = 0; r < N; r++) {
    streets.push({ id: `h${r}`, type: "street", points: [[0, r * spacing], [span, r * spacing]] });
  }
  for (let c = 0; c < N; c++) {
    streets.push({ id: `v${c}`, type: "street", points: [[c * spacing, 0], [c * spacing, span]] });
  }
  streets.push({ id: "diag1", type: "road", points: [[-5, -5], [span + 5, span + 5]] });
  streets.push({ id: "diag2", type: "road", points: [[span + 5, -5], [-5, span + 5]] });
  streets.push({ id: "diag3", type: "boulevard", points: [[10, -10], [span - 20, span + 10]] });
  // Stubs ending mid-span of a horizontal line at a non-grid-aligned x — pure
  // T junctions, no coincidence with a vertical column.
  const stubs: [number, number][] = [[15, 30], [55, 70], [95, 20], [25, 110]];
  stubs.forEach(([x, z], i) => {
    streets.push({ id: `stub${i}`, type: "alley", points: [[x, z - 10], [x, z]] });
  });
  return { streets, roundabouts: [] };
}

describe("deriveIntersections — matches a brute-force reference (grid regression guard)", () => {
  it("a 15x15 grid + diagonals + stub T's derives identically to the pre-grid brute force", () => {
    const network = syntheticStreetGridNetwork();
    const fast = normalizeIntersections(deriveIntersections(network));
    const reference = normalizeIntersections(bruteForceDeriveIntersections(network));
    expect(fast).toEqual(reference);
    // Sanity: the synthetic network actually exercises all three kinds.
    expect(reference.some((i) => i.kind === "node")).toBe(true);
    expect(reference.some((i) => i.kind === "t")).toBe(true);
    expect(reference.some((i) => i.kind === "x")).toBe(true);
  });
});
