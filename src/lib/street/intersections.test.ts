import { describe, it, expect } from "vitest";
import { deriveIntersections, moveStreetNode, pruneRoundabouts } from "./intersections";
import type { StreetNetwork } from "./types";

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
