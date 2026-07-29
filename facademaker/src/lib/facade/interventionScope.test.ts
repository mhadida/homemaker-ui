import { describe, expect, it } from "vitest";
import type { CadastralParcel } from "../geo/cadastralParcels";
import { DEFAULT_GEN, type FacadeBlock } from "./blocks";
import { DEFAULT_FACADE } from "./types";
import {
  scopeArea,
  scopeFromPoint,
  scopeFromRect,
} from "./interventionScope";

const parcels: CadastralParcel[] = [
  {
    id: "lot-a",
    polygons: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    ],
  },
  {
    id: "lot-b",
    polygons: [
      [
        [
          [10, 0],
          [20, 0],
          [20, 10],
          [10, 10],
        ],
      ],
    ],
  },
];

const block: FacadeBlock = {
  id: "drawn",
  line: { a: [30, 0], b: [40, 0] },
  flipped: false,
  gen: structuredClone(DEFAULT_GEN),
  seed: 1,
  lots: [
    {
      customized: false,
      params: { ...DEFAULT_FACADE, width: 10, massingDepth: 8 },
    },
  ],
};

describe("intervention scope", () => {
  it("selects the cadastral parcel under a click", () => {
    const scope = scopeFromPoint([5, 5], [block], parcels);
    expect(scope?.kind).toBe("parcel");
    expect(scope?.lotIds).toEqual(["brk:lot-a"]);
    expect(scopeArea(scope!.outline)).toBe(100);
  });

  it("selects an editable lot when no BRK parcel is under the click", () => {
    const scope = scopeFromPoint([35, -4], [block], parcels);
    expect(scope?.lotIds).toEqual(["edit:drawn:0"]);
    expect(scopeArea(scope!.outline)).toBe(80);
  });

  it("drag-selects a rectangular area and every intersected lot", () => {
    const scope = scopeFromRect([5, 2], [15, 8], [block], parcels);
    expect(scope?.kind).toBe("rectangle");
    expect(scopeArea(scope!.outline)).toBe(60);
    expect(scope?.lotIds).toEqual(["brk:lot-a", "brk:lot-b"]);
  });

  it("keeps a drag scope even where no parcel data exists", () => {
    const scope = scopeFromRect([50, 50], [60, 60], [], []);
    expect(scope).toMatchObject({ kind: "rectangle", lotIds: [] });
  });

  it("does not count a parcel whose collinear edges are spatially disjoint", () => {
    const scope = scopeFromRect([30, 0], [40, 10], [], parcels);
    expect(scope?.lotIds).toEqual([]);
  });
});
