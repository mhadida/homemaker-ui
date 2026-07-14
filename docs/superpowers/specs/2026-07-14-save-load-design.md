# Save / Load facade scenes — design

**Date:** 2026-07-14
**Feature tag:** v15
**Status:** approved (JSON + file export/import + localStorage autosave), shipped

## Decision

The facade scene is already a JSON-native object graph (blocks + a few
scalars + one Map), so **JSON** is the format — not XML (verbose, needs a
mapping layer) or SQLite (overkill; nothing relational or queryable, and the
facade tool has no server data path). Persistence is **client-side**:

- **Explicit file export/import** — the portable, shareable, backend-free
  mechanism (Save downloads `facade-scene.json`; Load imports one).
- **localStorage autosave** — silent crash/refresh insurance, restored on
  mount.

Rejected: a backend/DB (needs auth + API; deferred until sharing/multi-device
is actually wanted).

## The document

```ts
interface FacadeDocument {
  version: 1;                                  // reject unknown versions
  blocks: FacadeBlock[];
  cornerChoices: [string, CornerChoice][];     // Map → entries (JSON has no Map)
  ground: Ground;
  streetWidth: number;
  maxCornerAngle: number;
}
```

Transient UI (selection, marquee, draw mode) is **not** part of the document.

## Pure module `src/lib/facade/document.ts`

- `serializeScene(SceneState): FacadeDocument` / `toJSON(SceneState): string`.
- `deserializeScene(unknown): LoadResult` / `fromJSON(string): LoadResult`,
  where `LoadResult = {ok:true, scene} | {ok:false, error}` — **never throws**.
  Validates: object shape, `version === SCENE_VERSION`, `blocks` is an array
  of structurally-valid blocks (id, two numeric line endpoints, ≥1 lot with
  `params`). Missing optional scalars (cornerChoices/ground/streetWidth/
  maxCornerAngle) fall back to defaults so older/hand-edited saves load.
- Deep per-field FacadeParams validation is intentionally skipped: the layout
  engine already clamps every field, so a partial lot renders safely.

## Wiring (`page.tsx`)

- `applyScene(SceneState)`: `reserveBlockIds` (bump the id counter past loaded
  ids), `setBlocks(syncCorners(...))` (idempotent for clean saves; repairs
  hand-edited files), set the scalars + cornerChoices, select the first block.
- **Save** button → `toJSON` → Blob → `<a download>`.
- **Load** button → hidden `<input type=file>` → `fromJSON` → `applyScene`;
  a parse/validation error shows a transient header message.
- **Autosave**: debounced (500 ms) write of the current scene to
  `localStorage["facademaker:autosave"]`; restored once on mount (guarded
  against Strict-Mode double-invoke; a failed/empty restore clears the key).

## `reserveBlockIds` (blocks.ts)

`nextBlockId()` uses a module `idCounter`. After a load, scan loaded `block-N`
ids and bump the counter past the max so a freshly-drawn block can never
reuse a loaded id.

## Byte-identical invariant

No autosave present + never touching Save/Load → identical to before (blank
start, blocks drawn from scratch). The document module is additive; the id
counter only ever moves forward.

## Tests (`src/lib/facade/document.test.ts`)

Round-trip (serialize→deserialize, toJSON→fromJSON) preserves blocks / the
cornerChoices Map / scalars; version stamped; rejects non-object, unknown
version, missing blocks, malformed block (bad line, no lots), non-JSON text;
missing optional scalars → defaults; `reserveBlockIds` bumps the counter.
