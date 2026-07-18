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

/** Who the street carries: cars only, pedestrians only, or shared — the
 * Dutch fietsstraat where cars are guests. */
export type TrafficMode = "cars" | "peds" | "shared";

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
  /** optional per-street traffic mode; absent = the type default
   * (resolveTraffic). Meaningless for canals. */
  traffic?: TrafficMode;
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

/** Resolved traffic mode: the explicit per-street choice, else the type
 * default — car-carrying types default to cars-only, alleys to pedestrians. */
export function resolveTraffic(s: Street): TrafficMode {
  return s.traffic ?? (STREET_SPECS[s.type].allowsCars ? "cars" : "peds");
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
