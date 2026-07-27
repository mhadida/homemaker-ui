import { describe, it, expect } from "vitest";
import type { ContextBuilding } from "@/lib/geo/buildings";
import type { StreetNetwork } from "@/lib/street/types";
import { EMPTY_NETWORK } from "@/lib/street/types";
import { DEFAULT_GEN, blockFrame } from "./blocks";
import { MASSING_DEPTH_MAX, MASSING_DEPTH_MIN } from "./layout";
import {
  mergeBlock,
  parcelPreview,
  promoteParcel,
  subdivideBlock,
} from "./promote";

const streetAtZ = (z: number): StreetNetwork => ({
  ...EMPTY_NETWORK,
  streets: [
    {
      id: "s1",
      type: "street",
      points: [
        [-50, z],
        [50, z],
      ],
    },
  ],
});

const plot = (outline: [number, number][]): ContextBuilding => ({
  id: "way/24601",
  footprint: outline,
  height: 20.1,
});

// 10 m frontage, 6 m deep, street to the south.
const PLOT = plot([
  [0, 0],
  [10, 0],
  [10, 6],
  [0, 6],
]);

// 30 m frontage, 6 m deep — long enough to split at lotWidth 5-9.
const WIDE = plot([
  [0, 0],
  [30, 0],
  [30, 6],
  [0, 6],
]);

describe("promoteParcel", () => {
  it("produces exactly one lot spanning the whole frontage", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots).toHaveLength(1);
    expect(b.lots[0].params.width).toBeCloseTo(10, 6);
    expect(blockFrame(b).length).toBeCloseTo(10, 6);
  });

  it("takes massing depth from the parcel, not the generator", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBeCloseTo(6, 6);
    expect(b.parcel!.depth).toBeCloseTo(6, 6);
  });

  it("clamps a very deep plot to MASSING_DEPTH_MAX", () => {
    const deep = plot([
      [0, 0],
      [10, 0],
      [10, 40],
      [0, 40],
    ]);
    const b = promoteParcel(deep, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBe(MASSING_DEPTH_MAX);
    expect(b.parcel!.depth).toBe(MASSING_DEPTH_MAX);
  });

  it("clamps a very shallow plot to MASSING_DEPTH_MIN", () => {
    const shallow = plot([
      [0, 0],
      [10, 0],
      [10, 2],
      [0, 2],
    ]);
    const b = promoteParcel(shallow, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params.massingDepth).toBe(MASSING_DEPTH_MIN);
  });

  it("carries no depth jitter, so the building stays on its plot", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].depthOffset).toBe(0);
  });

  it("stores the source id and the real outline verbatim", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.parcel!.source).toBe("way/24601");
    expect(b.parcel!.outline).toEqual(PLOT.footprint);
  });

  it("copies the outline rather than aliasing the fetched footprint", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.parcel!.outline).not.toBe(PLOT.footprint);
    expect(b.parcel!.outline[0]).not.toBe(PLOT.footprint[0]);
  });

  it("leaves the lot unpinned so Reroll still works", () => {
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].customized).toBe(false);
  });

  it("faces the street", () => {
    const south = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(blockFrame(south).normal[1]).toBeCloseTo(-1, 6);
    const north = promoteParcel(PLOT, streetAtZ(14), DEFAULT_GEN, 7)!;
    expect(blockFrame(north).normal[1]).toBeCloseTo(1, 6);
  });

  it("is deterministic in the seed", () => {
    const a = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.lots[0].params).toEqual(a.lots[0].params);
    const c = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 8)!;
    expect(c.lots[0].params).not.toEqual(a.lots[0].params);
  });

  it("gives each promotion a distinct block id", () => {
    const a = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const b = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(b.id).not.toBe(a.id);
  });

  it("does not alias the caller's gen settings", () => {
    const gen = { ...DEFAULT_GEN };
    const b = promoteParcel(PLOT, streetAtZ(-8), gen, 7)!;
    expect(b.gen).not.toBe(gen);
    expect(b.gen).toEqual(gen);
  });

  it("works with no street network at all", () => {
    const b = promoteParcel(PLOT, null, DEFAULT_GEN, 7)!;
    expect(b).not.toBeNull();
    expect(b.lots[0].params.width).toBeCloseTo(10, 6);
  });

  it("returns null when the parcel cannot carry a facade", () => {
    const sliver = plot([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(promoteParcel(sliver, streetAtZ(-8), DEFAULT_GEN, 7)).toBeNull();
  });
});

