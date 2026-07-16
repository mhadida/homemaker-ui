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
import type { Corner } from "@/lib/facade/corners";
import type { Ground } from "@/lib/facade/terrain";
import { marqueeEmpty, type Marquee } from "@/lib/facade/marquee";
import {
  streetLines,
  streetAwareFlipped,
  type StreetRef,
} from "@/lib/facade/street";
import { filletCentreline, snapStreetPoint } from "@/lib/street/geometry";
import { STREET_SPECS } from "@/lib/street/types";
import type { StreetNetwork, StreetType, Vec2 } from "@/lib/street/types";

interface FacadeViewerProps {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  /** Commit one drawn segment with its resolved facing; returns the new
   * block id so the pen can flip the whole chain later. */
  onCommitLine: (
    a: [number, number],
    b: [number, number],
    flipped: boolean,
  ) => string;
  /** Flip the facing of a set of blocks at once (the chain being drawn). */
  onFlipChain: (ids: string[]) => void;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  view?: ViewSettings;
  onDrawModeChange?: (drawMode: boolean) => void;
  corners: Corner[];
  onSelectCorner: (key: string) => void;
  maxCornerAngle: number;
  ground: Ground;
  /** Street reference (first block) + width for street-aware orientation and
   * the plan-pane construction guides. null in the blank world. */
  streetRef: StreetRef | null;
  streetWidth: number;
  /** Marquee (rubber-band) multi-selection. null → the Select tool is idle. */
  marquee: Marquee | null;
  onMarquee: (a: [number, number], b: [number, number]) => void;
  onMarqueeClear: () => void;
  onMarqueeMoveStart: () => void;
  onMarqueeMove: (dx: number, dz: number) => void;
  onMarqueeMoveEnd: (dx: number, dz: number) => void;
  /** Drawn streets + roundabouts (the standalone road network, independent
   * of blocks/lots). Rendered in every pane's world space. */
  streetNetwork: StreetNetwork;
  /** Commit one finished street polyline drawn with the street tool. */
  onCommitStreet: (type: StreetType, points: Vec2[], closed?: boolean) => void;
  /** Selected street id (inspector target) — highlighted in every pane. */
  selectedStreet: string | null;
  onSelectStreet: (id: string) => void;
  /** Selected derived-intersection key (inspector target). */
  selectedIntersection: string | null;
  onSelectIntersection: (key: string) => void;
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
const DRAG_THRESHOLD = 0.3; // metres — clicks with sub-threshold jitter select, not drag

/** Pen tool: click chains nodes into welded segments. Lives ONLY in the
 * plan pane. Each click from the second on commits a block immediately;
 * Escape (or leaving draw mode) ends the path; clicking near the FIRST
 * node closes the loop. Consecutive segments share exact endpoint
 * coordinates — welded by construction. */
/** The facing indicator's colour — green "this side faces the street". */
const FACING_COLOR = "#22c55e";
/** Length of the facing tick, metres. */
const FACING_TICK = 2.5;

function PenSurface({
  blocks,
  active,
  onCommitLine,
  onFlipChain,
  streetRef,
  streetWidth,
}: {
  blocks: FacadeBlock[];
  active: boolean;
  onCommitLine: (
    a: [number, number],
    b: [number, number],
    flipped: boolean,
  ) => string;
  onFlipChain: (ids: string[]) => void;
  streetRef: StreetRef | null;
  streetWidth: number;
}) {
  const [path, setPath] = useState<[number, number][]>([]);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  // Facing is a CHAIN-level decision so a block's facade side never flips
  // between welded segments:
  //  • chainBase — the street-aware auto orientation, locked at the chain's
  //    FIRST segment and applied to every later segment (each relative to its
  //    own drawn direction → same physical side).
  //  • fFlip — the user's f-toggle for the whole chain (persistent, NOT reset
  //    per segment). f also flips every already-committed segment (chainIds)
  //    so pressing it any time keeps the whole block consistent.
  // Every segment builds with `chainBase !== fFlip`.
  const [fFlip, setFFlip] = useState(false);
  const [chainBase, setChainBase] = useState<boolean | null>(null);
  const [chainIds, setChainIds] = useState<string[]>([]);

  // Read by the window keydown listener (deps kept to [active]) so f sees the
  // live committed-chain ids and the current flip callback without re-binding.
  // Synced in a deps-less effect — mirrors NodeHandles' endDragRef pattern.
  const chainIdsRef = useRef<string[]>([]);
  const onFlipChainRef = useRef(onFlipChain);
  useEffect(() => {
    chainIdsRef.current = chainIds;
    onFlipChainRef.current = onFlipChain;
  });

  const resetChain = () => {
    setPath([]);
    setFFlip(false);
    setChainBase(null);
    setChainIds([]);
  };

  // Reset the in-progress path when draw mode is switched off. Adjusted
  // during render (React's documented pattern for resetting state on a
  // prop change) rather than in an effect, since setState-in-effect
  // triggers a cascading-render lint error and a render-time reset is
  // both simpler and paints one frame sooner.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setCursor(null);
      resetChain();
    }
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keystrokes typed into a field (the inline AI prompt
      // stays mounted while the pen is armed) — matches the page's own
      // keydown guard.
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        resetChain();
      } else if (e.key === "f" || e.key === "F") {
        // Flip the whole block: toggle the pending facing AND flip every
        // segment already committed in this chain, so it stays consistent.
        setFFlip((v) => !v);
        onFlipChainRef.current(chainIdsRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;
  const first = path[0];
  const last = path[path.length - 1];
  // Resolved facing of the segment being drawn (last → cursor). Uses the
  // locked chainBase once the chain has started, so the preview tick matches
  // what every segment of the chain gets.
  let facingTick: [[number, number, number], [number, number, number]] | null =
    null;
  if (last && cursor) {
    const dx = cursor[0] - last[0];
    const dz = cursor[1] - last[1];
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      const base =
        chainBase ?? streetAwareFlipped(streetRef, streetWidth, last, cursor);
      const flipped = base !== fFlip;
      const s = flipped ? -1 : 1;
      // blockFrame normal for flipped=false is [-dz, dx]; flip negates it.
      const nx = (s * -dz) / len;
      const nz = (s * dx) / len;
      const mx = (last[0] + cursor[0]) / 2;
      const mz = (last[1] + cursor[1]) / 2;
      facingTick = [
        [mx, 0.08, mz],
        [mx + nx * FACING_TICK, 0.08, mz + nz * FACING_TICK],
      ];
    }
  }
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
          // Lock the chain's side at the first segment; reuse it thereafter.
          const base =
            chainBase ?? streetAwareFlipped(streetRef, streetWidth, last, target);
          const id = onCommitLine(last, target, base !== fFlip);
          if (closing) {
            resetChain();
          } else {
            setPath([...path, target]);
            if (chainBase === null) setChainBase(base);
            // Sync the ref NOW (not just via the effect) so an f pressed in
            // the same tick as this commit still flips the new segment.
            const nextIds = [...chainIds, id];
            chainIdsRef.current = nextIds;
            setChainIds(nextIds);
          }
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
      {facingTick && (
        <Line points={facingTick} color={FACING_COLOR} lineWidth={4} />
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

// ── Street tool (pen for the road network) ──────────────────────────────────

/** In-progress polyline preview colour, per type — distinct from the pen's
 * blue and the marquee's gold; not required to match StreetRibbonMesh's
 * final paving material, just a legible type cue while drawing. */
const STREET_PREVIEW_COLORS: Record<StreetType, string> = {
  alley: "#c084fc",
  street: "#facc15",
  road: "#fb923c",
  boulevard: "#f472b6",
};

/** Street tool: click chains polyline vertices; Escape or clicking near the
 * first vertex ends the path and commits it as one Street. Unlike the block
 * pen, a street is a single multi-point object (no per-segment commit, no
 * facing) — mirrors PenSurface's invisible catcher + render-time reset. */
function StreetDrawSurface({
  active,
  activeType,
  onCommitStreet,
  network,
}: {
  active: boolean;
  activeType: StreetType;
  onCommitStreet: (type: StreetType, points: Vec2[], closed?: boolean) => void;
  network: StreetNetwork;
}) {
  const [path, setPath] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  // Whether the current cursor landed on an existing street (vertex or
  // mid-segment) rather than the raw pointer position — drives the snap-cue
  // ring so a forming T/X junction is visible before the click commits it.
  const [snapped, setSnapped] = useState(false);

  const resetPath = () => setPath([]);

  // Reset the in-progress path when the tool is switched off (render-time
  // reset, matching PenSurface).
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setCursor(null);
      setSnapped(false);
      resetPath();
    }
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        if (path.length >= 2) onCommitStreet(activeType, path);
        resetPath();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, path, activeType, onCommitStreet]);

  if (!active) return null;
  const first = path[0];
  const color = STREET_PREVIEW_COLORS[activeType];
  const preview = first && cursor ? [...path, cursor] : path;
  const smooth =
    preview.length >= 2
      ? filletCentreline(preview, STREET_SPECS[activeType].minRadius)
      : null;
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const raw: Vec2 = [e.point.x, e.point.z];
          const p = snapStreetPoint(raw, network, 1);
          if (path.length === 0) {
            setPath([p]);
            return;
          }
          // Clicking the first vertex closes the street into a LOOP (needs ≥ 3
          // vertices for a real ring). Escape still commits an open polyline.
          const closing =
            path.length >= 3 &&
            Math.hypot(p[0] - first[0], p[1] - first[1]) <= 1;
          if (closing) {
            onCommitStreet(activeType, path, true);
            resetPath();
            return;
          }
          setPath([...path, p]);
        }}
        onPointerMove={(e) => {
          const raw: Vec2 = [e.point.x, e.point.z];
          const snappedPoint = snapStreetPoint(raw, network, 1);
          setCursor(snappedPoint);
          setSnapped(snappedPoint[0] !== raw[0] || snappedPoint[1] !== raw[1]);
        }}
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {smooth && (
        <Line
          points={smooth.map(([x, z]) => [x, 0.08, z] as [number, number, number])}
          color={color}
          lineWidth={3}
          dashed
          dashSize={0.6}
          gapSize={0.35}
        />
      )}
      {path.length >= 2 && (
        <mesh
          position={[first[0], 0.09, first[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.5, 0.7, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      )}
      {cursor && snapped && (
        <mesh
          position={[cursor[0], 0.09, cursor[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.5, 0.8, 20]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

// ── Marquee (rubber-band) multi-selection surface ───────────────────────────

const MARQUEE_COLOR = "#38bdf8"; // sky-blue rubber band
/** Sub-threshold drags (m) are treated as a click → clear the selection. */
const MARQUEE_CLICK_EPS = 0.4;
/** Padding (m) around the selection bbox that still counts as "inside" for
 * starting a move drag rather than a fresh rectangle. */
const MARQUEE_MOVE_PAD = 1.5;

interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Plan bbox of the current selection (enclosed block endpoints, selected lot
 * centers, node points). null when the marquee is empty. */
function marqueeBounds(blocks: FacadeBlock[], marquee: Marquee | null): Bounds | null {
  if (!marquee) return null;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const xs: number[] = [];
  const zs: number[] = [];
  const push = (x: number, z: number) => {
    xs.push(x);
    zs.push(z);
  };
  for (const id of marquee.blocks) {
    const b = byId.get(id);
    if (!b) continue;
    push(b.line.a[0], b.line.a[1]);
    push(b.line.b[0], b.line.b[1]);
  }
  for (const key of marquee.lots) {
    const sep = key.lastIndexOf(":");
    const b = byId.get(key.slice(0, sep));
    if (!b) continue;
    const p = lotPlacements(b)[Number(key.slice(sep + 1))];
    if (p) push(p.position[0], p.position[2]);
  }
  for (const [x, z] of marquee.nodes) push(x, z);
  if (xs.length === 0) return null;
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  };
}

/** Rubber-band surface (plan pane only). A left-drag on empty space sweeps a
 * new rectangle (pointerup → onMarquee); a drag that starts inside the current
 * selection bbox translates it live (onMarqueeMove*). A sub-threshold click
 * clears. Mirrors PenSurface's invisible catcher + NodeHandles' window-
 * pointerup drag lifecycle. */
function MarqueeSurface({
  blocks,
  active,
  marquee,
  onMarquee,
  onMarqueeClear,
  onMoveStart,
  onMove,
  onMoveEnd,
  onInteractionEnd,
}: {
  blocks: FacadeBlock[];
  active: boolean;
  marquee: Marquee | null;
  onMarquee: (a: [number, number], b: [number, number]) => void;
  onMarqueeClear: () => void;
  onMoveStart: () => void;
  onMove: (dx: number, dz: number) => void;
  onMoveEnd: (dx: number, dz: number) => void;
  onInteractionEnd: () => void;
}) {
  const [rect, setRect] = useState<{ a: [number, number]; b: [number, number] } | null>(
    null,
  );
  const modeRef = useRef<"rect" | "move" | null>(null);
  const anchorRef = useRef<[number, number] | null>(null);
  const lastRef = useRef<[number, number] | null>(null);

  const reset = useCallback(() => {
    modeRef.current = null;
    anchorRef.current = null;
    lastRef.current = null;
    setRect(null);
  }, []);

  const finalize = useCallback(() => {
    const mode = modeRef.current;
    const anchor = anchorRef.current;
    const last = lastRef.current ?? anchor;
    reset();
    // Guard on `active`: finalizeRef always holds the latest closure, so a
    // pointerup arriving after the tool was switched off cancels cleanly.
    if (!active || !mode || !anchor || !last) return;
    onInteractionEnd(); // suppress the synthesized click after this drag
    const dx = last[0] - anchor[0];
    const dz = last[1] - anchor[1];
    if (mode === "move") {
      onMoveEnd(dx, dz);
    } else if (Math.hypot(dx, dz) < MARQUEE_CLICK_EPS) {
      onMarqueeClear(); // a click clears the selection
    } else {
      onMarquee(anchor, last);
    }
  }, [active, reset, onInteractionEnd, onMoveEnd, onMarqueeClear, onMarquee]);

  // Kept fresh for the imperative window pointerup listener (deps-less effect,
  // mirroring NodeHandles' endDragRef).
  const finalizeRef = useRef(finalize);
  useEffect(() => {
    finalizeRef.current = finalize;
  });

  // Escape clears an in-progress drag + the whole selection while active.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        reset();
        onMarqueeClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, reset, onMarqueeClear]);

  // Clear the visible rectangle when the tool is switched off (render-time
  // state reset, matching PenSurface — refs are cleared by finalize, which
  // no-ops once inactive). setRect only; no ref access during render.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setRect(null);
  }

  if (!active) return null;

  const box = rect
    ? {
        x0: Math.min(rect.a[0], rect.b[0]),
        x1: Math.max(rect.a[0], rect.b[0]),
        z0: Math.min(rect.a[1], rect.b[1]),
        z1: Math.max(rect.a[1], rect.b[1]),
      }
    : null;

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const p: [number, number] = [e.point.x, e.point.z];
          anchorRef.current = p;
          lastRef.current = p;
          const bounds = marqueeBounds(blocks, marquee);
          const insideSel =
            !!marquee &&
            !marqueeEmpty(marquee) &&
            !!bounds &&
            p[0] >= bounds.x0 - MARQUEE_MOVE_PAD &&
            p[0] <= bounds.x1 + MARQUEE_MOVE_PAD &&
            p[1] >= bounds.z0 - MARQUEE_MOVE_PAD &&
            p[1] <= bounds.z1 + MARQUEE_MOVE_PAD;
          if (insideSel) {
            modeRef.current = "move";
            onMoveStart();
          } else {
            modeRef.current = "rect";
            setRect({ a: p, b: p });
          }
          window.addEventListener("pointerup", () => finalizeRef.current(), {
            once: true,
          });
        }}
        onPointerMove={(e) => {
          if (!modeRef.current || !anchorRef.current) return;
          const p: [number, number] = [e.point.x, e.point.z];
          lastRef.current = p;
          if (modeRef.current === "rect") {
            setRect({ a: anchorRef.current, b: p });
          } else {
            onMove(p[0] - anchorRef.current[0], p[1] - anchorRef.current[1]);
          }
        }}
        onPointerUp={() => finalizeRef.current()}
      >
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {box && (
        <>
          <Line
            points={[
              [box.x0, 0.08, box.z0],
              [box.x1, 0.08, box.z0],
              [box.x1, 0.08, box.z1],
              [box.x0, 0.08, box.z1],
              [box.x0, 0.08, box.z0],
            ]}
            color={MARQUEE_COLOR}
            lineWidth={1.5}
          />
          <mesh
            position={[(box.x0 + box.x1) / 2, 0.04, (box.z0 + box.z1) / 2]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry
              args={[
                Math.max(box.x1 - box.x0, 0.01),
                Math.max(box.z1 - box.z0, 0.01),
              ]}
            />
            <meshBasicMaterial
              color={MARQUEE_COLOR}
              transparent
              opacity={0.12}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </>
  );
}

/** The street centreline (dashed light) + mirror/far-frontage (dashed dim)
 * construction guides, plan pane only. */
function StreetGuides({
  streetRef,
  streetWidth,
}: {
  streetRef: StreetRef | null;
  streetWidth: number;
}) {
  const lines = useMemo(
    () => (streetRef ? streetLines(streetRef, streetWidth) : null),
    [streetRef, streetWidth],
  );
  if (!lines) return null;
  return (
    <>
      <Line
        points={[
          [lines.centre.a[0], 0.05, lines.centre.a[1]],
          [lines.centre.b[0], 0.05, lines.centre.b[1]],
        ]}
        color="#9ca3af"
        lineWidth={1.5}
        dashed
        dashSize={1.2}
        gapSize={0.8}
      />
      <Line
        points={[
          [lines.mirror.a[0], 0.05, lines.mirror.a[1]],
          [lines.mirror.b[0], 0.05, lines.mirror.b[1]],
        ]}
        color="#6b7280"
        lineWidth={1.5}
        dashed
        dashSize={0.8}
        gapSize={0.8}
      />
    </>
  );
}

/** One draggable node handle (plan pane). Flat circle just above the
 * block lines; hover/drag states use the accent blue. */
function NodeHandle({
  node,
  active,
  interactive,
  isCorner,
  onStart,
}: {
  node: WorldNode;
  active: boolean;
  interactive: boolean;
  isCorner: boolean;
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
        color={
          active
            ? "#3b82f6"
            : hover
              ? isCorner
                ? "#e8c35a"
                : "#93c5fd"
              : isCorner
                ? "#d4a017"
                : "#e5e7eb"
        }
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
  corners,
  onSelectCorner,
}: {
  blocks: FacadeBlock[];
  interactive: boolean;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  onDraggingChange: (dragging: boolean) => void;
  corners: Corner[];
  onSelectCorner: (key: string) => void;
}) {
  const nodes = useMemo(() => deriveNodes(blocks), [blocks]);
  const cornerAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of corners) m.set(`${c.node[0]}:${c.node[1]}`, c.key);
    return m;
  }, [corners]);
  const [drag, setDrag] = useState<null | {
    pos: [number, number];
    targets: [number, number][];
  }>(null);
  // The drag lifecycle is REF-driven with state mirroring it for rendering:
  // a pointerup can arrive in the same tick as the pointerdown (before React
  // commits the drag state), so endDrag must read the live drag through a
  // ref — a state closure would still be null and silently no-op, eating
  // the {once:true} listener and stranding the drag.
  const dragRef = useRef<null | {
    pos: [number, number];
    targets: [number, number][];
  }>(null);
  // Tracks whether a pointermove during the current drag actually applied a
  // move — a drag that never moved is a stationary click, which selects the
  // corner under the handle (if any) instead.
  const movedRef = useRef(false);
  // World position where the current drag started — moves under
  // DRAG_THRESHOLD from this point are jitter, not intent, and are ignored.
  const startRef = useRef<[number, number] | null>(null);
  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (d === null) return;
    const key = cornerAt.get(`${d.pos[0]}:${d.pos[1]}`);
    if (!movedRef.current && key) onSelectCorner(key);
    dragRef.current = null;
    setDrag(null);
    onDraggingChange(false);
  }, [onDraggingChange, cornerAt, onSelectCorner]);
  // Read by the imperative pointerup listener registered in onStart (below);
  // kept fresh via a deps-less effect.
  const endDragRef = useRef(endDrag);
  useEffect(() => {
    endDragRef.current = endDrag;
  });
  return (
    <>
      {nodes.map((n) => (
        <NodeHandle
          key={n.refs.map((r) => `${r.blockId}:${r.end}`).sort().join("|")}
          node={n}
          active={drag !== null && drag.pos[0] === n.pos[0] && drag.pos[1] === n.pos[1]}
          interactive={interactive && drag === null}
          isCorner={cornerAt.has(`${n.pos[0]}:${n.pos[1]}`)}
          onStart={() => {
            movedRef.current = false;
            startRef.current = n.pos;
            const attached = new Set(n.refs.map((r) => r.blockId));
            const targets = nodes
              .filter(
                (m) => m !== n && !m.refs.some((r) => attached.has(r.blockId)),
              )
              .map((m) => m.pos);
            // Ref first (synchronous), state second (render mirror).
            dragRef.current = { pos: n.pos, targets };
            setDrag(dragRef.current);
            onDraggingChange(true);
            // Registered here (not in a useEffect) so it exists before any
            // pointerup arriving in the same tick as this pointerdown —
            // an effect-based listener would miss it (React hasn't
            // committed yet). {once:true} self-cleans; endDrag is also
            // idempotent in case the catcher's own onPointerUp fires too.
            window.addEventListener(
              "pointerup",
              () => endDragRef.current(),
              { once: true },
            );
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
            if (
              !movedRef.current &&
              startRef.current &&
              Math.hypot(
                to[0] - startRef.current[0],
                to[1] - startRef.current[1],
              ) < DRAG_THRESHOLD
            ) {
              return;
            }
            if (onMoveNode(drag.pos, to)) {
              if (to[0] !== drag.pos[0] || to[1] !== drag.pos[1])
                movedRef.current = true;
              dragRef.current = dragRef.current
                ? { ...dragRef.current, pos: to }
                : dragRef.current;
              setDrag((d) => (d ? { ...d, pos: to } : d));
            }
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
  selectMode,
  streetDrawMode,
  activeStreetType,
  onCommitStreet,
  onCommitLine,
  onFlipChain,
  onMoveNode,
  corners,
  onSelectCorner,
  maxCornerAngle,
  ground,
  streetRef,
  streetWidth,
  streetNetwork,
  marquee,
  onMarquee,
  onMarqueeClear,
  onMarqueeMoveStart,
  onMarqueeMove,
  onMarqueeMoveEnd,
  selectedStreet,
  onSelectStreet,
  selectedIntersection,
  onSelectIntersection,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  size: { w: number; h: number };
  drawMode: boolean;
  selectMode: boolean;
  streetDrawMode: boolean;
  activeStreetType: StreetType;
  onCommitStreet: (type: StreetType, points: Vec2[], closed?: boolean) => void;
  onCommitLine: (
    a: [number, number],
    b: [number, number],
    flipped: boolean,
  ) => string;
  onFlipChain: (ids: string[]) => void;
  onMoveNode: (from: [number, number], to: [number, number]) => boolean;
  corners: Corner[];
  onSelectCorner: (key: string) => void;
  maxCornerAngle: number;
  ground: Ground;
  streetRef: StreetRef | null;
  streetWidth: number;
  streetNetwork: StreetNetwork;
  marquee: Marquee | null;
  onMarquee: (a: [number, number], b: [number, number]) => void;
  onMarqueeClear: () => void;
  onMarqueeMoveStart: () => void;
  onMarqueeMove: (dx: number, dz: number) => void;
  onMarqueeMoveEnd: (dx: number, dz: number) => void;
  selectedStreet: string | null;
  onSelectStreet: (id: string) => void;
  selectedIntersection: string | null;
  onSelectIntersection: (key: string) => void;
}) {
  const [nodeDrag, setNodeDrag] = useState(false);
  const dragEndAt = useRef(0);
  const handleDraggingChange = useCallback((dragging: boolean) => {
    if (!dragging) dragEndAt.current = performance.now();
    setNodeDrag(dragging);
  }, []);
  // A marquee interaction (rect sweep or move) synthesizes a click on release
  // just like a node drag; reuse the same suppression window so it can't leak
  // into a single-lot selection.
  const suppressNextSelect = useCallback(() => {
    dragEndAt.current = performance.now();
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
  // Auto-fit the plan camera ONLY when content first appears and when the
  // viewport resizes — never on later edits. Adding/deleting a building must
  // not re-zoom or recenter the view (that jump reads as confusing); after the
  // first fit the user controls the camera via MapControls. `bounds` stays
  // live for the marquee move-pad; the camera snapshots it here. `bounds` is
  // deliberately excluded from the deps so content edits don't re-snapshot.
  const hasContent = blocks.length > 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fit = useMemo(() => bounds, [hasContent, size.w, size.h]);
  const zoom = fitOrthoZoom(size.w, size.h, fit.w, fit.d);
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
    () => [fit.cx, 0, fit.cz - 2],
    [fit.cx, fit.cz],
  );
  const camPosition = useMemo<[number, number, number]>(
    () => [fit.cx, 60, fit.cz - 2],
    [fit.cx, fit.cz],
  );
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={guardedSelectLot}
        view={view}
        maxCornerAngle={maxCornerAngle}
        ground={ground}
        marquee={marquee}
        streetNetwork={streetNetwork}
        selectedStreet={selectedStreet}
        onSelectStreet={onSelectStreet}
        selectedIntersection={selectedIntersection}
        onSelectIntersection={onSelectIntersection}
      />
      <StreetGuides streetRef={streetRef} streetWidth={streetWidth} />
      <PenSurface
        blocks={blocks}
        active={drawMode}
        onCommitLine={onCommitLine}
        onFlipChain={onFlipChain}
        streetRef={streetRef}
        streetWidth={streetWidth}
      />
      <MarqueeSurface
        blocks={blocks}
        active={selectMode}
        marquee={marquee}
        onMarquee={onMarquee}
        onMarqueeClear={onMarqueeClear}
        onMoveStart={onMarqueeMoveStart}
        onMove={onMarqueeMove}
        onMoveEnd={onMarqueeMoveEnd}
        onInteractionEnd={suppressNextSelect}
      />
      <StreetDrawSurface
        active={streetDrawMode}
        activeType={activeStreetType}
        onCommitStreet={onCommitStreet}
        network={streetNetwork}
      />
      <NodeHandles
        blocks={blocks}
        interactive={!drawMode && !selectMode && !streetDrawMode}
        onMoveNode={onMoveNode}
        onDraggingChange={handleDraggingChange}
        corners={corners}
        onSelectCorner={onSelectCorner}
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
      {/* Keep the control ENABLED so wheel-zoom always works (even while
       * drawing / node-dragging / marquee-dragging); gate only PAN so a
       * left-drag can't hijack a draw click or a marquee sweep. Rotate is off
       * for the top-down plan. The pan gate mirrors the old `enabled`
       * expression, so pan-suppression timing is unchanged. */}
      <MapControls
        makeDefault
        enableRotate={false}
        enablePan={!drawMode && !nodeDrag && !selectMode && !streetDrawMode}
        target={target}
        zoomSpeed={1}
      />
    </>
  );
}

function PerspectivePane({
  blocks,
  selected,
  onSelectLot,
  view,
  maxCornerAngle,
  ground,
  marquee,
  streetNetwork,
  selectedStreet,
  onSelectStreet,
  selectedIntersection,
  onSelectIntersection,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  maxCornerAngle: number;
  ground: Ground;
  marquee: Marquee | null;
  streetNetwork: StreetNetwork;
  selectedStreet: string | null;
  onSelectStreet: (id: string) => void;
  selectedIntersection: string | null;
  onSelectIntersection: (key: string) => void;
}) {
  return (
    <>
      <SceneContents
        blocks={blocks}
        selected={selected}
        onSelectLot={onSelectLot}
        view={view}
        maxCornerAngle={maxCornerAngle}
        ground={ground}
        marquee={marquee}
        streetNetwork={streetNetwork}
        selectedStreet={selectedStreet}
        onSelectStreet={onSelectStreet}
        selectedIntersection={selectedIntersection}
        onSelectIntersection={onSelectIntersection}
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
  maxCornerAngle,
  ground,
  marquee,
  streetNetwork,
  selectedStreet,
  onSelectStreet,
  selectedIntersection,
  onSelectIntersection,
}: {
  blocks: FacadeBlock[];
  selected: Selection | null;
  onSelectLot: (blockId: string, lot: number) => void;
  view: ViewSettings;
  size: { w: number; h: number };
  mode: "overview" | "detail";
  maxCornerAngle: number;
  ground: Ground;
  marquee: Marquee | null;
  streetNetwork: StreetNetwork;
  selectedStreet: string | null;
  onSelectStreet: (id: string) => void;
  selectedIntersection: string | null;
  onSelectIntersection: (key: string) => void;
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
        maxCornerAngle={maxCornerAngle}
        ground={ground}
        marquee={marquee}
        streetNetwork={streetNetwork}
        selectedStreet={selectedStreet}
        onSelectStreet={onSelectStreet}
        selectedIntersection={selectedIntersection}
        onSelectIntersection={onSelectIntersection}
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
  onFlipChain,
  onMoveNode,
  view = FACADE_DEFAULT_VIEW,
  onDrawModeChange,
  corners,
  onSelectCorner,
  maxCornerAngle,
  ground,
  streetRef,
  streetWidth,
  marquee,
  onMarquee,
  onMarqueeClear,
  onMarqueeMoveStart,
  onMarqueeMove,
  onMarqueeMoveEnd,
  streetNetwork,
  onCommitStreet,
  selectedStreet,
  onSelectStreet,
  selectedIntersection,
  onSelectIntersection,
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
  // Tool starts idle; the effect below arms the pen only on a TRULY empty
  // world (no blocks AND no streets). A streets-only scene must stay idle so
  // its ribbons are clickable — the armed pen's full-screen click-catcher
  // would otherwise swallow every attempt to select/delete a street.
  const [drawMode, setDrawMode] = useState(false);
  // The Select tool (marquee). Mutually exclusive with draw mode; off by
  // default so every existing path is byte-identical.
  const [selectMode, setSelectMode] = useState(false);
  // The street tool (draws the standalone road network). Mutually exclusive
  // with the other two; off by default so every existing path is
  // byte-identical.
  const [streetDrawMode, setStreetDrawMode] = useState(false);
  const [activeStreetType, setActiveStreetType] = useState<StreetType>("street");
  useEffect(() => {
    onDrawModeChange?.(drawMode);
  }, [drawMode, onDrawModeChange]);
  // Arm the pen only when the world is TRULY empty — no blocks AND no streets
  // (e.g. a fresh session, or the last block deleted with no roads drawn). A
  // streets-only scene is a valid, common state (streets are the primary
  // interface), so it must NOT force the pen: the armed pen's click-catcher
  // would block selecting/deleting streets.
  useEffect(() => {
    if (blocks.length === 0 && streetNetwork.streets.length === 0) {
      setDrawMode(true);
      setSelectMode(false);
      setStreetDrawMode(false);
    }
  }, [blocks.length, streetNetwork.streets.length]);
  const toggleDraw = useCallback(() => {
    setDrawMode((d) => !d);
    setSelectMode(false);
    setStreetDrawMode(false);
  }, []);
  const toggleSelect = useCallback(() => {
    setDrawMode(false);
    setSelectMode((s) => !s);
    setStreetDrawMode(false);
  }, []);
  const toggleStreetDraw = useCallback(() => {
    setDrawMode(false);
    setSelectMode(false);
    setStreetDrawMode((s) => !s);
  }, []);
  // Tool-off clears the selection (matches Escape). Fires on mount too, where
  // the marquee is already null (no-op).
  useEffect(() => {
    if (!selectMode) onMarqueeClear();
  }, [selectMode, onMarqueeClear]);
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
            selectMode={selectMode}
            streetDrawMode={streetDrawMode}
            activeStreetType={activeStreetType}
            onCommitStreet={onCommitStreet}
            onCommitLine={onCommitLine}
            onFlipChain={onFlipChain}
            onMoveNode={onMoveNode}
            corners={corners}
            onSelectCorner={onSelectCorner}
            maxCornerAngle={maxCornerAngle}
            ground={ground}
            streetRef={streetRef}
            streetWidth={streetWidth}
            streetNetwork={streetNetwork}
            marquee={marquee}
            onMarquee={onMarquee}
            onMarqueeClear={onMarqueeClear}
            onMarqueeMoveStart={onMarqueeMoveStart}
            onMarqueeMove={onMarqueeMove}
            onMarqueeMoveEnd={onMarqueeMoveEnd}
            selectedStreet={selectedStreet}
            onSelectStreet={onSelectStreet}
            selectedIntersection={selectedIntersection}
            onSelectIntersection={onSelectIntersection}
          />
        );
      case "perspective":
        return (
          <PerspectivePane
            blocks={blocks}
            selected={selected}
            onSelectLot={onSelectLot}
            view={view}
            maxCornerAngle={maxCornerAngle}
            ground={ground}
            marquee={marquee}
            streetNetwork={streetNetwork}
            selectedStreet={selectedStreet}
            onSelectStreet={onSelectStreet}
            selectedIntersection={selectedIntersection}
            onSelectIntersection={onSelectIntersection}
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
            maxCornerAngle={maxCornerAngle}
            ground={ground}
            marquee={marquee}
            streetNetwork={streetNetwork}
            selectedStreet={selectedStreet}
            onSelectStreet={onSelectStreet}
            selectedIntersection={selectedIntersection}
            onSelectIntersection={onSelectIntersection}
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
            maxCornerAngle={maxCornerAngle}
            ground={ground}
            marquee={marquee}
            streetNetwork={streetNetwork}
            selectedStreet={selectedStreet}
            onSelectStreet={onSelectStreet}
            selectedIntersection={selectedIntersection}
            onSelectIntersection={onSelectIntersection}
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
            {p.id === "plan" && (drawMode || selectMode || streetDrawMode) && (
              /* Uniform mode frame: the plan pane is the live drawing surface
               * while the pen is armed, the marquee surface while the Select
               * tool is active (gold), or the road-network surface while the
               * street tool is active (green) — one colour per tool. */
              <div
                aria-hidden
                className={`absolute inset-0 pointer-events-none border-[3px] z-10 ${
                  drawMode
                    ? "border-[var(--accent)]"
                    : selectMode
                      ? "border-[#d4a017]"
                      : "border-[#2f855a]"
                }`}
              />
            )}
            {p.id === "plan" && (
              <div className="absolute top-1.5 left-16 z-20 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={toggleDraw}
                  aria-label={drawMode ? "Exit draw mode" : "Draw buildings"}
                  className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium shadow-lg transition-colors ${
                    drawMode
                      ? "bg-[var(--accent)] text-white hover:brightness-110"
                      : "bg-white/90 text-zinc-900 hover:bg-white"
                  }`}
                >
                  {drawMode ? "✏ Drawing — Esc to end" : "✏ Buildings"}
                </button>
                {blocks.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelect}
                    aria-label={selectMode ? "Exit select mode" : "Select tool"}
                    className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium shadow-lg transition-colors ${
                      selectMode
                        ? "bg-[#d4a017] text-white hover:brightness-110"
                        : "bg-white/90 text-zinc-900 hover:bg-white"
                    }`}
                  >
                    {selectMode ? "⬚ Selecting — Esc" : "⬚ Select"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleStreetDraw}
                  aria-label={
                    streetDrawMode ? "Exit road tool" : "Draw road network"
                  }
                  className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium shadow-lg transition-colors ${
                    streetDrawMode
                      ? "bg-[#2f855a] text-white hover:brightness-110"
                      : "bg-white/90 text-zinc-900 hover:bg-white"
                  }`}
                >
                  {streetDrawMode ? "🛣 Drawing — Esc to end" : "🛣 Roads"}
                </button>
                {streetDrawMode && (
                  <select
                    value={activeStreetType}
                    onChange={(e) =>
                      setActiveStreetType(e.target.value as StreetType)
                    }
                    aria-label="Road type"
                    className="h-7 rounded-full bg-white/90 text-zinc-900 text-[11px] font-medium px-2 shadow-lg"
                  >
                    <option value="alley">Alley</option>
                    <option value="street">Street</option>
                    <option value="road">Road</option>
                    <option value="boulevard">Boulevard</option>
                  </select>
                )}
              </div>
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
