import { describe, it, expect } from "vitest";
import {
  mulberry32,
  subdivide,
  generateLot,
  generateBlock,
  rerollBlock,
  refit,
} from "./generate";
import { DEFAULT_GEN, initialWorld, type FacadeBlock, type LotState } from "./blocks";
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

// ── refit ────────────────────────────────────────────────────────────────

const mkLot = (width: number, customized = false): LotState => ({
  params: { ...DEFAULT_FACADE, width },
  customized,
});

const mkRefitBlock = (
  lots: LotState[],
  opts: Partial<Pick<FacadeBlock, "flipped" | "seed">> = {},
): FacadeBlock => ({
  id: "t",
  line: {
    a: [0, 0],
    b: [lots.reduce((s, l) => s + l.params.width, 0), 0],
  },
  flipped: opts.flipped ?? false,
  gen: structuredClone(DEFAULT_GEN),
  seed: opts.seed ?? 42,
  lots,
});

/** Re-line the block to a new length along +x (a stays at the origin). */
const withLength = (b: FacadeBlock, len: number): FacadeBlock => ({
  ...b,
  line: { a: [0, 0], b: [len, 0] },
});

describe("refit", () => {
  it("grows the lot nearest the moved end; fixed-end lots untouched", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 13), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([5, 8]);
  });

  it("absorbs at the head when line.a moved (unflipped)", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit({ ...b, line: { a: [-2, 0], b: [11, 0] } }, "a")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([7, 6]);
  });

  it("flipped swaps which array end absorbs", () => {
    // Flipped: frame origin = line.b, so lots[0] sits nearest b.
    const b = mkRefitBlock([mkLot(5), mkLot(6)], { flipped: true });
    const r = refit(withLength(b, 13), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([7, 6]);
  });

  it("skips pinned lots when picking the absorber", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6), mkLot(5, true)]);
    const r = refit(withLength(b, 18), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([5, 8, 5]);
    expect(r.lots[2].customized).toBe(true);
  });

  it("rejects when every lot is pinned", () => {
    const b = mkRefitBlock([mkLot(5, true), mkLot(6, true)]);
    expect(refit(withLength(b, 12), "b")).toBeNull();
  });

  it("shrinking below lotWidth.min removes the absorber and folds onward", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 9), "b")!;
    expect(r.lots.map((l) => l.params.width)).toEqual([9]);
  });

  it("rejects when the only lot would drop below lotWidth.min", () => {
    const b = mkRefitBlock([mkLot(7.5)]);
    expect(refit(withLength(b, 4), "b")).toBeNull();
  });

  it("rejects when removal leaves only pinned lots that cannot fit", () => {
    const b = mkRefitBlock([mkLot(5, true), mkLot(6)]);
    expect(refit(withLength(b, 4), "b")).toBeNull();
  });

  it("splits once the absorber reaches max + min", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(withLength(b, 25), "b")!;
    const widths = r.lots.map((l) => l.params.width);
    const T = DEFAULT_GEN.lotWidth.max + DEFAULT_GEN.lotWidth.min;
    expect(widths[0]).toBe(5); // fixed-end lot untouched
    expect(widths.length).toBeGreaterThan(2); // at least one new lot
    expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(25, 9);
    for (const w of widths.slice(1)) {
      expect(w).toBeGreaterThanOrEqual(DEFAULT_GEN.lotWidth.min);
      expect(w).toBeLessThan(T);
    }
    for (const l of r.lots.slice(2)) expect(l.customized).toBe(false);
  });

  it("final widths are drag-path independent", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const direct = refit(withLength(b, 25), "b")!;
    const stepped = refit(withLength(refit(withLength(b, 18), "b")!, 25), "b")!;
    expect(stepped.lots.map((l) => l.params.width)).toEqual(
      direct.lots.map((l) => l.params.width),
    );
  });

  it("is deterministic", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r1 = refit(withLength(b, 25), "b")!;
    const r2 = refit(withLength(b, 25), "b")!;
    expect(r2.lots.map((l) => l.params)).toEqual(r1.lots.map((l) => l.params));
  });

  it("preserves depthOffset on surviving lots and assigns one to new lots", () => {
    const lots: LotState[] = [{ ...mkLot(5), depthOffset: 0.05 }, mkLot(6)];
    const b = mkRefitBlock(lots);
    const r = refit(withLength(b, 25), "b")!;
    expect(r.lots[0].depthOffset).toBe(0.05);
    for (const l of r.lots.slice(2)) expect(typeof l.depthOffset).toBe("number");
  });

  it("returns lots unchanged when the length already matches", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const r = refit(b, "b")!;
    expect(r.lots).toEqual(b.lots);
  });

  it("does not mutate its input", () => {
    const b = mkRefitBlock([mkLot(5), mkLot(6)]);
    const snapshot = structuredClone(b);
    refit(withLength(b, 25), "b");
    expect(b).toEqual(snapshot);
  });
});
