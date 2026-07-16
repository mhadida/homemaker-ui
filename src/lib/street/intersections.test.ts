import { describe, it, expect } from "vitest";
import { deriveIntersections, pruneRoundabouts } from "./intersections";
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
