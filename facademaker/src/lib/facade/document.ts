import type { FacadeBlock } from "./blocks";
import type { CornerChoice } from "./corners";
import { DEFAULT_MAX_CORNER_ANGLE } from "./corners";
import type { Ground, Heightfield } from "./terrain";
import { DEFAULT_GROUND } from "./terrain";
import { STREET_WIDTH_DEFAULT } from "./street";
import type { FacadeParams } from "./types";
import { DEFAULT_FACADE } from "./types";
import type { Monument, Street, StreetNetwork } from "@/lib/street/types";
import { EMPTY_NETWORK, STREET_SPECS } from "@/lib/street/types";
import type { GeoAnchor, LngLatBBox } from "@/lib/geo/project";
import type { ParcelSubdivisionEdit } from "@/lib/geo/parcelSubdivision";

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
  anchor: GeoAnchor | null;
  /** bbox the context buildings were fetched for — the re-fetch key. The
   * footprints themselves are NEVER serialized (thousands of polygons). */
  bbox: LngLatBBox | null;
  /** Context buildings the user demolished, by OSM id. Sparse. */
  hiddenIds: Set<string>;
  /** Sparse local replacements for official cadastral parcels. */
  parcelEdits?: ParcelSubdivisionEdit[];
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
  anchor?: GeoAnchor;
  bbox?: LngLatBBox;
  hiddenIds?: string[];
  parcelEdits?: ParcelSubdivisionEdit[];
}

export type LoadResult =
  | { ok: true; scene: SceneState }
  | { ok: false; error: string };

/** Whether a scene has anything worth treating as non-empty — hand-drawn
 * blocks/streets, OR a loaded real place (a terrain heightfield in
 * `ground.hf` and/or the context-buildings re-fetch key `bbox`). A loaded
 * place is real scene state the user fetched (terrain + the bbox footprints
 * re-fetch from) and is worth autosaving/restoring even before any block is
 * drawn on top of it, so it counts as content alongside blocks/streets.
 * Shared by facade/page.tsx's autosave-write guard and mount-time restore
 * guard so the two conditions can't drift apart — narrowing this back to
 * "blocks or streets only" would make a place-only scene unrestorable again. */
export function sceneHasContent(
  s: Pick<SceneState, "blocks" | "streetNetwork" | "ground" | "bbox">,
): boolean {
  return (
    s.blocks.length > 0 ||
    s.streetNetwork.streets.length > 0 ||
    !!s.ground.hf ||
    !!s.bbox
  );
}

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
    anchor: s.anchor ?? undefined,
    bbox: s.bbox ?? undefined,
    hiddenIds: s.hiddenIds.size ? Array.from(s.hiddenIds) : undefined,
    parcelEdits: s.parcelEdits?.length ? s.parcelEdits : undefined,
  };
}

/** Pure: pretty JSON text of the current scene (what Save writes to a file).
 * Indented because a downloaded file is read by humans. */
export function toJSON(s: SceneState): string {
  return JSON.stringify(serializeScene(s), null, 2);
}

/** Pure: COMPACT JSON text, for the localStorage autosave.
 *
 * Deliberately not `toJSON`: nothing reads the autosave by eye, and the
 * indented form of a real-city scene (a 128x79 terrain heightfield plus 212
 * imported streets, each number on its own indented line) measured **2.79 MB**
 * — past Chrome's ~5 MB UTF-16 localStorage budget, so every autosave threw
 * QuotaExceededError. Same bytes of information, a fraction of the
 * characters. */
export function toCompactJSON(s: SceneState): string {
  return JSON.stringify(serializeScene(s));
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

/** A promoted block's real parcel (M4): a source id, a polygon of at least
 * three finite [x, z] vertices, and a finite depth. Malformed values are
 * DROPPED rather than failing the document — same idiom as validStreet /
 * validHeightfield / validBBox, so one corrupted parcel cannot white-screen an
 * otherwise-good save. */
function validParcel(v: unknown): v is NonNullable<FacadeBlock["parcel"]> {
  if (!isObject(v)) return false;
  if (typeof v.source !== "string") return false;
  if (
    v.contextBuildingId !== undefined &&
    typeof v.contextBuildingId !== "string"
  )
    return false;
  if (!isFiniteNumber(v.depth)) return false;
  const o = v.outline;
  return (
    Array.isArray(o) &&
    o.length >= 3 &&
    o.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        isFiniteNumber(p[0]) &&
        isFiniteNumber(p[1]),
    )
  );
}

function validCadastralParcel(v: unknown): boolean {
  if (!isObject(v) || typeof v.id !== "string") return false;
  if (v.sourceId !== undefined && typeof v.sourceId !== "string") return false;
  return (
    Array.isArray(v.polygons) &&
    v.polygons.length > 0 &&
    v.polygons.every(
      (polygon) =>
        Array.isArray(polygon) &&
        polygon.length > 0 &&
        polygon.every(
          (ring) =>
            Array.isArray(ring) &&
            ring.length >= 3 &&
            ring.every(
              (point) =>
                Array.isArray(point) &&
                point.length === 2 &&
                isFiniteNumber(point[0]) &&
                isFiniteNumber(point[1]),
            ),
        ),
    )
  );
}

