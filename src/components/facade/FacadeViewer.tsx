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
import { fitOrthoZoom, elevationCameraPosition } from "@/lib/facade/camera";
import { deriveNodes, type WorldNode } from "@/lib/facade/nodes";
import { FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import {
  snapPoint,
  blockFrame,
  lotPlacements,
  totalLotsWidth,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";

interface FacadeViewerProps {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  view?: ViewSettings;
  onDrawModeChange?: (drawMode: boolean) => void;
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

/** Pen tool: click chains nodes into welded segments. Lives ONLY in the
 * plan pane. Each click from the second on commits a block immediately;
 * Escape (or leaving draw mode) ends the path; clicking near the FIRST
 * node closes the loop. Consecutive segments share exact endpoint
 * coordinates — welded by construction. */
function PenSurface({
  blocks,
  active,
  onCommitLine,
}: {
  blocks: FacadeBlock[];
  active: boolean;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
}) {
  const [path, setPath] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  // Reset the in-progress path when draw mode is switched off. Adjusted
  // during render (React's documented pattern for resetting state on a
  // prop change) rather than in an effect, since setState-in-effect
  // triggers a cascading-render lint error and a render-time reset is
  // both simpler and paints one frame sooner.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setPath([]);
      setCursor(null);
    }
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPath([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;
  const first = path[0];
  const last = path[path.length - 1];
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const p = snapPoint([e.point.x, e.point.z], blocks);
          if (path.length === 0) {
            setPath([p]);
            return;
          }
          const closing =
            path.length >= 2 &&
            Math.hypot(p[0] - first[0], p[1] - first[1]) <= 1;
          const target = closing ? first : p;
          const len = Math.hypot(target[0] - last[0], target[1] - last[1]);
          if (len < MIN_BLOCK_LENGTH) return;
          onCommitLine(last, target);
          setPath(closing ? [] : [...path, target]);
        }}
        onPointerMove={(e) =>
          setCursor(snapPoint([e.point.x, e.point.z], blocks))
        }
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {last && cursor && (
        <Line
          points={[
            [last[0], 0.08, last[1]],
            [cursor[0], 0.08, cursor[1]],
          ]}
          color="#3b82f6"
          lineWidth={3}
          dashed
          dashSize={0.5}
          gapSize={0.3}
        />
      )}
      {path.length >= 2 && (
        <mesh
          position={[first[0], 0.09, first[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.5, 0.7, 24]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

/** One draggable node handle (plan pane). Flat circle just above the
 * block lines; hover/drag states use the accent blue. */
function NodeHandle({
  node,
  active,
  interactive,
  onStart,
}: {
  node: WorldNode;
  active: boolean;
  interactive: boolean;
  onStart: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <mesh
      position={[node.pos[0], 0.1, node.pos[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={
        interactive
          ? (e) => {
              e.stopPropagation();
              onStart();
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation();
              setHover(true);
            }
          : undefined
      }
      onPointerOut={interactive ? () => setHover(false) : undefined}
    >
      <circleGeometry args={[hover || active ? 0.8 : 0.55, 24]} />
      <meshBasicMaterial
        color={active ? "#3b82f6" : hover ? "#93c5fd" : "#e5e7eb"}
        transparent
        opacity={0.95}
        depthWrite={false}
      />
    </mesh>
  );
}

/** All node handles + the drag interaction. Handles are always visible in
 * the plan pane; dragging is disabled while the pen path is active. While
 * dragging, moves apply LIVE via onMoveNode (which may reject — the node
 * sticks), and the node snaps (1 m) to nodes of unattached blocks so
 * releasing there welds them. */
function NodeHandles({
  blocks,
  interactive,
  onMoveNode,
  onDraggingChange,
}: {
  blocks: FacadeBlock[];
  interactive: boolean;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const nodes = useMemo(() => deriveNodes(blocks), [blocks]);
  const [drag, setDrag] = useState<null | {
    pos: [number, number];
    targets: [number, number][];
  }>(null);
  const endDrag = useCallback(() => {
    setDrag(null);
    onDraggingChange(false);
  }, [onDraggingChange]);
  const dragging = drag !== null;
  // A release outside the pane must not strand the drag.
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointerup", endDrag);
    return () => window.removeEventListener("pointerup", endDrag);
  }, [dragging, endDrag]);
  return (
    <>
      {nodes.map((n) => (
        <NodeHandle
          key={n.refs.map((r) => `${r.blockId}:${r.end}`).sort().join("|")}
          node={n}
          active={drag !== null && drag.pos[0] === n.pos[0] && drag.pos[1] === n.pos[1]}
          interactive={interactive && drag === null}
          onStart={() => {
            const attached = new Set(n.refs.map((r) => r.blockId));
            const targets = nodes
              .filter(
                (m) => m !== n && !m.refs.some((r) => attached.has(r.blockId)),
              )
              .map((m) => m.pos);
            setDrag({ pos: n.pos, targets });
            onDraggingChange(true);
          }}
        />
      ))}
      {drag && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.03, 0]}
          onPointerMove={(e) => {
            const raw: [number, number] = [e.point.x, e.point.z];
            let best: [number, number] | null = null;
            let bestD = 1;
            for (const t of drag.targets) {
              const d = Math.hypot(raw[0] - t[0], raw[1] - t[1]);
              if (d < bestD) {
                bestD = d;
                best = t;
              }
            }
            const to = best ?? raw;
            if (onMoveNode(drag.pos, to))
              setDrag((d) => (d ? { ...d, pos: to } : d));
          }}
          onPointerUp={endDrag}
        >
          <planeGeometry args={[600, 600]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

function PlanPane({
  blocks,
  selected,
  onSelectLot,
  view,
  size,
  drawMode,
  onCommitLine,
  onMoveNode,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  size: { w: number; h: number };
  drawMode: boolean;
  onCommitLine: (a: [number, number], b: [number, number]) => void;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
}) {
  const [nodeDrag, setNodeDrag] = useState(false);
  const dragEndAt = useRef(0);
  const handleDraggingChange = useCallback((dragging: boolean) => {
    if (!dragging) dragEndAt.current = performance.now();
    setNodeDrag(dragging);
  }, []);
  // R3F synthesizes a click right after a drag's release, and the lot under
  // the release point was in the original pointerdown's hit set — no
  // object-level stopPropagation can intercept it (initialHits is snapshotted
  // before the drag catcher mounts). Suppress selection briefly instead.
  const guardedSelectLot = useCallback(
    (blockId: string, lot: number) => {
      if (performance.now() - dragEndAt.current < 300) return;
      onSelectLot(blockId, lot);
    },
    [onSelectLot],
  );
  const bounds = useMemo(() => {
    if (blocks.length === 0) return { w: 30, d: 30, cx: 0, cz: 0 };
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const b of blocks) {
      for (const e of [b.line.a, b.line.b]) {
        minX = Math.min(minX, e[0]);
        maxX = Math.max(maxX, e[0]);
        minZ = Math.min(minZ, e[1]);
        maxZ = Math.max(maxZ, e[1]);
      }
    }
    const pad = 20; // breathing room around the drawn world
    return {
      w: Math.max(maxX - minX + pad, 30),
      d: Math.max(maxZ - minZ + pad, 30),
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    };
  }, [blocks]);
  const zoom = fitOrthoZoom(size.w, size.h, bounds.w, bounds.d);
  const camRef = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }, [zoom]);
  // Stable identity — MapControls target/OrthographicCamera position reset
  // an in-progress pan when they receive a freshly-built array on every
  // render; memoize on the underlying scalars instead.
  const target = useMemo<[number, number, number]>(
    () => [bounds.cx, 0, bounds.cz - 2],
    [bounds.cx, bounds.cz],
  );
  const camPosition = useMemo<[number, number, number]>(
    () => [bounds.cx, 60, bounds.cz - 2],
    [bounds.cx, bounds.cz],
  );
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={guardedSelectLot}
        view={view}
      />
      <PenSurface blocks={blocks} active={drawMode} onCommitLine={onCommitLine} />
      <NodeHandles
        blocks={blocks}
        interactive={!drawMode}
        onMoveNode={onMoveNode}
        onDraggingChange={handleDraggingChange}
      />
      {/* Top-down; up = -z puts the street (+z) at the bottom of the pane. */}
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={camPosition}
        up={[0, 0, -1]}
        zoom={zoom}
        near={0.1}
        far={200}
      />
      <MapControls
        makeDefault
        enableRotate={false}
        target={target}
        zoomSpeed={1}
        enabled={!drawMode && !nodeDrag}
      />
    </>
  );
}

function PerspectivePane({
  blocks,
  selected,
  onSelectLot,
  view,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
}) {
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
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
  view,
  size,
  mode,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  size: { w: number; h: number };
  mode: "overview" | "detail";
}) {
  // Zero-block world: `block` is undefined. Hooks below must still run
  // unconditionally (Rules of Hooks) — every derived value falls back to a
  // safe default so the memos never throw, and the JSX branches at the end
  // to render just the ground plane behind a default fitted camera.
  const block = blocks.find((b) => b.id === selected?.blockId) ?? blocks[0];
  const frame = useMemo(() => (block ? blockFrame(block) : null), [block]);
  // Memoized (not `block?.lots ?? []`) — a fresh `[]` literal on every
  // render would change identity even when `block` doesn't, defeating the
  // maxH memo below.
  const lots = useMemo(() => block?.lots ?? [], [block]);
  const maxH = useMemo(
    () =>
      lots.length > 0
        ? Math.max(...lots.map((l) => computeLayout(l.params).totalHeight))
        : 12,
    [lots],
  );
  const length = block ? totalLotsWidth(block) : 30;
  // Overview frames the whole block strip; detail frames the SELECTED
  // lot's ground storey.
  const lotIndex = Math.min(selected?.lot ?? 0, Math.max(lots.length - 1, 0));
  const lotParams = lots[lotIndex]?.params ?? null;
  const lotLayout = useMemo(
    () => (lotParams ? computeLayout(lotParams) : null),
    [lotParams],
  );
  const placements = useMemo(
    () => (block ? lotPlacements(block) : []),
    [block],
  );
  const lotPos = placements[lotIndex]?.position ?? ([0, 0, 0] as [
    number,
    number,
    number,
  ]);

  const worldW = mode === "overview" ? length : (lotParams?.width ?? 30);
  const worldH =
    mode === "overview"
      ? maxH
      : lotLayout
        ? Math.min(lotLayout.storeyLevels[1] + 0.8, lotLayout.totalHeight)
        : 12;
  const targetY = block ? worldH / 2 : 4;
  const midX =
    mode === "overview"
      ? (frame ? frame.origin[0] + (frame.dir[0] * length) / 2 : 0)
      : lotPos[0];
  const midZ =
    mode === "overview"
      ? (frame ? frame.origin[1] + (frame.dir[1] * length) / 2 : 0)
      : lotPos[2];
  // Stable identity — drei's MapControls target/OrthographicCamera position
  // props reset any in-progress pan when they receive a freshly-built array
  // on every render; memoize on the underlying scalars instead.
  const mid = useMemo<[number, number, number]>(
    () => [midX, targetY, midZ],
    [midX, targetY, midZ],
  );
  const normal3: [number, number, number] = frame
    ? [frame.normal[0], 0, frame.normal[1]]
    : [0, 0, 1];
  const zoom = block
    ? fitOrthoZoom(size.w, size.h, worldW, worldH)
    : fitOrthoZoom(size.w, size.h, 30, 12);
  const position = useMemo<[number, number, number]>(
    () =>
      block
        ? elevationCameraPosition(mid, normal3, ELEVATION_DISTANCE)
        : [0, 8, ELEVATION_DISTANCE],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [block, mid, normal3[0], normal3[2]],
  );
  const camRef = useRef<THREE.OrthographicCamera>(null);
  useEffect(() => {
    const cam = camRef.current;
    if (!cam) return;
    cam.position.set(position[0], position[1], position[2]);
    cam.lookAt(mid[0], mid[1], mid[2]);
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, position[0], position[1], position[2], mid[0], mid[1], mid[2]]);
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        view={view}
      />
      <OrthographicCamera
        ref={camRef}
        makeDefault
        position={position}
        zoom={zoom}
        near={0.1}
        far={400}
      />
      {block && (
        <MapControls
          makeDefault
          enableRotate={false}
          target={mid}
          screenSpacePanning
          zoomSpeed={1}
        />
      )}
    </>
  );
}

// ── Workspace shell ─────────────────────────────────────────────────────────

export default function FacadeViewer({
  blocks,
  selected,
  onSelectLot,
  onCommitLine,
  onMoveNode,
  view = FACADE_DEFAULT_VIEW,
  onDrawModeChange,
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
  // A blank world starts with the pen armed — the empty-state copy on the
  // right panel promises the pen is ready immediately.
  const [drawMode, setDrawMode] = useState(blocks.length === 0);
  useEffect(() => {
    onDrawModeChange?.(drawMode);
  }, [drawMode, onDrawModeChange]);
  // Re-arm the pen whenever the world returns to blank (e.g. the last block
  // was deleted) — the blank-canvas copy promises an armed pen.
  useEffect(() => {
    if (blocks.length === 0) setDrawMode(true);
  }, [blocks.length]);
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
            view={view}
            size={planSize}
            drawMode={drawMode}
            onCommitLine={onCommitLine}
            onMoveNode={onMoveNode}
          />
        );
      case "perspective":
        return (
          <PerspectivePane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
            view={view}
          />
        );
      case "overview":
        return (
          <ElevationPane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
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
