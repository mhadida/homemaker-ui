import { describe, it, expect } from "vitest";
import {
  serializeScene,
  deserializeScene,
  toJSON,
  fromJSON,
  SCENE_VERSION,
  type SceneState,
} from "./document";
import { DEFAULT_GEN, reserveBlockIds, nextBlockId, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { DEFAULT_GROUND } from "./terrain";
import { STREET_WIDTH_DEFAULT } from "./street";
import { DEFAULT_MAX_CORNER_ANGLE, type CornerChoice } from "./corners";

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

const scene = (): SceneState => ({
  blocks: [
    mkBlock("block-2", [0, 0], [10, 0], [5, 5]),
    mkBlock("block-5", [10, 0], [10, 8], [8], true),
  ],
  cornerChoices: new Map<string, CornerChoice>([
    ["block-2:b|block-5:a", { mode: "unified", primary: "a" }],
  ]),
  ground: { slope: 0.1, azimuth: 45 },
  streetWidth: 18,
  maxCornerAngle: 120,
});

describe("serializeScene / toJSON", () => {
  it("stamps the version and converts the cornerChoices Map to entries", () => {
    const doc = serializeScene(scene());
    expect(doc.version).toBe(SCENE_VERSION);
    expect(doc.cornerChoices).toEqual([
      ["block-2:b|block-5:a", { mode: "unified", primary: "a" }],
    ]);
    expect(doc.streetWidth).toBe(18);
    expect(doc.maxCornerAngle).toBe(120);
  });
  it("toJSON produces parseable JSON text", () => {
    const parsed = JSON.parse(toJSON(scene()));
    expect(parsed.version).toBe(SCENE_VERSION);
    expect(parsed.blocks).toHaveLength(2);
  });
});

describe("round-trip", () => {
  it("serialize → deserialize preserves blocks, choices, and scalars", () => {
    const s = scene();
    const res = deserializeScene(serializeScene(s));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scene.blocks).toEqual(s.blocks);
    expect(res.scene.cornerChoices instanceof Map).toBe(true);
    expect(res.scene.cornerChoices.get("block-2:b|block-5:a")).toEqual({
      mode: "unified",
      primary: "a",
    });
    expect(res.scene.ground).toEqual({ slope: 0.1, azimuth: 45 });
    expect(res.scene.streetWidth).toBe(18);
    expect(res.scene.maxCornerAngle).toBe(120);
  });
  it("survives a JSON text round-trip (toJSON → fromJSON)", () => {
    const res = fromJSON(toJSON(scene()));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scene.blocks).toHaveLength(2);
  });
});

describe("deserialize validation", () => {
  it("rejects a non-object", () => {
    expect(deserializeScene(42).ok).toBe(false);
    expect(deserializeScene(null).ok).toBe(false);
  });
  it("rejects an unknown version", () => {
    const doc = serializeScene(scene());
    const res = deserializeScene({ ...doc, version: 999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/version/i);
  });
  it("rejects a missing blocks array", () => {
    const doc = serializeScene(scene()) as Record<string, unknown>;
    delete doc.blocks;
    expect(deserializeScene(doc).ok).toBe(false);
  });
  it("rejects a malformed block (bad line)", () => {
    const doc = serializeScene(scene());
    // deep-clone then corrupt one block's line
    const bad = JSON.parse(JSON.stringify(doc));
    bad.blocks[0].line = { a: [0, 0] }; // missing b
    expect(deserializeScene(bad).ok).toBe(false);
  });
  it("rejects a block with no lots", () => {
    const doc = serializeScene(scene());
    const bad = JSON.parse(JSON.stringify(doc));
    bad.blocks[0].lots = [];
    expect(deserializeScene(bad).ok).toBe(false);
  });
  it("fromJSON rejects non-JSON text", () => {
    const res = fromJSON("{not json");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/json/i);
  });
});

describe("forward-compatible defaults", () => {
  it("missing optional scalars fall back to defaults", () => {
    const res = deserializeScene({
      version: SCENE_VERSION,
      blocks: [mkBlock("block-1", [0, 0], [6, 0], [6])],
      // no cornerChoices, ground, streetWidth, maxCornerAngle
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scene.cornerChoices.size).toBe(0);
    expect(res.scene.ground).toEqual(DEFAULT_GROUND);
    expect(res.scene.streetWidth).toBe(STREET_WIDTH_DEFAULT);
    expect(res.scene.maxCornerAngle).toBe(DEFAULT_MAX_CORNER_ANGLE);
  });
});

describe("reserveBlockIds", () => {
  it("bumps the counter past loaded ids so new blocks never collide", () => {
    reserveBlockIds([
      mkBlock("block-2", [0, 0], [5, 0], [5]),
      mkBlock("block-41", [0, 0], [5, 0], [5]),
    ]);
    const next = Number(/^block-(\d+)$/.exec(nextBlockId())![1]);
    expect(next).toBeGreaterThan(41);
  });
});
