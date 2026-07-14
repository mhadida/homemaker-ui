import { describe, it, expect } from "vitest";
import {
  streetRefOf,
  streetLines,
  streetAwareFlipped,
  resolveFacing,
  STREET_WIDTH_DEFAULT,
  type StreetRef,
} from "./street";
import { blockFrame, DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";

const mkBlock = (
  id: string,
  a: [number, number],
  b: [number, number],
  widths: number[],
  flipped = false,
): FacadeBlock => ({
  id,
  line: { a, b },
  flipped,
  gen: structuredClone(DEFAULT_GEN),
  seed: 7,
  lots: widths.map((w) => ({
    params: { ...DEFAULT_FACADE, width: w },
    customized: false,
  })),
});

// Reference block along +x from origin, facade normal +z (the v1 invariant).
const REF: StreetRef = streetRefOf(mkBlock("R", [-5, 0], [5, 0], [10]));
const W = STREET_WIDTH_DEFAULT; // 14 → half 7

describe("streetRefOf", () => {
  it("normal matches blockFrame normal (unflipped +z)", () => {
    expect(REF.normal[0]).toBeCloseTo(0, 9);
    expect(REF.normal[1]).toBeCloseTo(1, 9);
  });
  it("flipped reference gives the flipped normal", () => {
    const ref = streetRefOf(mkBlock("R", [-5, 0], [5, 0], [10], true));
    const f = blockFrame(mkBlock("R", [-5, 0], [5, 0], [10], true));
    expect(ref.normal[0]).toBeCloseTo(f.normal[0], 9);
    expect(ref.normal[1]).toBeCloseTo(f.normal[1], 9);
    expect(ref.normal[1]).toBeCloseTo(-1, 9); // now faces −z
  });
});

describe("streetLines", () => {
  it("centre sits half-width, mirror full-width, along the normal", () => {
    const { centre, mirror } = streetLines(REF, W, 0); // pad 0 for exact ends
    expect(centre.a).toEqual([-5, W / 2]);
    expect(centre.b).toEqual([5, W / 2]);
    expect(mirror.a).toEqual([-5, W]);
    expect(mirror.b).toEqual([5, W]);
  });
  it("pad extends the guides past the reference ends along its direction", () => {
    const { centre } = streetLines(REF, W, 8);
    expect(centre.a[0]).toBeCloseTo(-13, 9); // -5 - 8
    expect(centre.b[0]).toBeCloseTo(13, 9); // 5 + 8
    expect(centre.a[1]).toBeCloseTo(W / 2, 9);
  });
});

describe("streetAwareFlipped", () => {
  it("no reference → false (drawn orientation)", () => {
    expect(streetAwareFlipped(null, W, [-5, 1], [5, 1])).toBe(false);
  });

  it("near-side segment drawn same direction → false (already faces centre)", () => {
    // near frontage ~z=1, drawn -x→+x: flipped=false gives normal +z (toward
    // the spine at z=7), so no flip needed.
    expect(streetAwareFlipped(REF, W, [-5, 1], [5, 1])).toBe(false);
  });

  it("near-side segment drawn reversed → true (flip to face centre)", () => {
    expect(streetAwareFlipped(REF, W, [5, 1], [-5, 1])).toBe(true);
  });

  it("far/mirror-side segment drawn same direction → true (face back to centre)", () => {
    // far frontage ~z=13 (mirror at 14): flipped=false normal +z points AWAY
    // from the spine, so it must flip to face −z back toward centre.
    expect(streetAwareFlipped(REF, W, [-5, 13], [5, 13])).toBe(true);
  });

  it("far/mirror-side segment drawn reversed → false", () => {
    expect(streetAwareFlipped(REF, W, [5, 13], [-5, 13])).toBe(false);
  });

  it("outside the corridor → false regardless of side", () => {
    // corridor is ±W (14) from the spine at z=7 → [-7, 21]. z=30 is outside.
    expect(streetAwareFlipped(REF, W, [-5, 30], [5, 30])).toBe(false);
  });

  it("exactly on the centreline → false (ambiguous)", () => {
    expect(streetAwareFlipped(REF, W, [-5, W / 2], [5, W / 2])).toBe(false);
  });

  it("orients toward centre whichever side, both facing the spine", () => {
    // A near-side and a far-side block, both drawn same direction, end up with
    // OPPOSITE flipped so their facades both point at the spine.
    const near = streetAwareFlipped(REF, W, [-5, 2], [5, 2]);
    const far = streetAwareFlipped(REF, W, [-5, 12], [5, 12]);
    expect(near).toBe(false);
    expect(far).toBe(true);
  });
});

describe("resolveFacing", () => {
  it("XORs the f-toggle over the auto orientation", () => {
    // near-side same-direction: auto=false
    expect(resolveFacing(REF, W, [-5, 1], [5, 1], false)).toBe(false);
    expect(resolveFacing(REF, W, [-5, 1], [5, 1], true)).toBe(true);
    // far-side same-direction: auto=true
    expect(resolveFacing(REF, W, [-5, 13], [5, 13], false)).toBe(true);
    expect(resolveFacing(REF, W, [-5, 13], [5, 13], true)).toBe(false);
  });
  it("no reference → f-toggle alone (first-block bootstrap)", () => {
    expect(resolveFacing(null, W, [-5, 0], [5, 0], false)).toBe(false);
    expect(resolveFacing(null, W, [-5, 0], [5, 0], true)).toBe(true);
  });
});
