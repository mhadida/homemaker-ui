import { describe, it, expect } from "vitest";
import { STREET_SPECS, effectiveWidth, nextStreetId, EMPTY_NETWORK } from "./types";

describe("STREET_SPECS", () => {
  it("has the four types with the agreed widths + car flags", () => {
    expect(STREET_SPECS.alley).toEqual({ width: 3.5, allowsCars: false, label: "Alley" });
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
