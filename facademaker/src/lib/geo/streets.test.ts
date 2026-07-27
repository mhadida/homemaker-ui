import { describe, it, expect } from "vitest";
import {
  classifyWay,
  parseWidth,
  mergeWays,
  osmToStreets,
  collapseShortSegments,
  type OsmWay,
} from "./streets";
import type { GeoAnchor } from "./project";
import { MIN_STREET_SEG, deriveIntersections } from "@/lib/street/intersections";

const ANCHOR: GeoAnchor = { lat0: 52.37, lon0: 4.89 };

describe("classifyWay", () => {
  it("maps the arterial classes to boulevard", () => {
    for (const h of ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"]) {
      expect(classifyWay({ highway: h })?.type).toBe("boulevard");
    }
  });
  it("maps secondary/tertiary (+_link) to road", () => {
    for (const h of ["secondary", "secondary_link", "tertiary", "tertiary_link"]) {
      expect(classifyWay({ highway: h })?.type).toBe("road");
    }
  });
  it("maps the local classes to street", () => {
    for (const h of ["residential", "unclassified", "living_street", "busway"]) {
      expect(classifyWay({ highway: h })?.type).toBe("street");
    }
  });
  it("maps service to alley", () => {
    expect(classifyWay({ highway: "service" })?.type).toBe("alley");
  });
  it("maps pedestrian to a car-free street", () => {
    expect(classifyWay({ highway: "pedestrian" })).toEqual({ type: "street", traffic: "peds" });
  });
  it("maps waterway=canal to canal", () => {
    expect(classifyWay({ waterway: "canal" })?.type).toBe("canal");
  });
  it("drops paths, steps and anything unlisted", () => {
    for (const h of ["footway", "cycleway", "steps", "path", "construction", "raceway"]) {
      expect(classifyWay({ highway: h })).toBeNull();
    }
    expect(classifyWay(undefined)).toBeNull();
    expect(classifyWay({})).toBeNull();
  });
  it("drops a highway=*+area=yes polygon (a paved square outline, not a centreline)", () => {
    expect(classifyWay({ highway: "pedestrian", area: "yes" })).toBeNull();
    expect(classifyWay({ highway: "residential", area: "yes" })).toBeNull();
  });
  it("still classifies the same highway without area=yes", () => {
    expect(classifyWay({ highway: "pedestrian" })).toEqual({ type: "street", traffic: "peds" });
  });
});

describe("collapseShortSegments", () => {
  it("collapses interior vertices closer than minSeg, keeping first/last exactly", () => {
    const pts: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [10, 0]];
    const out = collapseShortSegments(pts, MIN_STREET_SEG);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
    // [0.5,0] is within 1m of [0,0] so it's dropped; [1,0] is exactly 1m from
    // the last KEPT vertex ([0,0]) so it survives.
    expect(out).toEqual([[0, 0], [1, 0], [10, 0]]);
  });
  it("leaves a polyline with no sub-minSeg segments untouched", () => {
    const pts: [number, number][] = [[0, 0], [5, 0], [10, 0]];
    expect(collapseShortSegments(pts, MIN_STREET_SEG)).toEqual(pts);
  });
  it("also drops a trailing kept vertex that would leave the FINAL segment short", () => {
    // [9.5,0] is far enough from [0,0] to survive the forward scan, but the
    // true endpoint [10,0] is only 0.5m beyond it — without the trailing
    // check this would still emit an 0.5m final segment.
    const pts: [number, number][] = [[0, 0], [9.5, 0], [10, 0]];
    const out = collapseShortSegments(pts, MIN_STREET_SEG);
    expect(out).toEqual([[0, 0], [10, 0]]);
  });
  it("a 2-point street shorter than minSeg end-to-end is still emitted unchanged", () => {
    const pts: [number, number][] = [[0, 0], [0.3, 0]];
    expect(collapseShortSegments(pts, MIN_STREET_SEG)).toEqual(pts);
  });
  it("collapsing an entire interior run still preserves the true endpoints exactly", () => {
    const pts: [number, number][] = [[0, 0], [0.1, 0], [0.2, 0], [0.3, 0], [20, 0]];
    const out = collapseShortSegments(pts, MIN_STREET_SEG);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([20, 0]);
  });
  it("never collapses a protected (junction) vertex even when closer than minSeg to its neighbour", () => {
    const pts: [number, number][] = [[0, 0], [0.5, 0], [10, 0]];
    // index 1 ([0.5,0]) is protected — would normally collapse (0.5m < 1m).
    const out = collapseShortSegments(pts, MIN_STREET_SEG, new Set([1]));
    expect(out).toEqual([[0, 0], [0.5, 0], [10, 0]]);
  });
  it("still collapses a non-protected sub-minSeg vertex when a DIFFERENT index is protected", () => {
    const pts: [number, number][] = [[0, 0], [0.5, 0], [0.6, 0], [10, 0]];
    // only index 2 is protected; index 1 must still collapse away.
    const out = collapseShortSegments(pts, MIN_STREET_SEG, new Set([2]));
    expect(out).toEqual([[0, 0], [0.6, 0], [10, 0]]);
  });
  it("a protected vertex near the true end survives even though it leaves a short final segment", () => {
    // Without protection this exact input collapses to [[0,0],[10,0]] — see
    // "also drops a trailing kept vertex..." above. Protecting index 1 must
    // override that trailing cleanup: a real junction is never worth
    // sacrificing to avoid a short trailing segment.
    const pts: [number, number][] = [[0, 0], [9.5, 0], [10, 0]];
    const out = collapseShortSegments(pts, MIN_STREET_SEG, new Set([1]));
    expect(out).toEqual([[0, 0], [9.5, 0], [10, 0]]);
  });
});

