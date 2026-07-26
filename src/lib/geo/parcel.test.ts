import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Street, StreetNetwork } from "@/lib/street/types";
import { EMPTY_NETWORK } from "@/lib/street/types";
import type { ContextBuilding } from "./buildings";
import type { Vec2 } from "./parcel";
import {
  CHAIN_TOLERANCE_DEG,
  edgeChains,
  fitFrontage,
  MIN_FRONTAGE,
  parcelArea,
  signedArea,
} from "./parcel";

// A unit square wound CCW by the (x, z) shoelace convention.
const SQUARE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const L_SHAPE: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 1],
  [2, 1],
  [2, 3],
  [0, 3],
];

describe("parcelArea", () => {
  it("measures a unit square", () => {
    expect(parcelArea(SQUARE)).toBeCloseTo(1, 9);
  });

  it("is winding-independent", () => {
    expect(parcelArea([...SQUARE].reverse())).toBeCloseTo(1, 9);
  });

  it("measures a non-convex L correctly (12 - 4 = 8)", () => {
    expect(parcelArea(L_SHAPE)).toBeCloseTo(8, 9);
  });

  it("is zero for a degenerate outline", () => {
    expect(
      parcelArea([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBeCloseTo(0, 9);
  });
});

describe("signedArea", () => {
  it("is positive for CCW and negative for CW", () => {
    expect(signedArea(SQUARE)).toBeGreaterThan(0);
    expect(signedArea([...SQUARE].reverse())).toBeLessThan(0);
  });
});

describe("edgeChains", () => {
  it("gives one chain per side of a rectangle", () => {
    expect(edgeChains(SQUARE)).toHaveLength(4);
  });

  it("merges a collinear midpoint back into its side", () => {
    // Same square, but the bottom edge is split by an extra vertex.
    const split: Vec2[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const chains = edgeChains(split);
    expect(chains).toHaveLength(4);
    const bottom = chains.find((c) => c.idx.length === 2);
    expect(bottom).toBeDefined();
    expect(bottom!.a).toEqual([0, 0]);
    expect(bottom!.b).toEqual([1, 0]);
  });

  it("gives six chains for an L-shape", () => {
    expect(edgeChains(L_SHAPE)).toHaveLength(6);
  });

  it("merges just inside the tolerance and splits just outside it", () => {
    const at = (deg: number): Vec2[] => {
      const r = (deg * Math.PI) / 180;
      // Two edges meeting at `deg` of turn, closed by a return leg.
      return [
        [0, 0],
        [10, 0],
        [10 + 10 * Math.cos(r), 10 * Math.sin(r)],
        [5, -8],
      ];
    };
    const inside = edgeChains(at(CHAIN_TOLERANCE_DEG - 1));
    const outside = edgeChains(at(CHAIN_TOLERANCE_DEG + 1));
    expect(outside.length).toBeGreaterThan(inside.length);
  });

  it("gives the same chain count for both windings", () => {
    expect(edgeChains([...L_SHAPE].reverse())).toHaveLength(
      edgeChains(L_SHAPE).length,
    );
  });

  it("returns one chain per edge for a smooth ring with no corner", () => {
    // A 36-gon turns 10 degrees at every vertex — inside the 20 degree
    // tolerance everywhere, so there is no natural break to start from.
    const ring: Vec2[] = Array.from({ length: 36 }, (_, i) => {
      const t = (i / 36) * Math.PI * 2;
      return [Math.cos(t) * 10, Math.sin(t) * 10] as Vec2;
    });
    const chains = edgeChains(ring);
    expect(chains).toHaveLength(36);
    // Critically, none of them is a zero-length wrap-around.
    for (const c of chains) {
      expect(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])).toBeGreaterThan(0.1);
    }
  });

  it("returns nothing for fewer than three vertices", () => {
    expect(
      edgeChains([
        [0, 0],
        [1, 0],
      ]),
    ).toEqual([]);
  });
});

/** A single straight street running east-west at the given z. */
const streetAtZ = (z: number): StreetNetwork => ({
  ...EMPTY_NETWORK,
  streets: [
    {
      id: "s1",
      type: "street",
      points: [
        [-50, z],
        [50, z],
      ],
    },
  ],
});

/** Resolve the outward normal a FrontageFit implies, mirroring blockFrame:
 * the endpoints are read in reverse when `flipped`, which negates it. */
function normalOf(fit: { line: { a: Vec2; b: Vec2 }; flipped: boolean }): Vec2 {
  const a = fit.flipped ? fit.line.b : fit.line.a;
  const b = fit.flipped ? fit.line.a : fit.line.b;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-(dz / l), dx / l];
}

// A 10 x 6 plot, wound CCW, sitting with its long sides east-west.
const PLOT: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 6],
  [0, 6],
];

