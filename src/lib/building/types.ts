export type RoofType = "flat" | "pitched" | "gambrel" | "hip";
export type StyleId =
  | "default"
  | "blank"
  | "cinema"
  | "courtyard"
  | "fancy"
  | "foxhouse"
  | "framing"
  | "halifax"
  | "simple";

export interface BuildingParams {
  /** Footprint polygon as [x, y] pairs in local meters */
  footprint: [number, number][];
  /** Optional inner holes (e.g. courtyard void). Each hole is a ring. */
  holes?: [number, number][][];
  /** Number of storeys (1–6) */
  storeys: number;
  /** Average storey height (used to scale classical proportions). */
  storeyHeight: number;
  /** Per-storey heights in meters (bottom-up). If absent, all storeys
   * use storeyHeight. The UI populates this with classical proportions
   * when the storey count changes. */
  storeyHeights?: number[];
  /** Building style */
  style: StyleId;
  /** Roof type */
  roof: RoofType;
  /** Ridge height above top storey (for pitched roofs) */
  ridgeHeight: number;
  /** Room type assignments */
  rooms: { type: string; label: string }[];
  /** Exterior wall paint color as #RRGGBB hex */
  wallColor?: string;
  /** Roof tile/slate color as #RRGGBB hex. If absent, Molior's default
   * orange-terracotta is used. */
  roofColor?: string;
  /** Which facades render windows. Defaults to all four. Server-side
   * filter applies via parent-wall thin axis + ext_sign. */
  enabledFacades?: FacadeId[];
}

export type FacadeId = "N" | "S" | "E" | "W";

export const ALL_FACADES: FacadeId[] = ["N", "S", "E", "W"];

/** Classical façade proportions (Palladian tradition).
 * Ground floor = robust base; piano nobile = grandest;
 * upper storeys progressively shorter; attic shortest.
 * Ratios are relative to ground floor. */
export const CLASSICAL_RATIOS: number[][] = [
  [1.0],                          // 1 storey
  [1.0, 0.9],                     // 2 storeys
  [1.0, 1.2, 0.85],               // 3 — piano nobile in middle
  [1.0, 1.2, 0.95, 0.8],          // 4 — piano nobile + attic
  [1.0, 1.2, 1.0, 0.9, 0.8],      // 5
  [1.0, 1.2, 1.0, 0.95, 0.85, 0.75], // 6
];

/** Minimum floor-to-ceiling height required for each style.
 * Driven by the tallest window family the style uses + the eaves
 * cornice that projects DOWN from the wall top.
 *
 * "fancy" packs three constraints into one storey:
 *  - sill (0.587 m)
 *  - window + pediment surround (2.888 m) → pediment top at 3.475 m
 *  - eaves entablature/brackets reach down ~24-40 cm below wall top
 * So storey ≥ 3.475 + 0.40 = 3.875 m. Round up to 4.0 m for margin
 * and to keep classical ratios producing tolerable heights. Other
 * styles have smaller window variants that Molior auto-picks for
 * shorter walls, so they can go lower. */
export const STYLE_MIN_STOREY_HEIGHT: Partial<Record<StyleId, number>> = {
  fancy: 4.0,
};

/** Absolute minimum storey height across all styles (slider floor). */
export const ABSOLUTE_MIN_STOREY_HEIGHT = 2.2;

/** Minimum storey height the current style requires. */
export function minStoreyHeightForStyle(style: StyleId): number {
  return STYLE_MIN_STOREY_HEIGHT[style] ?? ABSOLUTE_MIN_STOREY_HEIGHT;
}

/** Clamp every height up to the style's minimum (no upper clamp). */
export function clampHeightsForStyle(
  heights: number[],
  style: StyleId
): number[] {
  const min = minStoreyHeightForStyle(style);
  return heights.map((h) => +Math.max(h, min).toFixed(2));
}

/** Compute per-storey heights from classical ratios scaled so the
 * average matches the given baseline (`storeyHeight`), then clamp each
 * to the style's minimum so decorative cornices/pediments don't bust
 * through the roof. */
export function classicalStoreyHeights(
  storeys: number,
  baseStoreyHeight: number,
  style: StyleId = "default"
): number[] {
  const ratios = CLASSICAL_RATIOS[Math.max(0, Math.min(5, storeys - 1))];
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const raw = ratios.map((r) => +(r * baseStoreyHeight / avgRatio).toFixed(2));
  return clampHeightsForStyle(raw, style);
}

export const DEFAULT_PARAMS: BuildingParams = {
  footprint: [
    [-5, -4],
    [5, -4],
    [5, 4],
    [-5, 4],
  ],
  storeys: 2,
  storeyHeight: 3.0,
  storeyHeights: classicalStoreyHeights(2, 3.0),
  style: "default",
  roof: "pitched",
  ridgeHeight: 3.0,
  rooms: [],
  wallColor: "#c7bca8",
  roofColor: "#a64b32",
};

/** View settings — purely client-side (not sent to the Python pipeline).
 * Lives separately from BuildingParams so changing the sun doesn't trigger
 * a regeneration of the building. */
export interface ViewSettings {
  /** Sun azimuth in degrees. 0 = North, 90 = East, 180 = South, 270 = West. */
  sunAzimuth: number;
  /** Sun altitude in degrees above the horizon. 0 = on horizon, 90 = zenith. */
  sunAltitude: number;
}

export const DEFAULT_VIEW: ViewSettings = {
  sunAzimuth: 135, // South-east — classic architectural rendering angle
  sunAltitude: 50, // Mid-morning / mid-afternoon
};

/** Roof tile/slate swatches. */
export const ROOF_SWATCHES: { id: string; label: string; hex: string }[] = [
  { id: "terracotta", label: "Terracotta", hex: "#a64b32" },
  { id: "slate", label: "Slate", hex: "#4d545c" },
];

/** Curated wall paint swatches — warm earthy palette, no pure browns. */
export const WALL_SWATCHES: { id: string; label: string; hex: string }[] = [
  { id: "earthy", label: "Earthy", hex: "#c7bca8" },
  { id: "cream", label: "Cream", hex: "#e8dcc4" },
  { id: "stone", label: "Stone", hex: "#a89c8d" },
  { id: "slate", label: "Slate", hex: "#8e9298" },
  { id: "linen", label: "Linen", hex: "#ddd3c3" },
  { id: "sage", label: "Sage", hex: "#a8b29a" },
  { id: "blush", label: "Blush", hex: "#c9a89c" },
  { id: "white", label: "White", hex: "#ece8e0" },
];

// "framing" and "blank" are hidden from the UI picker — framing has no
// wall geometry (timber-only) and blank produces a featureless shell. They
// remain valid StyleId values for direct API usage but aren't user-selectable.
export const STYLE_OPTIONS: {
  id: StyleId;
  label: string;
  desc: string;
}[] = [
  { id: "default", label: "Default", desc: "Full detail with windows & doors" },
  { id: "courtyard", label: "Courtyard", desc: "Open central space" },
  { id: "fancy", label: "Fancy", desc: "Ornamental classical" },
  { id: "halifax", label: "Halifax", desc: "Piece Hall inspired" },
  { id: "cinema", label: "Cinema", desc: "Art deco auditorium" },
  { id: "foxhouse", label: "Foxhouse", desc: "Fox house with openings" },
  { id: "simple", label: "Simple", desc: "Minimal shells only" },
];

export const ROOM_TYPES = [
  "living",
  "kitchen",
  "bedroom",
  "toilet",
  "circulation",
  "stair",
  "retail",
  "sahn",
  "outside",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];