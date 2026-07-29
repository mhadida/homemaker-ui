import { describe, it, expect } from "vitest";
import {
  serializeScene,
  deserializeScene,
  toJSON,
  toCompactJSON,
  fromJSON,
  sceneHasContent,
  SCENE_VERSION,
  type SceneState,
} from "./document";
import { DEFAULT_GEN, reserveBlockIds, nextBlockId, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { DEFAULT_GROUND, type Heightfield } from "./terrain";
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
  anchor: null,
  bbox: null,
  hiddenIds: new Set<string>(),
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
  it("round-trips a canal street (type derived from STREET_SPECS, not a stale list)", () => {
    const s: SceneState = {
      blocks: [],
      cornerChoices: new Map(),
      ground: DEFAULT_GROUND,
      streetWidth: STREET_WIDTH_DEFAULT,
      maxCornerAngle: DEFAULT_MAX_CORNER_ANGLE,
      streetNetwork: {
        streets: [{ id: "canal-1", type: "canal", points: [[0, 0], [40, 0]] }],
        roundabouts: [],
      },
      anchor: null,
      bbox: null,
      hiddenIds: new Set<string>(),
    };
    const res = fromJSON(toJSON(s));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scene.streetNetwork.streets).toHaveLength(1);
      expect(res.scene.streetNetwork.streets[0].type).toBe("canal");
    }
  });
  it("round-trips a street-derived block's source link", () => {
    const s: SceneState = {
      blocks: [
        {
          ...mkBlock("street:s1#0#0#left", [0, 0], [8, 0], [8]),
          source: { streetId: "s1", segment: 0, part: 0, side: "left" },
        },
      ],
      cornerChoices: new Map(),
      ground: DEFAULT_GROUND,
      streetWidth: STREET_WIDTH_DEFAULT,
      maxCornerAngle: DEFAULT_MAX_CORNER_ANGLE,
      streetNetwork: EMPTY_NETWORK,
      anchor: null,
      bbox: null,
      hiddenIds: new Set<string>(),
    };
    const res = fromJSON(toJSON(s));
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.scene.blocks[0].source).toEqual({
        streetId: "s1",
        segment: 0,
        part: 0,
        side: "left",
      });
  });
  it("round-trips an arch gate as a sparse lot use", () => {
    const s = scene();
    s.blocks[0].lots[1].kind = "arch-gate";
    const res = deserializeScene(serializeScene(s));
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.scene.blocks[0].lots.map((lot) => lot.kind)).toEqual([
        undefined,
        "arch-gate",
      ]);
  });
  it("round-trips sparse local parcel subdivisions", () => {
    const s = scene();
    s.parcelEdits = [
      {
        sourceId: "BRK.1",
        replacements: [
          {
            id: "BRK.1~1",
            sourceId: "BRK.1",
            polygons: [[[[0, 0], [5, 0], [5, 10], [0, 10]]]],
            area: 50,
          },
          {
            id: "BRK.1~2",
            sourceId: "BRK.1",
            polygons: [[[[5, 0], [10, 0], [10, 10], [5, 10]]]],
            area: 50,
          },
        ],
      },
    ];
    const res = fromJSON(toJSON(s));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scene.parcelEdits).toEqual(s.parcelEdits);
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
      anchor: null,
      bbox: null,
      hiddenIds: new Set<string>(),
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

  it("drops a malformed street entry (bad points) but keeps the valid one — no throw", () => {
    const doc = {
      ...serializeScene(scene()),
      streetNetwork: {
        streets: [
          { id: "street-1", type: "street", points: [[0, 0], [10, 0]] },
          { id: "street-2", type: "street", points: "x" }, // malformed: points not an array
        ],
        roundabouts: [],
      },
    };
    let res: ReturnType<typeof deserializeScene>;
    expect(() => {
      res = deserializeScene(doc);
    }).not.toThrow();
    expect(res!.ok).toBe(true);
    if (!res!.ok) return;
    expect(res!.scene.streetNetwork.streets).toHaveLength(1);
    expect(res!.scene.streetNetwork.streets[0].id).toBe("street-1");
  });

  it("drops a null street entry", () => {
    const doc = {
      ...serializeScene(scene()),
      streetNetwork: {
        streets: [
          null,
          { id: "street-1", type: "street", points: [[0, 0], [10, 0]] },
        ],
        roundabouts: [],
      },
    };
    const res = deserializeScene(doc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.scene.streetNetwork.streets).toHaveLength(1);
  });

  it("drops a street with a missing points field, an unknown type, or a bad id", () => {
    const doc = {
      ...serializeScene(scene()),
      streetNetwork: {
        streets: [
          { id: "street-1", type: "street" }, // no points at all
          { id: "street-2", type: "not-a-type", points: [[0, 0], [1, 1]] },
          { id: 42, type: "street", points: [[0, 0], [1, 1]] },
          { id: "street-3", type: "road", points: [[0, 0], [1, 1]] }, // valid
        ],
        roundabouts: [],
      },
    };
    const res = deserializeScene(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scene.streetNetwork.streets).toHaveLength(1);
    expect(res.scene.streetNetwork.streets[0].id).toBe("street-3");
  });

  it("drops malformed roundabout entries, keeping well-shaped ones", () => {
    const doc = {
      ...serializeScene(scene()),
      streetNetwork: {
        streets: [{ id: "street-1", type: "street", points: [[0, 0], [10, 0]] }],
        roundabouts: [
          ["node-a|node-b", { kind: "obelisk" }],
          ["node-c|node-d", { kind: "triumphal-arch" }],
          ["node-e|node-f", { kind: "unknown" }],
          ["bad-entry"], // wrong shape
          "not-a-pair",
        ],
      },
    };
    const res = deserializeScene(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scene.streetNetwork.roundabouts).toEqual([
      ["node-a|node-b", { kind: "obelisk" }],
      ["node-c|node-d", { kind: "triumphal-arch" }],
    ]);
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

const HF: Heightfield = {
  originX: -100, originZ: -100, spacing: 20, cols: 3, rows: 3,
  data: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

function baseScene() {
  return {
    blocks: [],
    cornerChoices: new Map(),
    ground: { slope: 0, azimuth: 0 },
    streetWidth: 14,
    maxCornerAngle: 60,
    streetNetwork: { streets: [], roundabouts: [], squares: [] },
    anchor: null,
    bbox: null,
    hiddenIds: new Set<string>(),
  };
}

describe("document terrain round-trip", () => {
  it("round-trips a heightfield + anchor", () => {
    const scene = { ...baseScene(), ground: { slope: 0, azimuth: 0, hf: HF }, anchor: { lat0: 52.37, lon0: 4.91 } };
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toEqual(HF);
    expect(back.scene.anchor).toEqual({ lat0: 52.37, lon0: 4.91 });
  });

  it("an old save with no hf/anchor loads flat (byte-identical)", () => {
    const doc = { version: 1, blocks: [], cornerChoices: [], ground: { slope: 0, azimuth: 0 }, streetWidth: 14, maxCornerAngle: 60, streetNetwork: { streets: [], roundabouts: [], squares: [] } };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toBeUndefined();
    expect(back.scene.anchor).toBeNull();
  });

  it("drops a malformed heightfield rather than crashing", () => {
    const doc = { version: 1, blocks: [], cornerChoices: [], ground: { slope: 0, azimuth: 0, hf: { cols: 3 } }, streetWidth: 14, maxCornerAngle: 60, streetNetwork: { streets: [], roundabouts: [], squares: [] } };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toBeUndefined();
  });

  it("drops a degenerate heightfield (cols:0, rows:0, spacing:0) rather than loading a zero-area grid", () => {
    const doc = {
      version: 1,
      blocks: [],
      cornerChoices: [],
      ground: {
        slope: 0,
        azimuth: 0,
        hf: { originX: 0, originZ: 0, spacing: 0, cols: 0, rows: 0, data: [] },
      },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
    };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.ground.hf).toBeUndefined();
  });
});

describe("document context-building fields", () => {
  const BBOX = { west: 4.88, south: 52.36, east: 4.9, north: 52.38 };

  function sceneWith(over: Record<string, unknown>) {
    return {
      blocks: [],
      cornerChoices: new Map(),
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
      anchor: null,
      bbox: null,
      hiddenIds: new Set<string>(),
      ...over,
    };
  }

  it("round-trips bbox and hiddenIds", () => {
    const scene = sceneWith({ bbox: BBOX, hiddenIds: new Set(["way/1", "way/2"]) });
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene as never))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toEqual(BBOX);
    expect(Array.from(back.scene.hiddenIds).sort()).toEqual(["way/1", "way/2"]);
  });

  it("a document without the fields loads clean (byte-identical)", () => {
    const doc = {
      version: 1,
      blocks: [],
      cornerChoices: [],
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
    };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toBeNull();
    expect(back.scene.hiddenIds.size).toBe(0);
  });

  it("drops a malformed bbox and non-string hiddenIds rather than throwing", () => {
    const doc = {
      version: 1,
      blocks: [],
      cornerChoices: [],
      ground: { slope: 0, azimuth: 0 },
      streetWidth: 14,
      maxCornerAngle: 60,
      streetNetwork: { streets: [], roundabouts: [], squares: [] },
      bbox: { west: 1, south: 2 },
      hiddenIds: ["way/1", 7, null],
    };
    const back = deserializeScene(doc);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.bbox).toBeNull();
    expect(Array.from(back.scene.hiddenIds)).toEqual(["way/1"]);
  });

  it("omits empty hiddenIds from the serialized document", () => {
    const doc = serializeScene(sceneWith({}) as never);
    expect(doc.hiddenIds).toBeUndefined();
    expect(doc.bbox).toBeUndefined();
  });
});

