import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Heightfield } from "@/lib/facade/terrain";
import type { ContextBuilding } from "./buildings";
import {
  cadastralPlotForFootprint,
  type CadastralParcel,
} from "./cadastralParcels";
import type { Street } from "@/lib/street/types";
import { effectiveWidth } from "@/lib/street/types";
import { normalizeImportedStreetWidths } from "./streets";
import { project } from "./project";
import {
  DEMO_ANCHOR,
  DEMO_BBOX,
  DEMO_BUILDINGS_URL,
  DEMO_PLACES,
  DEMO_STREETS_URL,
  DEMO_TERRAIN_URL,
  UTRECHT_DEMO_PLACE,
  demoPlaceForFrame,
  isDemoPlaceFrame,
} from "./demoPlace";

// Reads the committed fixture files straight off disk (this is a Node-
// environment vitest run, not a browser — DEMO_*_URL are the runtime fetch
// paths the app uses; here we map them onto public/ directly).
const PUBLIC_DIR = path.resolve(__dirname, "../../../public");
const readFixture = (url: string) =>
  JSON.parse(
    readFileSync(path.join(PUBLIC_DIR, url.replace(/^\//, "")), "utf8"),
  ) as unknown;

function sustainedParallelOverlapCount(streets: Street[]): number {
  const segments = streets.flatMap((street) =>
    street.type === "canal"
      ? []
      : street.points.slice(0, -1).map((a, i) => ({
          street,
          a,
          b: street.points[i + 1],
        })),
  );
  let overlaps = 0;
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const adx = a.b[0] - a.a[0];
    const adz = a.b[1] - a.a[1];
    const al = Math.hypot(adx, adz);
    if (al < 1e-6) continue;
    const ux = adx / al;
    const uz = adz / al;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.street.id === b.street.id) continue;
      const bdx = b.b[0] - b.a[0];
      const bdz = b.b[1] - b.a[1];
      const bl = Math.hypot(bdx, bdz);
      if (bl < 1e-6) continue;
      if (
        Math.abs(ux * (bdz / bl) - uz * (bdx / bl)) >
        Math.sin((3 * Math.PI) / 180)
      )
        continue;
      const side = (p: [number, number]) =>
        (p[0] - a.a[0]) * -uz + (p[1] - a.a[1]) * ux;
      const d0 = side(b.a);
      const d1 = side(b.b);
      if (d0 * d1 < 0) continue;
      const separation = Math.min(Math.abs(d0), Math.abs(d1));
      const along = (p: [number, number]) =>
        (p[0] - a.a[0]) * ux + (p[1] - a.a[1]) * uz;
      const t0 = along(b.a);
      const t1 = along(b.b);
      const run =
        Math.min(al, Math.max(t0, t1)) -
        Math.max(0, Math.min(t0, t1));
      if (run < 8) continue;
      if (
        (effectiveWidth(a.street) + effectiveWidth(b.street)) / 2 >
        separation + 0.01
      )
        overlaps++;
    }
  }
  return overlaps;
}

