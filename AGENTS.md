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
| Tests | `npm test` | vitest — src/lib/facade unit tests |

**Tests:** vitest covers the pure facade modules — layout engine (incl. section strips), prompt parser, street generator (`refit`/`deleteLot`), node welding, corner detection/sync/miters, section edit helpers, street-aware orientation, and marquee hit-test/delete/translate (`src/lib/facade/*.test.ts`) — run `npm test`. No e2e/playwright; everything else is verified visually.

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
  types/
    mapbox-gl-draw.d.ts — Type declarations (legacy; no map UI currently exists)
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
- **Blocks & streets**: pen-tool drawing in the plan pane — click chains
  nodes into welded segments (Escape ends, clicking the first node closes
  the loop); every segment is a generated block (`src/lib/facade/blocks.ts`
  + `generate.ts`). Nodes are derived from exactly-equal endpoints
  (`nodes.ts`); dragging one re-fits every attached block (`refit` in
  `generate.ts` — absorb at the moved end, split at lotWidth.max+min,
  remove below min). Width edits ripple through welds the same way. Hand
  edits pin lots against reroll.
- **Corner buildings**: welded two-block junctions turning ≤ the global max
  angle merge into one building (`src/lib/facade/corners.ts`): shells
  (storeys/colors/ornament/glazing) sync through the `syncCorners` choke
  point on every mutation; walls miter so cornice/parapet run continuously;
  corner nodes tint gold and a stationary click opens the corner inspector
  (unified ↔ 2-facades, primary side, global angle).
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
  "arbitrary" topography deferred. Spec:
  `docs/superpowers/specs/2026-07-14-topography-design.md`.
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
