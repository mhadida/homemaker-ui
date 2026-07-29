import { describe, expect, it } from "vitest";
import type { CadastralParcel } from "./cadastralParcels";
import {
  applyParcelSubdivisionEdits,
  autoParcelCountForArea,
  autoSplitCadastralParcel,
  mergeCadastralParcels,
  nearestParcelBoundaryPoint,
  recordParcelMerge,
  recordParcelSplit,
  splitCadastralParcel,
} from "./parcelSubdivision";

const square: CadastralParcel = {
  id: "NL.TEST",
  polygons: [
    [
      [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
    ],
  ],
};

describe("nearestParcelBoundaryPoint", () => {
  it("snaps to the closest boundary segment", () => {
    expect(nearestParcelBoundaryPoint([7, 4], square.polygons[0][0])).toMatchObject({
      point: [7, 0],
      edge: 0,
      distance: 4,
    });
  });
});

describe("splitCadastralParcel", () => {
  it("splits a simple parcel between snapped opposite edges", () => {
    const result = splitCadastralParcel(
      square,
      square.polygons[0][0],
      [10, -3],
      [10, 14],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapped).toEqual([
      [10, 0],
      [10, 10],
    ]);
    expect(result.parcels.map((p) => p.area)).toEqual([100, 100]);
    expect(result.parcels.map((p) => p.id)).toEqual(["NL.TEST~1", "NL.TEST~2"]);
  });

  it("preserves a hole on the side that contains it", () => {
    const withHole: CadastralParcel = {
      ...square,
      polygons: [
        [
          square.polygons[0][0],
          [
            [2, 2],
            [4, 2],
            [4, 4],
            [2, 4],
          ],
        ],
      ],
    };
    const result = splitCadastralParcel(
      withHole,
      withHole.polygons[0][0],
      [10, 0],
      [10, 10],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parcels.map((p) => p.polygons[0].length).sort()).toEqual([1, 2]);
    expect(result.parcels.reduce((sum, p) => sum + (p.area ?? 0), 0)).toBe(196);
  });

  it("rejects a cut across the same edge or through a concave exterior", () => {
    expect(
      splitCadastralParcel(square, square.polygons[0][0], [2, 0], [18, 0]).ok,
    ).toBe(false);
    const concave: CadastralParcel = {
      id: "concave",
      polygons: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [6, 10],
            [6, 3],
            [4, 3],
            [4, 10],
            [0, 10],
          ],
        ],
      ],
    };
    expect(
      splitCadastralParcel(
        concave,
        concave.polygons[0][0],
        [2, 10],
        [8, 10],
      ).ok,
    ).toBe(false);
  });

  it("rejects slivers and disconnected source parcels", () => {
    expect(
      splitCadastralParcel(square, square.polygons[0][0], [0.1, 0], [0.1, 10])
        .ok,
    ).toBe(false);
    expect(
      splitCadastralParcel(
        { ...square, polygons: [...square.polygons, ...square.polygons] },
        square.polygons[0][0],
        [10, 0],
        [10, 10],
      ),
    ).toEqual({
      ok: false,
      error: "Disconnected parcels cannot be split yet.",
    });
  });

  it("records repeated child splits as one sparse source override", () => {
    const first = splitCadastralParcel(
      square,
      square.polygons[0][0],
      [10, 0],
      [10, 10],
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const edits = recordParcelSplit([], square, first.parcels);
    const child = first.parcels[0];
    const second = splitCadastralParcel(
      child,
      child.polygons[0][0],
      [10, 5],
      [20, 5],
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const repeated = recordParcelSplit(edits, child, second.parcels);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].sourceId).toBe(square.id);
    expect(repeated[0].replacements).toHaveLength(3);
    expect(applyParcelSubdivisionEdits([square], repeated)).toEqual(
      repeated[0].replacements,
    );
  });
});

describe("autoSplitCadastralParcel", () => {
  it("creates the requested number of approximately equal parcels", () => {
    const result = autoSplitCadastralParcel(
      square,
      square.polygons[0][0],
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parcels).toHaveLength(5);
    expect(
      result.parcels.reduce((sum, parcel) => sum + (parcel.area ?? 0), 0),
    ).toBeCloseTo(200);
    for (const parcel of result.parcels)
      expect(parcel.area).toBeCloseTo(40, 0);
  });

  it("derives the nearest practical count from a target area", () => {
    expect(autoParcelCountForArea(200, 42)).toBe(5);
    expect(autoParcelCountForArea(200, 500)).toBe(1);
    expect(autoParcelCountForArea(200, 0)).toBe(1);
  });

  it("rejects unsafe counts and disconnected sources", () => {
    expect(
      autoSplitCadastralParcel(square, square.polygons[0][0], 1),
    ).toEqual({ ok: false, error: "Choose between 2 and 50 parcels." });
    expect(
      autoSplitCadastralParcel(
        { ...square, polygons: [...square.polygons, ...square.polygons] },
        square.polygons[0][0],
        2,
      ),
    ).toEqual({
      ok: false,
      error: "Disconnected parcels cannot be split automatically.",
    });
  });
});

describe("mergeCadastralParcels", () => {
  const left: CadastralParcel = {
    id: "left",
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
  };
  const right: CadastralParcel = {
    id: "right",
    polygons: [
      [
        [
          [10, 0],
          [20, 0],
          [20, 10],
          [10, 10],
          [10, 5],
        ],
      ],
    ],
  };

  it("removes a shared boundary even when one side segments it differently", () => {
    const result = mergeCadastralParcels([left, right]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parcel.area).toBeCloseTo(200);
    expect(result.parcel.polygons).toHaveLength(1);
    expect(result.parcel.polygons[0]).toHaveLength(1);
  });

  it("rejects disconnected parcels", () => {
    const result = mergeCadastralParcels([
      left,
      {
        ...right,
        id: "far",
        polygons: [
          [
            right.polygons[0][0].map(
              ([x, z]) => [x + 10, z] as [number, number],
            ),
          ],
        ],
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("records one replacement owner and removes the other source on reload", () => {
    const result = mergeCadastralParcels([left, right]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edits = recordParcelMerge([], [left, right], result.parcel);
    expect(applyParcelSubdivisionEdits([left, right], edits)).toEqual([
      result.parcel,
    ]);
  });
});
