import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

export const runtime = "nodejs";

// Keep in sync with WALL_SWATCHES / DOOR_SWATCHES in the client libs.
const WALL_COLOR_IDS = [
  "earthy",
  "cream",
  "stone",
  "slate",
  "linen",
  "sage",
  "blush",
  "white",
] as const;
const DOOR_COLOR_IDS = [
  "racing-green",
  "oxblood",
  "navy",
  "black",
  "white",
] as const;

// Flat, fully-required spec: OpenAI structured output rejects .optional()
// (same constraint as /api/prompt). The system prompt tells the model to
// echo current values for unmentioned fields. Per-cell overrides are
// deliberately NOT in the AI surface — that's a direct-manipulation gesture.
const FacadeSpec = z.object({
  storeys: z.number().int().min(1).max(6),
  width: z.number().min(4).max(20),
  bays: z.number().int().min(1).max(9),
  treatment: z.enum(["residential", "shopfront", "garage"]),
  doorBay: z.number().int().min(1).max(9), // 1 = leftmost bay (1-based for the model)
  stoop: z.boolean(),
  cornice: z.boolean(),
  parapet: z.boolean(),
  sills: z.boolean(),
  surrounds: z.boolean(),
  windowSize: z.enum(["small", "medium", "large"]),
  windowStyle: z.enum(["georgian", "sash", "victorian", "none"]),
  // Sections: vertical strips of whole bays with small forward/back relief.
  sections: z.number().int().min(1).max(9),
  sectionPattern: z.enum([
    "custom",
    "flush",
    "recessed-center",
    "projected-center",
    "alternating",
  ]),
  wallColor: z.enum(WALL_COLOR_IDS),
  trimColor: z.enum(WALL_COLOR_IDS),
  doorColor: z.enum(DOOR_COLOR_IDS),
  // "none" = no preset active; echo current when the user doesn't name a style
  preset: z.enum(["none", "georgian", "victorian-shopfront", "modern"]),
});
export type FacadeSpec = z.infer<typeof FacadeSpec>;

const RequestSchema = z.object({
  prompt: z.string().min(1),
  current: FacadeSpec.partial().optional(),
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
      schema: FacadeSpec,
      system: SYSTEM_PROMPT(current),
      prompt,
    });

    return NextResponse.json({ spec: object, model: MODEL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/facade-prompt]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function SYSTEM_PROMPT(current: Partial<FacadeSpec> | undefined): string {
  const have = current ?? {};
  return [
    "You configure the SINGLE street-facing facade of an infill building",
    "(party walls both sides — only this one wall exists).",
    "The user describes a new facade or an edit to the current one.",
    "Return the COMPLETE new facade specification as JSON matching the schema.",
    "If the user does NOT mention a property, KEEP its current value.",
    "",
    "Current facade (defaults for unmentioned properties):",
    `- storeys: ${have.storeys ?? 3}, width: ${have.width ?? 7.5}m, bays: ${have.bays ?? 3}`,
    `- ground floor: ${have.treatment ?? "residential"}, door in bay ${have.doorBay ?? 1} (1 = leftmost), stoop: ${have.stoop ?? true}`,
    `- ornament: cornice ${have.cornice ?? true}, parapet ${have.parapet ?? false}, sills ${have.sills ?? true}, surrounds ${have.surrounds ?? false}`,
    `- windowSize: ${have.windowSize ?? "medium"}`,
    `- windowStyle: ${have.windowStyle ?? "sash"}`,
    `- sections: ${have.sections ?? 1}, sectionPattern: ${have.sectionPattern ?? "flush"}`,
    `- colors: wall ${have.wallColor ?? "earthy"}, trim ${have.trimColor ?? "white"}, door ${have.doorColor ?? "racing-green"}`,
    `- preset: ${have.preset ?? "none"}`,
    "",
    "Meanings:",
    '- treatment "residential": windows + front door. "shopfront": retail glazing across the ground floor. "garage": vehicle door instead of an entrance.',
    "- stoop: entry steps in front of the door (residential only).",
    "- windowSize small/medium/large controls window proportions within each bay.",
    "- doorBay is 1-based from the left and must not exceed bays.",
    '- windowStyle: internal glazing bars — georgian (small-pane grid), sash (2-over-2), victorian (1-over-1), none (plain glass). Echo current unless the user mentions panes/glazing.',
    '- sections: the facade divides into that many vertical strips of whole bays; sectionPattern names their relief — recessed-center / projected-center (center strip steps back/forward), alternating, flush (no relief), custom (user-sculpted). Echo the current values unless the user asks about sections, relief, or a projecting/recessed part.',
    "- preset: georgian (classical terrace), victorian-shopfront (retail ground floor), modern (minimal). Set it when the user names a style; otherwise echo the current value.",
  ].join("\n");
}
