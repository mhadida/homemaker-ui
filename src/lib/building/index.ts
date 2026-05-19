export {
  rectangularFootprint,
  lShapedFootprint,
  uShapedFootprint,
  hShapedFootprint,
  courtyardFootprint,
} from "./footprints";
export { parsePromptLocal, mergeParams, buildAIPrompt } from "./prompt-parser";
export type { BuildingParams, StyleId, RoofType } from "./types";
export {
  DEFAULT_PARAMS,
  STYLE_OPTIONS,
  ROOM_TYPES,
  WALL_SWATCHES,
  CLASSICAL_RATIOS,
  classicalStoreyHeights,
} from "./types";
