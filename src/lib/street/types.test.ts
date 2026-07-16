import { describe, it, expect } from "vitest";
import { STREET_SPECS, effectiveWidth, nextStreetId, EMPTY_NETWORK, minRadiusOf, type Street } from "./types";

describe("STREET_SPECS", () => {
  it("has the four types with the agreed widths + car flags", () => {
    expect(STREET_SPECS.alley).toEqual({ width: 3.5, allowsCars: false, label: "Alley", minRadius: 6 });
    expect(STREET_SPECS.street.width).toBe(9);
    expect(STREET_SPECS.road.width).toBe(14);
    expect(STREET_SPECS.boulevard.width).toBe(24);
    expect(STREET_SPECS.street.allowsCars).toBe(true);
  });
});
describe("effectiveWidth", () => {
  it("uses the type default, overridden by the per-street width", () => {
    expect(effectiveWidth({ id: "s1", type: "street", points: [] })).toBe(9);
    expect(effectiveWidth({ id: "s1", type: "street", points: [], width: 12 })).toBe(12);
  });
});
describe("ids + empty network", () => {
  it("nextStreetId is unique and EMPTY_NETWORK is empty", () => {
    expect(nextStreetId()).not.toBe(nextStreetId());
    expect(EMPTY_NETWORK.streets).toEqual([]);
    expect(EMPTY_NETWORK.roundabouts).toEqual([]);
  });
});
describe("minRadius", () => {
  it("every type has a positive minRadius, ordered alley < street < road < boulevard", () => {
    const { alley, street, road, boulevard } = STREET_SPECS;
    for (const s of [alley, street, road, boulevard]) expect(s.minRadius).toBeGreaterThan(0);
    expect(alley.minRadius).toBeLessThan(street.minRadius);
    expect(street.minRadius).toBeLessThan(road.minRadius);
    expect(road.minRadius).toBeLessThan(boulevard.minRadius);
    expect(STREET_SPECS.alley.minRadius).toBe(6);
    expect(STREET_SPECS.street.minRadius).toBe(20);
    expect(STREET_SPECS.road.minRadius).toBe(45);
    expect(STREET_SPECS.boulevard.minRadius).toBe(120);
  });
  it("minRadiusOf returns the type default", () => {
    const s: Street = { id: "street-1", type: "road", points: [[0, 0], [10, 0]] };
    expect(minRadiusOf(s)).toBe(STREET_SPECS.road.minRadius);
  });
});
