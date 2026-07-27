import { describe, it, expect } from "vitest";
import {
  withSectionCount,
  withSectionOffset,
  withSectionBays,
  withSectionsSymmetry,
  applySectionPattern,
  classifySectionPattern,
} from "./sections";
import { resolveSections } from "./layout";
import { DEFAULT_FACADE, type FacadeParams } from "./types";

const p = (o: Partial<FacadeParams>): FacadeParams => ({
  ...DEFAULT_FACADE,
  ...o,
});

describe("withSectionCount", () => {
  it("splits bays evenly, extra to the left", () => {
    const next = withSectionCount(p({ bays: 5 }), 3);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 2, 1]);
    expect(next.sections!.every((s) => s.offset === 0)).toBe(true);
  });

  it("preserves offsets by index when the count changes", () => {
    const base = withSectionOffset(withSectionCount(p({ bays: 4 }), 4), 1, -0.1);
    const next = withSectionCount(base, 2);
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.1]);
  });

  it("count 1 clears sections", () => {
    const next = withSectionCount(withSectionCount(p({ bays: 3 }), 3), 1);
    expect(next.sections).toBeUndefined();
  });

  it("count clamps to the bay count", () => {
    const next = withSectionCount(p({ bays: 2 }), 7);
    expect(next.sections).toHaveLength(2);
  });
});

describe("withSectionOffset", () => {
  it("sets and clamps one section's offset", () => {
    const base = withSectionCount(p({ bays: 3 }), 3);
    const next = withSectionOffset(base, 1, 0.4);
    expect(next.sections!.map((s) => s.offset)).toEqual([0, 0.15, 0]);
  });

  it("mirrors the edit in symmetric mode (either half)", () => {
    const base = withSectionsSymmetry(withSectionCount(p({ bays: 3 }), 3), true);
    const next = withSectionOffset(base, 2, 0.1);
    expect(next.sections!.map((s) => s.offset)).toEqual([0.1, 0, 0.1]);
  });

  it("out-of-range index is a no-op", () => {
    const base = withSectionCount(p({ bays: 3 }), 3);
    expect(withSectionOffset(base, 9, 0.1)).toBe(base);
  });
});

describe("withSectionBays", () => {
  it("steals a bay from the right neighbor", () => {
    const base = withSectionCount(p({ bays: 6 }), 3); // [2,2,2]
    const next = withSectionBays(base, 0, 1);
    expect(next.sections!.map((s) => s.bays)).toEqual([3, 1, 2]);
  });

  it("shrinking returns the bay to the right neighbor", () => {
    const base = withSectionCount(p({ bays: 6 }), 3);
    const next = withSectionBays(base, 0, -1);
    expect(next.sections!.map((s) => s.bays)).toEqual([1, 3, 2]);
  });

  it("the last section borrows from the left", () => {
    const base = withSectionCount(p({ bays: 6 }), 3);
    const next = withSectionBays(base, 2, 1);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 1, 3]);
  });

  it("never shrinks any section below 1 bay", () => {
    const base = withSectionCount(p({ bays: 3 }), 3); // [1,1,1]
    expect(withSectionBays(base, 0, 1)).toBe(base);
    expect(withSectionBays(base, 0, -1)).toBe(base);
  });

  it("is a no-op in symmetric mode", () => {
    const base = withSectionsSymmetry(withSectionCount(p({ bays: 6 }), 3), true);
    expect(withSectionBays(base, 0, 1)).toBe(base);
  });
});

describe("withSectionsSymmetry", () => {
  it("turning symmetry on canonicalizes the stored array", () => {
    let base = withSectionCount(p({ bays: 5 }), 3); // [2,2,1]
    base = withSectionOffset(base, 0, 0.1);
    const next = withSectionsSymmetry(base, true);
    expect(next.sectionsSymmetrical).toBe(true);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 1, 2]);
    expect(next.sections!.map((s) => s.offset)).toEqual([0.1, 0, 0.1]);
    // stored equals resolved (WYSIWYG)
    expect(resolveSections(next).map((s) => s.bays)).toEqual([2, 1, 2]);
  });

  it("turning symmetry off keeps the mirrored state and frees edits", () => {
    const sym = withSectionsSymmetry(withSectionCount(p({ bays: 4 }), 2), true);
    const next = withSectionsSymmetry(sym, false);
    expect(next.sectionsSymmetrical).toBe(false);
    expect(next.sections!.map((s) => s.bays)).toEqual([2, 2]);
  });
});

describe("section patterns", () => {
  it("applies recessed-center (center band recessed, symmetric)", () => {
    const next = applySectionPattern(p({ bays: 6 }), 3, "recessed-center");
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.12, 0]);
    expect(next.sectionsSymmetrical).toBe(true);
  });

  it("projected-center bumps a too-small count to 3", () => {
    const next = applySectionPattern(p({ bays: 6 }), 1, "projected-center");
    expect(next.sections).toHaveLength(3);
    expect(next.sections![1].offset).toBeCloseTo(0.12, 9);
  });

  it("center patterns on a 2-bay facade fall back to flush", () => {
    const next = applySectionPattern(p({ bays: 2 }), 3, "recessed-center");
    expect(classifySectionPattern(next)).toBe("flush");
  });

  it("alternating recesses odd sections and clears symmetry", () => {
    const next = applySectionPattern(p({ bays: 8 }), 4, "alternating");
    expect(next.sections!.map((s) => s.offset)).toEqual([0, -0.12, 0, -0.12]);
    expect(next.sectionsSymmetrical).toBe(false);
  });

  it("flush zeroes offsets and keeps the partition", () => {
    let base = applySectionPattern(p({ bays: 6 }), 3, "recessed-center");
    base = applySectionPattern(base, 3, "flush");
    expect(base.sections!.map((s) => s.offset)).toEqual([0, 0, 0]);
    expect(base.sections!.map((s) => s.bays)).toEqual([2, 2, 2]);
  });

  it("classify round-trips every named pattern and reports custom otherwise", () => {
    const base = p({ bays: 6 });
    expect(classifySectionPattern(base)).toBe("flush");
    for (const pat of ["recessed-center", "projected-center", "alternating"] as const) {
      expect(classifySectionPattern(applySectionPattern(base, 4, pat))).toBe(pat);
    }
    expect(
      classifySectionPattern(withSectionOffset(withSectionCount(base, 4), 0, 0.07)),
    ).toBe("custom");
  });
});
