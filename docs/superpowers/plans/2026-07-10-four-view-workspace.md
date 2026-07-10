# Four-View Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `/facade` viewer becomes a 2×2 CAD-style workspace — plan, perspective, elevation overview, elevation detail — with per-pane maximize, a mobile pane switcher, and per-pane image capture.

**Architecture:** One R3F `Canvas` with drei `<View>`/`<View.Port>` viewports. Scene content is single-sourced in a shared `SceneContents` component instanced per pane (drei View technically gives each view its own scene graph — an approved implementation detail; the spec's observable requirements hold: one canvas, per-pane cameras, every edit updates all panes because they render the same React state). Pure camera math (ortho fit, normal-derived elevation position) lives in `src/lib/facade/camera.ts` with vitest coverage.

**Tech Stack:** Existing stack. drei 10.7.7's `View` (verified present at `node_modules/@react-three/drei/web/View.d.ts` — `View` + `View.Port`, `className`/`style`/`track` API). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-four-view-workspace-design.md`

## Global Constraints

- **Elevation cameras are ALWAYS positioned along the facade-plane normal** (`FACADE_NORMAL = [0,0,1]` today) via `elevationCameraPosition(target, normal, distance)` — never hardcoded to a world axis (binding; sub-project C reuses this with angled normals).
- The two elevation panes are overview (auto-fitted to facade bounds + margin, refits when facade width/total height change) and detail (starts framed on the ground floor, free pan/zoom).
- Rendered everywhere: all panes share the same materials/sun/shadows (same `SceneContents`); plan + elevations use orthographic cameras with pan/zoom-only controls (no rotate); perspective keeps the v1 camera/controls verbatim (position [6,5,14], fov 40, target [0,4,0], azimuth clamp ±0.44π, polar π/2.05, distances 3–60).
- 2×2 grid with per-pane maximize (double-click or corner button toggles); mobile (< 768px): single pane + switcher strip, perspective by default.
- Save image captures the maximized pane, else the perspective pane; PNG must have the opaque sky (composite the gradient) — the gradient stops are defined ONCE (`SKY_STOPS`) and drive both the container CSS and the capture composite.
- **Approved deviation:** Canvas gains `preserveDrawingBuffer: true` — required because per-pane capture crops the shared multi-view canvas (v1's render-then-read trick doesn't compose with `View.Port`).
- The controls panel, page layout, and all other components are untouched except as listed. `FacadeMesh`, `layout.ts`, `types.ts` are NOT modified.
- Branch `feature/four-view` off `main`. Gate per task: `npm test && npx tsc --noEmit && npm run lint` (42 tests before this plan; 49 after Task 1). Dev server on :3000 may be running — leave it alone. Unrelated dirty files (public/default.glb, python/vendor submodule): leave untouched.

---

### Task 1: Camera math library (TDD)

**Files:**
- Create: `src/lib/facade/camera.ts`
- Create: `src/lib/facade/camera.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (Task 3 imports exactly these): `FACADE_NORMAL: [number, number, number]`, `fitOrthoZoom(viewW, viewH, worldW, worldH, margin?): number`, `elevationCameraPosition(target: [number,number,number], normal: [number,number,number], distance: number): [number, number, number]`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feature/four-view
```

- [ ] **Step 2: Write the failing tests** — `src/lib/facade/camera.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  FACADE_NORMAL,
  fitOrthoZoom,
  elevationCameraPosition,
} from "./camera";

describe("fitOrthoZoom", () => {
  it("fits by the limiting axis (pixels per world unit)", () => {
    // 800×600 view, 10×20 world, margin 1: height limits → 600/20 = 30
    expect(fitOrthoZoom(800, 600, 10, 20, 1)).toBeCloseTo(30, 9);
    // width limits: 400×600 view, 20×10 world → 400/20 = 20
    expect(fitOrthoZoom(400, 600, 20, 10, 1)).toBeCloseTo(20, 9);
  });

  it("applies the default 1.15 margin", () => {
    expect(fitOrthoZoom(800, 600, 10, 20)).toBeCloseTo(600 / (20 * 1.15), 9);
  });

  it("degenerate inputs return 1 instead of Infinity/NaN", () => {
    expect(fitOrthoZoom(800, 600, 0, 20)).toBe(1);
    expect(fitOrthoZoom(0, 600, 10, 20)).toBe(1);
    expect(fitOrthoZoom(800, 600, -5, 20)).toBe(1);
  });
});

describe("elevationCameraPosition", () => {
  it("places the camera along the normal at the given distance", () => {
    expect(
      elevationCameraPosition([0, 5, 0], FACADE_NORMAL, 30),
    ).toEqual([0, 5, 30]);
  });

  it("normalizes non-unit normals", () => {
    // normal (0,0,2) → unit (0,0,1) → same as above
    expect(elevationCameraPosition([1, 2, 3], [0, 0, 2], 10)).toEqual([
      1, 2, 13,
    ]);
  });

  it("works for angled normals (sub-project C's case)", () => {
    // 3-4-5 triangle normal in the xz plane
    const [x, y, z] = elevationCameraPosition([0, 0, 0], [0.6, 0, 0.8], 5);
    expect(x).toBeCloseTo(3, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(4, 9);
  });

  it("zero-length normal falls back without NaN", () => {
    const p = elevationCameraPosition([1, 1, 1], [0, 0, 0], 10);
    expect(p.every(Number.isFinite)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/camera.test.ts`
Expected: FAIL — cannot resolve `./camera`.

- [ ] **Step 4: Create `src/lib/facade/camera.ts`**

```ts
/** Outward normal of the (single, v1) facade plane. Sub-project C replaces
 * per-block; every elevation camera derives from a normal, never a world
 * axis — elevations are ALWAYS perpendicular to the facade plane. */
export const FACADE_NORMAL: [number, number, number] = [0, 0, 1];

/** Orthographic zoom (pixels per world unit) that fits a worldW×worldH
 * rectangle into a viewW×viewH viewport. margin > 1 leaves breathing room
 * (1.15 = 15%). Degenerate inputs return 1 (visible, never NaN/Infinity). */
export function fitOrthoZoom(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  margin = 1.15,
): number {
  if (viewW <= 0 || viewH <= 0 || worldW <= 0 || worldH <= 0) return 1;
  return Math.min(viewW / (worldW * margin), viewH / (worldH * margin));
}

/** Camera position `distance` along the (normalized) facade normal from
 * `target`. Zero-length normals fall back to +z. */
export function elevationCameraPosition(
  target: [number, number, number],
  normal: [number, number, number],
  distance: number,
): [number, number, number] {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  const n: [number, number, number] =
    len > 0 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1];
  return [
    target[0] + n[0] * distance,
    target[1] + n[1] * distance,
    target[2] + n[2] * distance,
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/camera.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Full gate and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 49 tests pass (42 + 7), clean.

```bash
git add src/lib/facade/camera.ts src/lib/facade/camera.test.ts
git commit -m "feat(facade): camera math — ortho fit + normal-derived elevation position"
```

---

### Task 2: Extract SceneContents into its own file (pure move)

**Files:**
- Create: `src/components/facade/SceneContents.tsx`
- Modify: `src/components/facade/FacadeViewer.tsx` (remove the moved code, import instead)

**Interfaces:**
- Consumes: nothing new.
- Produces: `default SceneContents({ params, context, view }: { params: FacadeParams; context: LotContext; view: ViewSettings })` — byte-for-byte the component currently named `SceneContents` inside FacadeViewer.tsx, INCLUDING its `<OrbitControls>` for now (Task 3 relocates controls into the panes). Also move (unchanged) its private helpers: `sunPositionFromAngles`, `useGroundGeometry`, `NeighborMasses`.

- [ ] **Step 1: Move the code**

Create `src/components/facade/SceneContents.tsx` with `"use client";` at top, the imports the moved code needs (`useMemo` from react; `OrbitControls, Environment, ContactShadows, Grid` from `@react-three/drei`; `* as THREE`; `FacadeMesh` from `./FacadeMesh`; types `FacadeParams, LotContext` from `@/lib/facade/types`; type `ViewSettings` from `@/lib/building/types`), then paste — UNCHANGED — from FacadeViewer.tsx: `sunPositionFromAngles`, `useGroundGeometry`, `NeighborMasses`, and the `SceneContents` function (renamed to a default export: `export default function SceneContents(...)`, same props).

In `FacadeViewer.tsx`: delete the moved functions, add `import SceneContents from "./SceneContents";`, keep everything else (Canvas, CaptureBridge, save button) exactly as is, and remove now-unused imports (likely `useMemo`, `OrbitControls`, `Environment`, `ContactShadows`, `Grid`, `FacadeMesh`, and the `THREE` import IF nothing else in the file uses it — `CaptureBridge` does not; check `mouseButtons/touches` were part of the moved controls).

- [ ] **Step 2: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 49 tests, clean, no unused-import warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/facade/SceneContents.tsx src/components/facade/FacadeViewer.tsx
git commit -m "refactor(facade): extract SceneContents for multi-view reuse"
```

---

### Task 3: The quad workspace

**Files:**
- Modify: `src/components/facade/FacadeViewer.tsx` (full rewrite — workspace shell)
- Modify: `src/components/facade/SceneContents.tsx` (remove `<OrbitControls>` + its now-unused imports; controls move into panes)

**Interfaces:**
- Consumes: `SceneContents` (Task 2), `fitOrthoZoom`/`elevationCameraPosition`/`FACADE_NORMAL` (Task 1), `computeLayout` from `@/lib/facade/layout`, drei `View`, `OrbitControls`, `MapControls`, `OrthographicCamera`, `PerspectiveCamera`.
- Produces: `default FacadeViewer({ params, context, view })` — same public props as today; the page is untouched.

**Implementation notes (binding):**
- drei `View` children are 3D content ONLY — pane labels/buttons are HTML siblings inside each grid cell, with `<View className="absolute inset-0">` filling the cell.
- The `Canvas` is absolutely positioned over the whole container with `pointerEvents: "none"` and `eventSource={containerRef}`; the tracking cells receive pointer events and drei routes them to the right view.
- Panes must stay MOUNTED when hidden (unmounting destroys their camera/controls state); hide with the `hidden` class on the cell.
- If drei View behaves unexpectedly, read the actual implementation at `node_modules/@react-three/drei/web/View.js` before improvising.

- [ ] **Step 1: Remove controls from SceneContents**

In `src/components/facade/SceneContents.tsx`: delete the `<OrbitControls …/>` element and remove now-unused imports (`OrbitControls`; `THREE` only if the touches/mouseButtons constants were its last use — `sunPositionFromAngles`/`useGroundGeometry` still use THREE, so keep it).

- [ ] **Step 2: Rewrite `src/components/facade/FacadeViewer.tsx`**

Complete replacement:

```tsx
"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas } from "@react-three/fiber";
import {
  View,
  OrbitControls,
  MapControls,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import SceneContents from "./SceneContents";
import { computeLayout } from "@/lib/facade/layout";
import {
  FACADE_NORMAL,
  fitOrthoZoom,
  elevationCameraPosition,
} from "@/lib/facade/camera";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import { FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";

interface FacadeViewerProps {
  params: FacadeParams;
  context: LotContext;
  view?: ViewSettings;
}

type PaneId = "plan" | "perspective" | "overview" | "detail";

const PANES: { id: PaneId; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "perspective", label: "3D" },
  { id: "overview", label: "Elevation" },
  { id: "detail", label: "Detail" },
];

const ELEVATION_DISTANCE = 30;

/** Single source for the sky gradient — drives BOTH the container CSS and
 * the save-image composite (they must never drift apart). */
const SKY_STOPS: [number, string][] = [
  [0, "#8ea4b8"],
  [0.55, "#a8b0b3"],
  [1, "#b8ad9c"],
];
const SKY_CSS = `linear-gradient(to bottom, ${SKY_STOPS.map(
  ([p, c]) => `${c} ${p * 100}%`,
).join(", ")})`;

/** Track an element's content size (drives ortho fit math). */
function useElementSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 300, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ── Pane contents (3D only — rendered inside <View>) ────────────────────────

function PlanPane({
  params,
  context,
  view,
  size,
}: {
  params: FacadeParams;
  context: LotContext;
  view: ViewSettings;
  size: { w: number; h: number };
}) {
  const layout = useMemo(() => computeLayout(params), [params]);
  // Fit the lot + neighbors (8m each side) + sidewalk/road depth.
  const worldW = layout.width + 18;
  const worldD = 26;
  const zoom = fitOrthoZoom(size.w, size.h, worldW, worldD);
  const camRef = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }, [zoom]);
  return (
    <>
      <SceneContents params={params} context={context} view={view} />
      {/* Top-down; up = -z puts the street (+z) at the bottom of the pane. */}
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={[0, 60, -2]}
        up={[0, 0, -1]}
        zoom={zoom}
        near={0.1}
        far={200}
      />
      <MapControls
        makeDefault
        enableRotate={false}
        target={[0, 0, -2]}
        zoomSpeed={1}
      />
    </>
  );
}

function PerspectivePane({
  params,
  context,
  view,
}: {
  params: FacadeParams;
  context: LotContext;
  view: ViewSettings;
}) {
  return (
    <>
      <SceneContents params={params} context={context} view={view} />
      <PerspectiveCamera
        makeDefault
        position={[6, 5, 14]}
        fov={40}
        near={0.1}
        far={200}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 4, 0]}
        minDistance={3}
        maxDistance={60}
        minAzimuthAngle={-Math.PI * 0.44}
        maxAzimuthAngle={Math.PI * 0.44}
        maxPolarAngle={Math.PI / 2.05}
        enablePan
        panSpeed={0.8}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

function ElevationPane({
  params,
  context,
  view,
  size,
  mode,
}: {
  params: FacadeParams;
  context: LotContext;
  view: ViewSettings;
  size: { w: number; h: number };
  mode: "overview" | "detail";
}) {
  const layout = useMemo(() => computeLayout(params), [params]);
  // Overview frames the whole facade; detail frames the ground storey.
  const worldH =
    mode === "overview"
      ? layout.totalHeight
      : Math.min(layout.storeyLevels[1] + 0.8, layout.totalHeight);
  const targetY = worldH / 2;
  const zoom = fitOrthoZoom(size.w, size.h, layout.width, worldH);
  const position = elevationCameraPosition(
    [0, targetY, 0],
    FACADE_NORMAL,
    ELEVATION_DISTANCE,
  );
  const camRef = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }, [zoom]);
  return (
    <>
      <SceneContents params={params} context={context} view={view} />
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={position}
        zoom={zoom}
        near={0.1}
        far={200}
      />
      <MapControls
        makeDefault
        enableRotate={false}
        target={[0, targetY, 0]}
        screenSpacePanning
        zoomSpeed={1}
      />
    </>
  );
}

// ── Workspace shell ─────────────────────────────────────────────────────────

export default function FacadeViewer({
  params,
  context,
  view = FACADE_DEFAULT_VIEW,
}: FacadeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const planRef = useRef<HTMLDivElement>(null);
  const perspectiveRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const cellRefs: Record<PaneId, React.RefObject<HTMLDivElement | null>> = {
    plan: planRef,
    perspective: perspectiveRef,
    overview: overviewRef,
    detail: detailRef,
  };

  const [maximized, setMaximized] = useState<PaneId | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Mobile always shows exactly one pane (perspective until switched).
  const active: PaneId | null = isDesktop ? maximized : maximized ?? "perspective";
  const paneVisible = (id: PaneId) => active === null || active === id;
  const toggleMaximize = useCallback(
    (id: PaneId) =>
      setMaximized((m) => (m === id && isDesktop ? null : id)),
    [isDesktop],
  );

  const planSize = useElementSize(planRef);
  const overviewSize = useElementSize(overviewRef);
  const detailSize = useElementSize(detailRef);

  // Per-pane capture: crop the shared canvas to the pane's rect and
  // composite the sky gradient (Canvas has preserveDrawingBuffer for this).
  const saveImage = useCallback(() => {
    const canvas = containerRef.current?.querySelector("canvas");
    const target: PaneId = active ?? "perspective";
    const cell = cellRefs[target].current;
    if (!canvas || !cell) return;
    const cRect = canvas.getBoundingClientRect();
    const pRect = cell.getBoundingClientRect();
    const dpr = canvas.width / cRect.width;
    const sx = (pRect.left - cRect.left) * dpr;
    const sy = (pRect.top - cRect.top) * dpr;
    const sw = pRect.width * dpr;
    const sh = pRect.height * dpr;
    if (sw <= 0 || sh <= 0) return;
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, sh);
    for (const [p, c] of SKY_STOPS) grad.addColorStop(p, c);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "facade.png";
    a.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const paneContent = (id: PaneId) => {
    switch (id) {
      case "plan":
        return (
          <PlanPane params={params} context={context} view={view} size={planSize} />
        );
      case "perspective":
        return <PerspectivePane params={params} context={context} view={view} />;
      case "overview":
        return (
          <ElevationPane
            params={params}
            context={context}
            view={view}
            size={overviewSize}
            mode="overview"
          />
        );
      case "detail":
        return (
          <ElevationPane
            params={params}
            context={context}
            view={view}
            size={detailSize}
            mode="detail"
          />
        );
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      style={{ background: SKY_CSS }}
    >
      {/* Tracking cells — the Views render into the shared canvas below. */}
      <div
        className={`h-full ${
          active
            ? ""
            : "grid grid-cols-2 grid-rows-2 gap-px bg-[var(--border)]"
        }`}
      >
        {PANES.map((p) => (
          <div
            key={p.id}
            ref={cellRefs[p.id]}
            className={`relative ${paneVisible(p.id) ? "h-full" : "hidden"}`}
            onDoubleClick={() => isDesktop && toggleMaximize(p.id)}
          >
            <View className="absolute inset-0">
              <Suspense fallback={null}>{paneContent(p.id)}</Suspense>
            </View>
            {/* HTML overlays — Views hold 3D content only */}
            <div className="absolute top-1.5 left-2 text-[10px] font-mono text-white/70 bg-black/40 rounded px-1.5 py-0.5 pointer-events-none">
              {p.label}
            </div>
            {isDesktop && (
              <button
                type="button"
                onClick={() => toggleMaximize(p.id)}
                className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded bg-black/40 text-white/70 text-[11px] hover:bg-black/60 transition-colors"
                title={maximized === p.id ? "Restore grid" : "Maximize"}
              >
                {maximized === p.id ? "⤡" : "⤢"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* One shared canvas behind the tracking cells. */}
      <Canvas
        shadows
        className="!absolute !inset-0"
        style={{ pointerEvents: "none" }}
        eventSource={containerRef}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        <View.Port />
      </Canvas>

      {/* Mobile pane switcher */}
      <div className="md:hidden absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setMaximized(p.id)}
            className={`px-2.5 py-1 rounded-full text-[10px] transition-colors ${
              active === p.id
                ? "bg-[var(--accent)] text-white"
                : "bg-black/45 text-white/75"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={saveImage}
        className="absolute top-3 right-3 rounded-lg bg-black/55 backdrop-blur-md px-3 py-1.5 text-[11px] text-white/85 hover:bg-black/70 transition-colors"
      >
        Save image
      </button>
    </div>
  );
}
```

Note: the old `CaptureBridge` component is gone — capture now reads the
preserved buffer directly. If eslint objects to the `cellRefs` dependency in
`saveImage`'s hook deps, the refs record is stable per render semantics; the
disable comment shown above is acceptable, or hoist `cellRefs` into a
`useRef`-of-record.

- [ ] **Step 3: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 49 tests pass, tsc clean, lint 0 errors.

- [ ] **Step 4: VISUAL CHECKPOINT** (controller performs if implementer has no browser)

On `/facade` (desktop width):
1. 2×2 grid: plan (top-down, street at bottom), perspective (v1 view), elevation overview (whole facade, head-on), detail (ground floor).
2. Drag a slider: all four panes update live.
3. Orbit only works in the perspective pane; plan/elevations pan+zoom but never rotate.
4. Double-click a pane → fills the viewer; double-click again → grid restores. Corner ⤢/⤡ buttons do the same.
5. Width/storeys change → overview refits.
6. Save image downloads the perspective pane (grid mode) or the maximized pane, sky opaque.
7. Narrow window (< 768px): single pane + switcher strip.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeViewer.tsx src/components/facade/SceneContents.tsx
git commit -m "feat(facade): 2x2 quad workspace — plan, perspective, elevation overview/detail"
```

