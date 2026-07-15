import type { FacadeBlock } from "./blocks";
import type { CornerChoice } from "./corners";
import { DEFAULT_MAX_CORNER_ANGLE } from "./corners";
import type { Ground } from "./terrain";
import { DEFAULT_GROUND } from "./terrain";
import { STREET_WIDTH_DEFAULT } from "./street";
import type { FacadeParams } from "./types";
import { DEFAULT_FACADE } from "./types";
import type { Monument, Street, StreetNetwork, StreetType } from "@/lib/street/types";
import { EMPTY_NETWORK } from "@/lib/street/types";

/** Bump when the on-disk shape changes incompatibly. Loaders reject unknown
 * versions rather than silently mis-reading (beta data-preservation rule). */
export const SCENE_VERSION = 1;

/** The live scene state the page owns and that a saved file round-trips.
 * Transient UI (selection, marquee, draw mode) is NOT part of the document. */
export interface SceneState {
  blocks: FacadeBlock[];
  cornerChoices: Map<string, CornerChoice>;
  ground: Ground;
  streetWidth: number;
  maxCornerAngle: number;
  streetNetwork: StreetNetwork;
}

/** JSON-native form. `cornerChoices` is a Map in memory → entries on disk
 * (JSON has no Map). Everything else is already plain JSON. */
export interface FacadeDocument {
  version: number;
  blocks: FacadeBlock[];
  cornerChoices: [string, CornerChoice][];
  ground: Ground;
  streetWidth: number;
  maxCornerAngle: number;
  streetNetwork: StreetNetwork;
}

export type LoadResult =
  | { ok: true; scene: SceneState }
  | { ok: false; error: string };

/** Pure: live state → serializable document (Map → entries). */
export function serializeScene(s: SceneState): FacadeDocument {
  return {
    version: SCENE_VERSION,
    blocks: s.blocks,
    cornerChoices: Array.from(s.cornerChoices.entries()),
    ground: s.ground,
    streetWidth: s.streetWidth,
    maxCornerAngle: s.maxCornerAngle,
    streetNetwork: s.streetNetwork,
  };
}

/** Pure: pretty JSON text of the current scene (what Save writes to a file). */
export function toJSON(s: SceneState): string {
  return JSON.stringify(serializeScene(s), null, 2);
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A drawn segment: two numeric [x,z] endpoints. */
function validLine(line: unknown): boolean {
  if (typeof line !== "object" || line === null) return false;
  const l = line as { a?: unknown; b?: unknown };
  const pt = (p: unknown) =>
    Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]);
  return pt(l.a) && pt(l.b);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Structural validation of one block — enough to keep the renderer from
 * crashing (id, line endpoints, a non-empty lots array whose lots each carry
 * an object `params`). Missing scalar fields are tolerated (the layout engine
 * clamps them); missing NESTED objects are filled by normalizeParams below,
 * which is what makes "partial lot renders safely" actually true. A
 * non-object `params` is genuinely broken and rejected (graceful error). */
function validBlock(b: unknown): boolean {
  return (
    isObject(b) &&
    typeof b.id === "string" &&
    typeof b.flipped === "boolean" &&
    validLine(b.line) &&
    Array.isArray(b.lots) &&
    b.lots.length > 0 &&
    b.lots.every((l) => isObject(l) && isObject((l as { params?: unknown }).params))
  );
}

/** Fill any missing FacadeParams fields from DEFAULT_FACADE — critically the
 * nested `groundFloor`/`ornament` objects that computeLayout dereferences
 * unguarded — so a partial/hand-edited lot renders instead of crashing. */
function normalizeParams(raw: Record<string, unknown>): FacadeParams {
  const gf = isObject(raw.groundFloor) ? raw.groundFloor : {};
  const orn = isObject(raw.ornament) ? raw.ornament : {};
  return {
    ...DEFAULT_FACADE,
    ...raw,
    groundFloor: { ...DEFAULT_FACADE.groundFloor, ...gf },
    ornament: { ...DEFAULT_FACADE.ornament, ...orn },
  } as FacadeParams;
}

const STREET_TYPES: ReadonlySet<string> = new Set<StreetType>([
  "alley",
  "street",
  "road",
  "boulevard",
]);

/** A drawn street: id, a known type, and a non-empty points array of
 * [finite, finite] pairs. Mirrors validLine/validBlock's shape-check style,
 * but malformed streets are DROPPED rather than failing the whole document
 * (consistent with "malformed → empty" — one corrupted street shouldn't
 * take down an otherwise-good save). */
