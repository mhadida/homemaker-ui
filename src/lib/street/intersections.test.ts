import { describe, it, expect } from "vitest";
import { deriveIntersections } from "./intersections";
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
