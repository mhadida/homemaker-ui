import type { BuildingParams, StyleId, RoofType } from "./types";
import { DEFAULT_PARAMS } from "./types";

/**
 * Parse a natural language prompt into building parameters.
 * Works without an AI model — uses keyword matching.
 * For richer parsing, the /api/prompt route uses Ollama or OpenAI.
 */
export function parsePromptLocal(prompt: string): Partial<BuildingParams> {
  const lower = prompt.toLowerCase();
  const updates: Partial<BuildingParams> = {};

  // Storeys
  const storeyMatch = lower.match(/(\d+)\s*[-]?\s*stor(?:ey|y|ies|ies)/);
  if (storeyMatch) {
    updates.storeys = Math.min(6, Math.max(1, parseInt(storeyMatch[1])));
  }
  if (/\bsingle[- ]?family\b|\bone[- ]?story\b|\bone[- ]?storey\b|\b1[- ]?story\b/.test(lower)) {
    updates.storeys = 1;
  }
  if (/\bbungalow\b|\bcottage\b/.test(lower)) {
    updates.storeys = 1;
  }
  if (/\bduplex\b|\btwo[- ]?story\b|\btwo[- ]?storey\b/.test(lower)) {
    updates.storeys = 2;
  }
  if (/\btriplex\b|\bthree[- ]?story\b|\bthree[- ]?storey\b/.test(lower)) {
    updates.storeys = 3;
  }
  if (/\bhigh[- ]?rise\b|\btower\b/.test(lower)) {
    updates.storeys = 5;
  }

  // Styles
  const styleMap: Record<string, StyleId> = {
    default: "default",
    blank: "blank",
    cinema: "cinema",
    courtyard: "courtyard",
    fancy: "fancy",
    foxhouse: "foxhouse",
    framing: "framing",
    timber: "framing",
    halifax: "halifax",
    simple: "simple",
    minimal: "simple",
    modern: "default",
    classical: "fancy",
    ornate: "fancy",
    art: "cinema",
    deco: "cinema",
  };
  for (const [keyword, style] of Object.entries(styleMap)) {
    if (lower.includes(keyword)) {
      updates.style = style;
      break;
    }
  }

  // Roof
  if (/\bflat[- ]?roof\b|\bflat\b/.test(lower) && !lower.includes("flat screen")) {
    updates.roof = "flat";
  }
  if (/\bpitched[- ]?roof\b|\bgable\b|\bpitched\b/.test(lower)) {
    updates.roof = "pitched";
  }
  if (/\bhip[- ]?roof\b|\bhipped\b/.test(lower)) {
    updates.roof = "hip";
  }

  // Shape
  if (/\bl[- ]?shaped?\b|\bel[- ]?shaped?\b/.test(lower)) {
    const w = 12, d = 10;
    updates.footprint = [
      [-w / 2, -d / 2],
      [w / 2 - w * 0.4, -d / 2],
      [w / 2 - w * 0.4, d / 2 - d * 0.4],
      [w / 2, d / 2 - d * 0.4],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
  } else if (/\bu[- ]?shaped?\b/.test(lower)) {
    const w = 14, d = 10;
    const ww = w * 0.35, wd = d * 0.35;
    updates.footprint = [
      [-w / 2, -d / 2],
      [-w / 2 + ww, -d / 2],
      [-w / 2 + ww, d / 2 - wd],
      [w / 2 - ww, d / 2 - wd],
      [w / 2 - ww, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
  } else if (/\bh[- ]?shaped?\b/.test(lower)) {
    const w = 14, d = 12;
    const bw = w * 0.3;     // bar width
    const cd = d * 0.3;     // crossbar depth
    const innerL = -w / 2 + bw;
    const innerR = w / 2 - bw;
    const innerB = -cd / 2;
    const innerT = cd / 2;
    updates.footprint = [
      [-w / 2, -d / 2], [innerL, -d / 2], [innerL, innerB], [innerR, innerB], [innerR, -d / 2], [w / 2, -d / 2],
      [w / 2, d / 2], [innerR, d / 2], [innerR, innerT], [innerL, innerT], [innerL, d / 2], [-w / 2, d / 2],
    ];
  }

  // Width/depth
  const widthMatch = lower.match(/(\d+(?:\.\d+)?)\s*m(?:eters?)?\s*(?:wide|width|across|by|x)/);
  const depthMatch = lower.match(/(?:by|x)\s*(\d+(?:\.\d+)?)\s*m(?:eters?)?(?:\s*deep|depth)?/);
  if (widthMatch) {
    const w = parseFloat(widthMatch[1]);
    const d = depthMatch ? parseFloat(depthMatch[1]) : w * 0.8;
    updates.footprint = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
  }

  // Rooms
  const roomKeywords: Record<string, string> = {
    bedroom: "bedroom",
    bedrooms: "bedroom",
    kitchen: "kitchen",
    living: "living",
    bathroom: "toilet",
    toilet: "toilet",
    stair: "stair",
    stairs: "stair",
    retail: "retail",
    shop: "retail",
    store: "retail",
    circulation: "circulation",
    hallway: "circulation",
    corridor: "circulation",
  };
  const rooms: { type: string; label: string }[] = [];
  for (const [keyword, roomType] of Object.entries(roomKeywords)) {
    if (lower.includes(keyword)) {
      rooms.push({ type: roomType, label: keyword });
    }
  }
  if (rooms.length > 0) {
    updates.rooms = rooms;
  }

  return updates;
}

/**
 * Merge parsed prompt updates into default params.
 */
export function mergeParams(
  base: BuildingParams,
  updates: Partial<BuildingParams>
): BuildingParams {
  return {
    ...base,
    ...updates,
    footprint: updates.footprint ?? base.footprint,
    storeys: updates.storeys ?? base.storeys,
    storeyHeight: updates.storeyHeight ?? base.storeyHeight,
    style: updates.style ?? base.style,
    roof: updates.roof ?? base.roof,
    ridgeHeight: updates.ridgeHeight ?? base.ridgeHeight,
    rooms: updates.rooms ?? base.rooms,
  };
}

/**
 * Build the system prompt for AI-based parsing.
 */
export function buildAIPrompt(userPrompt: string): string {
  return `You are a building parameter parser. Convert the user's description into a JSON object with these fields:

- "storeys": integer 1-6 (number of floors)
- "style": one of "default", "blank", "cinema", "courtyard", "fancy", "foxhouse", "framing", "halifax", "simple"
- "roof": one of "flat", "pitched", "hip"
- "width": number in meters (building width, 4-30)
- "depth": number in meters (building depth, 4-30)
- "shape": one of "rectangle", "l", "u", "h"
- "rooms": array of room types, each one of "bedroom", "kitchen", "living", "toilet", "circulation", "stair", "retail", "sahn", "outside"

User description: "${userPrompt}"

Respond with ONLY the JSON object, no explanation.`;
}