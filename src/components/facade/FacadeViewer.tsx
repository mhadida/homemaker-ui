"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  View,
  OrbitControls,
  MapControls,
  OrthographicCamera,
  PerspectiveCamera,
  Line,
} from "@react-three/drei";
import * as THREE from "three";
import SceneContents from "./SceneContents";
import { computeLayout } from "@/lib/facade/layout";
import {
  FACADE_NORMAL,
  fitOrthoZoom,
  elevationCameraPosition,
} from "@/lib/facade/camera";
import type { LotContext } from "@/lib/facade/types";
import { FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import { snapPoint, type FacadeBlock, type Selection } from "@/lib/facade/blocks";

interface FacadeViewerProps {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
  context: LotContext;
  view?: ViewSettings;
}

type PaneId = "plan" | "perspective" | "overview" | "detail";

const PANES: { id: PaneId; label: string; index: number }[] = [
  { id: "plan", label: "Plan", index: 1 },
  { id: "perspective", label: "3D", index: 2 },
  { id: "overview", label: "Elevation", index: 3 },
  { id: "detail", label: "Detail", index: 4 },
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

/** Track an element's content size (drives ortho fit math). Re-measures on
 * ResizeObserver events AND whenever layoutEpoch changes — across
 * maximize/restore the observer can deliver zero/stale sizes, so an
 * explicit re-measure after the new layout commits is required. */
function useElementSize(
  ref: React.RefObject<HTMLDivElement | null>,
  layoutEpoch: unknown,
) {
  const [size, setSize] = useState({ w: 300, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, layoutEpoch]);
  return size;
}

/** drei Views scissor-paint their own regions with autoClear disabled and
 * the buffer is preserved for capture — without a global clear, stale
 * pixels from layout transitions persist forever. Runs before every View
 * (their useFrame priority is >= 1). */
function GlobalClear() {
  useFrame(({ gl }) => {
    gl.setScissorTest(false);
    gl.clear(true, true, true);
  }, 0.5);
  return null;
}

// ── Pane contents (3D only — rendered inside <View>) ────────────────────────

const MIN_BLOCK_LENGTH = 3;

/** Invisible ground-plane pick surface + rubber-band line. Lives ONLY in
 * the plan pane, so drawing gestures can't fire from other panes. */
function DrawSurface({
  blocks,
  onCommitLine,
}: {
  blocks: FacadeBlock[];
  onCommitLine: (a: [number, number], b: [number, number]) => void;
}) {
  const [draft, setDraft] = useState<null | {
    a: [number, number];
    b: [number, number];
  }>(null);
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          (e.target as unknown as HTMLElement).setPointerCapture?.(e.pointerId);
          e.stopPropagation();
          const p = snapPoint([e.point.x, e.point.z], blocks);
          setDraft({ a: p, b: p });
        }}
        onPointerMove={(e) => {
          setDraft((d) => (d ? { a: d.a, b: [e.point.x, e.point.z] } : d));
        }}
        onPointerUp={(e) => {
          if (!draft) return;
          const b = snapPoint([e.point.x, e.point.z], blocks);
          const len = Math.hypot(b[0] - draft.a[0], b[1] - draft.a[1]);
          if (len >= MIN_BLOCK_LENGTH) onCommitLine(draft.a, b);
          setDraft(null);
        }}
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {draft && (
        <Line
          points={[
            [draft.a[0], 0.08, draft.a[1]],
            [draft.b[0], 0.08, draft.b[1]],
          ]}
          color="#3b82f6"
          lineWidth={3}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
    </>
  );
}

function PlanPane({
  blocks,
  selected,
  onSelectLot,
  context,
  view,
  size,
  drawMode,
  onCommitLine,
}: {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view: ViewSettings;
  size: { w: number; h: number };
  drawMode: boolean;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
}) {
  const selBlock = blocks.find((b) => b.id === selected.blockId) ?? blocks[0];
  const selParams =
    selBlock.lots[Math.min(selected.lot, selBlock.lots.length - 1)].params;
  const layout = useMemo(() => computeLayout(selParams), [selParams]);
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
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        context={context}
        view={view}
      />
      {drawMode && <DrawSurface blocks={blocks} onCommitLine={onCommitLine} />}
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
        enabled={!drawMode}
      />
    </>
  );
}

function PerspectivePane({
  blocks,
  selected,
  onSelectLot,
  context,
  view,
}: {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view: ViewSettings;
}) {
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        context={context}
        view={view}
      />
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
  blocks,
  selected,
  onSelectLot,
  context,
  view,
  size,
  mode,
}: {
  blocks: FacadeBlock[];
  selected: Selection;
  onSelectLot: (blockId: string, lot: number) => void;
  context: LotContext;
  view: ViewSettings;
  size: { w: number; h: number };
  mode: "overview" | "detail";
}) {
  const selBlock = blocks.find((b) => b.id === selected.blockId) ?? blocks[0];
  const selParams =
    selBlock.lots[Math.min(selected.lot, selBlock.lots.length - 1)].params;
  const layout = useMemo(() => computeLayout(selParams), [selParams]);
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
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        context={context}
        view={view}
      />
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
  blocks,
  selected,
  onSelectLot,
  onCommitLine,
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
  const [drawMode, setDrawMode] = useState(false);
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

  const planSize = useElementSize(planRef, active);
  const overviewSize = useElementSize(overviewRef, active);
  const detailSize = useElementSize(detailRef, active);

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
          <PlanPane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
            context={context}
            view={view}
            size={planSize}
            drawMode={drawMode}
            onCommitLine={onCommitLine}
          />
        );
      case "perspective":
        return (
          <PerspectivePane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
            context={context}
            view={view}
          />
        );
      case "overview":
        return (
          <ElevationPane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
            context={context}
            view={view}
            size={overviewSize}
            mode="overview"
          />
        );
      case "detail":
        return (
          <ElevationPane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
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
            <View
              className="absolute inset-0"
              index={p.index}
              visible={paneVisible(p.id)}
            >
              <Suspense fallback={null}>{paneContent(p.id)}</Suspense>
            </View>
            {/* HTML overlays — Views hold 3D content only */}
            <div className="absolute top-1.5 left-2 text-[10px] font-mono text-white/70 bg-black/40 rounded px-1.5 py-0.5 pointer-events-none">
              {p.label}
            </div>
            {p.id === "plan" && (
              <button
                type="button"
                onClick={() => setDrawMode((d) => !d)}
                aria-label={drawMode ? "Exit draw mode" : "Draw a block"}
                className={`absolute top-1 left-16 grid h-6 px-2 place-items-center rounded text-[10px] transition-colors ${
                  drawMode
                    ? "bg-[var(--accent)] text-white"
                    : "bg-black/40 text-white/70 hover:bg-black/60"
                }`}
              >
                {drawMode ? "drawing…" : "✏ draw"}
              </button>
            )}
            {isDesktop && (
              <button
                type="button"
                onClick={() => toggleMaximize(p.id)}
                className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded bg-black/40 text-white/70 text-[11px] hover:bg-black/60 transition-colors"
                title={maximized === p.id ? "Restore grid" : "Maximize"}
                aria-label={maximized === p.id ? "Restore grid" : "Maximize pane"}
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
        <GlobalClear />
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
        className="absolute top-3 right-12 rounded-lg bg-black/55 backdrop-blur-md px-3 py-1.5 text-[11px] text-white/85 hover:bg-black/70 transition-colors"
      >
        Save image
      </button>
    </div>
  );
}
