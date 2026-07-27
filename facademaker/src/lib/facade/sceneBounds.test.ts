import { describe, expect, it } from "vitest";
import { DEFAULT_FACADE } from "./types";
import { EMPTY_NETWORK } from "@/lib/street/types";
import { DEFAULT_GEN } from "./blocks";
import { deriveSceneBounds, perspectiveFitFor } from "./sceneBounds";

describe("deriveSceneBounds", () => {
  it("keeps the legacy 30 m origin frame for a blank flat scene", () => {
    const bounds = deriveSceneBounds({
      blocks: [],
      streetNetwork: EMPTY_NETWORK,
      contextBuildings: [],
      ground: { slope: 0, azimuth: 0 },
    });

    expect(bounds.hasContent).toBe(false);
    expect(bounds).toMatchObject({
      minX: -15,
      maxX: 15,
      minZ: -15,
      maxZ: 15,
      width: 30,
      depth: 30,
      cx: 0,
      cz: 0,
    });
  });

  it("combines facade, street, context and terrain extents", () => {
    const bounds = deriveSceneBounds({
      blocks: [
        {
          id: "block-1",
          line: { a: [-40, -5], b: [20, -5] },
          flipped: false,
          lots: [
            {
              params: { ...DEFAULT_FACADE, storeys: 4 },
              customized: false,
            },
          ],
          gen: structuredClone(DEFAULT_GEN),
          seed: 1,
        },
      ],
      streetNetwork: {
        ...EMPTY_NETWORK,
        streets: [
          { id: "street-1", type: "street", points: [[-80, 10], [90, 15]] },
        ],
      },
      contextBuildings: [
        {
          id: "way/1",
          footprint: [[-10, -30], [120, -30], [120, 45]],
          height: 50,
        },
      ],
      ground: {
        slope: 0,
        azimuth: 0,
        hf: {
          originX: -100,
          originZ: -60,
          spacing: 20,
          cols: 12,
          rows: 8,
          data: Array.from({ length: 96 }, (_, i) => (i === 95 ? 12 : 2)),
        },
      },
      padding: 10,
    });

    expect(bounds.hasContent).toBe(true);
    expect(bounds.minX).toBe(-110);
    expect(bounds.maxX).toBe(130);
    expect(bounds.minZ).toBe(-70);
    expect(bounds.maxZ).toBe(90);
    expect(bounds.maxY).toBe(62);
    expect(bounds.width).toBe(240);
    expect(bounds.depth).toBe(160);
  });
});

describe("perspectiveFitFor", () => {
  it("derives a camera and orbit range large enough for an imported city", () => {
    const bounds = deriveSceneBounds({
      blocks: [],
      streetNetwork: {
        ...EMPTY_NETWORK,
        streets: [
          { id: "street-1", type: "street", points: [[-800, -500], [800, 700]] },
        ],
      },
      contextBuildings: [],
      ground: { slope: 0, azimuth: 0 },
    });
    const fit = perspectiveFitFor(bounds);

    expect(fit.distance).toBeGreaterThan(2000);
    expect(fit.maxDistance).toBeGreaterThan(fit.distance);
    expect(fit.far).toBeGreaterThan(fit.distance + bounds.radius);
    expect(fit.target).toEqual([0, 6, 100]);
  });
});
