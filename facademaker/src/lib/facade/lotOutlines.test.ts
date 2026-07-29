import { describe, expect, it } from "vitest";
import type { CadastralParcel } from "@/lib/geo/cadastralParcels";
import { DEFAULT_GROUND } from "./terrain";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import { buildLotOutlineGeometry } from "./lotOutlines";

function block(lots = 1): FacadeBlock {
  return {
    id: "block-test",
    line: { a: [0, 0], b: [4 * lots, 0] },
    flipped: false,
    gen: structuredClone(DEFAULT_GEN),
    seed: 1,
    lots: Array.from({ length: lots }, () => ({
      customized: false,
      params: {
        ...DEFAULT_FACADE,
        width: 4,
        massingDepth: 4,
      },
    })),
  };
}

describe("buildLotOutlineGeometry", () => {
  it("builds one ground-draped rectangle for an editable lot", () => {
    const geometry = buildLotOutlineGeometry([block()], [], DEFAULT_GROUND);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(8);
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeCloseTo(0.1);
    }
    geometry.dispose();
  });

  it("deduplicates the shared boundary between adjacent lots", () => {
    const geometry = buildLotOutlineGeometry([block(2)], [], DEFAULT_GROUND);
    const position = geometry.getAttribute("position");
    // Two 4×4 rectangles: seven unique edges, two vertices per edge.
    expect(position.count).toBe(14);
    geometry.dispose();
  });

  it("adds imported cadastral parcel boundaries to the same geometry", () => {
    const parcel: CadastralParcel = {
      id: "parcel/1",
      polygons: [
        [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
          ],
        ],
      ],
    };
    const geometry = buildLotOutlineGeometry([], [parcel], DEFAULT_GROUND);
    expect(geometry.getAttribute("position").count).toBe(8);
    geometry.dispose();
  });

  it("samples real heightfield terrain instead of drawing a flat overlay", () => {
    const geometry = buildLotOutlineGeometry([block()], [], {
      slope: 0,
      azimuth: 0,
      hf: {
        originX: 0,
        originZ: -4,
        spacing: 4,
        cols: 2,
        rows: 2,
        data: [2, 6, 2, 6],
      },
    });
    const position = geometry.getAttribute("position");
    const heights = Array.from(
      { length: position.count },
      (_, index) => position.getY(index),
    );
    expect(Math.min(...heights)).toBeCloseTo(2.1);
    expect(Math.max(...heights)).toBeCloseTo(6.1);
    geometry.dispose();
  });
});