describe("sceneHasContent", () => {
  const BBOX = { west: 4.88, south: 52.36, east: 4.9, north: 52.38 };

  it("is false for a genuinely empty scene (no blocks, no streets, no place)", () => {
    expect(sceneHasContent(baseScene())).toBe(false);
  });

  it("is true when blocks are present", () => {
    expect(
      sceneHasContent({
        ...baseScene(),
        blocks: [mkBlock("block-1", [0, 0], [6, 0], [6])],
      }),
    ).toBe(true);
  });

  it("is true when streets are present", () => {
    expect(
      sceneHasContent({
        ...baseScene(),
        streetNetwork: {
          streets: [{ id: "s1", type: "street", points: [[0, 0], [10, 0]] }],
          roundabouts: [],
        },
      }),
    ).toBe(true);
  });

  it("is true when a terrain heightfield is loaded, even with no blocks/streets (the autosave-place bug)", () => {
    expect(
      sceneHasContent({ ...baseScene(), ground: { slope: 0, azimuth: 0, hf: HF } }),
    ).toBe(true);
  });

  it("is true when a context-buildings bbox is loaded, even with no blocks/streets", () => {
    expect(sceneHasContent({ ...baseScene(), bbox: BBOX })).toBe(true);
  });
});

// --- M4: a promoted block's real parcel ---------------------------------