describe("fitFrontage", () => {
  it("faces a street to the south", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    expect(fit).not.toBeNull();
    const n = normalOf(fit);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(-1, 6);
  });

  it("faces a street to the north", () => {
    const fit = fitFrontage(PLOT, streetAtZ(14))!;
    const n = normalOf(fit);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(1, 6);
  });

  it("leaves the line endpoints unswapped and uses `flipped` for facing", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    // The winning chain is the south edge, in ring order (0,0) -> (10,0).
    expect(fit.line.a).toEqual([0, 0]);
    expect(fit.line.b).toEqual([10, 0]);
    expect(fit.flipped).toBe(true);
  });

  it("gives the same facing for a CW-wound copy of the same plot", () => {
    const cw = fitFrontage([...PLOT].reverse(), streetAtZ(-8))!;
    const n = normalOf(cw);
    expect(n[1]).toBeCloseTo(-1, 6);
  });

  it("falls back to the longest chain with no network", () => {
    const fit = fitFrontage(PLOT, null)!;
    // Long sides are 10 m, short sides 6 m.
    const width = Math.hypot(
      fit.line.b[0] - fit.line.a[0],
      fit.line.b[1] - fit.line.a[1],
    );
    expect(width).toBeCloseTo(10, 6);
  });

  it("treats an empty network the same as no network", () => {
    const a = fitFrontage(PLOT, null)!;
    const b = fitFrontage(PLOT, EMPTY_NETWORK)!;
    expect(b.line).toEqual(a.line);
    expect(b.flipped).toBe(a.flipped);
  });

  it("measures depth as the perpendicular extent of the plot", () => {
    const fit = fitFrontage(PLOT, streetAtZ(-8))!;
    expect(fit.depth).toBeCloseTo(6, 6);
  });

  it("measures depth over ALL vertices, not just the frontage chain's", () => {
    // An L whose deep leg is nowhere near the frontage chain.
    const L: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [3, 4],
      [3, 20],
      [0, 20],
    ];
    const fit = fitFrontage(L, streetAtZ(-8))!;
    expect(fit.depth).toBeCloseTo(20, 6);
  });

  it("puts the facade on a canal house's NARROW end, not its party wall", () => {
    // The defining Amsterdam case and the one length-only scoring gets
    // wrong: 6 m of frontage against 25 m of side wall. If the long side
    // ever wins here, every promoted canal house faces its neighbour.
    const canalHouse: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 25],
      [0, 25],
    ];
    const fit = fitFrontage(canalHouse, streetAtZ(-2))!;
    const width = Math.hypot(
      fit.line.b[0] - fit.line.a[0],
      fit.line.b[1] - fit.line.a[1],
    );
    expect(width).toBeCloseTo(6, 6);
    expect(fit.depth).toBeCloseTo(25, 6);
    expect(normalOf(fit)[1]).toBeCloseTo(-1, 6);
  });

  it("prefers a shorter facing edge over a longer edge running away", () => {
    // Same shape, street along the long side instead — now the 25 m edge is
    // correct, so this is not just "always pick the short one".
    const plot: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 25],
      [0, 25],
    ];
    const network: StreetNetwork = {
      ...EMPTY_NETWORK,
      streets: [
        {
          id: "s1",
          type: "street",
          points: [
            [-3, -20],
            [-3, 45],
          ],
        },
      ],
    };
    const fit = fitFrontage(plot, network)!;
    const width = Math.hypot(
      fit.line.b[0] - fit.line.a[0],
      fit.line.b[1] - fit.line.a[1],
    );
    expect(width).toBeCloseTo(25, 6);
    expect(normalOf(fit)[0]).toBeCloseTo(-1, 6);
  });

  it("returns depth UNCLAMPED so promoteParcel owns the clamp", () => {
    const deep: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 40],
      [0, 40],
    ];
    expect(fitFrontage(deep, streetAtZ(-8))!.depth).toBeCloseTo(40, 6);
    const shallow: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 1],
      [0, 1],
    ];
    expect(fitFrontage(shallow, streetAtZ(-8))!.depth).toBeCloseTo(1, 6);
  });

  it("rejects a polygon that cannot carry a facade", () => {
    expect(
      fitFrontage(
        [
          [0, 0],
          [1, 0],
        ],
        null,
      ),
    ).toBeNull();
    expect(
      fitFrontage(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        null,
      ),
    ).toBeNull();
    const tiny: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(MIN_FRONTAGE).toBe(2);
    expect(fitFrontage(tiny, null)).toBeNull();
  });
});

const FIXTURE_DIR = path.resolve(__dirname, "../../../public/fixtures/amsterdam");
const readFixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as unknown;

describe("fitFrontage against the real Amsterdam fixture", () => {
  const buildings = (
    readFixture("buildings.json") as { buildings: ContextBuilding[] }
  ).buildings;
  const network: StreetNetwork = {
    ...EMPTY_NETWORK,
    streets: (readFixture("streets.json") as { streets: Street[] }).streets,
  };

  it("resolves a frontage for at least 99% of real footprints", () => {
    const fits = buildings.map((b) => fitFrontage(b.footprint as Vec2[], network));
    const ok = fits.filter(Boolean).length;
    expect(ok / buildings.length).toBeGreaterThanOrEqual(0.99);
  });

  it("never returns a NaN, infinite or negative-depth fit", () => {
    for (const b of buildings) {
      const fit = fitFrontage(b.footprint as Vec2[], network);
      if (!fit) continue;
      for (const v of [
        fit.line.a[0],
        fit.line.a[1],
        fit.line.b[0],
        fit.line.b[1],
        fit.depth,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(fit.depth).toBeGreaterThanOrEqual(0);
      expect(typeof fit.flipped).toBe("boolean");
    }
  });

  it("never returns a frontage below MIN_FRONTAGE", () => {
    for (const b of buildings) {
      const fit = fitFrontage(b.footprint as Vec2[], network);
      if (!fit) continue;
      const w = Math.hypot(
        fit.line.b[0] - fit.line.a[0],
        fit.line.b[1] - fit.line.a[1],
      );
      expect(w).toBeGreaterThanOrEqual(MIN_FRONTAGE);
    }
  });
});
