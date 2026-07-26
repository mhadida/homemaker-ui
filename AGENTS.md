<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.1) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Homemaker UI

Interactive parametric building editor. Users draw a building footprint on a map, configure parameters, and Blender generates an IFC model.

## Architecture

Four parts work together:

- **`homemaker-ui/`** (this repo) — Next.js 16 app, the interactive editor. Generates IFC + glTF in pure Python (`ifcopenshell` + `topologic_core` + Molior) — no Blender needed in the deployed web app.
- **`python/vendor/homemaker-addon/`** — Bruno Postle's Blender addon, vendored as a Git submodule pinned to a known-good commit. Provides the Molior IFC generator.
- **`../homemaker-blender/`** (sibling repo, optional) — developer tooling: MCP server + Blender workspace for driving a running Blender instance from agents like Claude Code. Not required for the web app.
- **Blender** (optional, dev-only) — runs Bonsai + Homemaker addons when you want to use the MCP bridge.

## Commands

| What | Command | Notes |
|------|---------|-------|
| Dev server | `npm run dev` | Next.js dev server on :3000 |
| Build | `npm run build` | |
| Start prod | `npm run start` | |
| Lint | `npm run lint` | ESLint 9 flat config (`eslint.config.mjs`) |
| Typecheck | `npx tsc --noEmit` | No npm script exists — run manually |
| MCP server (dev only) | `uv run ../homemaker-blender/mcp_server.py` | Bridges agents to a running Blender; lives in the sibling repo |
| Tests | `npm test` | vitest — src/lib/facade + src/lib/street unit tests |

**Tests:** vitest covers the pure facade modules — layout engine (incl. section strips), prompt parser, street generator (`refit`/`deleteLot`), node welding, corner detection/sync/miters, section edit helpers, street-aware orientation, and marquee hit-test/delete/translate (`src/lib/facade/*.test.ts`) — plus the standalone street-network module: centreline smoothing, ribbon offsets, roundabout rings, derived intersections, and the Krier/Alexander advisory (`src/lib/street/*.test.ts`) — run `npm test`. Real-city import adds `src/lib/geo/*.test.ts` (projection, DEM
decode/resample, OSM→building/street mapping, way merging, Overpass failover +
cache, request validation), parcel frontage-fitting and promote/subdivide/merge
(`src/lib/geo/parcel.test.ts`, `src/lib/facade/promote.test.ts`), and two
fixture guards — the demo-fixture shape/anchor check and a `fitFrontage` sweep
over all 1,585 real footprints. No e2e/playwright;
everything else is verified visually — **and in this codebase the bugs that
mattered were only findable by running the app** (a 0-height picker map, a
missing Overpass User-Agent, a 1.8 s-per-frame drag freeze, an uncaught
localStorage `QuotaExceededError` that killed the editor on reload), so treat a
green suite as necessary, not sufficient. A green suite is not even sufficient
for *correctness*: the M4 frontage fitter passed a 99.3% fixture guard while
putting every canal house's facade on its party wall, because the guard
measured whether a frontage was produced, not whether it was the right one.
Assert the property you actually care about.

## Blender is NOT a runtime dependency of the web app

The deployed web app (Vercel + the local `npm run dev` flow) generates IFC and glTF purely in Python via Molior + `ifcopenshell` + `topologic_core`. The pipeline entry is `python/generate.py:build_and_export_glb()`.

Blender is **optional dev tooling**, only used if you want to drive a running Blender instance from an MCP-connected agent. That flow lives in the sibling [`homemaker-blender`](../homemaker-blender/) repo (private). When using it, Blender must run with Bonsai + the Homemaker addon enabled and the BlenderMCP socket server listening on `127.0.0.1:9876`.

The startup sequence matters: Bonsai first, then Homemaker. The autostart script handles this: `~/Library/Application Support/Blender/4.3/scripts/startup/homemaker_autostart.py`

## Key file layout

