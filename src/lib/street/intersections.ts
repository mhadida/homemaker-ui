import type { StreetNetwork, Vec2 } from "./types";

export interface Intersection {
  /** stable key: the shared point, rounded to a weld grid */
  key: string;
  pos: Vec2;
  incident: { streetId: string; vertex: number }[];
}

const keyOf = (p: Vec2) => `${p[0]}:${p[1]}`;

/** Intersections are DERIVED: a plan point shared (exact equality) by vertices
 * of ≥ 2 DIFFERENT streets. Mid-span crossings are deferred. */
export function deriveIntersections(net: StreetNetwork): Intersection[] {
  const byPoint = new Map<string, { pos: Vec2; incident: { streetId: string; vertex: number }[] }>();
  for (const s of net.streets) {
    s.points.forEach((p, vertex) => {
      const k = keyOf(p);
      let e = byPoint.get(k);
      if (!e) {
        e = { pos: [p[0], p[1]], incident: [] };
        byPoint.set(k, e);
      }
      // a street may pass its own point twice — record once per (street,vertex)
      e.incident.push({ streetId: s.id, vertex });
    });
  }
  const out: Intersection[] = [];
  for (const [key, e] of byPoint) {
    const distinctStreets = new Set(e.incident.map((i) => i.streetId));
    if (distinctStreets.size >= 2) out.push({ key, pos: e.pos, incident: e.incident });
  }
  return out;
}

/** Drops roundabout entries whose intersection key is no longer DERIVED
 * (e.g. after deleting a street that made the junction). Keeps every entry
 * still backed by a real intersection. Pure — no-op on an empty network. */
export function pruneRoundabouts(net: StreetNetwork): StreetNetwork {
  const valid = new Set(deriveIntersections(net).map((i) => i.key));
  return { ...net, roundabouts: net.roundabouts.filter(([k]) => valid.has(k)) };
}
