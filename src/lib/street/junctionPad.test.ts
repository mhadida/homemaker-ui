import { describe, it, expect } from "vitest";
import {
  clipCentreline,
  junctionClips,
  streetSpans,
  mouthsAt,
  deriveJunctionPads,
  type ClipDisc,
} from "./junctionPad";
import { deriveIntersections } from "./intersections";
import type { Street, StreetNetwork, Vec2 } from "./types";

const line = (...pts: Vec2[]) => pts;

const net = (streets: Street[], roundabouts: StreetNetwork["roundabouts"] = []): StreetNetwork => ({
  streets,
  roundabouts,
  squares: [],
});
const S = (id: string, type: Street["type"], points: Vec2[], extra: Partial<Street> = {}): Street => ({
  id,
  type,
  points,
  ...extra,
});

// even-odd point-in-polygon for assertions
function inPoly(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

describe("clipCentreline", () => {
  it("no discs → the input unchanged (one span, byte-identical)", () => {
    const cl = line([0, 0], [10, 0], [20, 0]);
    const spans = clipCentreline(cl, []);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual(cl);
  });

  it("a mid-line disc splits into two spans with the split points on the circle", () => {
    const cl = line([0, 0], [20, 0]);
    const discs: ClipDisc[] = [{ centre: [10, 0], radius: 2 }];
    const spans = clipCentreline(cl, discs);
    expect(spans).toHaveLength(2);
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(8);
    expect(spans[1][0][0]).toBeCloseTo(12);
  });

  it("a disc over an endpoint shortens that end (one span)", () => {
    const cl = line([0, 0], [20, 0]);
    const spans = clipCentreline(cl, [{ centre: [0, 0], radius: 3 }]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0][0]).toBeCloseTo(3);
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(20);
  });

  it("two discs (both ends) leave the middle span", () => {
    const cl = line([0, 0], [20, 0]);
    const spans = clipCentreline(cl, [
      { centre: [0, 0], radius: 3 },
      { centre: [20, 0], radius: 3 },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0][0]).toBeCloseTo(3);
    expect(spans[0][spans[0].length - 1][0]).toBeCloseTo(17);
  });

  it("a disc that swallows the whole line → no spans", () => {
    const cl = line([0, 0], [4, 0]);
    expect(clipCentreline(cl, [{ centre: [2, 0], radius: 10 }])).toHaveLength(0);
  });

  it("keeps interior vertices of a bent polyline inside a surviving span", () => {
    const cl = line([0, 0], [10, 5], [20, 0]);
    const spans = clipCentreline(cl, [{ centre: [20, 0], radius: 2 }]);
    expect(spans).toHaveLength(1);
    expect(spans[0].some((p) => p[0] === 10 && p[1] === 5)).toBe(true);
  });
});

describe("junctionClips", () => {
  it("an X crossing gives each street one disc at the crossing", () => {
    const a = S("a", "road", [[-20, 0], [20, 0]]);
    const b = S("b", "road", [[0, -20], [0, 20]]);
    const clips = junctionClips(net([a, b]));
    expect(clips.get("a")).toHaveLength(1);
    expect(clips.get("b")).toHaveLength(1);
    expect(clips.get("a")![0].centre[0]).toBeCloseTo(0);
    expect(clips.get("a")![0].centre[1]).toBeCloseTo(0);
  });

  it("a canal-incident junction contributes no discs", () => {
    const road = S("r", "road", [[-20, 0], [20, 0]]);
    const canal = S("c", "canal", [[0, -20], [0, 20]]);
    const clips = junctionClips(net([road, canal]));
    expect(clips.get("r")).toBeUndefined();
    expect(clips.get("c")).toBeUndefined();
  });

  it("a roundabout junction uses the ring radius", () => {
    const a = S("a", "road", [[-20, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 20]]);
    const n = net([a, b]);
    const key = deriveIntersections(n).find((i) => Math.abs(i.pos[0]) < 1e-9)!.key;
    const clips = junctionClips({ ...n, roundabouts: [[key, { kind: "fountain" }]] });
    expect(clips.get("a")![0].radius).toBeCloseTo(9); // ROUNDABOUT_OUTER_R
  });
});

