import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

export const runtime = "nodejs";

// Available styles + roof types — keep in sync with src/lib/building/types.ts.
const STYLES = [
  "default",
  "blank",
  "cinema",
  "courtyard",
  "fancy",
  "foxhouse",
  "framing",
  "halifax",
  "simple",
] as const;

const SHAPES = ["rectangle", "l", "u", "h", "courtyard"] as const;
const ROOFS = ["flat", "pitched", "hip"] as const;
const ROOF_COLORS = ["terracotta", "slate"] as const;
const ROOM_TYPES = [
  "bedroom",
  "kitchen",
  "living",
  "circulation",
  "stair",
  "toilet",
  "retail",
  "outside",
  "sahn",
  "void",
] as const;

// Compact, AI-friendly spec. Server converts this to BuildingParams before
// returning. Width/depth + shape are friendlier for an LLM than raw polygon
// coordinates. Colors come back as semantic names; the client maps to hex.
const BuildingSpec = z.object({
  storeys: z.number().int().min(1).max(6),
  width: z.number().min(4).max(30),
  depth: z.number().min(4).max(30),
  shape: z.enum(SHAPES),
  style: z.enum(STYLES),
  roof: z.enum(ROOFS),
  ridgeHeight: z.number().min(1).max(6),
  wallColor: z
    .enum(["earthy", "cream", "stone", "slate", "linen", "sage", "blush", "white"])
    .optional(),
  roofColor: z.enum(ROOF_COLORS).optional(),
  rooms: z.array(z.enum(ROOM_TYPES)).optional(),
});

export type BuildingSpec = z.infer<typeof BuildingSpec>;

const RequestSchema = z.object({
  prompt: z.string().min(1),
  current: BuildingSpec.partial().optional(),
});

const MODEL = process.env.HOMEMAKER_AI_MODEL ?? "openai/gpt-5-nano";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad request", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { prompt, current } = parsed.data;

    const { object } = await generateObject({
      model: MODEL,
      schema: BuildingSpec,
      system: SYSTEM_PROMPT(current),
      prompt,
    });

    return NextResponse.json({ spec: object, model: MODEL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/prompt]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function SYSTEM_PROMPT(current: Partial<BuildingSpec> | undefined): string {
  const have = current ?? {};
  return [
    "You are a building configurator for an interactive parametric editor.",
    "The user describes either a brand-new building or an edit to the current one.",
    "Return the COMPLETE new building specification as JSON matching the schema.",
    "If the user does NOT mention a property, KEEP its current value.",
    "Only change properties the user explicitly asks for.",
    "",
    "Current building (use these as defaults for unmentioned properties):",
    `- storeys: ${have.storeys ?? 2}`,
    `- footprint: ${have.width ?? 10}m × ${have.depth ?? 8}m, shape "${have.shape ?? "rectangle"}"`,
    `- style: ${have.style ?? "default"}`,
    `- roof: ${have.roof ?? "flat"} (ridgeHeight ${have.ridgeHeight ?? 3}m)`,
    `- wallColor: ${have.wallColor ?? "earthy"}`,
    `- roofColor: ${have.roofColor ?? "terracotta"}`,
    `- rooms: ${have.rooms?.join(", ") || "(none)"}`,
    "",
    "Style guide:",
    '- "default": plain windows/doors, simplest. Good for modern.',
    '- "fancy": classical with pediment surrounds. Needs storey ≥ 4.0m.',
    '- "halifax": Piece-Hall arcaded ground floor.',
    '- "cinema", "courtyard", "foxhouse", "framing", "simple", "blank": specialty.',
    "",
    "Shapes: rectangle (default), l/u/h (extruded letter shapes), courtyard (rectangle with central void).",
    "Roof colors: terracotta (warm clay red) or slate (cool blue-gray).",
  ].join("\n");
}
