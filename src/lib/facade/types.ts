import type { ViewSettings } from "@/lib/building/types";
import { classicalStoreyHeights } from "@/lib/building/types";

export type OpeningKind = "window" | "door" | "blank" | "shopfront" | "garage";

export type GroundTreatment = "residential" | "shopfront" | "garage";

export interface GroundFloorConfig {
  treatment: GroundTreatment;
  /** Which bay gets the entrance (0 = leftmost). Clamped to bays-1 by the
   * layout engine, so stale values after a bay-count change are harmless. */
  doorBay: number;
  /** Entry steps in front of the door (residential treatment only). */
  stoop: boolean;
}

export interface OrnamentConfig {
  cornice: boolean;
  parapet: boolean;
  sills: boolean;
  surrounds: boolean;
}

export interface CellOverride {
  /** 0 = ground storey */
  storey: number;
  /** 0 = leftmost bay */
  bay: number;
  kind: OpeningKind;
}

export type PresetId = "georgian" | "victorian-shopfront" | "modern";

export type WindowStyleId = "georgian" | "sash" | "victorian" | "none";

/** Order matches the controls chip row. */
export const WINDOW_STYLE_OPTIONS: { id: WindowStyleId; label: string }[] = [
  { id: "georgian", label: "Georgian" },
  { id: "sash", label: "Sash" },
  { id: "victorian", label: "1-over-1" },
  { id: "none", label: "Plain" },
];

export interface FacadeParams {
  /** Lot width in meters */
  width: number;
  /** 1–6 */
  storeys: number;
  /** Baseline average storey height */
  storeyHeight: number;
  /** Per-storey heights (bottom-up), classical ratios. Falls back to
   * storeyHeight per storey when absent/short. */
  storeyHeights?: number[];
  /** Vertical bay count, 1–9 */
  bays: number;
  /** Opening width as fraction of bay width */
  windowWidthRatio: number;
  /** Opening height as fraction of storey height */
  windowHeightRatio: number;
  /** Internal glazing-bar pattern for windows (and the door transom). */
  windowStyle: WindowStyleId;
  /** Sparse per-cell overrides of the default grid kinds */
  cellOverrides?: CellOverride[];
  groundFloor: GroundFloorConfig;
  ornament: OrnamentConfig;
  /** #RRGGBB — wall render color */
  wallColor: string;
  /** #RRGGBB — cornice/sills/surrounds/frames */
  trimColor: string;
  /** #RRGGBB — door + garage panel */
  doorColor: string;
  preset?: PresetId;
}

export const FACADE_LIMITS = {
  width: { min: 4, max: 20 },
  storeys: { min: 1, max: 6 },
  storeyHeight: { min: 2.2, max: 4.5 },
  bays: { min: 1, max: 9 },
  windowWidthRatio: { min: 0.2, max: 0.8 },
  windowHeightRatio: { min: 0.3, max: 0.8 },
} as const;

export const DEFAULT_FACADE: FacadeParams = {
  width: 7.5,
  storeys: 3,
  storeyHeight: 3.0,
  storeyHeights: classicalStoreyHeights(3, 3.0),
  bays: 3,
  windowWidthRatio: 0.45,
  windowHeightRatio: 0.55,
  windowStyle: "sash",
  groundFloor: { treatment: "residential", doorBay: 0, stoop: true },
  ornament: { cornice: true, parapet: false, sills: true, surrounds: false },
  wallColor: "#c7bca8",
  trimColor: "#ece8e0",
  doorColor: "#3d4a42",
};

/** Facade-specific sun default. The facade faces +z (azimuth 0), so unlike
 * the main app's DEFAULT_VIEW (135° = behind the building), the sun starts
 * front-right to rake across the relief. */
export const FACADE_DEFAULT_VIEW: ViewSettings = {
  sunAzimuth: 30,
  sunAltitude: 50,
};

/** Door + garage panel swatches — deep traditional door colors. */
export const DOOR_SWATCHES: { id: string; label: string; hex: string }[] = [
  { id: "racing-green", label: "Green", hex: "#3d4a42" },
  { id: "oxblood", label: "Oxblood", hex: "#5c3a35" },
  { id: "navy", label: "Navy", hex: "#2e3a4d" },
  { id: "black", label: "Black", hex: "#26262a" },
  { id: "white", label: "White", hex: "#e8e4da" },
];

/** Presets are parameter bundles, not code paths. Applying one spreads
 * `params` over DEFAULT_FACADE and clears cellOverrides (done by the page). */
export const FACADE_PRESETS: Record<
  PresetId,
  { label: string; params: Partial<FacadeParams> }
> = {
  georgian: {
    label: "Georgian",
    params: {
      storeys: 3,
      bays: 3,
      storeyHeight: 3.2,
      storeyHeights: classicalStoreyHeights(3, 3.2),
      windowWidthRatio: 0.4,
      windowHeightRatio: 0.6,
      windowStyle: "georgian",
      groundFloor: { treatment: "residential", doorBay: 0, stoop: true },
      ornament: { cornice: true, parapet: true, sills: true, surrounds: false },
      wallColor: "#c7bca8",
      trimColor: "#ece8e0",
      doorColor: "#3d4a42",
    },
  },
  "victorian-shopfront": {
    label: "Shopfront",
    params: {
      storeys: 3,
      bays: 3,
      storeyHeight: 3.4,
      storeyHeights: classicalStoreyHeights(3, 3.4),
      windowWidthRatio: 0.5,
      windowHeightRatio: 0.6,
      windowStyle: "victorian",
      groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      ornament: { cornice: true, parapet: false, sills: true, surrounds: true },
      wallColor: "#a89c8d",
      trimColor: "#ddd3c3",
      doorColor: "#26262a",
    },
  },
  modern: {
    label: "Modern",
    params: {
      storeys: 4,
      bays: 2,
      storeyHeight: 2.9,
      storeyHeights: classicalStoreyHeights(4, 2.9),
      windowWidthRatio: 0.7,
      windowHeightRatio: 0.7,
      windowStyle: "none",
      groundFloor: { treatment: "residential", doorBay: 1, stoop: false },
      ornament: { cornice: false, parapet: true, sills: false, surrounds: false },
      wallColor: "#ece8e0",
      trimColor: "#8e9298",
      doorColor: "#26262a",
    },
  },
};
