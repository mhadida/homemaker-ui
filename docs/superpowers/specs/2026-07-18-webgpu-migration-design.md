# WebGPU (Metal) Renderer Migration — Design

**Status:** COMPLETE (browser-verified 2026-07-18) — Phase 0 returned **GO**;
Phases 1–4 shipped. **WebGPU is the default renderer**; `?webgl` is the
classic-renderer escape hatch. Save-image fixed via captureStream +
ImageCapture frame grab (Phase 3's one gap).
**Date:** 2026-07-18
**Branch:** `feature/webgpu-migration` (continues the `spike/webgpu` scaffolding)

## Phase 0–2 results (browser-verified)

- **Node lines** ✓ — `NodeLine.tsx` (drei `<Line>` on WebGL, WebGPU `Line2` +
  `Line2NodeMaterial` on `?webgpu`; `segments` mode for box-edge outlines).
  Gotcha: never mount a `Line2` with an empty geometry — the pipeline compiles
  before `instanceStart` exists and caches invalid WGSL.
- **Node shadows** ✓ — the spike's "stubborn MeshDepthMaterial" was
  **drei `<ContactShadows>`** (it renders the scene through a depth material),
  NOT the sun's shadow map. Native WebGPU shadow mapping works unmodified;
  ContactShadows is WebGL-only-gated, sun `castShadow` ungated everywhere.
- **Grid** — drei `<Grid>` is a GLSL ShaderMaterial; `NodeGrid.tsx` is a TSL
  port (same fwidth-antialiased cell/section math, camera-plane fade).
- **Quad `<View>`** ✓ — required a **viewport Y-flip shim**: drei View places
  panes with WebGL's bottom-left-origin viewport/scissor convention; WebGPU's
  origin is top-left and three passes values through unflipped, vertically
  mirroring the layout. `ViewCompatWebGPURenderer` (in FacadeViewer's gl init)
  flips Y in `setViewport`/`setScissor`.
- **Instancing** ✓ (windows/frames render), **canal transparency** ✓,
  **compass + Stats** ✓.
- **WebGL2 fallback** ✓ — `?webgpu&webgl2` → `forceWebGL: true`; renders
  identically (node materials compile to GLSL), zero console errors.
- **Save-image** ✗ — `drawImage(webgpuCanvas)` reads 0 pixels (no
  preserveDrawingBuffer semantics). Needs a render-target readback
  (`readRenderTargetPixelsAsync`) → **Phase 3**.
- **FPS (M-series Mac, dpr 2, dev build):** maximized 3D pane **39 → 116 FPS
  (~3×)**; heavy scene (22 blocks / 140 lots) quad view **9 → 16 FPS (~1.8×)**.
**Builds on:** `2026-07-18-webgpu-metal-spike.md` (the spike that established the
incompatibility list).

## Goal

Move the facade renderer from the classic WebGL renderer to three's
**WebGPURenderer** — native **Metal on macOS**, with automatic **WebGL2 fallback**
where WebGPU is unavailable — for better performance, sharing 100% of the
React-Three-Fiber scene code.

## Hard constraint (read first)

This migration is **overwhelmingly visual-verification work**: "does it render,
do shadows look right, do all four `<View>` panes show, does transparency /
Save-image still work." Each phase's exit criterion is a **browser check**.
Building renderer code that can't be watched render is shipping blind (the
canal's visual pass caught real bugs). Therefore:

- **Phase 0 is a GO/NO-GO gate** verified in a browser before any further phase.
- Execution requires reliable in-browser verification (restored automation, or
  the user spot-checking). The **design and per-phase plans are browser-
  independent** and can be written ahead.

## Architecture decision: single renderer, node materials, WebGL2 fallback

Adopt **WebGPURenderer as the single renderer for everyone** (WebGPU when
available → Metal on Mac; WebGL2 fallback otherwise), reached via a **flag-gated
rollout** (opt-in `?webgpu` → a user setting → default-on only after full
verification). Rationale:

- Under WebGPURenderer, plain `<meshStandardMaterial>`/`<meshBasicMaterial>`
  **auto-convert to node materials** — so the vast majority of the scene needs
  **no changes**. The explicit migration surface is small and known:
  **fat-lines** and **shadows** (the two incompatibilities the spike found),
  plus verification of View / instancing / transparency / Save-image.
- A single renderer avoids maintaining two divergent material paths (the spike's
  `?webgpu` gating of shadows/lines is throwaway scaffolding, not the end state).

**Rejected:** keeping classic WebGLRenderer as default with WebGPU behind a
permanent flag — it forces dual material code forever (node lines on WebGPU,
classic lines on WebGL). Acceptable only as a temporary state during rollout.

## Incompatibility → replacement (from the spike)

| Incompatible today | WebGPU-native replacement (already in `three@0.184`) |
|---|---|
| drei `<Line>` (`LineMaterial`, a `ShaderMaterial`) | `Line2` + `Line2NodeMaterial` (`three/examples/jsm/lines/webgpu/Line2.js`, `Line2NodeMaterial`) |
| shadow depth (`MeshDepthMaterial`) | WebGPURenderer's node shadow path (`ShadowNodeMaterial`); standard materials cast shadows via node conversion — the spike's failure was the classic depth material being used; must configure the node shadow path |
| `<meshStandardMaterial>` etc. | auto-converts (no change) |
| InstancedMesh (windows/frames) | supported; **verify** |

## Phases

### Phase 0 — De-risk gate (BROWSER-VERIFIED, GO/NO-GO)

Prove the whole render path on WebGPU on one representative scene **and** its
WebGL2 fallback. Deliver a throwaway spike scene (or the real facade) that renders
with:

1. **Node lines** — one drei `<Line>` replaced by `Line2` + `Line2NodeMaterial`,
   visible on WebGPU.
2. **Node shadows** — the sun casts a shadow on WebGPU with no `MeshDepthMaterial`
   error (configure the node shadow path; do NOT just disable shadows).
3. **Quad `<View>`** — all four viewport panes render (highest risk).
4. **Instancing, transparency (canal water), Save-image** — each works or its
   gap is documented.
5. **WebGL2 fallback** — the same WebGPURenderer, on a browser/context without
   WebGPU, still renders correctly (so non-WebGPU users aren't broken).

**Exit:** a screenshot per pane + the FPS delta on a heavy scene, in a browser.
- **GO** → write the Phase 1–4 bite-sized plans and execute.
- **NO-GO** (e.g. `<View>` can't render on WebGPU in R3F 9.6) → stop, record why,
  fall back to the WebGL-optimization track. Do not sink effort past this gate.

### Phase 1 — Node line component

Replace drei `<Line>` everywhere with a `<NodeLine>` wrapper (`Line2` +
`Line2NodeMaterial` + `LineGeometry`) that renders identically under WebGPU and
its WebGL2 fallback. Remove the spike's `?webgpu` Line-hiding wrapper. ~6 call
sites in `FacadeViewer.tsx`.

### Phase 2 — Node shadows

Configure WebGPURenderer's node shadow path so the sun casts correctly; remove
the spike's `castShadow={!spikeWebGPU()}` and `shadows={!useWebGPU}` gates. Verify
shadow quality (bias/mapSize) matches the WebGL look.

### Phase 3 — Re-verify the rest

InstancedMesh windows/frames, canal water transparency + `depthWrite:false`,
`polygonOffset` on ribbons, Save-image (WebGPU needs a render-target readback if
`preserveDrawingBuffer` isn't honored), the compass/gizmo, drei `Stats`. Fix each
gap; each is a browser check.

### Phase 4 — Rollout

Renderer selection behind a **user setting** (not just `?webgpu`): default WebGL
→ opt-in WebGPU → **default WebGPU (WebGL2 fallback)** once Phases 1–3 verify.
Delete the throwaway spike scaffolding (`useWebGPU` gates, Line wrapper). Update
`AGENTS.md`.

## Testing / verification

- Pure logic is unaffected (no new geometry math) — existing unit tests must stay
  green throughout (`npm test`), proving the scene graph is unchanged.
- **Every phase's real gate is a browser check** (per the hard constraint): render
  each pane, compare against the WebGL baseline screenshot, confirm no console
  material errors, and record FPS on a heavy scene (grid of streets → hundreds of
  buildings).
- `npx tsc --noEmit` + `npx eslint src` clean at every commit.

## Risks (ranked)

1. **`<View>` on WebGPU in R3F 9.6** — multi-viewport scissor rendering is the
   least-proven path; this is what Phase 0 exists to test. If it fails, the whole
   migration is blocked (NO-GO).
2. **Node shadow configuration** — the spike showed the depth material is
   entangled; getting node shadows to render correctly is non-trivial.
3. **WebGL2 fallback fidelity** — must not regress users without WebGPU.
4. **Save-image readback** on WebGPU.

## Byte-identical / safety

The WebGL path stays the **default** through Phases 0–3; only Phase 4 flips the
default, and only after browser verification. At every point before Phase 4, a
user who doesn't opt in gets today's exact renderer. Unit tests (scene-graph
logic) stay green throughout.

## Next step

Phase 0 is a browser-verified spike. Because it needs reliable visual
verification (unavailable in the session that wrote this spec), execution should
run where a browser can be driven — a session with working automation, or with
the user spot-checking each pane. The Phase 1–4 bite-sized plans are written
**after** Phase 0 returns GO.
