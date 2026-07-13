# Massing Boxes — Design Spec (v6)

**Date:** 2026-07-14
**Status:** Design decisions made autonomously (owner authorized finishing
v5–v8 locally; owner reviews this spec's decisions table on return).
**Depends on:** v5 facade sections (massing reuses the `SectionStrip[]`
partition), v4 corners, v1–v3.

## Purpose

Facades are currently thin front skins. Give each building a **body** — a
plain box behind the facade with controllable depth — so the street reads
as solid buildings, and so v7 roofs have a mass to sit on.

User requirement (verbatim): "then i want to create massing behind all the
facades. just plain boxes with controllable depth."

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Granularity of the box | **One box per SECTION** (per v5 SectionStrip), not per lot. Degenerates to one box when the lot has no sections. | A single per-lot box cannot compose with v5 relief: a recessed section's windows would be occluded by the box front, and a proud section would show a side gap. Per-section boxes each sit flush behind their own wall. |
| Depth control | Per-lot field `massingDepth` (metres), default 8, range 3–20; a panel slider in a new "Massing" section. Generated lots get a small seeded depth range (6–12) for street variety. | Matches the existing per-lot param pattern (width/storeys). "Controllable depth" = a slider. |
| Depth across corners | NOT synced — depth is per-facade. A corner building's two frontages may have different depths (an honest L). | Depth is geometry, not the shared "shell" (colors/ornament). Keeping it per-face avoids forcing a square footprint. |
| Box front plane | Each section box front at `z = sectionOffset − WALL_THICKNESS` (flush with that section's wall back), extending back to `z = sectionOffset − massingDepth`. | Flush-behind-each-wall is the invariant that kills both the occlusion and the side-gap failure modes. |
| Material | Wall-colored (matches the section's building), plain matte, no holes. The existing thin-wall window recess is untouched — windows keep their current dark-reveal look; the mass just fills the void behind. | "Just plain boxes." Wall-colored so the building reads as one solid mass, not a separate grey object. Not punching window holes keeps the mass trivial and avoids interior-lighting work (deferred to if/when interiors matter). |
| Height | `massingTop = layout.wallTop` (same top as the wall body; cornice/parapet still project above it). Flat top for v6. | The mass is the building body up to the eaves; roofs (v7) cap it. |
| Sections' side reveals | Adjacent section boxes at different offsets leave a side reveal equal to their offset difference (≤0.30 m) along the depth — the same reveal the v5 section returns already show at the wall, continued deeper. Not closed with extra geometry. | Only visible looking straight down a section reveal from a steep angle; inside the building footprint; acceptable and cheap. |
| Corner overlap | Two perpendicular corner-lot masses overlap solidly in the corner region (invisible, like concave corner walls). Proper L-merge deferred. | Opaque solids overlapping read fine; L-merge is v7+ polish. |
| Empty/default | `massingDepth` absent → a sensible default is applied by the layout clamp (8 m); pre-v6 params (no field) render with the default box. There is no "zero massing" — every building has a body. | A building without a body is the old paper-wall bug, not a feature. If "no mass" is ever wanted it's a separate toggle (deferred). |

## Data model

`FacadeParams` gains:
```ts
/** Building body depth behind the facade, metres. Clamped
 * [MASSING_DEPTH_MIN, MASSING_DEPTH_MAX] by the layout engine. Absent =
 * MASSING_DEPTH_DEFAULT (every building has a body). */
massingDepth?: number;
```
Layout constants (in `layout.ts`): `MASSING_DEPTH_MIN = 3`,
`MASSING_DEPTH_MAX = 20`, `MASSING_DEPTH_DEFAULT = 8`.

## Layout engine (pure)

`computeLayout` returns the single clamped depth:
```ts
/** Clamped building-body depth (m). The mesh renders one box per section
 * strip using this + each strip's x0/x1. */
massingDepth: number;
```
All clamping (range, non-finite sanitize, default-when-absent) lives here.
The per-section box count falls out of the mesh's existing per-strip loop —
no per-box layout entity needed (the strip group already carries the
offset, so a box built in local coords front=−WALL_THICKNESS, back=−depth
lands at world z = offset−WALL_THICKNESS … offset−depth, matching the
"flush behind each wall" invariant for free).

## Mesh (`FacadeMesh.tsx`)

Inside each existing per-strip `<group position={[0,0,strip.offset]}>`, add
one `<mesh>` box: width `strip.x1−strip.x0`, height `wallTop`, depth
`massingDepth−WALL_THICKNESS`, centered at
`[(x0+x1)/2, wallTop/2, −(WALL_THICKNESS+massingDepth)/2]`, wall-colored
matte, castShadow+receiveShadow. Plain `<boxGeometry>` (R3F auto-disposes
element geometries — no manual dispose needed, unlike the extruded wall).
No per-frame allocation.

## Controls

New "Massing" `Section` in the lot panel: a single `Depth` slider
(3–20 m, step 0.5, display `${d.toFixed(1)}m`). Block inspector unchanged
(depth is per-lot; a block-gen range is deferred).

## Generation

`generateLot` sets `massingDepth` from a seeded draw in [6, 12], drawn LAST
from the lot's existing stream so it never perturbs any earlier field's
determinism. Reroll regenerates it for unpinned lots; pinned lots keep theirs.

## AI prompt

Deferred. Massing depth is a niche numeric; the local parser and AI spec
stay unchanged. (Recorded so a reviewer doesn't flag it as missing.)

## Testing (vitest, pure)

- `computeLayout` massing: depth clamped to [3,20]; default 8 when absent;
  one MassBox per section (1 when no sections); box front = offset −
  WALL_THICKNESS, back = offset − depth, top = wallTop; non-finite depth
  sanitized.
- No-massing-field path: adding the default must NOT change any existing
  layout output (openings, wall, cornice, parapet) — existing suite pins it.
- `generateLot`: massingDepth in [6,12], deterministic, reroll pins.
- Mesh + material verified in the browser.

## Not in scope (deferred)

Per-block depth range in the inspector; corner L-merge of masses; window
holes through the mass / interior; roofs (v7); AI depth; a "no body" toggle.
