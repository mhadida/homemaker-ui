import type {
  FacadeParams,
  GroundFloorConfig,
  OrnamentConfig,
  PresetId,
} from "./types";
import { FACADE_PRESETS, DOOR_SWATCHES, FACADE_LIMITS } from "./types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";

/** Partial params with PARTIAL nested objects — a prompt like "add a stoop"
 * must not clobber the unmentioned treatment/doorBay. */
export type FacadePromptUpdates = Omit<
  Partial<FacadeParams>,
  "groundFloor" | "ornament"
> & {
  groundFloor?: Partial<GroundFloorConfig>;
  ornament?: Partial<OrnamentConfig>;
};

const clampInt = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(v)));

/** Keyword parser — instant feedback while /api/facade-prompt is in flight.
 * Same pattern as src/lib/building/prompt-parser.ts. */
export function parseFacadePromptLocal(prompt: string): FacadePromptUpdates {
  const lower = prompt.toLowerCase();
  const updates: FacadePromptUpdates = {};

  // Presets first — later keywords can still refine on top.
  const PRESET_KEYWORDS: [RegExp, PresetId][] = [
    [/\bgeorgian\b/, "georgian"],
    [/\bvictorian\b/, "victorian-shopfront"],
    [/\bmodern\b|\bminimal\b/, "modern"],
  ];
  for (const [re, id] of PRESET_KEYWORDS) {
    if (re.test(lower)) {
      Object.assign(updates, FACADE_PRESETS[id].params);
      updates.preset = id;
      updates.cellOverrides = [];
      break;
    }
  }

  const storeyMatch = lower.match(/(\d+)\s*-?\s*stor(?:ey|y|eys|ies)/);
  if (storeyMatch) {
    updates.storeys = clampInt(
      parseInt(storeyMatch[1]),
      FACADE_LIMITS.storeys.min,
      FACADE_LIMITS.storeys.max,
    );
    // A preset may have set storeyHeights for its own storey count — if the
    // explicit storey count differs, drop them so mergeFacadeParams recomputes.
    if (
      updates.storeyHeights !== undefined &&
      updates.storeyHeights.length !== updates.storeys
    ) {
      delete updates.storeyHeights;
    }
  }

  const bayMatch = lower.match(/(\d+)\s*bays?/);
  if (bayMatch) {
    updates.bays = clampInt(
      parseInt(bayMatch[1]),
      FACADE_LIMITS.bays.min,
      FACADE_LIMITS.bays.max,
    );
  }

  const widthMatch = lower.match(/(\d+(?:\.\d+)?)\s*m(?:eters?)?\s*(?:wide|width)/);
  if (widthMatch) {
    updates.width = Math.min(
      FACADE_LIMITS.width.max,
      Math.max(FACADE_LIMITS.width.min, parseFloat(widthMatch[1])),
    );
  }

  // Ground floor
  const gf: Partial<GroundFloorConfig> = { ...updates.groundFloor };
  if (/shop\s?front|\bretail\b|\bshop\b|\bstore\b/.test(lower))
    gf.treatment = "shopfront";
  if (/\bgarage\b/.test(lower)) gf.treatment = "garage";
  if (/\bstoop\b|\bentry steps\b/.test(lower)) gf.stoop = true;
  if (Object.keys(gf).length > 0) updates.groundFloor = gf;

  // Ornament
  const orn: Partial<OrnamentConfig> = { ...updates.ornament };
  if (/\bcornice\b/.test(lower)) orn.cornice = true;
  if (/\bparapet\b/.test(lower)) orn.parapet = true;
  if (/\bsills?\b/.test(lower)) orn.sills = true;
  if (/\bsurrounds?\b/.test(lower)) orn.surrounds = true;
  if (Object.keys(orn).length > 0) updates.ornament = orn;

  // Window glazing — explicit keywords override a preset's default style.
  if (/\bsmall panes?\b|\bgeorgian windows?\b|\bglazing bars?\b/.test(lower)) {
    updates.windowStyle = "georgian";
  } else if (/\bsash\b/.test(lower)) {
    updates.windowStyle = "sash";
  } else if (/\bsingle pane\b|\bplain glass\b|\bplain windows?\b/.test(lower)) {
    updates.windowStyle = "none";
  }

  // Colors: "<swatch> wall(s)" / "<swatch> door"
  for (const s of WALL_SWATCHES) {
    if (new RegExp(`\\b${s.label.toLowerCase()}\\b[^.]*\\bwalls?\\b`).test(lower)) {
      updates.wallColor = s.hex;
      break;
    }
  }
  for (const s of DOOR_SWATCHES) {
    if (new RegExp(`\\b${s.label.toLowerCase()}\\b[^.]*\\bdoor\\b`).test(lower)) {
      updates.doorColor = s.hex;
      break;
    }
  }

  return updates;
}

export function mergeFacadeParams(
  base: FacadeParams,
  updates: FacadePromptUpdates,
): FacadeParams {
  const merged: FacadeParams = {
    ...base,
    ...updates,
    groundFloor: { ...base.groundFloor, ...(updates.groundFloor ?? {}) },
    ornament: { ...base.ornament, ...(updates.ornament ?? {}) },
  };
  if (updates.storeys !== undefined && updates.storeyHeights === undefined) {
    merged.storeyHeights = classicalStoreyHeights(
      updates.storeys,
      merged.storeyHeight,
    );
  }
  return merged;
}