const GOOD_PARCEL = {
  source: "way/24601",
  outline: [
    [0, 0],
    [10, 0],
    [10, 6],
    [0, 6],
  ] as [number, number][],
  depth: 6,
};

const sceneWithParcel = (parcel: unknown): SceneState => ({
  ...scene(),
  blocks: [{ ...mkBlock("block-2", [0, 0], [10, 0], [10]), parcel } as FacadeBlock],
});

describe("document round-trip of block.parcel", () => {
  it("round-trips a valid parcel", () => {
    const out = deserializeScene(
      JSON.parse(JSON.stringify(serializeScene(sceneWithParcel(GOOD_PARCEL)))),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scene.blocks[0].parcel).toEqual(GOOD_PARCEL);
  });

  it("keeps SCENE_VERSION at 1 — a bump would reject every beta save", () => {
    expect(SCENE_VERSION).toBe(1);
  });

  it("loads a block with no parcel at all (every older save)", () => {
    const out = deserializeScene(
      JSON.parse(JSON.stringify(serializeScene(sceneWithParcel(undefined)))),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scene.blocks[0].parcel).toBeUndefined();
  });

  it.each([
    ["not an object", 42],
    ["missing source", { outline: GOOD_PARCEL.outline, depth: 6 }],
    ["non-string source", { source: 1, outline: GOOD_PARCEL.outline, depth: 6 }],
    ["missing outline", { source: "way/1", depth: 6 }],
    [
      "outline too short",
      {
        source: "way/1",
        outline: [
          [0, 0],
          [1, 1],
        ],
        depth: 6,
      },
    ],
    [
      "non-finite vertex",
      {
        source: "way/1",
        outline: [
          [0, 0],
          [null, 0],
          [1, 1],
        ],
        depth: 6,
      },
    ],
    [
      "bad vertex arity",
      {
        source: "way/1",
        outline: [[0], [1, 1], [2, 2]],
        depth: 6,
      },
    ],
    ["missing depth", { source: "way/1", outline: GOOD_PARCEL.outline }],
  ])(
    "drops a malformed parcel (%s) without failing the document",
    (_label, parcel) => {
      const out = deserializeScene(
        JSON.parse(JSON.stringify(serializeScene(sceneWithParcel(parcel)))),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      // The block itself survives — only the parcel is dropped.
      expect(out.scene.blocks).toHaveLength(1);
      expect(out.scene.blocks[0].parcel).toBeUndefined();
    },
  );
});

describe("toCompactJSON", () => {
  it("round-trips identically to toJSON", () => {
    const s = scene();
    const compact = deserializeScene(JSON.parse(toCompactJSON(s)));
    const pretty = deserializeScene(JSON.parse(toJSON(s)));
    expect(compact.ok).toBe(true);
    expect(pretty.ok).toBe(true);
    if (!compact.ok || !pretty.ok) return;
    expect(compact.scene).toEqual(pretty.scene);
  });

  it("is substantially smaller than the indented form", () => {
    // The autosave key is machine-read only, and the indented form of a
    // real-city scene ran to 2.79 MB — past Chrome's localStorage budget.
    const s = scene();
    expect(toCompactJSON(s).length).toBeLessThan(toJSON(s).length * 0.7);
  });

  it("stays compact for a heightfield-heavy scene, the case that overflowed", () => {
    const cols = 128;
    const rows = 79;
    const withHf: SceneState = {
      ...scene(),
      ground: {
        slope: 0,
        azimuth: 0,
        hf: {
          originX: 0,
          originZ: 0,
          spacing: 10,
          cols,
          rows,
          data: Array.from({ length: cols * rows }, (_, i) => i * 0.125),
        },
      },
    };
    // Indented, every one of the 10,112 samples costs its own line + indent.
    expect(toCompactJSON(withHf).length).toBeLessThan(
      toJSON(withHf).length * 0.5,
    );
  });
});