---

### Task 4: Finish

- [ ] **Step 1:** Full gate: `npm test && npx tsc --noEmit && npm run lint` — 49 tests, clean.
- [ ] **Step 2:** Hand off via superpowers:finishing-a-development-branch.

## Self-Review Notes

- Spec coverage: normal-derived elevation cameras → T1 `elevationCameraPosition` + T3 usage; overview auto-fit + refit → `fitOrthoZoom` + zoom effect on layout dims; detail ground-floor framing → `worldH = storeyLevels[1] + 0.8`; rendered-everywhere → shared `SceneContents` in all panes; 2×2 + maximize + mobile switcher → workspace shell; per-pane save-image with opaque sky + single-sourced gradient → `SKY_STOPS`/`saveImage`; perspective verbatim → `PerspectivePane` copies v1 values exactly.
- Deviations declared in Global Constraints: per-view scene graphs under drei View (content single-sourced), `preserveDrawingBuffer: true`.
- Type consistency: `fitOrthoZoom`/`elevationCameraPosition`/`FACADE_NORMAL` signatures match between T1 and T3; `SceneContents` props match T2's extraction; `PaneId`/`PANES` internal to T3.
- Known risk (flagged for the implementer/reviewer, not a placeholder): drei View + per-view `makeDefault` controls interplay and the `up=[0,0,-1]` plan orientation are the two spots most likely to need interactive debugging; the visual checkpoint gates them.