describe("streetSpans", () => {
  it("a lone street with no junctions is absent from the map", () => {
    const s = S("s", "road", [[0, 0], [50, 0]]);
    expect(streetSpans(net([s])).has("s")).toBe(false);
  });

  it("a through street at an X is split into two spans", () => {
    const a = S("a", "road", [[-20, 0], [20, 0]]);
    const b = S("b", "road", [[0, -20], [0, 20]]);
    const spans = streetSpans(net([a, b]));
    expect(spans.get("a")).toHaveLength(2);
    expect(spans.get("b")).toHaveLength(2);
  });

  it("an ending street at a node yields one shortened span", () => {
    const a = S("a", "road", [[-20, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 20]]);
    const spans = streetSpans(net([a, b]));
    expect(spans.get("a")).toHaveLength(1);
    expect(spans.get("b")).toHaveLength(1);
  });
});

describe("mouthsAt", () => {
  it("a straight through-street gives two mouths on the clip circle, cap = width", () => {
    const s = S("s", "road", [[-30, 0], [30, 0]]); // width 14 → h 7
    const clipR = 7 * 1.3;
    const mouths = mouthsAt(s, [0, 0], clipR);
    expect(mouths).toHaveLength(2);
    for (const m of mouths) {
      expect(Math.hypot(m.centre[0], m.centre[1])).toBeCloseTo(clipR);
      expect(Math.hypot(m.left[0] - m.right[0], m.left[1] - m.right[1])).toBeCloseTo(14);
    }
  });

  it("an ending street gives one mouth", () => {
    const s = S("s", "road", [[0, 0], [30, 0]]);
    expect(mouthsAt(s, [0, 0], 9)).toHaveLength(1);
  });
});

describe("deriveJunctionPads", () => {
  it("an X crossing → one pad, 8 vertices, contains the centre, right dominant id", () => {
    const a = S("a", "road", [[-30, 0], [30, 0]]);
    const b = S("b", "street", [[0, -30], [0, 30]]); // narrower
    const pads = deriveJunctionPads(net([a, b]));
    expect(pads).toHaveLength(1);
    expect(pads[0].polygon).toHaveLength(8); // 4 mouths × 2 corners
    expect(inPoly([0, 0], pads[0].polygon)).toBe(true);
    expect(pads[0].pos).toEqual([0, 0]);
    expect(pads[0].dominantStreetId).toBe("a"); // road wider than street
  });

  it("a T → one pad with 6 vertices (branch 1 mouth + through 2)", () => {
    const through = S("t", "road", [[-30, 0], [30, 0]]);
    const branch = S("br", "road", [[0, 0], [0, 30]]);
    const pads = deriveJunctionPads(net([through, branch]));
    expect(pads).toHaveLength(1);
    expect(pads[0].polygon).toHaveLength(6);
    expect(inPoly([0, 0], pads[0].polygon)).toBe(true);
  });

  it("a canal-incident junction → no pad", () => {
    const road = S("r", "road", [[-30, 0], [30, 0]]);
    const canal = S("c", "canal", [[0, -30], [0, 30]]);
    expect(deriveJunctionPads(net([road, canal]))).toHaveLength(0);
  });

  it("a roundabout junction → no pad (the ring is the pad)", () => {
    const a = S("a", "road", [[-30, 0], [0, 0]]);
    const b = S("b", "road", [[0, 0], [0, 30]]);
    const n = net([a, b]);
    const key = deriveIntersections(n).find((i) => Math.abs(i.pos[0]) < 1e-9)!.key;
    expect(deriveJunctionPads({ ...n, roundabouts: [[key, { kind: "obelisk" }]] })).toHaveLength(0);
  });
});