describe("subdivideBlock", () => {
  it("splits a wide promoted block into a terrace", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    expect(many.lots.length).toBeGreaterThan(1);
  });

  it("keeps the block's total frontage exactly", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    const sum = many.lots.reduce((s, l) => s + l.params.width, 0);
    expect(sum).toBeCloseTo(blockFrame(one).length, 6);
  });

  it("propagates the parcel depth to every new lot, with no jitter", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    for (const l of many.lots) {
      expect(l.params.massingDepth).toBeCloseTo(6, 6);
      expect(l.depthOffset).toBe(0);
    }
  });

  it("leaves the parcel itself untouched", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    expect(many.parcel).toEqual(one.parcel);
  });

  it("refuses a frontage too short to split", () => {
    const narrow = promoteParcel(
      plot([
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
      streetAtZ(-8),
      DEFAULT_GEN,
      7,
    )!;
    expect(subdivideBlock(narrow, 11)).toBeNull();
    const one = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(subdivideBlock(one, 11)).not.toBeNull();
  });

  it("refuses a block that is already a terrace", () => {
    const many = subdivideBlock(
      promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!,
      11,
    )!;
    expect(subdivideBlock(many, 12)).toBeNull();
  });
});

describe("mergeBlock", () => {
  it("collapses a terrace back to one lot spanning the frontage", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const many = subdivideBlock(one, 11)!;
    const back = mergeBlock(many, 13)!;
    expect(back.lots).toHaveLength(1);
    expect(back.lots[0].params.width).toBeCloseTo(blockFrame(one).length, 6);
  });

  it("keeps the parcel depth on the merged lot", () => {
    const many = subdivideBlock(
      promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!,
      11,
    )!;
    const back = mergeBlock(many, 13)!;
    expect(back.lots[0].params.massingDepth).toBeCloseTo(6, 6);
    expect(back.lots[0].depthOffset).toBe(0);
  });

  it("refuses when any lot is hand-edited, rather than discarding the work", () => {
    const many = subdivideBlock(
      promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!,
      11,
    )!;
    many.lots[1] = { ...many.lots[1], customized: true };
    expect(mergeBlock(many, 13)).toBeNull();
  });

  it("refuses a block that is already a single lot", () => {
    const one = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!;
    expect(mergeBlock(one, 13)).toBeNull();
  });

  it("round-trips: promote -> subdivide -> merge restores one full-width lot", () => {
    const one = promoteParcel(WIDE, streetAtZ(-8), DEFAULT_GEN, 7)!;
    const back = mergeBlock(subdivideBlock(one, 11)!, 13)!;
    expect(back.lots).toHaveLength(1);
    expect(back.lots[0].params.width).toBeCloseTo(one.lots[0].params.width, 6);
    expect(back.line).toEqual(one.line);
    expect(back.flipped).toBe(one.flipped);
  });
});

describe("parcelPreview", () => {
  it("agrees exactly with what promoteParcel produces", () => {
    for (const p of [PLOT, WIDE]) {
      const pre = parcelPreview(p, streetAtZ(-8))!;
      const block = promoteParcel(p, streetAtZ(-8), DEFAULT_GEN, 7)!;
      expect(pre.width).toBeCloseTo(block.lots[0].params.width, 9);
      expect(pre.depth).toBe(block.lots[0].params.massingDepth);
      expect(pre.line).toEqual(block.line);
      expect(pre.flipped).toBe(block.flipped);
    }
  });

  it("applies the same depth clamp", () => {
    const deep = plot([
      [0, 0],
      [10, 0],
      [10, 40],
      [0, 40],
    ]);
    expect(parcelPreview(deep, streetAtZ(-8))!.depth).toBe(MASSING_DEPTH_MAX);
  });

  it("is PURE — it must not consume block ids, unlike promoteParcel", () => {
    // The panel previews on every render. If preview allocated an id, the
    // counter would climb with mouse movement.
    const before = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!.id;
    for (let i = 0; i < 50; i++) parcelPreview(PLOT, streetAtZ(-8));
    const after = promoteParcel(PLOT, streetAtZ(-8), DEFAULT_GEN, 7)!.id;
    const n = (s: string) => Number(/^block-(\d+)$/.exec(s)![1]);
    expect(n(after) - n(before)).toBe(1);
  });

  it("returns null for the same parcels promoteParcel rejects", () => {
    const sliver = plot([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(parcelPreview(sliver, streetAtZ(-8))).toBeNull();
    expect(promoteParcel(sliver, streetAtZ(-8), DEFAULT_GEN, 7)).toBeNull();
  });
});