function validStreet(s: unknown): s is Street {
  if (!isObject(s)) return false;
  if (typeof s.id !== "string") return false;
  if (typeof s.type !== "string" || !STREET_TYPES.has(s.type)) return false;
  const pts = s.points;
  return (
    Array.isArray(pts) &&
    pts.length >= 1 &&
    pts.every(
      (p) => Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
    )
  );
}

/** A roundabout entry: [derived intersection key, {kind}]. */
function validRoundabout(r: unknown): r is [string, Monument] {
  return (
    Array.isArray(r) &&
    r.length === 2 &&
    typeof r[0] === "string" &&
    isObject(r[1]) &&
    typeof (r[1] as { kind?: unknown }).kind === "string"
  );
}

/** Normalize every lot's params so the loaded blocks are render-safe. */
function normalizeBlocks(blocks: Record<string, unknown>[]): FacadeBlock[] {
  return blocks.map((b) => ({
    ...(b as unknown as FacadeBlock),
    lots: (b.lots as Record<string, unknown>[]).map((l) => ({
      ...(l as { customized?: boolean; depthOffset?: number }),
      params: normalizeParams(l.params as Record<string, unknown>),
    })),
  })) as FacadeBlock[];
}

/** Pure: validate + normalize a parsed document into live scene state.
 * Missing optional scalars fall back to their defaults so older/hand-edited
 * saves still load. Returns a discriminated result — never throws. */
export function deserializeScene(raw: unknown): LoadResult {
  if (typeof raw !== "object" || raw === null)
    return { ok: false, error: "Not a facade document." };
  const doc = raw as Record<string, unknown>;
  if (doc.version !== SCENE_VERSION)
    return {
      ok: false,
      error: `Unsupported document version ${String(doc.version)} (expected ${SCENE_VERSION}).`,
    };
  if (!Array.isArray(doc.blocks))
    return { ok: false, error: "Document has no blocks array." };
  if (!doc.blocks.every(validBlock))
    return { ok: false, error: "Document contains a malformed block." };

  let cornerChoices: Map<string, CornerChoice>;
  try {
    cornerChoices = new Map(
      Array.isArray(doc.cornerChoices)
        ? (doc.cornerChoices as [string, CornerChoice][])
        : [],
    );
  } catch {
    return { ok: false, error: "Malformed cornerChoices." };
  }

  const ground: Ground =
    typeof doc.ground === "object" &&
    doc.ground !== null &&
    isFiniteNumber((doc.ground as Ground).slope) &&
    isFiniteNumber((doc.ground as Ground).azimuth)
      ? (doc.ground as Ground)
      : DEFAULT_GROUND;

  // Additive (older saves have no field at all) — also tolerate a malformed
  // `streets` (anything other than an array) rather than crash the loader.
  // Individual malformed street/roundabout entries are DROPPED (not
  // rejected) so one corrupted entry doesn't white-screen an otherwise-good
  // save — mirrors the block validation above, applied per-entry instead of
  // whole-document.
  const rawNet = doc.streetNetwork;
  const streetNetwork: StreetNetwork =
    isObject(rawNet) && Array.isArray((rawNet as { streets?: unknown }).streets)
      ? {
          streets: ((rawNet as { streets: unknown[] }).streets).filter(validStreet),
          roundabouts: Array.isArray(
            (rawNet as { roundabouts?: unknown }).roundabouts,
          )
            ? ((rawNet as { roundabouts: unknown[] }).roundabouts).filter(
                validRoundabout,
              )
            : [],
        }
      : EMPTY_NETWORK;

  return {
    ok: true,
    scene: {
      blocks: normalizeBlocks(doc.blocks as Record<string, unknown>[]),
      cornerChoices,
      ground,
      streetWidth: isFiniteNumber(doc.streetWidth)
        ? doc.streetWidth
        : STREET_WIDTH_DEFAULT,
      maxCornerAngle: isFiniteNumber(doc.maxCornerAngle)
        ? doc.maxCornerAngle
        : DEFAULT_MAX_CORNER_ANGLE,
      streetNetwork,
    },
  };
}

/** Pure: parse JSON text into scene state (Load from a file / localStorage). */
export function fromJSON(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  return deserializeScene(raw);
}