describe("demoPlace fixtures", () => {
  it("recognizes only the exact serialized demo projection frame", () => {
    expect(isDemoPlaceFrame(DEMO_BBOX, DEMO_ANCHOR)).toBe(true);
    expect(
      isDemoPlaceFrame(
        UTRECHT_DEMO_PLACE.bbox,
        UTRECHT_DEMO_PLACE.anchor,
      ),
    ).toBe(true);
    expect(
      demoPlaceForFrame(
        UTRECHT_DEMO_PLACE.bbox,
        UTRECHT_DEMO_PLACE.anchor,
      )?.id,
    ).toBe("utrecht");
    expect(
      isDemoPlaceFrame(
        { ...DEMO_BBOX, west: DEMO_BBOX.west + 0.0001 },
        DEMO_ANCHOR,
      ),
    ).toBe(false);
    expect(isDemoPlaceFrame(DEMO_BBOX, null)).toBe(false);
  });

  it("terrain.json exists, parses, and has the exact shape /api/terrain returns", () => {
    const json = readFixture(DEMO_TERRAIN_URL) as { heightfield: Heightfield };
    expect(json.heightfield).toBeDefined();
    const hf = json.heightfield;
    expect(typeof hf.originX).toBe("number");
    expect(typeof hf.originZ).toBe("number");
    expect(typeof hf.spacing).toBe("number");
    expect(Array.isArray(hf.data)).toBe(true);
    // Pinned exactly: a different capture (different bbox/zoom) would
    // silently misalign the terrain under the buildings/streets below.
    expect(hf.cols).toBe(128);
    expect(hf.rows).toBe(79);
    expect(hf.data.length).toBe(hf.cols * hf.rows);
  });

  it("buildings.json exists, parses, and has the exact shape /api/buildings returns", () => {
    const json = readFixture(DEMO_BUILDINGS_URL) as {
      buildings: ContextBuilding[];
      truncated: boolean;
      total: number;
    };
    expect(Array.isArray(json.buildings)).toBe(true);
    expect(json.truncated).toBe(false);
    // Pinned count: a re-capture against a different bbox/anchor would
    // silently corrupt geometry alignment without a count regression here.
    expect(json.buildings.length).toBe(1585);
    expect(json.total).toBe(1585);
    for (const b of json.buildings) {
      expect(typeof b.id).toBe("string");
      expect(Array.isArray(b.footprint)).toBe(true);
      expect(b.footprint.length).toBeGreaterThan(0);
      expect(typeof b.height).toBe("number");
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it("streets.json exists, parses, and has the exact shape /api/streets returns", () => {
    const json = readFixture(DEMO_STREETS_URL) as {
      streets: Street[];
      truncated: boolean;
      total: number;
    };
    expect(Array.isArray(json.streets)).toBe(true);
    expect(json.truncated).toBe(false);
    expect(json.streets.length).toBe(212);
    expect(json.total).toBe(212);
  });

  it("parcels.json contains real BRK property boundaries", () => {
    const json = readFixture(DEMO_PLACES[0].parcelsUrl) as {
      parcels: CadastralParcel[];
      truncated: boolean;
    };
    expect(json.truncated).toBe(false);
    expect(json.parcels.length).toBe(1753);
    for (const parcel of json.parcels) {
      expect(typeof parcel.id).toBe("string");
      expect(parcel.polygons.length).toBeGreaterThan(0);
      expect(parcel.polygons[0][0].length).toBeGreaterThanOrEqual(3);
    }
  });

  it("places every imported building footprint inside a cadastral lot", () => {
    const buildings = (
      readFixture(DEMO_BUILDINGS_URL) as { buildings: ContextBuilding[] }
    ).buildings;
    const parcels = (
      readFixture(DEMO_PLACES[0].parcelsUrl) as {
        parcels: CadastralParcel[];
      }
    ).parcels;
    const outside = buildings.filter(
      (building) =>
        cadastralPlotForFootprint(building.footprint, parcels) === null,
    );
    expect(outside.map((building) => building.id)).toEqual([]);
  });

  it("has at least one canal — the visually distinctive part of this area", () => {
    const json = readFixture(DEMO_STREETS_URL) as { streets: Street[] };
    const canals = json.streets.filter((s) => s.type === "canal");
    expect(canals.length).toBeGreaterThan(0);
  });

  it("normalizes historical OSM widths without any sustained parallel ribbon overlap", () => {
    const json = readFixture(DEMO_STREETS_URL) as { streets: Street[] };
    const normalized = normalizeImportedStreetWidths(json.streets);
    expect(sustainedParallelOverlapCount(normalized)).toBe(0);
  });

  it("DEMO_ANCHOR/DEMO_BBOX match the geometry terrain.json was actually captured against", () => {
    // resampleToGrid (src/lib/geo/dem.ts) sets heightfield.origin{X,Z} to
    // project(bbox.south, bbox.west, anchor) — recomputing that here with
    // demoPlace.ts's own constants and comparing against the committed
    // fixture directly proves the two are still in lockstep. If DEMO_ANCHOR
    // or DEMO_BBOX drift from what the fixture was captured for (edited
    // without recapturing), the origin no longer lines up and this fails.
    const json = readFixture(DEMO_TERRAIN_URL) as { heightfield: Heightfield };
    const [xW, zS] = project(DEMO_BBOX.south, DEMO_BBOX.west, DEMO_ANCHOR);
    expect(xW).toBeCloseTo(json.heightfield.originX, 6);
    expect(zS).toBeCloseTo(json.heightfield.originZ, 6);
  });
});

describe("Utrecht demo fixture", () => {
  const place = UTRECHT_DEMO_PLACE;

  it("has the pinned terrain shape and projection origin", () => {
    const json = readFixture(place.terrainUrl) as {
      heightfield: Heightfield;
    };
    const hf = json.heightfield;
    expect(hf.cols).toBe(128);
    expect(hf.rows).toBe(99);
    expect(hf.data.length).toBe(hf.cols * hf.rows);
    const [xW, zS] = project(place.bbox.south, place.bbox.west, place.anchor);
    expect(xW).toBeCloseTo(hf.originX, 6);
    expect(zS).toBeCloseTo(hf.originZ, 6);
  });

  it("contains the pinned Smakkelaarsveld building snapshot", () => {
    const json = readFixture(place.buildingsUrl) as {
      buildings: ContextBuilding[];
      truncated: boolean;
      total: number;
    };
    expect(json.truncated).toBe(false);
    expect(json.buildings.length).toBe(637);
    expect(json.total).toBe(637);
    for (const building of json.buildings) {
      expect(typeof building.id).toBe("string");
      expect(building.footprint.length).toBeGreaterThan(0);
      expect(building.height).toBeGreaterThan(0);
    }
  });

  it("contains the pinned street/canal snapshot without ribbon overlap", () => {
    const json = readFixture(place.streetsUrl) as {
      streets: Street[];
      truncated: boolean;
      total: number;
    };
    expect(json.truncated).toBe(false);
    expect(json.streets.length).toBe(125);
    expect(json.total).toBe(125);
    expect(json.streets.filter((street) => street.type === "canal").length).toBe(
      2,
    );
    expect(sustainedParallelOverlapCount(json.streets)).toBe(0);
  });

  it("contains the Smakkelaarsveld BRK parcel snapshot", () => {
    const json = readFixture(place.parcelsUrl) as {
      parcels: CadastralParcel[];
      truncated: boolean;
    };
    expect(json.truncated).toBe(false);
    expect(json.parcels.length).toBe(577);
    expect(
      json.parcels.every((parcel) => parcel.polygons.length > 0),
    ).toBe(true);
  });

  it("places every Utrecht building footprint inside a cadastral lot", () => {
    const buildings = (
      readFixture(place.buildingsUrl) as { buildings: ContextBuilding[] }
    ).buildings;
    const parcels = (
      readFixture(place.parcelsUrl) as { parcels: CadastralParcel[] }
    ).parcels;
    const outside = buildings.filter(
      (building) =>
        cadastralPlotForFootprint(building.footprint, parcels) === null,
    );
    expect(outside.map((building) => building.id)).toEqual([]);
  });
});