function validParcelSubdivisionEdit(v: unknown): v is ParcelSubdivisionEdit {
  return (
    isObject(v) &&
    typeof v.sourceId === "string" &&
    Array.isArray(v.replacements) &&
    v.replacements.length >= 2 &&
    v.replacements.every(validCadastralParcel)
  );
}

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

// Derived from STREET_SPECS (the single source of truth for street types) so a
// newly-added type can never silently fail to load. A hand-maintained list here
// previously drifted and dropped `canal` streets on load.
const STREET_TYPES: ReadonlySet<string> = new Set(Object.keys(STREET_SPECS));

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
  const kinds: ReadonlySet<string> = new Set([
    "obelisk",
    "fountain",
    "statue",
    "triumphal-arch",
  ]);
  return (
    Array.isArray(r) &&
    r.length === 2 &&
    typeof r[0] === "string" &&
    isObject(r[1]) &&
    typeof (r[1] as { kind?: unknown }).kind === "string" &&
    kinds.has((r[1] as { kind: string }).kind)
  );
}

/** A heightfield: finite grid scalars plus a data array whose length matches
 * cols·rows, every entry finite. Defensive guard for a loaded `ground.hf` —
 * malformed terrain is STRIPPED (not trusted, not thrown on). cols/rows must
 * be at least 2 (a grid needs two points per axis to span anything) and
 * spacing must be positive — otherwise `cols:0,rows:0,spacing:0,data:[]`
 * passes the finite + length checks below (0 is finite, [].length === 0×0)
 * and a corrupt/degenerate save would load a zero-area grid instead of being
 * stripped. */
export function validHeightfield(v: unknown): v is Heightfield {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  const nums = ["originX", "originZ", "spacing", "cols", "rows"];
  if (!nums.every((k) => isFiniteNumber(h[k]))) return false;
  const cols = h.cols as number;
  const rows = h.rows as number;
  const spacing = h.spacing as number;
  if (cols < 2 || rows < 2 || spacing <= 0) return false;
  return (
    Array.isArray(h.data) &&
    h.data.length === cols * rows &&
    (h.data as unknown[]).every((n) => isFiniteNumber(n))
  );
}

/** A context-buildings bbox: four finite lng/lat bounds. Defensive guard for
 * a loaded `bbox` — malformed (missing/non-finite fields) is DROPPED (not
 * trusted, not thrown on), same idiom as validHeightfield above. */
export function validBBox(v: unknown): v is LngLatBBox {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (["west", "south", "east", "north"] as const).every((k) => isFiniteNumber(b[k]));
}

/** Normalize every lot's params so the loaded blocks are render-safe, and
 * drop a malformed `parcel` (M4) so a corrupt outline can never reach the
 * renderer — `ParcelOutline` would otherwise mount a fat line built from
 * non-finite points. */
function normalizeBlocks(blocks: Record<string, unknown>[]): FacadeBlock[] {
  return blocks.map((b) => {
    const { parcel: rawParcel, ...rest } = b;
    return {
      ...(rest as unknown as FacadeBlock),
      ...(validParcel(rawParcel) ? { parcel: rawParcel } : {}),
      lots: (b.lots as Record<string, unknown>[]).map((l) => {
        const normalized: Record<string, unknown> = {
          ...l,
          params: normalizeParams(l.params as Record<string, unknown>),
        };
        if (normalized.kind !== "arch-gate") delete normalized.kind;
        return normalized as unknown as FacadeBlock["lots"][number];
      }),
    };
  }) as FacadeBlock[];
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

  const rawGround = doc.ground as (Ground & { hf?: unknown }) | undefined;
  const ground: Ground =
    typeof rawGround === "object" &&
    rawGround !== null &&
    isFiniteNumber(rawGround.slope) &&
    isFiniteNumber(rawGround.azimuth)
      ? {
          slope: rawGround.slope,
          azimuth: rawGround.azimuth,
          ...(validHeightfield(rawGround.hf) ? { hf: rawGround.hf } : {}),
        }
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
          // Square monuments share the roundabout entry shape ([id, monument]).
          // Additive — old saves have no field and load with none.
          squares: Array.isArray((rawNet as { squares?: unknown }).squares)
            ? ((rawNet as { squares: unknown[] }).squares).filter(validRoundabout)
            : [],
        }
      : EMPTY_NETWORK;

  // Additive (older saves have no field at all → null, flat/manual ground).
  const rawAnchor = doc.anchor as Partial<GeoAnchor> | undefined;
  const anchor: GeoAnchor | null =
    rawAnchor && isFiniteNumber(rawAnchor.lat0) && isFiniteNumber(rawAnchor.lon0)
      ? { lat0: rawAnchor.lat0, lon0: rawAnchor.lon0 }
      : null;

  // Additive (older saves have no field at all). The footprints themselves
  // are never persisted — bbox is only the re-fetch key, hiddenIds only the
  // demolished-building set — so a malformed value just falls back to
  // "nothing loaded" rather than failing the whole document.
  const bbox: LngLatBBox | null = validBBox(doc.bbox) ? doc.bbox : null;
  const hiddenIds = new Set<string>(
    Array.isArray(doc.hiddenIds)
      ? (doc.hiddenIds as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
  );
  const parcelEdits = Array.isArray(doc.parcelEdits)
    ? doc.parcelEdits.filter(validParcelSubdivisionEdit)
    : [];

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
      anchor,
      bbox,
      hiddenIds,
      parcelEdits,
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
