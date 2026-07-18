export type Vec2 = [number, number];

export type StreetType = "alley" | "street" | "road" | "boulevard" | "canal";

export interface StreetSpec {
  width: number;
  allowsCars: boolean;
  label: string;
  minRadius: number;
}

/** Type defaults (metres). A Street may override `width`. */
export const STREET_SPECS: Record<StreetType, StreetSpec> = {
  alley: { width: 3.5, allowsCars: false, label: "Alley", minRadius: 6 },
  street: { width: 9, allowsCars: true, label: "Street", minRadius: 20 },
  road: { width: 14, allowsCars: true, label: "Road", minRadius: 45 },
  boulevard: { width: 24, allowsCars: true, label: "Boulevard", minRadius: 120 },
  canal: { width: 14, allowsCars: false, label: "Canal", minRadius: 45 },
};

export interface Street {
  id: string;
  type: StreetType;
  /** polyline vertices, plan coords [x, z]; rendered as a smooth curve */
  points: Vec2[];
  /** optional per-street override of the type default width */
  width?: number;
  /** closed loop: an implicit closing segment joins points[n-1] → points[0]
   * (a ring road). Absent = open polyline. `points` never repeats the first. */
  closed?: boolean;
}

export interface Monument {
  kind: "obelisk" | "fountain";
}

export interface StreetNetwork {
  streets: Street[];
  /** roundabout choices: [derived intersection key, monument]. Sparse. */
  roundabouts: [string, Monument][];
}

export const EMPTY_NETWORK: StreetNetwork = { streets: [], roundabouts: [] };

export function effectiveWidth(s: Street): number {
  return s.width ?? STREET_SPECS[s.type].width;
}

export function minRadiusOf(s: Street): number {
  return STREET_SPECS[s.type].minRadius;
}

let streetIdCounter = 0;
/** Session-unique ids. */
export function nextStreetId(): string {
  streetIdCounter += 1;
  return `street-${streetIdCounter}`;
}

/** After loading a saved network, bump the counter past every `street-N` id so
 * newly-drawn streets can't collide (mirrors reserveBlockIds). */
export function reserveStreetIds(streets: Street[]): void {
  for (const s of streets) {
    const m = /^street-(\d+)$/.exec(s.id);
    if (m) streetIdCounter = Math.max(streetIdCounter, Number(m[1]));
  }
}