describe("parseWidth", () => {
  it("reads a plain, suffixed or comma-decimal width", () => {
    expect(parseWidth({ width: "12" })).toBe(12);
    expect(parseWidth({ width: "12.5 m" })).toBe(12.5);
    expect(parseWidth({ width: "12,5" })).toBe(12.5);
  });
  it("is undefined when absent or out of a sane 1..60 m range", () => {
    expect(parseWidth(undefined)).toBeUndefined();
    expect(parseWidth({})).toBeUndefined();
    expect(parseWidth({ width: "wide" })).toBeUndefined();
    expect(parseWidth({ width: "0" })).toBeUndefined();
    expect(parseWidth({ width: "-4" })).toBeUndefined();
    expect(parseWidth({ width: "500" })).toBeUndefined();
  });
});

const way = (id: number, name: string | undefined, coords: [number, number][], highway = "residential"): OsmWay => ({
  type: "way",
  id,
  tags: { highway, ...(name ? { name } : {}) },
  geometry: coords.map(([lat, lon]) => ({ lat, lon })),
});

describe("mergeWays", () => {
  it("chains two ways that share an endpoint", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 1], [0, 2]]);
    const groups = mergeWays([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((w) => w.id).sort()).toEqual([1, 2]);
  });
  it("chains a way that is stored reversed", () => {
    const a = way(1, "Herengracht", [[0, 0], [0, 1]]);
    const b = way(2, "Herengracht", [[0, 2], [0, 1]]); // shares its END with a's end
    expect(mergeWays([a, b])).toHaveLength(1);
  });
  it("chains three ways into one run", () => {
    const ws = [
      way(1, "Keizersgracht", [[0, 0], [0, 1]]),
      way(2, "Keizersgracht", [[0, 1], [0, 2]]),
      way(3, "Keizersgracht", [[0, 2], [0, 3]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
  it("never merges unnamed ways", () => {
    const a = way(1, undefined, [[0, 0], [0, 1]]);
    const b = way(2, undefined, [[0, 1], [0, 2]]);
    expect(mergeWays([a, b])).toHaveLength(2);
  });
  it("never merges different names or different types", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "B", [[0, 1], [0, 2]]),
    ])).toHaveLength(2);
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]], "residential"),
      way(2, "A", [[0, 1], [0, 2]], "primary"),
    ])).toHaveLength(2);
  });
  it("does not merge same-named ways that do not touch", () => {
    expect(mergeWays([
      way(1, "A", [[0, 0], [0, 1]]),
      way(2, "A", [[5, 5], [5, 6]]),
    ])).toHaveLength(2);
  });
  it("is order-independent", () => {
    const ws = [
      way(3, "X", [[0, 2], [0, 3]]),
      way(1, "X", [[0, 0], [0, 1]]),
      way(2, "X", [[0, 1], [0, 2]]),
    ];
    const groups = mergeWays(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

describe("osmToStreets", () => {
  it("projects through the anchor and keeps the merged run contiguous", () => {
    const ws = [
      way(1, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0], [ANCHOR.lat0, ANCHOR.lon0 + 0.001]]),
      way(2, "Herengracht", [[ANCHOR.lat0, ANCHOR.lon0 + 0.001], [ANCHOR.lat0, ANCHOR.lon0 + 0.002]]),
    ];
    const r = osmToStreets(ws, ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].points.length).toBe(3);            // 2+2 with the shared node once
    expect(r.streets[0].points[0][0]).toBeCloseTo(0, 6);   // first vertex sits at the anchor
    expect(r.streets[0].points[0][1]).toBeCloseTo(0, 6);
    expect(r.streets[0].id).toMatch(/^street-osm-1m$/);
  });
  it("ids a lone way without the merge suffix", () => {
    const r = osmToStreets([way(7, undefined, [[0, 0], [0, 1]])], ANCHOR, 100);
    expect(r.streets[0].id).toBe("street-osm-7");
  });
  it("drops path classes entirely", () => {
    const r = osmToStreets([
      way(1, "P", [[0, 0], [0, 1]], "footway"),
      way(2, "S", [[0, 0], [0, 1]], "residential"),
    ], ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].type).toBe("street");
  });
  it("skips ways with fewer than 2 vertices", () => {
    const r = osmToStreets([{ type: "way", id: 1, tags: { highway: "residential" }, geometry: [{ lat: 0, lon: 0 }] }], ANCHOR, 100);
    expect(r.streets).toHaveLength(0);
  });
  it("caps at maxStreets and reports the pre-cap total", () => {
    const ws = Array.from({ length: 5 }, (_, i) => way(i + 1, undefined, [[i, 0], [i, 1]]));
    const r = osmToStreets(ws, ANCHOR, 3);
    expect(r.streets).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(5);
  });
  it("carries a sane width tag through and omits an insane one", () => {
    const wide = way(1, undefined, [[0, 0], [0, 1]]);
    wide.tags!.width = "18";
    const junk = way(2, undefined, [[1, 0], [1, 1]]);
    junk.tags!.width = "999";
    const r = osmToStreets([wide, junk], ANCHOR, 10);
    expect(r.streets.find((s) => s.id === "street-osm-1")!.width).toBe(18);
    expect(r.streets.find((s) => s.id === "street-osm-2")!.width).toBeUndefined();
  });
  it("drops highway=*+area=yes polygons (pedestrian squares) entirely", () => {
    const square = way(1, "Dam Square", [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]], "pedestrian");
    square.tags!.area = "yes";
    const real = way(2, "Real Street", [[5, 5], [5, 6]]);
    const r = osmToStreets([square, real], ANCHOR, 100);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].id).toBe("street-osm-2");
  });
  it("collapses a sub-MIN_STREET_SEG vertex introduced by real OSM geometry", () => {
    // ~6.8cm at this latitude (well under MIN_STREET_SEG) between the first
    // two points — real OSM ways regularly have these (measured: 71 such
    // segments across 22 of 227 streets in a real import, min 5.6cm). The
    // third point is ~1.1km further — a real segment that must survive.
    const r = osmToStreets(
      [way(1, undefined, [
        [ANCHOR.lat0, ANCHOR.lon0],
        [ANCHOR.lat0, ANCHOR.lon0 + 0.000001],
        [ANCHOR.lat0, ANCHOR.lon0 + 0.01],
      ])],
      ANCHOR,
      100,
    );
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].points).toHaveLength(2); // the sub-1m vertex collapsed away
    expect(r.streets[0].points[0][0]).toBeCloseTo(0, 6); // first vertex preserved exactly
    expect(r.streets[0].points[0][1]).toBeCloseTo(0, 6);
  });
  it("a 2-point way shorter than MIN_STREET_SEG is still emitted, not dropped", () => {
    // ~0.5m at this latitude — collapseShortSegments never drops a 2-point
    // input; osmToStreets doesn't filter on length either.
    const r = osmToStreets(
      [way(1, undefined, [[ANCHOR.lat0, ANCHOR.lon0], [ANCHOR.lat0, ANCHOR.lon0 + 0.000005]])],
      ANCHOR,
      100,
    );
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].points).toHaveLength(2);
  });
  it("caps by descending polyline length, keeping a merged named street over an unnamed stub", () => {
    const stub = way(99, undefined, [[0, 0], [0, 0.00001]]); // ~1.1m unnamed stub
    const a = way(1, "Lang Street", [[10, 10], [10, 10.01]]);
    const b = way(2, "Lang Street", [[10, 10.01], [10, 10.02]]); // merges with `a` into ~2.2km
    const r = osmToStreets([stub, a, b], ANCHOR, 1);
    expect(r.total).toBe(2); // stub + merged chain
    expect(r.truncated).toBe(true);
    expect(r.streets).toHaveLength(1);
    expect(r.streets[0].id).toBe("street-osm-1m"); // the merged chain survives, not the stub
  });

  // Regression guard for the junction-aware collapse: OSM splits ways exactly
  // at real crossings, so a merged chain's interior vertex is frequently
  // precisely where a different street/bridge/canal meets it. If that vertex
  // sits within MIN_STREET_SEG of its neighbour on the SAME chain — exactly
  // the population the plain collapse fix targets — a junction-BLIND collapse
  // deletes it, and the junction silently disappears (deriveIntersections
  // stops finding it, moveStreetNode stops treating the two streets as
  // welded). This test mirrors that exact scenario.
  it("never collapses a real cross-street junction, even close to its neighbour and off-line — while an ordinary short vertex on the same chain still collapses", () => {
    // Local layout after `project` (informally): A=(0,0) --~99.6m--> J --~0.4m--> B=(100,0).
    // J sits ~5cm off the straight A–B line (ordinary GPS/curvature noise)
    // and ~0.4m from B, its neighbour in the merged "Kade Straat" chain — too
    // far off-line for deriveIntersections' T-junction fallback to rescue
    // (5cm >> ON_SEG_EPS). A THIRD way ("Kanaal") shares J's exact raw
    // coordinate — a genuine OSM-style shared junction node.
    const M_PER_DEG_LAT = (Math.PI / 180) * 6378137; // same R as project()
    const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ANCHOR.lat0 * Math.PI) / 180);
    const jLat = ANCHOR.lat0 + 0.05 / M_PER_DEG_LAT; // ~5cm off-line
    const jLon = ANCHOR.lon0 + 99.6 / M_PER_DEG_LON; // ~99.6m east
    const J: [number, number] = [jLat, jLon];
    const A: [number, number] = [ANCHOR.lat0, ANCHOR.lon0];
    const B: [number, number] = [ANCHOR.lat0, ANCHOR.lon0 + 100 / M_PER_DEG_LON]; // ~100m east
    const C: [number, number] = [ANCHOR.lat0 + 50 / M_PER_DEG_LAT, jLon]; // ~50m further, off "Kanaal"
    // An ordinary, non-shared extra vertex ~7cm from A — nothing else
    // touches it, so it must still collapse away exactly as before this fix.
    const extra: [number, number] = [ANCHOR.lat0, ANCHOR.lon0 + 0.07 / M_PER_DEG_LON];

    const chainA = way(1, "Kade Straat", [A, extra, J]);
    const chainB = way(2, "Kade Straat", [J, B]);
    const crossing = way(3, "Kanaal", [J, C]);

    const r = osmToStreets([chainA, chainB, crossing], ANCHOR, 100);
    expect(r.streets).toHaveLength(2);

    const kade = r.streets.find((s) => s.id === "street-osm-1m")!;
    // `extra` collapsed away (an ordinary short vertex, no junction there);
    // `J` survives (a real junction) despite being CLOSER to B than `extra`
    // was to A.
    expect(kade.points).toHaveLength(3); // A, J, B

    const is = deriveIntersections({ streets: r.streets, roundabouts: [] });
    expect(is.some((i) => i.kind === "node")).toBe(true);
  });
});
