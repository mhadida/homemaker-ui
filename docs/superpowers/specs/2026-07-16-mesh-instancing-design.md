# Scene-Wide Mesh Instancing (Perf) — Design

**Status:** design for review
**Date:** 2026-07-16
**Motivation:** City-scale street grids render ~74 individual `<mesh>` per building (each window = frame box + glass box + glazing bars; plus sills, doors, stoops, cornice/parapet trim). A few hundred buildings ⇒ tens of thousands of draw calls + a matching shadow pass ⇒ lag.

## Goal

Cut draw calls by 1–2 orders of magnitude at city scale by drawing every
repeated box element **once per material** as a `THREE.InstancedMesh`, with no
visible change to a single building.

## Key insight

Almost every small facade element is a **unit box scaled + positioned** (window
frame, glass pane, glazing bar, sill, door leaf/panels, stoop, cornice/parapet
trim, awning slats). A box instance is fully described by a `Matrix4`
(position·rotation·scale) + a color. So the entire scene's small boxes collapse
into **one `InstancedMesh` per material** (opaque wall-colored, trim-colored,
glass, door-colored, …), each a unit `BoxGeometry` with per-instance matrix +
per-instance color (`instanceColor`).

Unique, low-count geometry stays per-building: the **wall** (ExtrudeGeometry
with punched holes), **roofs**, **massing boxes**, **gables**, **passage
arches**. These are 1–few per building — not the draw-call explosion — and are
not boxes.

## Architecture

### 1. Harvest (pure) — `src/lib/facade/instancing.ts` (new)

A pure function turns a building's layout into a flat list of box-instance specs
in the building's LOCAL frame:

```ts
interface BoxInstance {
  material: "wall" | "trim" | "glass" | "door" | "dark"; // → one InstancedMesh each
  /** local position, rotation (Y/Z), and box dimensions (w,h,d) → a Matrix4. */
  pos: [number, number, number];
  rot?: [number, number, number];
  size: [number, number, number];
  color?: string; // per-instance override (wall/trim/door vary per building)
}

// Every box the current FacadeMesh emits, as data (mirrors FacadeMesh exactly).
function harvestBoxes(layout: FacadeLayout, params: FacadeParams): BoxInstance[];
```

This is the load-bearing, testable core: it must reproduce the EXACT boxes
`FacadeMesh` renders today (positions, sizes, materials) — verified by golden
tests comparing harvested boxes against the known geometry for each treatment.

### 2. Compose world matrices (pure) — same module

```ts
// building world transform (from SceneContents: position + rotationY) composed
// with each local box → world Matrix4, grouped by material.
function worldInstances(
  buildings: { world: { pos: Vec3; rotY: number }; boxes: BoxInstance[] }[],
): Record<Material, { matrix: Matrix4; color: Color }[]>;
```

### 3. Render — `SceneContents` (+ a new `InstancedBoxes` component)

`SceneContents` gathers `worldInstances` across all placed lots and renders one
`<instancedMesh>` per material (unit `boxGeometry`, `count = N`, `setMatrixAt` +
`setColorAt` in a `useMemo`/`useLayoutEffect`, `instanceMatrix.needsUpdate`).
Shadows configured per material (walls/trim cast+receive; glass neither — a perf
+ correctness win). The per-building `FacadeMesh` keeps ONLY the unique geometry
(wall/roof/massing/gable/arch); its box elements move to the harvest.

### Selection + interactivity

Instanced boxes are non-interactive (selection already happens via the
lot/block hit-targets and the wall mesh, not the trim). Confirm the existing
click/select path doesn't depend on window meshes as raycast targets; if it
does, keep an invisible per-lot hit-plane.

## Migration / risk control

This touches the highest-risk file (`FacadeMesh`, 931 lines). To keep visual
parity and allow rollback:
- **Element-by-element:** move ONE element type at a time (windows first, then
  sills, doors, trim, stoops, glazing bars), each behind the same visual
  checkpoint, so a regression is isolated to one element.
- **Golden test per element:** `harvestBoxes` output for a fixed
  layout/treatment is asserted against expected boxes — a regression fails a
  unit test, not just the eye.
- **Byte-identical fallback:** a `USE_INSTANCING` flag (default on) lets us fall
  back to the old per-mesh path if a scene looks wrong.

## Testing

- `harvestBoxes`: for each treatment (residential / shopfront / garage /
  passage) and window style (sash / georgian / victorian / plain), the harvested
  box set matches the elements `FacadeMesh` renders (count, positions, sizes,
  materials) — golden tests.
- `worldInstances`: composes building transform × local correctly (a box at
  local origin under a rotated/translated building lands at the expected world
  point).
- Visual: a city grid before/after shows identical buildings; draw-call count
  (spector/stats) drops sharply; frame rate recovers.

## Out of scope

- Instancing the wall/roof/massing/gable geometry (unique per building; not the
  bottleneck).
- LOD / frustum culling / merged-geometry per block (possible later levers).
- Texture atlasing (materials are flat-colored; per-instance color suffices).
