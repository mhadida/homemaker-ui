<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.1) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Homemaker UI

Interactive parametric building editor. Users draw a building footprint on a map, configure parameters, and Blender generates an IFC model.

## Architecture

Four parts work together:

- **`homemaker-ui/`** (this repo) — Next.js 16 app, the interactive editor
- **`../homemaker-addon/`** — Bruno Postle's Blender addon (the engine), generates IFC buildings from topology
- **`mcp_server.py`** — MCP server bridging agents to Blender via socket on port 9876
- **Blender** (running separately) — runs Bonsai + Homemaker addons, serves as the backend

## Commands

| What | Command | Notes |
|------|---------|-------|
| Dev server | `npm run dev` | Next.js dev server on :3000 |
| Build | `npm run build` | |
| Start prod | `npm run start` | |
| Lint | `npm run lint` | ESLint 9 flat config (`eslint.config.mjs`) |
| Typecheck | `npx tsc --noEmit` | No npm script exists — run manually |
| MCP server | `uv run mcp_server.py` | Bridges agents to Blender |

**No test runner or test files exist.** Don't look for jest/vitest/playwright.

## Blender dependency (critical)

The app's API routes (`/api/generate`, `/api/export`) talk to Blender via a raw TCP socket at `127.0.0.1:9876`. Blender **must** be running with:
1. Bonsai (BlenderBIM) addon enabled
2. Homemaker addon enabled (registers `bpy.ops.object.homemaker`)
3. BlenderMCP socket server running on port 9876

If the `/api/generate` endpoint returns connection errors, Blender isn't running or the socket server isn't active.

The startup sequence matters: Bonsai first, then Homemaker. The autostart script handles this: `~/Library/Application Support/Blender/4.3/scripts/startup/homemaker_autostart.py`

## Key file layout

```
src/
  app/
    page.tsx          — Main 3-panel layout (Map | Config | Render)
    demo/page.tsx     — Self-contained 3D demo (no Blender needed)
    layout.tsx        — Root layout, dark-only theme
    globals.css       — Tailwind v4 imports + dark CSS vars
    api/
      generate/route.ts   — POST: builds mesh in Blender, runs Homemaker, returns renders
      export/route.ts     — POST: exports IFC from Blender
      prompt/route.ts     — POST: AI prompt parsing (Ollama + OpenAI)
  components/
    MapView.tsx       — MapLibre GL + Mapbox GL Draw for footprint drawing
    ConfigPanel.tsx   — Storeys, style picker, room types
    RenderView.tsx    — Shows rendered building images
    demo/
      BuildingViewer.tsx — R3F canvas with orbit controls, lighting, grid
      BuildingMesh.tsx   — Procedural building geometry renderer
      PromptInput.tsx    — Natural language prompt + suggestion chips
      SliderControls.tsx — Storeys, height, width, depth, shape, style, roof, rooms
  lib/
    blender.ts        — TCP socket client to Blender (port 9876)
    building/
      types.ts        — BuildingParams, StyleId, RoofType, defaults
      styles.ts       — StyleConfig per style (colors, materials, window/door flags)
      geometry.ts     — Procedural building generator (walls, windows, doors, roof, slabs)
      prompt-parser.ts — Local keyword parser + AI prompt builder
      index.ts        — Re-exports
  types/
    mapbox-gl-draw.d.ts — Type declarations
blender/
  homemaker_workspace.py — Stripped-down Blender UI workspace file
```

## Demo app (`/demo`)

A self-contained 3D building viewer that works without Blender. Uses React Three Fiber for in-browser rendering with proper PBR lighting (ACES filmic tone mapping, environment maps, contact shadows). Touch-friendly orbit controls for iPad.

- **3D viewer**: R3F + drei (OrbitControls, Environment, ContactShadows, Grid)
- **Procedural geometry**: `lib/building/geometry.ts` generates walls, windows, doors, roofs, slabs from params
- **Style system**: 9 styles with distinct materials (colors, roughness, metalness, window/door flags)
- **AI prompt**: Local keyword parser works instantly; optional Ollama/OpenAI for richer parsing via `/api/prompt`
- **No Blender dependency**: The demo generates buildings entirely in the browser

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

- `.mcp.json` registers `mcp_server.py` as a Homemaker MCP tool for Claude Code agents.
- `.claude/settings.local.json` pre-approves a subset of MCP tools (`execute_python`, `clear_scene`, `create_building_mesh`, `render_view`, `select_objects`, `homemaker`).
- To use manually: `claude mcp add homemaker -- uv run /path/to/mcp_server.py`

## The app is dark-only

Hardcoded dark mode in `layout.tsx` (`className="dark"`). CSS uses custom properties (`--background`, `--foreground`, `--panel-bg`, `--border`, `--accent`, `--muted`). No light theme support.
