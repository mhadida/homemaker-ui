# WebGPU (Metal-on-Mac) Renderer Spike — Note

**Status:** spike / evidence-gathering (not a committed migration)
**Date:** 2026-07-18
**Branch:** `spike/webgpu`

## Question

Can we get better rendering performance (esp. "Metal on Mac") while sharing the
same code logic — ideally without a native rewrite?

## Landscape (three levers, kept honest)

1. **Packaging as desktop (Electron/Tauri)** — wraps the existing Next.js app,
   ~zero logic change. Buys offline, native file dialogs, no tab throttling.
   **Not itself a big FPS win:** Chrome/Electron on Mac already run WebGL through
   ANGLE → Metal. Tauri (WKWebView) has weaker WebGPU than Electron (Chromium).
2. **Renderer backend WebGL → WebGPU** — this is the actual "Metal" lever.
   WebGPU maps to Metal natively on Mac, cuts CPU/draw-call overhead, and unlocks
   GPU compute. Keeps 100% of the React-Three-Fiber scene graph; only the
   renderer (and any hand-written shaders) change. Runs in the browser too
   (Chrome + Safari support WebGPU). **This spike wires exactly this.**
3. **Native Swift/Metal** — highest ceiling, but **cannot share code logic**, so
   it's out of scope by the stated constraint.

Cheapest-first reminder: before committing to a backend swap, profile what's
actually slow and push WebGL wins (more instancing/merging, LOD, frustum
culling). We already ship scene-wide window instancing.

## What the spike wires (already in this branch)

`src/components/facade/FacadeViewer.tsx`:

- `?webgpu` query flag → the `<Canvas gl=…>` prop becomes an **async initializer**
  that dynamic-imports `three/webgpu` (`WebGPURenderer`) and `await renderer.init()`.
  Without the flag, the WebGL path is byte-identical (same `gl` object as before).
- The dynamic `import("three/webgpu")` keeps the (large) WebGPU build **out of
  the default bundle** — it only loads when the flag is present.
- `?webgpu` (or `?stats`) mounts drei's `<Stats />` FPS panel (renderer-agnostic)
  for A/B measurement.

Confirmed so far: `three@0.184` exports `WebGPURenderer` via `three/webgpu`;
`tsc`/`eslint` clean; both `/facade?stats` and `/facade?webgpu` build and serve
200. **NOT yet confirmed at runtime** (browser automation was unavailable when
this was written) — see "Measure it" and "Risks to verify".

## Findings (live)

- **WebGPU renderer initializes** — it gets far enough to build materials, so the
  `three/webgpu` init + dynamic import + async `gl` path all work in-browser.
- **Shadows are incompatible:** `THREE.NodeBuilder: Material "MeshDepthMaterial"
  is not compatible` (×7). Three's shadow-map depth pass uses the classic
  `MeshDepthMaterial`, which WebGPURenderer's node system can't compile. **Spike
  accommodation:** `<Canvas shadows={!useWebGPU}>` disables the shadow pass on the
  WebGPU path so the scene renders and FPS is measurable. A real migration needs
  WebGPU-native shadows (node-based / `customDepthMaterial` per casting mesh, or
  three's WebGPU shadow setup) — a concrete, bounded migration cost to budget.

### Findings, continued (the incompatibility list)

Under `?webgpu`, each accommodation surfaced the next incompatible material:

1. **Shadows — `MeshDepthMaterial`.** three's WebGPU renderer compiles the
   shadow-map depth material through its NodeBuilder, which rejects the classic
   `MeshDepthMaterial`. Disabling it needed more than `<Canvas shadows={false}>`;
   even gating `castShadow` at the sun light did **not** fully clear it — three's
   WebGPU shadow system compiles the depth material eagerly / globally, so
   removing shadows is not a one-liner. **Entangled.**
2. **Fat lines — `ShaderMaterial`.** Every drei `<Line>` overlay (street guides,
   block outlines, facing ticks, selection) uses `LineMaterial` (a
   `ShaderMaterial`), rejected by the node system. Needs node/TSL line materials.

## Conclusion

**WebGPU is a genuine material migration for this app, not a flag flip.** Standard
building meshes convert automatically, but the scene depends on multiple
WebGPU-incompatible material paths (shadow depth material — stubbornly so — and
all fat-line overlays), each needing a node/TSL rewrite, plus re-verification of
the quad `<View>` layout, instancing, transparency and Save-image. Because the
app can't render on WebGPU until those are migrated, a clean apples-to-apples FPS
number wasn't obtainable in a time-boxed spike — and that inability is itself the
answer to "is this a cheap win": **no.**

**Recommendation:** invest in **WebGL-side optimization first** (profile the heavy
scene, then instance/merge more geometry, add LOD + frustum culling) — zero
migration, helps the live app today, and benefits any future desktop build.
Revisit WebGPU in ~6–12 months as three/R3F node-material coverage matures. If a
WebGPU migration is chosen deliberately, it earns its own multi-task plan
(node shadows → node/TSL lines → re-verify View/instancing/save-image).

Spike branch `spike/webgpu` is fully reversible; nothing here is merged.

## Measure it (on the Mac that matters)

1. `npm run dev`, open a **heavy** scene (draw a grid of ~8–10 long streets so a
   few hundred buildings generate).
2. **Control:** `http://localhost:3000/facade?stats` — read the FPS panel while
   orbiting the maximized 3D pane. Note min/typical FPS.
3. **WebGPU:** `http://localhost:3000/facade?webgpu` — same scene, same motion,
   read FPS. (Chrome ≥ 113 has WebGPU on by default; check `navigator.gpu` in the
   console if unsure.)
4. Compare. A meaningful win (say ≥ 1.5× on the heavy scene, or a much higher
   floor during interaction) justifies planning a real migration; a wash means
   stay on WebGL and spend the effort on WebGL-side optimization instead.

## Risks to verify at runtime (the spike's real purpose)

These are the things that decide the migration cost — check each with `?webgpu`:

- **Multi-`<View>` rendering.** The app draws 4 viewports in one Canvas via drei
  `<View>` (scissor/viewport). Confirm all four panes still render correctly on
  WebGPU — this is the highest-risk item.
- **Material node conversion.** `meshStandardMaterial`/`meshBasicMaterial` are
  auto-converted to node materials by WebGPURenderer; confirm colors, shadows,
  transparency (the canal water `depthWrite:false`) and `polygonOffset` all look
  right.
- **InstancedMesh** (window/frame instancing) renders.
- **"Save image"** uses `preserveDrawingBuffer` (WebGL-only flag). The WebGPU
  path drops it — verify whether Save-image still works or needs a WebGPU readback.
- **Shadows** (`<Canvas shadows>` + directional light) render.

## Decision framework

- Win is real and breakage is small → write a migration spec (renderer behind a
  setting, then default-on), likely paired with **Electron** packaging so WebGPU
  is guaranteed on the desktop build.
- Win is real but `<View>`/materials break → scope the fixes first; may be worth
  it but no longer "free".
- No win → keep WebGL; invest in profiling + WebGL optimization; revisit WebGPU
  when three/R3F support matures further.

## Cleanup

The flag is inert without `?webgpu`. If we decide **not** to pursue WebGPU, revert
this branch (it's a spike, unmerged). If we pursue it, fold the flag into a real
migration plan.