```
src/
  app/
    page.tsx          — Main parametric editor (viewer + controls, manual-update mode)
    facade/page.tsx   — Facade designer: single street-facing facade for infill lots
    layout.tsx        — Root layout, dark-only theme
    globals.css       — Tailwind v4 imports + dark CSS vars
    api/
      generate-building/route.ts — POST: runs the Python pipeline via python-server, returns glb
      debug-walls/route.ts       — GET: serves debug glbs (walls/windows/roofs) from /tmp
      prompt/route.ts            — POST: AI prompt parsing (Vercel AI Gateway)
      facade-prompt/route.ts     — POST: AI prompt parsing for the facade designer
      terrain/route.ts           — POST: bbox+anchor → real DEM heightfield (M1)
      buildings/route.ts         — POST: bbox+anchor → OSM footprints (M2)
      streets/route.ts           — POST: bbox+anchor → OSM streets + canals (M3)
  components/
    demo/
      BuildingViewer.tsx   — R3F canvas with orbit controls, lighting, grid, compass
      GLTFBuildingScene.tsx — Fetches/caches glbs from /build, applies cosmetic colors
      PromptInput.tsx      — Natural language prompt + suggestion chips
      SliderControls.tsx   — Storeys, heights, footprint shape, style, roof, facades
    facade/
      FacadeViewer.tsx   — R3F canvas, front-hemisphere orbit, save-image
      FacadeMesh.tsx     — FacadeLayout → meshes (wall, openings, ornament)
      FacadeControls.tsx — presets + sliders + toggles panel
      BayGrid.tsx        — tappable per-cell opening editor
      SceneContents.tsx  — shared world scene (blocks, ground, lights)
      PlacePicker.tsx    — MapLibre bbox picker modal (real-city import)
      ContextBuildings.tsx — merged backdrop mesh for imported footprints
  lib/
    blender.ts        — TCP socket client to Blender (port 9876)
    python-server.ts  — Long-running Python child process serving pipeline requests (local dev)
    building/
      types.ts         — BuildingParams, StyleId, RoofType, defaults
      footprints.ts    — Rectangle/L/U/H/courtyard footprint generators
      prompt-parser.ts — Local keyword parser + AI prompt builder
      index.ts         — Re-exports
    facade/
      types.ts         — FacadeParams, presets, defaults
      layout.ts        — pure layout engine (params → rectangles, all clamps)
      prompt-parser.ts — local keyword parser + deep merge
      camera.ts        — ortho fit + normal-derived elevation cameras
      blocks.ts        — street blocks: frames, lot placement, selection types
      generate.ts      — seeded generator: subdivision, lot params, reroll
      nodes.ts         — derived nodes (coincidence welds), moveNode + refit ripple
      corners.ts       — corner detection (turn/convexity), shell sync, miters
      sections.ts      — facade-section edit helpers (canonical writes, AI patterns)
      grid.ts          — rectilinear drawing grid: lattice snap + 90° axis lock
      promote.ts       — real footprint → editable block (M4); subdivide/merge
      clip.ts          — world size (GROUND_HALF), perspective far plane, and the
                         plan-camera / walk-catcher heights derived from
                         MAX_BUILDING_HEIGHT (real buildings exceed the old y=60)
    geo/               — REAL-CITY IMPORT (all pure unless noted)
      project.ts       — lon/lat ⇄ local metres (ENU; east→+x, north→+z)
      dem.ts           — terrarium decode, web-mercator tiles, resample
      terrainProvider.ts — TerrainProvider + AWS Terrain Tiles adapter (network)
      buildings.ts     — OSM footprints → ContextBuilding (height, base, filter)
      buildingProvider.ts — BuildingProvider + Overpass adapter (network)
      streets.ts       — OSM ways → Street (classify, width, merge, project, cap)
      streetProvider.ts  — StreetProvider + Overpass adapter (network)
      overpass.ts      — shared Overpass client: mirror failover + TTL cache
      demoPlace.ts     — the committed offline Amsterdam fixture's bbox/anchor
      parcel.ts        — real parcel polygon → frontage line, facing, depth
  types/
    mapbox-gl-draw.d.ts — Type declarations (legacy, unused; the real map UI is
                          PlacePicker.tsx on maplibre-gl)
python/
  generate.py             — IFC + glTF pipeline (entry: build_and_export_glb)
  build.py                — Vercel Function entrypoint (POST → glb, GET → "ok")
  server.py               — Local-dev stdio child server
  vendor/homemaker-addon/ — Submodule (Bruno Postle's addon)
```

## Facade designer (`/facade`)

A single-wall parametric facade designer for infill urban lots (one street-facing
facade, party walls both sides). Pure client-side Three.js — the Python pipeline is
NOT involved; every edit is live (no Update button). Spec:
`docs/superpowers/specs/2026-07-06-facade-designer-design.md`.

- **Layout engine**: `src/lib/facade/layout.ts` is a pure function
  (FacadeParams → rectangles) holding ALL validity clamps; the mesh renders
  whatever it returns.
- **Grid model**: (storeys × bays) cells, treatment-derived defaults + sparse
  `cellOverrides` patches.
- **Quad workspace**: plan / perspective / elevation overview / detail as
  drei `<View>` viewports over one Canvas (`FacadeViewer.tsx`); elevation
  cameras always aim along the facade normal (`src/lib/facade/camera.ts`).
- **Display modes**: a `BuildingDisplay` (`blocks.ts`) view mode — `full`
  (detailed facades, default), `massing` (plain wall-colored volume boxes,
  `MassingBox`), `outline` (wireframe lot volumes, `OutlineBox`), `off`
  (buildings hidden; streets/sidewalks/lot lines remain). Internal
  `FacadeViewer` state (a segmented selector, not persisted) threaded to
  `SceneContents`/`BlockGroup`; `full` skips nothing and gates the window
  instancer, so it is byte-identical.
- **Blocks & streets**: pen-tool drawing in the plan pane — click chains
  nodes into welded segments (Escape ends, clicking the first node closes
  the loop); every segment is a generated block (`src/lib/facade/blocks.ts`
  + `generate.ts`). Nodes are derived from exactly-equal endpoints
  (`nodes.ts`); dragging one re-fits every attached block (`refit` in
  `generate.ts` — absorb at the moved end, split at lotWidth.max+min,
  remove below min). Width edits ripple through welds the same way. Hand
  edits pin lots against reroll.
