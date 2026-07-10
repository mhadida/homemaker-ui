import { describe, it, expect } from "vitest";
import {
  mulberry32,
  subdivide,
  generateLot,
  generateBlock,
  rerollBlock,
} from "./generate";
import { DEFAULT_GEN, initialWorld, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE, FACADE_LIMITS, FACADE_PRESETS } from "./types";
import { computeLayout } from "./layout";

describe("mulberry32", () => {
  it("is deterministic and bounded to [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(seqA).size).toBeGreaterThan(15); // actually random-ish
  });
});

describe("subdivide", () => {
  it("widths sum to the length, all-but-last within [min,max]", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = mulberry32(seed);
      const widths = subdivide(42.5, 5, 9, rand);
      const sum = widths.reduce((s, w) => s + w, 0);
      expect(sum).toBeCloseTo(42.5, 9);
      for (const w of widths.slice(0, -1)) {
        expect(w).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(w).toBeLessThanOrEqual(9 + 1e-9);
      }
      const last = widths[widths.length - 1];
      expect(last).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(last).toBeLessThan(10); // ≤ max, or in the (max, 2·min) corner
    }
  });

  it("a segment shorter than min becomes a single lot", () => {
    expect(subdivide(3, 5, 9, mulberry32(1))).toEqual([3]);
  });
});

describe("generateLot", () => {
  it("produces valid params across many seeds (layout invariants hold)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = generateLot(6.5, DEFAULT_GEN, mulberry32(seed));
      expect(p.width).toBe(6.5);
      expect(p.storeys).toBeGreaterThanOrEqual(DEFAULT_GEN.storeys.min);
      expect(p.storeys).toBeLessThanOrEqual(DEFAULT_GEN.storeys.max);
      expect(p.bays).toBeGreaterThanOrEqual(FACADE_LIMITS.bays.min);
      expect(p.groundFloor.doorBay).toBeLessThan(p.bays);
      expect(p.storeyHeights).toHaveLength(p.storeys);
      expect(p.preset).toBeUndefined();
      // the generated lot must render valid geometry
      const layout = computeLayout(p);
      for (const o of layout.openings) {
        expect(o.x).toBeGreaterThanOrEqual(-layout.width / 2 - 1e-9);
        expect(o.x + o.w).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
        expect(o.y + o.h).toBeLessThanOrEqual(layout.wallTop + 1e-9);
      }
    }
  });

  it("shopfrontShare extremes: 0 → never retail, 1 → always retail", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const none = generateLot(7, { ...DEFAULT_GEN, shopfrontShare: 0 }, mulberry32(seed));
      expect(none.groundFloor.treatment).not.toBe("shopfront");
      const all = generateLot(7, { ...DEFAULT_GEN, shopfrontShare: 1 }, mulberry32(seed));
      expect(all.groundFloor.treatment).toBe("shopfront");
    }
  });

  it("respects the preset pool at zero variation", () => {
    const gen = { ...DEFAULT_GEN, presets: ["modern" as const], variation: 0 };
    const p = generateLot(7, gen, mulberry32(3));
    expect(p.wallColor).toBe(FACADE_PRESETS.modern.params.wallColor);
    expect(p.windowStyle).toBe("none");
  });
});

describe("generateBlock / rerollBlock", () => {
  const line = { a: [0, 0] as [number, number], b: [30, 0] as [number, number] };

  it("is deterministic: same inputs → identical lots", () => {
    const x = generateBlock(line, false, DEFAULT_GEN, 7);
    const y = generateBlock(line, false, DEFAULT_GEN, 7);
    expect(x).toEqual(y);
    const widths = x.reduce((s, l) => s + l.params.width, 0);
    expect(widths).toBeCloseTo(30, 9);
  });

  it("reroll pins customized lots, regenerates the rest, keeps widths", () => {
    const lots = generateBlock(line, false, DEFAULT_GEN, 7);
    const block: FacadeBlock = {
      ...initialWorld(DEFAULT_FACADE),
      line,
      lots: lots.map((l, i) => (i === 1 ? { ...l, customized: true } : l)),
      seed: 7,
    };
    const rerolled = rerollBlock(block, 99);
    expect(rerolled.lots[1]).toEqual(block.lots[1]); // pinned, untouched
    expect(rerolled.lots[0].params.width).toBe(block.lots[0].params.width);
    expect(rerolled.seed).toBe(99);
    // at least one unpinned lot actually changed
    const changed = rerolled.lots.some(
      (l, i) => i !== 1 && JSON.stringify(l) !== JSON.stringify(block.lots[i]),
    );
    expect(changed).toBe(true);
  });
});

describe("generateBlock depthOffset", () => {
  const line = { a: [0, 0] as [number, number], b: [30, 0] as [number, number] };

  it("depthJitter 0 → every lot's depthOffset is 0", () => {
    const gen = { ...DEFAULT_GEN, depthJitter: 0 };
    for (let seed = 1; seed <= 20; seed++) {
      const lots = generateBlock(line, false, gen, seed);
      for (const l of lots) expect(l.depthOffset).toBeCloseTo(0, 9);
    }
  });

  it("DEFAULT_GEN → every |depthOffset| stays within depthJitter/2", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lots = generateBlock(line, false, DEFAULT_GEN, seed);
      for (const l of lots) {
        expect(Math.abs(l.depthOffset ?? 0)).toBeLessThanOrEqual(
          DEFAULT_GEN.depthJitter / 2 + 1e-9,
        );
      }
    }
  });

  it("reroll: pinned lot keeps its exact depthOffset, unpinned offsets change with the new seed", () => {
    const lots = generateBlock(line, false, DEFAULT_GEN, 7);
    const block: FacadeBlock = {
      ...initialWorld(DEFAULT_FACADE),
      line,
      lots: lots.map((l, i) => (i === 1 ? { ...l, customized: true } : l)),
      seed: 7,
    };
    const rerolled = rerollBlock(block, 99);
    expect(rerolled.lots[1].depthOffset).toBe(block.lots[1].depthOffset); // pinned
    expect(rerolled.lots[0].depthOffset).not.toBe(block.lots[0].depthOffset);
  });

  it("patching a lot must spread the old LotState (depthOffset survives edits)", () => {
    const lots = generateBlock(
      { a: [0, 0], b: [30, 0] },
      false,
      DEFAULT_GEN,
      7,
    );
    const patched = lots.map((l, i) =>
      i === 1 ? { ...l, params: { ...l.params, storeys: 5 }, customized: true } : l,
    );
    expect(patched[1].depthOffset).toBe(lots[1].depthOffset);
    expect(patched[1].customized).toBe(true);
  });
});
