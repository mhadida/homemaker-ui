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
import { EMPTY_NETWORK } from "../street/types";

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
  streetNetwork: EMPTY_NETWORK,
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
    const doc = serializeScene(scene()) as unknown as Record<string, unknown>;
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

describe("params normalization (partial lots render safe)", () => {
  it("fills missing nested groundFloor/ornament from defaults", () => {
    const res = deserializeScene({
      version: SCENE_VERSION,
      blocks: [
        {
          id: "block-1",
          line: { a: [0, 0], b: [6, 0] },
          flipped: false,
          gen: structuredClone(DEFAULT_GEN),
          seed: 3,
          lots: [{ params: { width: 6 }, customized: false }], // no groundFloor/ornament
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.scene.blocks[0].lots[0].params;
    // the fields computeLayout dereferences unguarded are now present
    expect(p.groundFloor).toEqual(DEFAULT_FACADE.groundFloor);
    expect(p.ornament).toEqual(DEFAULT_FACADE.ornament);
    expect(p.width).toBe(6);
  });
  it("rejects a lot whose params is null/non-object (graceful error, no crash)", () => {
    const bad = {
      version: SCENE_VERSION,
      blocks: [
        {
          id: "block-1",
          line: { a: [0, 0], b: [6, 0] },
          flipped: false,
          gen: structuredClone(DEFAULT_GEN),
          seed: 3,
          lots: [{ params: null }],
        },
      ],
    };
    expect(deserializeScene(bad).ok).toBe(false);
  });
  it("round-trips optional facade fields (sections, massingDepth, roofType)", () => {
    const s: SceneState = {
      blocks: [
        {
          ...mkBlock("block-1", [0, 0], [8, 0], [8]),
          lots: [
            {
              params: {
                ...DEFAULT_FACADE,
                width: 8,
                massingDepth: 11,
                roofType: "hip",
                roofColor: "red",
                sections: [{ bays: 2, offset: 0.1 }],
              },
              customized: true,
              depthOffset: 0.07,
            },
          ],
        },
      ],
      cornerChoices: new Map(),
      ground: DEFAULT_GROUND,
      streetWidth: STREET_WIDTH_DEFAULT,
      maxCornerAngle: DEFAULT_MAX_CORNER_ANGLE,
      streetNetwork: EMPTY_NETWORK,
    };
    const res = fromJSON(toJSON(s));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lot = res.scene.blocks[0].lots[0];
    expect(lot.params.massingDepth).toBe(11);
    expect(lot.params.roofType).toBe("hip");
    expect(lot.params.sections).toEqual([{ bays: 2, offset: 0.1 }]);
    expect(lot.depthOffset).toBe(0.07);
    expect(lot.customized).toBe(true);
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

describe("streetNetwork", () => {
  it("round-trips a streetNetwork; absent → empty", () => {
    const withNet = {
      ...scene(),
      streetNetwork: { streets: [{ id: "street-1", type: "street", points: [[0,0],[10,0]] }], roundabouts: [] },
    };
    const res = fromJSON(toJSON(withNet as never));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scene.streetNetwork.streets).toHaveLength(1);
    // old doc with no streetNetwork → empty network, still ok
    const old = deserializeScene({ version: 1, blocks: serializeScene(scene()).blocks });
    expect(old.ok).toBe(true);
    if (old.ok) expect(old.scene.streetNetwork.streets).toEqual([]);
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