- **Drawing grid**: the plan pane's **⌗ Grid** toggle constrains BOTH pens
  (blocks and roads) to a square `GRID_SPACING` (5 m) lattice rotated
  `gridAngle` degrees from north, and locks every segment to **90° increments
  of the grid direction** — `snapToGridAxis` in `src/lib/facade/grid.ts` (pure)
  pulls the cursor onto the grid axis through the previous vertex, keeping the
  dominant component and rounding it to whole cells. The offset is measured
  from that ANCHOR, not the world origin, so a segment leaving a welded
  (off-lattice) vertex still runs exactly along the grid. Weld / street-endpoint
  snapping runs AFTER and still wins — joining existing geometry beats the grid,
  so a weld may pull a segment off-axis. A chain's first vertex has no anchor
  and falls back to plain `snapToGrid`. Within half a cell the result collapses
  onto the anchor, so both pens reject the degenerate segment
  (`MIN_BLOCK_LENGTH`; `MIN_STREET_SEG` from `street/intersections.ts`). Grid
  off = byte-identical.
- **Corner buildings**: welded two-block junctions turning ≤ the global max
  angle merge into one building (`src/lib/facade/corners.ts`): shells
  (storeys/colors/ornament/glazing, incl. `massingDepth`) sync through the
  `syncCorners` choke point on every mutation; walls miter so
  cornice/parapet run continuously; corner nodes tint gold and a stationary
  click opens the corner inspector (unified ↔ 2-facades, primary side,
  global angle). A **unified** corner reads as ONE mass with ONE roof
  (`src/lib/facade/cornerRoof.ts` pure — `cornerRoofPlan` builds the
  four-plane hip/valley L-roof; front faces foot at the node V, back faces
  at the back-eave crossing Q, everything meets at the centreline crossing
  P): `massMiterFor` fills the convex elbow (mass-depth-scaled miter, the
  wall keeps its thin one), both wings level to the primary side's datum,
  per-wing roofs+dormers suppress (`FacadeMesh roof={false}`), and
  `syncCorners` forces `roofOrientation: "parallel"` at unified corners
  only. Any failed precondition (flat roof, unequal depths/wallTops,
  perpendicular orientation, concave wing ≤ D/2) falls back to today's
  independent tents, byte-identical. Assembly in `SceneContents`
  (`cornerMerge` memo → `CornerRoofMesh`). A unified corner can also carry
  a **corner turret** (`CornerChoice.turret`: none / to-ground / corbelled
  above the first floor — inspector row; `TurretMesh` renders the round
  shaft + cone straddling the node in the shell's colors). The shaft carries
  **arched windows** on the outward (street-facing ~270°) arc, one row per
  storey — pure `turretWindows` in `src/lib/facade/turret.ts` (placement +
  `clampTurretRadius`), the outward angle derived from the two wings' facade
  normals in `SceneContents`. A **radius slider** (`CornerChoice.turretRadius`,
  clamped 1–6 m, sparse → default 2.2 = byte-identical) in the inspector's
  turret row scales the shaft, cone, corbel and window count. Specs:
  `docs/superpowers/specs/2026-07-17-corner-l-roof-design.md`.
- **Sections**: one lot's facade divides into vertical strips of whole bays
  with ±15 cm perpendicular relief (`FacadeParams.sections`, sparse — absent
  means one flush strip). `resolveSections` in `layout.ts` holds all clamps
  (proportional refit of stale partitions, live symmetry enforcement);
  `sections.ts` holds the canonical edit helpers + AI patterns; cornice/
  parapet step with the offsets; `syncCorners` flattens corner-side end
  sections so miters stay closed. Spec:
  `docs/superpowers/specs/2026-07-14-facade-sections-design.md`.
- **Massing**: each building gets a body — one wall-colored box per section
  strip behind the facade, front flush with the wall back, extending back
  by a per-lot `massingDepth` (clamped 3–20 m in `layout.ts`, default 8, a
  panel Depth slider). Flat-topped; roofs cap it. Spec:
  `docs/superpowers/specs/2026-07-14-massing-design.md`.
- **Open blocks (plaza / park)**: a frontage too short for a terrace
  (`frame.length < 2·gen.lotWidth.min`, ~10 m) becomes open space instead of a
  squished row — DERIVED from the block seed, no stored state (`src/lib/facade/
  openBlock.ts` pure — `openFillFor` returns `null` for a normal block OR the
  weighted "single building" outcome, `{kind:"plaza",monument}` or
  `{kind:"park"}` otherwise; `blockFootprint` extrudes the frontage line back by
  massing depth along −normal; `parkPlanting` is a deterministic jittered-grid
  tree scatter; `isOpenSpace`). `SceneContents` renders `OpenBlockMesh` (draped
  paved/green quad + `MonumentMesh` fountain/obelisk for plazas + `TreeMesh`
  low-poly trees for parks — the project's first vegetation) in place of the
  lots, filters open blocks out of `InstancedFacadeBoxes`, and `corners.ts`
  skips them (no facade to miter). Reroll re-picks the fill; Save/Load and any
  all-≥10 m scene are byte-identical. Spec:
  `docs/superpowers/specs/2026-07-23-open-blocks-plaza-park-design.md`.
- **Roofs**: flat / gable / hip, ridge parallel or perpendicular to street,
  per-lot height (`src/lib/facade/roof.ts`, pure — `resolveRoof` → clamped
  `RoofPlan`, `roofTriangles` → soup the mesh auto-orients by normal).
  Default flat (no mesh); generator seeds variety; `roofType`+`roofHeight`
  and `roofColor` (slate/red) are corner shell fields (orientation stays per-wing). Corner hip-valley
  merge deferred. Spec: `docs/superpowers/specs/2026-07-14-roofs-design.md`.
- **Topography + basements**: a global tilted ground (`ground: {slope,
  azimuth}` page state; `src/lib/facade/terrain.ts` pure — `groundHeightAt`,
  `levelingFor`, `groundNormal`). Each building levels its floor to the
  front-centre ground height and grows a stone basement (thin horizontal
  windows) down to the lowest footprint corner; the ground plane + grid
  tilt to the slope. `slope 0` = flat = byte-identical. Per-node/heightfield
  "arbitrary" topography deferred. **Corner leveling**: leveling is per-lot,
  so on a slope two welded wings would level to different heights and TEAR at
  the shared node. `cornerDatumOverrides` (`src/lib/facade/cornerDatum.ts`,
  pure) forces both corner lots of EVERY corner (unified OR two-facades) to the
  primary/wider side's datum, applied via `datumOverride` in `SceneContents`;
  flat ground → all 0 → byte-identical. (Pitched roofs at a two-facades corner
  still overlap two independent tents — the unified L-roof is the full fix.)
  Spec: `docs/superpowers/specs/2026-07-14-topography-design.md`.
- **Street awareness**: a centreline + mirror (far-frontage) derive live from
  the first block's facade normal (`src/lib/facade/street.ts` pure —
  `streetRefOf`, `streetLines`, `streetAwareFlipped`; width a page-state
  slider, default 14 m). New blocks drawn inside the street corridor
  auto-orient their facade toward the centreline (fixes "inside-out"
  drawing). Facing is a **chain-level** decision so a block's side never
  flips between welded segments: the pen locks the street-aware orientation
  at the chain's first segment and reuses it for every later segment; `f`
  flips the whole chain (persistent + retroactively flips already-committed
  segments via `onFlipChain`, same op as the "Flip side" button). A live
  green tick previews the facing. The first block (no reference yet) is
  oriented by `f` alone and then defines the street. Guides render in the
  plan pane only; orientation applies on creation only. Spec:
  `docs/superpowers/specs/2026-07-14-street-awareness-design.md`.
- **Dormers**: `FacadeParams.dormers` (0..bays, clamped) adds gabled dormer
  windows to the street-facing slope of a **parallel** pitched roof so it reads
  as an occupied storey (Nyhavn). Pure `roofDormers(plan, count)` in `roof.ts`
  (front-slope placements, empty for flat/perpendicular/too-shallow);
  `layout.roofDormers`; `DormerMesh` in `FacadeMesh.tsx` (window + cheeks + a
  little gable roof + cheeks that die into the opaque main slope at the back —
  watertight, no poke-through). `dormers` is a corner **shell** field (both
  wings match). Slider under Roof (parallel only). Absent/0 = byte-identical.
  Extends `docs/superpowers/specs/2026-07-14-roofs-design.md`.
- **Shaped gables**: `FacadeParams.gableStyle` (`curved` Dutch ogee /
  `stepped` crow-step) rises the street wall above the eave into an ornamental
  silhouette (`src/lib/facade/gable.ts` pure — `gableProfile(style, width,
  rise)` → symmetric outline points, sampled béziers / crow-steps);
  `layout.gable: GablePlan`; `GableMesh` extrudes the profile to a wall panel
  + a trim coping `<Line>`. `gableHeight` clamped `[GABLE_HEIGHT_MIN,MAX]`.
  Gable style + height are corner **shell** fields. Section under Roof. Absent
  = byte-identical. Spec:
  `docs/superpowers/specs/2026-07-14-shaped-gables-design.md`.
- **Pass-through arch**: a ground-floor treatment `"passage"` — a tall
  semicircular carriage arch at the door bay that pierces the massing box so
  you see through to behind (`src/lib/facade/layout.ts` — `resolveGrid` maps
  the door bay to `"passage"`; the opening is arched (`OpeningRect.arched`,
  head radius w/2, width shrinks on short storeys to keep a `PASSAGE_MIN_SIDE`
  jamb); `computeLayout` exposes `layout.passage: PassagePlan` — the tunnel
  void — only for a ground-storey passage). `FacadeMesh.buildStripGeometry`
  punches an arched wall hole; `StripMass` splits the strip's box into piers +
  lintel around the full-depth void (+ dark cobble floor); `PassageFill` adds a
  keystone + imposts. Toggle in the treatment row; AI/local prompt know
  passage/tunnel/carriage-arch/porte-cochère. Absent = byte-identical (single
  box, rectangular holes). Spec:
  `docs/superpowers/specs/2026-07-14-passage-arch-design.md`.
- **Save / Load**: the whole scene is a JSON-native object graph, so
  persistence is a versioned `FacadeDocument` (`src/lib/facade/document.ts`
  pure — `serializeScene`/`toJSON`, `deserializeScene`/`fromJSON`;
  `cornerChoices` Map ⇄ entries; `deserializeScene` validates version + block
  shape and defaults missing scalars, never throws). Header **Save** downloads
  `facade-scene.json`, **Load** imports one; a debounced localStorage autosave
  (`facademaker:autosave`) restores the scene on refresh. `reserveBlockIds`
  (blocks.ts) bumps the session id counter past loaded ids so drawn blocks
  never collide. No backend. Spec:
  `docs/superpowers/specs/2026-07-14-save-load-design.md`.
- **Renderer**: three's **WebGPURenderer by default** (native Metal on Mac —
  measured ~3× the classic WebGL frame rate; auto WebGL2 fallback where
  WebGPU is unavailable). `?webgl` = classic WebGLRenderer escape hatch,
  `?webgl2` forces the fallback backend, `?stats` shows an FPS panel.
  Renderer-dependent pieces route through `src/components/facade/webgpu.ts`
  (the flag choke point), `NodeLine.tsx` (fat lines: drei `<Line>` on
  classic, `Line2NodeMaterial` on WebGPU — never mount one empty; optional
  `depthTest`/`depthWrite`/`renderOrder` so transient drawing GUIDES can render
  on top of the world — a flat preview line at y≈0.08 is otherwise occluded
  wherever it crosses a taller building or risen ground in the top-down plan
  view), and
  `NodeGrid.tsx` (TSL port of drei's Grid). drei `ContactShadows` is
  classic-only (it renders through MeshDepthMaterial); the quad `<View>`
  needs the viewport Y-flip shim in `FacadeViewer` (WebGPU origin is
  top-left); Save-image grabs WebGPU frames via captureStream+ImageCapture.
  The shared `<Canvas>` must stay the **first** child of the viewer container:
  it is `absolute` with `z-index: auto`, so paint order is tree order and every
  later sibling (the tracking cells and their HTML overlays — pane labels,
  maximize buttons, Walk) draws on top without needing a z-index. It formerly
  sat last, which buried those overlays under the ground plane wherever the
  render was opaque; they still *worked* only because the canvas is
  `pointerEvents:none`.
  Spec: `docs/superpowers/specs/2026-07-18-webgpu-migration-design.md`.
- **First-person walk**: a **Walk** toggle on the 3D pane drops into
  first-person (WASD + pointer-lock mouse-look, 1.75 m eye height, walking
  speed, slope-follow, walk-through — no collision; `src/lib/facade/walk.ts`
  pure `walkStep`). Entering is a **two-step pick**: Walk arms a plan-pane
  picker (the whole pane becomes a modal catcher floating at `y=50`, above all
  geometry, so every click wins over lot/street selection), the cursor projects
  onto the **nearest street centreline** (`nearestPointOnStreets` in
  `src/lib/street/geometry.ts` — unbounded, so a pick can never land off-street;
  walks the raw polyline incl. a closed loop's wrap segment), a green disc +
  facing arrow preview where you'll stand and face, and the click commits that
  pose. `WalkControls` places the camera on the picked point facing along the
  street tangent. The button is disabled with no streets (nothing to stand on);
  Esc or re-clicking Walk cancels an armed pick. Spec:
  `docs/superpowers/specs/2026-07-18-fpv-walk-design.md`.
- **AI prompt**: `/api/facade-prompt` (flat fully-required zod spec — OpenAI
  structured output rejects optionals) targets the selected lot, plus an
  instant local keyword parser.
- **Marquee selection**: a Select tool (toggle beside Draw, mutually
  exclusive) turns a plan-pane left-drag into a rubber-band rectangle that
  grabs a **unified, mixed** set — blocks, lots, and nodes at once
  (`src/lib/facade/marquee.ts` pure — `hitTest` holds the enclosure rule:
  a block when BOTH endpoints are enclosed → whole-block op; else a lot when
  its center is inside, and a node when it's inside and not an endpoint of a
  fully-enclosed block, which subsumes its own lots/nodes). Dragging inside
  the selection bbox translates it live (`translateMarquee` — rigid shift of
  enclosed blocks + `moveNode` ripple for loose nodes); the Selection panel
  (`MarqueeControls` in `FacadeControls.tsx`) deletes (`deleteMarquee`, split-
  safe multi-lot removal), rerolls (`affectedBlockIds`), or bulk-restyles
  every selected lot. `⌘/Ctrl+A` selects every block (whole-block marquee);
  a single-lot click clears the marquee (the two selection models are mutually
  exclusive both ways). Every mutation funnels through `syncCorners`; `marquee`
  defaults null + the tool defaults off so the unused feature is byte-
  identical. Node-merge (welding selected nodes) is deferred — nodes move
  only. Spec: `docs/superpowers/specs/2026-07-14-marquee-selection-design.md`.
  **Selecting requires the Select tool**: with it OFF, a click in ANY pane
  selects nothing. Every `onSelect*` callback (lot, corner, street,
  intersection, square) is re-exported inside `FacadeViewer` under its
  canonical name wrapped in a `selectMode` gate at the single props-
  destructuring point, so the panes need no per-call-site guard and a future
  selectable thing is gated the moment it is threaded through. Leaving the tool
  fires `onClearSelection`, dropping EVERY kind of selection (single
  lot/corner, street, intersection, square, marquee) — selection is UI-only and
  never restored from the autosaved document, so the mount-time clear is a
  no-op. The Select button shows whenever `blocks.length > 0 || hasStreets`
  (a streets-only scene must still reach the Street/Intersection/Square
  inspectors). Nothing HIGHLIGHTS to advertise selectability outside select
  mode either: `onSelectStreet`/`onSelectIntersection`/`onSelectSquare` are
  passed as `undefined` (not a no-op) when the tool is off, so ribbons/canals
  still render but stop hover-tinting and the invisible-until-hover
  intersection/square markers stop rendering — leaning on the existing
  `onSelect === undefined` "not interactive" convention. Lots carry no hover
  tint (only the `selected`-driven marker, already cleared), and a corner
  node's disc hover is its DRAG affordance (nodes move outside select mode),
  so `onSelectLot`/`onSelectCorner` stay defined and gate only the ACTION.
- **Street Network**: a standalone, drawable, typed road network —
  `alley`/`street`/`road`/`boulevard` (`src/lib/street/types.ts` — `Street`,
  `StreetType`, `STREET_SPECS` widths/car flags, `Monument`,
  `StreetNetwork`). Polylines render as paved ribbons whose corners round to a
  per-type minimum curve radius (`STREET_SPECS[type].minRadius` — boulevards
  sweep wide, alleys turn tight) via `filletCentreline`/`cornerFit` (real
  tangent+arc road alignment, endpoints pinned so junctions are unaffected) +
  `streetRibbon` in `src/lib/street/geometry.ts`; `StreetRibbonMesh` in
  `src/components/street/`. The whole network **drapes on the tilted ground**
  (`groundHeightAt` per ribbon vertex; the roundabout disc tilts to the ground
  plane; monuments stand plumb) — flat ground is byte-identical.
  (`smoothCentreline` is retained but superseded by the fillet.)
  Shared-endpoint junctions
  are derived, not stored (`intersections.ts` — `deriveIntersections`) and
  any junction can become a roundabout + monument (obelisk/fountain), written
  sparsely into `network.roundabouts` (`roundaboutRing` in `geometry.ts`;
  `RoundaboutMesh`/`MonumentMesh` in `src/components/street/`). A **Roads**
  draw tool (mutually exclusive with
  the block pen and Select) places polyline vertices with a type selector
  (options derived from `STREET_SPECS` so every type — canal included — is
  always drawable); clicking a ribbon or an intersection marker opens the
  **Street** / **Intersection** inspector in `FacadeControls.tsx` (type,
  width override, **traffic mode** — cars / shared fietsstraat (red
  asphalt) / peds (light cobble), `Street.traffic` sparse via
  `resolveTraffic`, alleys default peds; delete; roundabout on/off +
  monument pick) — page state `streetNetwork`, `selectedStreet`,
  `selectedIntersection`. Selecting a street shows **draggable green vertex
  handles** in the plan pane (`StreetNodeHandles` in FacadeViewer;
  `moveStreetNode` in `intersections.ts` moves welded junction copies as
  one, migrates roundabout keys, rejects sub-1 m segments; derived frontage
  blocks refit live). A pure, non-blocking Krier/
  Alexander advisory (`geometry.ts` — `streetAdvisory`) hints at an
  uninterrupted straight alley/street run, an overlong boulevard, or a corner
  drawn tighter than the type's minimum radius; it never blocks the layout. The network **coexists** with the existing block/lot/
  corner system — additive, no shared state (Save/Load extends the document;
  an empty network is byte-identical). **Squares & plazas**: every closed
  loop big enough to enclose a void is a derived Square
  (`src/lib/street/squares.ts` pure — `deriveSquares` finds the interior
  side by point-in-polygon probe, `isSquareFrontingBlock`,
  `pruneSquareMonuments`; monument choice stored sparsely in
  `network.squares` [loop id, monument]). Interior-side derived blocks grow
  a second facade skin on the massing rear facing the void (`FacadeMesh
  skin` mode — wall+openings+ornament only, windows filled inline since
  the instancer only walks front placements); a clickable centre marker
  opens the Square inspector (fountain/obelisk/none). Block/plot/building
  derivation beyond frontages and mid-span crossings stay deferred.
  **Junction pads**: every node/T/X junction is paved by a derived
  star-polygon so overlapping ribbons stop z-fighting
  (`src/lib/street/junctionPad.ts` pure — `clipCentreline` trims each incident
  ribbon back `CLIP_K×` the widest half-width, `mouthsAt`+`deriveJunctionPads`
  walk the mouths in angular order and emit their ribbon cap edges as one
  polygon that tiles exactly with the clipped ribbons; the lib is color-free,
  returning `dominantStreetId`). `StreetRibbonMesh` takes clipped `spans` (the
  no-span path is byte-identical), `JunctionPadMesh` fans the polygon from the
  junction centre on the ribbon plane, `StreetNetworkView` resolves the color
  via `pavingOf`. Roundabouts clip to the ring (`ROUNDABOUT_OUTER_R`, now in
  `types.ts`) which then sits in a clean gap; canal/bridge junctions are
  excluded; a junction-free network is byte-identical. Specs:
  `docs/superpowers/specs/2026-07-15-street-network-design.md` (network) +
  `docs/superpowers/specs/2026-07-16-street-realism-design.md` (SP-2a:
  radius-limited fillet + topography draping) +
  `docs/superpowers/specs/2026-07-21-junction-pad-design.md` (trim + pad).

## Real-city import (M1–M4)

Pick a real place on a map and the scene becomes that place: its **terrain**,
its **buildings**, its **streets and canals** — then design into it. Specs:
`docs/superpowers/specs/2026-07-24-arcgis-terrain-import-design.md`,
`2026-07-25-context-buildings-design.md`, `2026-07-25-street-import-design.md`.

- **One projection frame.** `src/lib/geo/project.ts` maps lon/lat ⇄ local
  metres on an ENU tangent plane (`east→+x`, `north→+z`, R=6378137), origin =
  the picked bbox centre. That `GeoAnchor` is stored in the document and every
  payload is projected against it — **the anchor and the data must move
  together**, or the geometry silently shifts.
- **Header flow.** **Load place** opens `PlacePicker` (MapLibre, tokenless) →
  bbox → three fetches **in parallel that fail independently**. **Demo place**
  loads a committed offline Amsterdam fixture instead (below). **Clear terrain**
  reverts.
- **M1 terrain** — an optional `hf?: Heightfield` on `Ground`, sampled behind
  the EXISTING `groundHeightAt(x,z,g)` seam, so basements (`levelingFor`),
  streets, trees and ribbons drape on real ground for free. The ground mesh
  becomes a displaced grid and `groundQuat` goes identity. `hf` absent ⇒ the
  old tilted-plane math, byte-identical.
- **M2 context buildings** — real footprints as ONE merged grey
  `BufferGeometry` (thousands of meshes would be thousands of draw calls) with
  a parallel per-triangle id array, so a raycast `faceIndex` resolves to one
  building. Click (Select tool on) hides it; **Restore hidden** is the only way
  back. **Footprints are NEVER serialized** — the document stores only `bbox` +
  `hiddenIds`, and they are re-fetched on load.
- **M3 streets & canals** — OSM ways become ordinary, editable `Street`s in the
  existing network (the deliberate asymmetry with M2: these ARE serialized and
  are NOT re-fetched). Roads only (`footway`/`cycleway`/`steps`/`path`/
  `area=yes` are dropped — ~48% of ways, and `area=yes` polygons imported as
  ring-shaped "streets"); contiguous ways sharing `(name, type)` are merged
  back into whole streets (OSM splits "Herengracht" into 8). `waterway=canal`
  → the existing `canal` type. Importing **replaces** the network and forces
  `buildingsFromStreets` off (`syncStreetBlocks` would otherwise generate
  thousands of lots over the real footprints); Clear-terrain removes only
  `street-osm-` ids so hand-drawn work survives, and restores the pre-import
  toggle value.
- **Offline demo fixture** — `public/fixtures/amsterdam/` holds a frozen
  snapshot (1,585 buildings, 212 streets, 128×79 heightfield) plus
  `ATTRIBUTION.md` (OSM is **ODbL** — keep the attribution on any
  redistribution). **Demo place** loads it with zero network. Recapture with
  `npm run fixture:amsterdam`; `src/lib/geo/demoPlace.test.ts` fails loudly if
  the fixture and its anchor drift apart.

- **M4 promote to an editable lot** — click an imported footprint (Select tool)
  and the **Context building** inspector offers **Promote to lot** or
  **Demolish**. Promotion takes the PLOT from reality — frontage line, facing,
  width, depth (`src/lib/geo/parcel.ts` → `src/lib/facade/promote.ts`, both
  pure) — and the building from the generator (storeys, style, roof, colour).
  The real polygon rides on `FacadeBlock.parcel` and draws as a dashed,
  ground-draped plot boundary; the rectangular-box engine is **untouched**, so
  roofs, section strips, corners and basements all work on a promoted building
  from day one. A reversible **Subdivide / Merge to one lot** action turns one
  plot into a terrace and back (merge refuses when a lot is hand-edited rather
  than discarding the work). Only 18% of real footprints are quads and even a
  min-area **oriented** bbox misses ≥10% of plot area on 47% of them, which is
  why the true polygon is stored rather than a rectangle. The parcel outline is
  **fixed** — it does not follow the block, so seeing a building leave its plot
  is information, not a bug. Spec:
  `docs/superpowers/specs/2026-07-26-promote-footprint-design.md`.

### Hard-won rules (violating these has broken this app before)

- **Overpass 406s any request without a `User-Agent`.** It also rate-limits
  hard: `overpass.ts` fails over across mirrors (429/502/503/504/network/timeout
  → next mirror; anything else → fail fast) and caches responses, because
  re-fetching the same bbox on every reload is what triggers the limiter.
- **Tailwind utilities lose to unlayered third-party CSS.** Tailwind v4 emits
  them in `@layer utilities`, so maplibre's `.maplibregl-map{position:relative}`
  beat `.absolute` and gave the picker a 0-height map for a whole milestone.
- **R3F synthesizes a click after a drag release.** Any new clickable 3D object
  needs the existing `dragEndAt` guard, or a marquee sweep will trigger it.
  `mouseButtons` does NOT gate touch — only `enablePan` does.
- **Derive street geometry ONCE per network.** `deriveIntersections` is called
  by `streetSpans` and `deriveJunctionPads` too, and all four panes are always
  mounted; recomputing per pane cost ~1.5 s per network change (~1.8 s per
  pointermove while dragging) before it was hoisted and spatially bucketed.
- **Imported geometry must satisfy the network's own invariants** —
  sub-`MIN_STREET_SEG` vertices are collapsed on import (they permanently block
  vertex drags), but a vertex **shared with another way is a junction and must
  never be collapsed**, or the two streets silently detach.
- Cameras are sized from `MAX_BUILDING_HEIGHT` in `clip.ts`, not hardcoded:
  real buildings exceed the old plan camera (y=60) and walk catcher (y=50).
- **A frontage is a CHAIN of edges, never one edge.** The longest single edge of
  a real footprint is only ~31% of its perimeter (median), so "pick the longest
  edge as the facade" does not work. `edgeChains` groups near-collinear runs
  first — and a smooth ring with no corner at all (footprints run to 162
  vertices) falls back to one chain per edge, because the wrap-around chain it
  would otherwise emit has zero length.
- **Scoring a frontage on length and distance alone puts the facade on the
  party wall.** A 25 m side wall outscores a 6 m canal frontage, and distance
  cannot fix it because a long edge running away from the street is still close
  to it at one end. `fitFrontage` multiplies by a **facing** term. The
  length-only version still "succeeded" on 99.3% of the fixture — success
  measures whether a frontage was produced, not whether it was the right one —
  while reporting a median 13.9 m wide × 6.0 m deep, i.e. Amsterdam backwards.
  With facing: 6.5 m × 12.5 m, which is what a canal house is.
- **Never assume a footprint's winding.** Real OSM ways wind both ways, so the
  outward normal must come from the signed area, per polygon.
- **`generateLot` redraws `massingDepth` from 6–12 m**, and both `rerollBlock`
  and `refit` call it — so a promoted block's depth must be re-pinned through
  `applyParcelDepth`, or a reroll or node drag silently pushes the building out
  through the back of its own parcel.
- **Promoted buildings are suppressed by a DERIVED set** (`blocks` →
  `parcel.source`), not by `hiddenIds` — which is what stops "Restore hidden"
  resurrecting a grey copy on top of a promoted block, and makes deleting the
  block bring the real building back.
- **The autosave must never throw.** It writes inside a timeout, so an uncaught
  `QuotaExceededError` escapes as an unhandled error and kills the React tree.
  It serializes **compact** (`toCompactJSON`, not the indented `toJSON` used for
  downloads) and the `setItem` is wrapped: the bulk is LOTS (~541 chars each),
  and auto-buildings over 212 imported streets generates thousands, so a large
  enough scene overflows any budget.

## Tailwind v4

Uses `@import "tailwindcss"` in `globals.css` (not old `@tailwind` directives). PostCSS plugin is `@tailwindcss/postcss` v4. No `tailwind.config.*` file.

## Path alias

`@/*` → `./src/*` (configured in both `tsconfig.json` and `next.config.ts`).

## Engine docs (key references)

- `docs/engine-variables.md` — All Homemaker parameters, style system, room types, topology conditions, IFC property sets
- `docs/engine-dependencies.md` — Dependency chain, setup requirements, the Bonsai pip-conflict gotcha

Available styles: `default`, `blank`, `cinema`, `courtyard`, `fancy`, `foxhouse`, `framing`, `halifax` (with sub-styles `arcade`, `rustic`, `tuscan`), `nonplanar`, `simple`.

Room types: `bedroom`, `circulation`, `circulation_stair`, `stair`, `kitchen`, `living`, `outside`, `retail`, `sahn`, `toilet`, `void`.

## MCP integration

- `.mcp.json` (gitignored, per-developer) registers `mcp_server.py` from the sibling `../homemaker-blender/` repo as a Homemaker MCP tool. Copy `.mcp.json.example` to `.mcp.json` to enable.
- `.claude/settings.local.json` pre-approves a subset of MCP tools (`execute_python`, `clear_scene`, `create_building_mesh`, `render_view`, `select_objects`, `homemaker`).
- To use manually: `claude mcp add homemaker -- uv run ../homemaker-blender/mcp_server.py`

## The app is dark-only

Hardcoded dark mode in `layout.tsx` (`className="dark"`). CSS uses custom properties (`--background`, `--foreground`, `--panel-bg`, `--border`, `--accent`, `--muted`). No light theme support.
