export type Vec2 = [number, number];

export type StreetType = "alley" | "street" | "road" | "boulevard";

export interface StreetSpec {
  width: number;
  allowsCars: boolean;
  label: string;
}

/** Type defaults (metres). A Street may override `width`. */
export const STREET_SPECS: Record<StreetType, StreetSpec> = {
  alley: { width: 3.5, allowsCars: false, label: "Alley" },
  street: { width: 9, allowsCars: true, label: "Street" },
  road: { width: 14, allowsCars: true, label: "Road" },
  boulevard: { width: 24, allowsCars: true, label: "Boulevard" },
};

export interface Street {
  id: string;
  type: StreetType;
  /** polyline vertices, plan coords [x, z]; rendered as a smooth curve */
  points: Vec2[];
  /** optional per-street override of the type default width */
  width?: number;
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
