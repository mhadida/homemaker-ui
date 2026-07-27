import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Heightfield } from "@/lib/facade/terrain";
import type { ContextBuilding } from "./buildings";
import type { Street } from "@/lib/street/types";
import { project } from "./project";
import {
  DEMO_ANCHOR,
  DEMO_BBOX,
  DEMO_BUILDINGS_URL,
  DEMO_STREETS_URL,
  DEMO_TERRAIN_URL,
  isDemoPlaceFrame,
} from "./demoPlace";

// Reads the committed fixture files straight off disk (this is a Node-
// environment vitest run, not a browser — DEMO_*_URL are the runtime fetch
// paths the app uses; here we map them onto public/ directly).
const FIXTURE_DIR = path.resolve(__dirname, "../../../public/fixtures/amsterdam");
const readFixture = (url: string) =>
  JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, path.basename(url)), "utf8"),
  ) as unknown;

describe("demoPlace fixtures", () => {
  it("recognizes only the exact serialized demo projection frame", () => {
    expect(isDemoPlaceFrame(DEMO_BBOX, DEMO_ANCHOR)).toBe(true);
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

  it("has at least one canal — the visually distinctive part of this area", () => {
    const json = readFixture(DEMO_STREETS_URL) as { streets: Street[] };
    const canals = json.streets.filter((s) => s.type === "canal");
    expect(canals.length).toBeGreaterThan(0);
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
