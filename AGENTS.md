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

**Tests:** vitest covers the pure facade layout engine and prompt parser (`src/lib/facade/*.test.ts`) — run `npm test`. No e2e/playwright; everything else is verified visually.

## Blender is NOT a runtime dependency of the web app

The deployed web app (Vercel + the local `npm run dev` flow) generates IFC and glTF purely in Python via Molior + `ifcopenshell` + `topologic_core`. The pipeline entry is `python/generate.py:build_and_export_glb()`.

Blender is **optional dev tooling**, only used if you want to drive a running Blender instance from an MCP-connected agent. That flow lives in the sibling [`homemaker-blender`](../homemaker-blender/) repo (private). When using it, Blender must run with Bonsai + the Homemaker addon enabled and the BlenderMCP socket server listening on `127.0.0.1:9876`.

The startup sequence matters: Bonsai first, then Homemaker. The autostart script handles this: `~/Library/Application Support/Blender/4.3/scripts/startup/homemaker_autostart.py`

## Key file layout

```
src/
  app/
    page.tsx          — Main 3-panel layout (Map | Config | Render)
    demo/page.tsx     — Self-contained 3D demo (no Blender needed)
    facade/page.tsx   — Facade designer: single street-facing facade for infill lots
    layout.tsx        — Root layout, dark-only theme
    globals.css       — Tailwind v4 imports + dark CSS vars
    api/
      generate/route.ts   — POST: builds mesh in Blender, runs Homemaker, returns renders
      export/route.ts     — POST: exports IFC from Blender
      prompt/route.ts     — POST: AI prompt parsing (Ollama + OpenAI)
      facade-prompt/route.ts — POST: AI prompt parsing for the facade designer
  components/
    MapView.tsx       — MapLibre GL + Mapbox GL Draw for footprint drawing
    ConfigPanel.tsx   — Storeys, style picker, room types
    RenderView.tsx    — Shows rendered building images
    demo/
      BuildingViewer.tsx — R3F canvas with orbit controls, lighting, grid
      BuildingMesh.tsx   — Procedural building geometry renderer
      PromptInput.tsx    — Natural language prompt + suggestion chips
      SliderControls.tsx — Storeys, height, width, depth, shape, style, roof, rooms
    facade/
      FacadeViewer.tsx   — R3F canvas, front-hemisphere orbit, save-image
      FacadeMesh.tsx     — FacadeLayout → meshes (wall, openings, ornament)
      FacadeControls.tsx — presets + sliders + toggles panel
      BayGrid.tsx        — tappable per-cell opening editor
  lib/
    blender.ts        — TCP socket client to Blender (port 9876)
    building/
      types.ts        — BuildingParams, StyleId, RoofType, defaults
      styles.ts        — StyleConfig per style (colors, materials, window/door flags)
      geometry.ts      — Procedural building generator (walls, windows, doors, roof, slabs)
      prompt-parser.ts — Local keyword parser + AI prompt builder
      index.ts         — Re-exports
    facade/
      types.ts         — FacadeParams, presets, defaults, LotContext
      layout.ts        — pure layout engine (params → rectangles, all clamps)
      prompt-parser.ts — local keyword parser + deep merge
  types/
    mapbox-gl-draw.d.ts — Type declarations
python/
  generate.py             — IFC + glTF pipeline (entry: build_and_export_glb)
  build.py                — Vercel Function entrypoint (POST → glb, GET → "ok")
  server.py               — Local-dev stdio child server
  vendor/homemaker-addon/ — Submodule (Bruno Postle's addon)
```

## Demo app (`/demo`)

A self-contained 3D building viewer that works without Blender. Uses React Three Fiber for in-browser rendering with proper PBR lighting (ACES filmic tone mapping, environment maps, contact shadows). Touch-friendly orbit controls for iPad.

- **3D viewer**: R3F + drei (OrbitControls, Environment, ContactShadows, Grid)
- **Procedural geometry**: `lib/building/geometry.ts` generates walls, windows, doors, roofs, slabs from params
- **Style system**: 9 styles with distinct materials (colors, roughness, metalness, window/door flags)
- **AI prompt**: Local keyword parser works instantly; optional Ollama/OpenAI for richer parsing via `/api/prompt`
- **No Blender dependency**: The demo generates buildings entirely in the browser

## Facade designer (`/facade`)

A single-wall parametric facade designer for infill urban lots (one street-facing
facade, party walls both sides). Pure client-side Three.js — the Python pipeline is
NOT involved; every edit is live (no Update button). Spec:
`docs/superpowers/specs/2026-07-06-facade-designer-design.md`.

- **Layout engine**: `src/lib/facade/layout.ts` is a pure function
  (FacadeParams → rectangles) holding ALL validity clamps; the mesh renders
  whatever it returns. Corner conditions (two facades) plug in at this seam later.
- **Grid model**: (storeys × bays) cells, treatment-derived defaults + sparse
  `cellOverrides` patches.
- **AI prompt**: `/api/facade-prompt` (flat fully-required zod spec — OpenAI
  structured output rejects optionals), plus an instant local keyword parser.

## Tailwind v4

Uses `@import "tailwindcss"` in `globals.css` (not old `@tailwind` directives). PostCSS plugin is `@tailwindcss/postcss` v4. No `tailwind.config.*` file.

## Path alias

`@/*` → `./src/*` (configured in both `tsconfig.json` and `next.config.ts`).

## MapLibre GL + Mapbox GL Draw quirks

- Mapbox GL Draw's default styles use bare arrays for `line-dasharray`, which MapLibre rejects. The app works around this by overriding **all** draw styles manually in `MapView.tsx` with `["literal", [...]]` wrapper.
- Draw starts in `draw_polygon` mode by default.
- Building footprints fetched from Overpass API at zoom ≥ 15.

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
