import { describe, expect, it } from "vitest";
import {
  cadastralBoundaryRings,
  cadastralPlotForFootprint,
  pdokToCadastralParcels,
  type CadastralParcel,
  type PdokParcelFeature,
} from "./cadastralParcels";

const anchor = { lat0: 52, lon0: 5 };

describe("pdokToCadastralParcels", () => {
  it("projects a BRK MultiPolygon and preserves its cadastral identity", () => {
    const feature: PdokParcelFeature = {
      id: "uuid",
      properties: {
        identificatie_lokaal_id: "parcel-42",
        kadastrale_gemeente_waarde: "Catharijne",
        sectie: "B",
        perceelnummer: 42,
        kadastrale_grootte_waarde: 95,
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [5, 52],
              [5.001, 52],
              [5.001, 52.001],
              [5, 52],
            ],
          ],
        ],
      },
    };
    const parcels = pdokToCadastralParcels([feature], anchor);
    expect(parcels).toHaveLength(1);
    expect(parcels[0]).toMatchObject({
      id: "parcel-42",
      municipality: "Catharijne",
      section: "B",
      number: 42,
      area: 95,
    });
    expect(parcels[0].polygons[0][0]).toHaveLength(3);
    expect(parcels[0].polygons[0][0][0]).toEqual([0, 0]);
  });

  it("retains exterior and hole rings as drawable boundaries", () => {
    const feature: PdokParcelFeature = {
      id: "with-hole",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [5, 52],
            [5.002, 52],
            [5.002, 52.002],
            [5, 52],
          ],
          [
            [5.0005, 52.0005],
            [5.001, 52.0005],
            [5.001, 52.001],
            [5.0005, 52.0005],
          ],
        ],
      },
    };
    const parcels = pdokToCadastralParcels([feature], anchor);
    expect(cadastralBoundaryRings(parcels)).toHaveLength(2);
  });

  it("drops malformed or unsupported geometry", () => {
    expect(
      pdokToCadastralParcels(
        [
          { id: "point", geometry: { type: "Point", coordinates: [5, 52] } },
          {
            id: "bad-ring",
            geometry: {
              type: "Polygon",
              coordinates: [[[5, 52], [5.001, 52]]],
            },
          },
        ],
        anchor,
      ),
    ).toEqual([]);
  });

  it("resolves a building to its containing parcel, not its own footprint", () => {
    const parcels: CadastralParcel[] = [
      {
        id: "parcel-a",
        polygons: [
          [
            [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
            ],
          ],
        ],
      },
    ];
    const building = [
      [5, 5],
      [10, 5],
      [10, 10],
      [5, 10],
    ] as [number, number][];
    const plot = cadastralPlotForFootprint(building, parcels);
    expect(plot?.id).toBe("parcel-a");
    expect(plot?.outline).toEqual(parcels[0].polygons[0][0]);
    expect(plot?.outline).not.toEqual(building);
  });

  it("returns null when no property boundary contains the building", () => {
    const parcels: CadastralParcel[] = [
      {
        id: "elsewhere",
        polygons: [
          [
            [
              [100, 100],
              [110, 100],
              [110, 110],
              [100, 110],
            ],
          ],
        ],
      },
    ];
    expect(
      cadastralPlotForFootprint(
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
        parcels,
      ),
    ).toBeNull();
  });
});
