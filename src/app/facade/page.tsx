"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { FacadeParams } from "@/lib/facade/types";
import {
  DEFAULT_FACADE,
  FACADE_DEFAULT_VIEW,
  DOOR_SWATCHES,
  FACADE_PRESETS,
} from "@/lib/facade/types";
import { computeLayout, resolveSections } from "@/lib/facade/layout";
import {
  withSectionCount,
  applySectionPattern,
  classifySectionPattern,
  type SectionPattern,
} from "@/lib/facade/sections";
import {
  parseFacadePromptLocal,
  mergeFacadeParams,
} from "@/lib/facade/prompt-parser";
import {
  syncLineToLots,
  nextBlockId,
  reserveBlockIds,
  DEFAULT_GEN,
  type BlockGenSettings,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";
import {
  toJSON,
  fromJSON,
  type SceneState,
} from "@/lib/facade/document";
import { rerollBlock, generateBlock, deleteLot } from "@/lib/facade/generate";
import { moveNode, deriveNodes } from "@/lib/facade/nodes";
import { DEFAULT_GROUND, type Ground } from "@/lib/facade/terrain";
import { streetRefOf, STREET_WIDTH_DEFAULT } from "@/lib/facade/street";
import {
  EMPTY_NETWORK,
  nextStreetId,
  reserveStreetIds,
  type StreetNetwork,
  type StreetType,
  type Vec2,
} from "@/lib/street/types";
import {
  syncCorners,
  detectCorners,
  cornerChoice,
  DEFAULT_MAX_CORNER_ANGLE,
  type CornerChoice,
  type Corner,
} from "@/lib/facade/corners";
import {
  hitTest,
  normalizeRect,
  marqueeEmpty,
  affectedBlockIds,
  deleteMarquee,
  translateMarquee,
  type Marquee,
} from "@/lib/facade/marquee";
import type { ViewSettings } from "@/lib/building/types";
import { WALL_SWATCHES } from "@/lib/building/types";
import FacadeControls, {
  MarqueeControls,
} from "@/components/facade/FacadeControls";
import PromptInput from "@/components/demo/PromptInput";

const FacadeViewer = dynamic(() => import("@/components/facade/FacadeViewer"), {
  ssr: false,
});

/** localStorage key for the silent autosave (crash/refresh insurance; the
 * explicit file Save/Load is the portable, shareable mechanism). */
const AUTOSAVE_KEY = "facademaker:autosave";

// AI spec <-> FacadeParams plumbing (mirrors the main page's BuildingSpec flow).
interface FacadeSpec {
  storeys?: number;
  width?: number;
  bays?: number;
  treatment?: "residential" | "shopfront" | "garage" | "passage";
  doorBay?: number; // 1-based over the wire
  stoop?: boolean;
  cornice?: boolean;
  parapet?: boolean;
  sills?: boolean;
  surrounds?: boolean;
  windowSize?: "small" | "medium" | "large";
  windowStyle?: "georgian" | "sash" | "victorian" | "none";
  sections?: number;
  sectionPattern?: SectionPattern;
  wallColor?: string;
  trimColor?: string;
  doorColor?: string;
  preset?: "none" | "georgian" | "victorian-shopfront" | "modern";
}

const WINDOW_SIZE_RATIOS = {
  small: { windowWidthRatio: 0.35, windowHeightRatio: 0.45 },
  medium: { windowWidthRatio: 0.45, windowHeightRatio: 0.55 },
  large: { windowWidthRatio: 0.6, windowHeightRatio: 0.7 },
} as const;

const WALL_HEX = Object.fromEntries(WALL_SWATCHES.map((s) => [s.id, s.hex]));
const DOOR_HEX = Object.fromEntries(DOOR_SWATCHES.map((s) => [s.id, s.hex]));

function specToFacadeParams(spec: FacadeSpec, prev: FacadeParams): FacadeParams {
  let next = { ...prev };
  if (spec.preset && spec.preset !== "none" && spec.preset !== prev.preset) {
    // A newly-named preset applies its bundle first; the remaining spec
    // fields then refine on top (mirrors the local parser's order).
    next = {
      ...DEFAULT_FACADE,
      ...FACADE_PRESETS[spec.preset].params,
      cellOverrides: [],
      preset: spec.preset,
    };
  }
  if (spec.storeys) next = mergeFacadeParams(next, { storeys: spec.storeys });
  if (spec.width) next.width = spec.width;
  if (spec.bays) next.bays = spec.bays;
  if (spec.treatment || spec.doorBay || spec.stoop !== undefined) {
    next.groundFloor = {
      treatment: spec.treatment ?? next.groundFloor.treatment,
      doorBay:
        spec.doorBay !== undefined
          ? Math.max(0, Math.min(next.bays - 1, spec.doorBay - 1))
          : next.groundFloor.doorBay,
      stoop: spec.stoop ?? next.groundFloor.stoop,
    };
  }
  next.ornament = {
    cornice: spec.cornice ?? next.ornament.cornice,
    parapet: spec.parapet ?? next.ornament.parapet,
    sills: spec.sills ?? next.ornament.sills,
    surrounds: spec.surrounds ?? next.ornament.surrounds,
  };
  // Sections: the count applies only when it differs; a NAMED pattern
  // applies when it differs or the count changed. "custom" is the echo
  // value and never touches the user's sculpted offsets. Runs after
  // spec.bays so partitions fit the new bay count.
  const curCount = resolveSections(next).length;
  const curPattern = classifySectionPattern(next);
  const wantCount = spec.sections ?? curCount;
  const wantPattern = spec.sectionPattern ?? "custom";
  if (
    wantPattern !== "custom" &&
    (wantPattern !== curPattern || wantCount !== curCount)
  ) {
    next = applySectionPattern(next, wantCount, wantPattern);
  } else if (wantCount !== curCount) {
    next = withSectionCount(next, wantCount);
  }
  // Only apply when the AI actually changed the bucket — an echo of the
  // current bucket must not snap fine-tuned slider ratios to bucket values.
  if (spec.windowSize && spec.windowSize !== nearestWindowSize(prev))
    Object.assign(next, WINDOW_SIZE_RATIOS[spec.windowSize]);
  if (spec.windowStyle) next.windowStyle = spec.windowStyle;
  if (spec.wallColor && WALL_HEX[spec.wallColor])
    next.wallColor = WALL_HEX[spec.wallColor];
  if (spec.trimColor && WALL_HEX[spec.trimColor])
    next.trimColor = WALL_HEX[spec.trimColor];
  if (spec.doorColor && DOOR_HEX[spec.doorColor])
    next.doorColor = DOOR_HEX[spec.doorColor];
  return next;
}

function nearestWindowSize(p: FacadeParams): "small" | "medium" | "large" {
  const entries = Object.entries(WINDOW_SIZE_RATIOS) as [
    "small" | "medium" | "large",
    { windowWidthRatio: number; windowHeightRatio: number },
  ][];
  let best: "small" | "medium" | "large" = "medium";
  let bestDist = Infinity;
  for (const [id, r] of entries) {
    const d =
      Math.abs(r.windowWidthRatio - p.windowWidthRatio) +
      Math.abs(r.windowHeightRatio - p.windowHeightRatio);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

function paramsToFacadeSpec(p: FacadeParams): FacadeSpec {
  const wallId = WALL_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.wallColor.toLowerCase(),
  )?.id;
  const trimId = WALL_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.trimColor.toLowerCase(),
  )?.id;
  const doorId = DOOR_SWATCHES.find(
    (s) => s.hex.toLowerCase() === p.doorColor.toLowerCase(),
  )?.id;
  return {
    storeys: p.storeys,
    width: p.width,
    bays: p.bays,
    treatment: p.groundFloor.treatment,
    doorBay: Math.min(p.groundFloor.doorBay, p.bays - 1) + 1,
    stoop: p.groundFloor.stoop,
    cornice: p.ornament.cornice,
    parapet: p.ornament.parapet,
    sills: p.ornament.sills,
    surrounds: p.ornament.surrounds,
    windowSize: nearestWindowSize(p),
    windowStyle: p.windowStyle,
    sections: resolveSections(p).length,
    sectionPattern: classifySectionPattern(p),
    wallColor: wallId,
    trimColor: trimId,
    doorColor: doorId,
    preset: p.preset ?? "none",
  };
}

const FACADE_SUGGESTIONS = [
  "3-storey georgian with a stoop",
  "victorian shopfront, 4 bays",
  "modern, 2 bays, parapet",
  "garage door, 2 storeys",
  "3 sections, projecting centre",
];

export default function FacadePage() {
  // Everything is live — no draft/committed split. Client-side geometry
  // rebuilds are trivially fast, so every slider tick renders immediately.
  // The scene starts BLANK: no buildings until the user draws a street with
  // the pen tool (auto-armed in FacadeViewer when blocks is empty).
  const [blocks, setBlocks] = useState<FacadeBlock[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [view, setView] = useState<ViewSettings>(FACADE_DEFAULT_VIEW);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [drawActive, setDrawActive] = useState(false);
  const [cornerChoices, setCornerChoices] = useState<Map<string, CornerChoice>>(
    () => new Map(),
  );
  const [maxCornerAngle, setMaxCornerAngle] = useState(DEFAULT_MAX_CORNER_ANGLE);
  const [ground, setGround] = useState<Ground>(DEFAULT_GROUND);
  const [streetWidth, setStreetWidth] = useState(STREET_WIDTH_DEFAULT);
  // The standalone road network (independent of blocks/lots). Empty by
  // default so every existing path is byte-identical.
  const [streetNetwork, setStreetNetwork] =
    useState<StreetNetwork>(EMPTY_NETWORK);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Marquee (rubber-band) multi-selection. Coexists with single `selected`:
  // a plain click sets `selected` + clears this; a marquee sets this + clears
  // `selected`. null (the default, Select tool off) → every existing path is
  // byte-identical.
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  // Snapshot of blocks+marquee at the start of a live move drag, so each frame
  // translates the ORIGINAL by the cumulative delta (no double-application).
  const moveDragRef = useRef<{ blocks: FacadeBlock[]; marquee: Marquee } | null>(
    null,
  );

  // The street is derived from the first (earliest surviving) block: its
  // facade normal defines which side the street is on. null in the blank
  // world, so the first block is oriented by the pen's f-toggle alone.
  const streetRef = useMemo(
    () => (blocks[0] ? streetRefOf(blocks[0]) : null),
    [blocks],
  );

  // ── Save / Load ────────────────────────────────────────────────────────
  /** Replace the whole scene from a loaded document. Re-syncs corners
   * defensively (idempotent for clean saves; repairs hand-edited files) and
   * bumps the block-id counter so newly-drawn blocks can't collide. */
  const applyScene = useCallback((s: SceneState) => {
    reserveBlockIds(s.blocks);
    reserveStreetIds(s.streetNetwork.streets);
    setBlocks(syncCorners(s.blocks, s.cornerChoices, s.maxCornerAngle));
    setCornerChoices(s.cornerChoices);
    setGround(s.ground);
    setStreetWidth(s.streetWidth);
    setMaxCornerAngle(s.maxCornerAngle);
    setStreetNetwork(s.streetNetwork);
    setSelected(
      s.blocks.length > 0
        ? { blockId: s.blocks[0].id, lot: 0, level: "block" }
        : null,
    );
  }, []);

  const handleSave = useCallback(() => {
    const text = toJSON({
      blocks,
      cornerChoices,
      ground,
      streetWidth,
      maxCornerAngle,
      streetNetwork,
    });
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "facade-scene.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer the revoke so the download has surely started (revoking on the
    // same tick is the fragile variant).
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [blocks, cornerChoices, ground, streetWidth, maxCornerAngle, streetNetwork]);

  const handleLoadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // let the same file be re-selected later
      if (!file) return;
      const res = fromJSON(await file.text());
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
      applyScene(res.scene);
    },
    [applyScene],
  );

  // Restore the autosave once on mount (survives refresh/crash). Guarded so
  // Strict Mode's double-invoke can't apply it twice.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return;
    const res = fromJSON(saved);
    if (res.ok && (res.scene.blocks.length > 0 || res.scene.streetNetwork.streets.length > 0)) applyScene(res.scene);
    else window.localStorage.removeItem(AUTOSAVE_KEY);
  }, [applyScene]);

  // Debounced autosave — one write 500 ms after the last change, so live
  // node drags don't hammer localStorage every frame. Emptying a scene
  // clears the key so a refresh doesn't resurrect deleted buildings — but
  // ONLY after the scene has actually held content (blocks or streets) this session, so the
  // mount-time empty pass can't wipe a good save before restore lands.
  const everHadContentRef = useRef(false);
  useEffect(() => {
    if (blocks.length === 0 && streetNetwork.streets.length === 0) {
      if (everHadContentRef.current) window.localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }
    everHadContentRef.current = true;
    const id = window.setTimeout(() => {
      window.localStorage.setItem(
        AUTOSAVE_KEY,
        toJSON({
          blocks,
          cornerChoices,
          ground,
          streetWidth,
          maxCornerAngle,
          streetNetwork,
        }),
      );
    }, 500);
    return () => window.clearTimeout(id);
  }, [blocks, cornerChoices, ground, streetWidth, maxCornerAngle, streetNetwork]);

  const selectedBlock = selected
    ? (blocks.find((b) => b.id === selected.blockId) ?? null)
    : null;
  const selectedLot = selectedBlock
    ? selectedBlock.lots[Math.min(selected!.lot, selectedBlock.lots.length - 1)]
    : null;
  const params = selectedLot ? selectedLot.params : null;

  // Every existing consumer (controls, prompt, AI, header) edits the
  // SELECTED lot; hand edits pin it against reroll and keep the block
  // line in sync with the new widths.
  const setParams = useCallback(
    (next: FacadeParams | ((prev: FacadeParams) => FacadeParams)) => {
      if (!selected) return;
      setBlocks((bs) => {
        const b = bs.find((x) => x.id === selected.blockId);
        if (!b) return bs;
        const lotIndex = Math.min(selected.lot, b.lots.length - 1);
        const prev = b.lots[lotIndex].params;
        const value = typeof next === "function" ? next(prev) : next;
        const lots = b.lots.map((l, i) =>
          i === lotIndex ? { ...l, params: value, customized: true } : l,
        );
        const updated = syncLineToLots({ ...b, lots });
        const replaced = bs.map((x) => (x.id === b.id ? updated : x));
        const endKey = b.flipped ? ("a" as const) : ("b" as const);
        const oldEnd = b.line[endKey];
        const newEnd = updated.line[endKey];
        if (oldEnd[0] === newEnd[0] && oldEnd[1] === newEnd[1])
          return syncCorners(
            replaced,
            cornerChoices,
            maxCornerAngle,
            selected.blockId,
          );
        const welded = bs.some(
          (x) =>
            x.id !== b.id &&
            ((x.line.a[0] === oldEnd[0] && x.line.a[1] === oldEnd[1]) ||
              (x.line.b[0] === oldEnd[0] && x.line.b[1] === oldEnd[1])),
        );
        if (!welded)
          return syncCorners(
            replaced,
            cornerChoices,
            maxCornerAngle,
            selected.blockId,
          );
        // The computed end is a node move: welded neighbors re-fit exactly
        // as if the shared node were dragged. If any cannot absorb, the
        // whole edit is rejected (the slider clamps). moveNode is pure, so
        // it is Strict Mode-safe inside this updater.
        const moved = moveNode(replaced, oldEnd, newEnd);
        return moved
          ? syncCorners(moved, cornerChoices, maxCornerAngle, selected.blockId)
          : bs;
      });
    },
    [selected, cornerChoices, maxCornerAngle],
  );

  // Latest detected corners, read by handleSelectLot without re-creating it.
  const cornersRef = useRef<Corner[]>([]);
  const handleSelectLot = useCallback(
    (blockId: string, lot: number) => {
      // A single-lot selection supersedes any live marquee (symmetric to
      // handleMarquee clearing `selected`), so clicking a building in any pane
      // can't leave a hidden marquee underneath the single selection.
      setMarquee(null);
      // A single-lot chamfer block can bridge two corners (both ends of its
      // one lot). One facade mesh can't disambiguate which the user meant, so
      // we take the first — the plan-pane node handles reach either corner
      // precisely (onSelectCorner).
      const corner = cornersRef.current.find(
        (c) =>
          (c.a.blockId === blockId && c.a.lotIndex === lot) ||
          (c.b.blockId === blockId && c.b.lotIndex === lot),
      );
      setSelected((s) => {
        if (corner) {
          // Clicking a corner building selects the whole corner (both
          // facades); a repeat click drills into just this wing.
          if (s?.level === "corner" && s.cornerKey === corner.key) {
            return { blockId, lot, level: "lot" };
          }
          return {
            blockId: corner.a.blockId,
            lot: corner.a.lotIndex,
            level: "corner",
            cornerKey: corner.key,
          };
        }
        return s?.blockId === blockId && s.lot === lot && s.level === "lot"
          ? { blockId, lot, level: "block" } // second click promotes to block
          : { blockId, lot, level: "lot" };
      });
    },
    [],
  );

  const updateSelectedBlock = useCallback(
    (fn: (b: FacadeBlock) => FacadeBlock) => {
      if (!selected) return;
      setBlocks((bs) =>
        syncCorners(
          bs.map((b) => (b.id === selected.blockId ? fn(b) : b)),
          cornerChoices,
          maxCornerAngle,
          selected.blockId,
        ),
      );
    },
    [selected, cornerChoices, maxCornerAngle],
  );

  const handleGenChange = useCallback(
    (gen: BlockGenSettings) => updateSelectedBlock((b) => ({ ...b, gen })),
    [updateSelectedBlock],
  );

  const handleReroll = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => rerollBlock(b, seed));
  }, [updateSelectedBlock]);

  const handleFlip = useCallback(
    () => updateSelectedBlock((b) => ({ ...b, flipped: !b.flipped })),
    [updateSelectedBlock],
  );

  const handleDeleteBlock = useCallback(() => {
    if (!selected) return;
    // The world may become empty — no fallback block is respawned.
    const rest = blocks.filter((b) => b.id !== selected.blockId);
    setBlocks(syncCorners(rest, cornerChoices, maxCornerAngle));
    setSelected(
      rest.length > 0 ? { blockId: rest[0].id, lot: 0, level: "lot" } : null,
    );
  }, [blocks, selected, cornerChoices, maxCornerAngle]);

  // ── Marquee (rubber-band) multi-selection ────────────────────────────────
  const handleMarquee = useCallback(
    (a: [number, number], b: [number, number]) => {
      const m = hitTest(blocks, normalizeRect(a, b));
      if (marqueeEmpty(m)) {
        setMarquee(null);
        return;
      }
      setMarquee(m);
      setSelected(null); // a marquee supersedes the single selection
    },
    [blocks],
  );

  const handleMarqueeClear = useCallback(() => setMarquee(null), []);

  const handleMarqueeDelete = useCallback(() => {
    if (!marquee) return;
    const next = syncCorners(
      deleteMarquee(blocks, marquee),
      cornerChoices,
      maxCornerAngle,
    );
    setBlocks(next);
    setMarquee(null);
    // Reselect a surviving block so the panel doesn't fall through to the
    // blank-canvas copy while buildings still exist (matches handleDeleteBlock).
    setSelected(
      next.length > 0
        ? { blockId: next[0].id, lot: 0, level: "block" }
        : null,
    );
  }, [blocks, marquee, cornerChoices, maxCornerAngle]);

  const handleMarqueeReroll = useCallback(() => {
    if (!marquee) return;
    const ids = affectedBlockIds(marquee, blocks);
    setBlocks(
      syncCorners(
        blocks.map((b) =>
          ids.has(b.id) ? rerollBlock(b, Math.floor(Math.random() * 1e9)) : b,
        ),
        cornerChoices,
        maxCornerAngle,
      ),
    );
  }, [blocks, marquee, cornerChoices, maxCornerAngle]);

  // Bulk restyle: apply `fn` to every selected lot (enclosed block → all lots;
  // partial block → its selected lots), pin them, then sync line + corners.
  const handleMarqueeApply = useCallback(
    (fn: (p: FacadeParams) => FacadeParams) => {
      if (!marquee) return;
      const enclosed = new Set(marquee.blocks);
      const lotSel = new Map<string, Set<number>>();
      for (const key of marquee.lots) {
        const sep = key.lastIndexOf(":");
        const id = key.slice(0, sep);
        const idx = Number(key.slice(sep + 1));
        const s = lotSel.get(id) ?? new Set<number>();
        s.add(idx);
        lotSel.set(id, s);
      }
      setBlocks((bs) =>
        syncCorners(
          bs.map((b) => {
            const all = enclosed.has(b.id);
            const partial = lotSel.get(b.id);
            if (!all && !partial) return b;
            const lots = b.lots.map((l, i) =>
              all || partial?.has(i)
                ? { ...l, params: fn(l.params), customized: true }
                : l,
            );
            return syncLineToLots({ ...b, lots });
          }),
          cornerChoices,
          maxCornerAngle,
        ),
      );
    },
    [marquee, cornerChoices, maxCornerAngle],
  );

  const handleMarqueeMoveStart = useCallback(() => {
    if (!marquee) return;
    moveDragRef.current = { blocks, marquee };
  }, [blocks, marquee]);

  const handleMarqueeMove = useCallback(
    (dx: number, dz: number) => {
      const snap = moveDragRef.current;
      if (!snap) return;
      setBlocks(
        syncCorners(
          translateMarquee(snap.blocks, snap.marquee, dx, dz),
          cornerChoices,
          maxCornerAngle,
        ),
      );
    },
    [cornerChoices, maxCornerAngle],
  );

  const handleMarqueeMoveEnd = useCallback(
    (dx: number, dz: number) => {
      const snap = moveDragRef.current;
      moveDragRef.current = null;
      if (!snap) return;
      const next = syncCorners(
        translateMarquee(snap.blocks, snap.marquee, dx, dz),
        cornerChoices,
        maxCornerAngle,
      );
      setBlocks(next);
      // Rebuild the marquee's loose-node positions from the ACTUAL moved
      // geometry: a node whose move was rejected (its block couldn't absorb)
      // stays at its origin, and one that no longer exists is dropped — so no
      // gold ring is stranded at a phantom coordinate. Enclosed-block ids are
      // unchanged by a rigid move, so only nodes need reconciling.
      if (dx !== 0 || dz !== 0) {
        const present = new Set(
          deriveNodes(next).map((n) => `${n.pos[0]}:${n.pos[1]}`),
        );
        setMarquee((m) => {
          if (!m) return m;
          const nodes = m.nodes
            .map(([x, z]): [number, number] =>
              present.has(`${x + dx}:${z + dz}`) ? [x + dx, z + dz] : [x, z],
            )
            .filter(([x, z]) => present.has(`${x}:${z}`));
          return { ...m, nodes };
        });
      }
    },
    [cornerChoices, maxCornerAngle],
  );

  // Delete/Backspace removes the selection: the selected lot (street refits,
  // length preserved) or the whole block at block level / last lot. Direct —
  // no two-step confirm for keyboard deletion. Skipped while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const typing =
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      // Cmd/Ctrl+A → select every block as one whole-block marquee. Skipped
      // while typing (let the field's own select-all work) or mid-sketch.
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        if (typing || drawActive || blocks.length === 0) return;
        e.preventDefault();
        setSelected(null);
        setMarquee({ blocks: blocks.map((b) => b.id), lots: [], nodes: [] });
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.repeat) return; // OS key-repeat must not cascade-delete lots
      if (typing) return;
      // A live marquee takes precedence: Delete removes the whole selection.
      if (marquee) {
        e.preventDefault();
        handleMarqueeDelete();
        return;
      }
      // Backspace muscle-memory from pen tools must not nuke the selection
      // while the user is mid-sketch on a street.
      if (drawActive) return;
      if (!selected) return;
      const block = blocks.find((b) => b.id === selected.blockId);
      if (!block) return;
      e.preventDefault(); // Backspace can navigate back in some browsers
      if (selected.level === "lot" && block.lots.length > 1) {
        const lotIndex = Math.min(selected.lot, block.lots.length - 1);
        const next = deleteLot(block, lotIndex);
        if (!next) return; // nothing can absorb — deletion rejected
        setBlocks((bs) =>
          syncCorners(
            bs.map((b) => (b.id === block.id ? next : b)),
            cornerChoices,
            maxCornerAngle,
            block.id,
          ),
        );
        setSelected((s) =>
          s ? { ...s, lot: Math.min(lotIndex, next.lots.length - 1) } : s,
        );
        return;
      }
      // Block level, or the block's last lot: delete the whole block. Reuses
      // handleDeleteBlock rather than re-implementing block deletion here.
      handleDeleteBlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    blocks,
    selected,
    drawActive,
    handleDeleteBlock,
    cornerChoices,
    maxCornerAngle,
    marquee,
    handleMarqueeDelete,
  ]);

  const handleSelectionLevel = useCallback(
    (level: "lot" | "block") =>
      setSelected((s) => (s ? { blockId: s.blockId, lot: s.lot, level } : s)),
    [],
  );

  const handleCommitLine = useCallback(
    (a: [number, number], b: [number, number], flipped: boolean): string => {
      const seed = Math.floor(Math.random() * 1e9);
      const line = { a, b };
      const gen = structuredClone(DEFAULT_GEN);
      // The pen resolves the facing (chain-consistent, street-aware ⊕ f); we
      // just build the block with it and return its id so the pen can track
      // and later flip the whole chain.
      const id = nextBlockId();
      const newBlock: FacadeBlock = {
        id,
        line,
        flipped,
        gen,
        seed,
        lots: generateBlock(line, flipped, gen, seed),
      };
      setBlocks((bs) =>
        syncCorners([...bs, newBlock], cornerChoices, maxCornerAngle),
      );
      setSelected({ blockId: id, lot: 0, level: "block" });
      return id;
    },
    [cornerChoices, maxCornerAngle],
  );

  // f while drawing flips the entire chain being drawn (every committed
  // segment), so a block's facade side stays consistent however late f is
  // pressed. Same operation as the "Flip side" button, applied to a set.
  const handleFlipChain = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setBlocks((bs) =>
        syncCorners(
          bs.map((b) =>
            idSet.has(b.id) ? { ...b, flipped: !b.flipped } : b,
          ),
          cornerChoices,
          maxCornerAngle,
        ),
      );
    },
    [cornerChoices, maxCornerAngle],
  );

  /** Commit one finished street polyline drawn with the street tool. Streets
   * are independent of blocks — just appended to the network. */
  const handleCommitStreet = useCallback((type: StreetType, points: Vec2[]) => {
    setStreetNetwork((n) => ({
      ...n,
      streets: [...n.streets, { id: nextStreetId(), type, points }],
    }));
  }, []);

  const handleMoveNode = useCallback(
    (from: [number, number], to: [number, number]) => {
      // Computed OUTSIDE the updater so the boolean result is available
      // synchronously; moveNode is pure. A stale-closure frame (blocks not
      // yet re-rendered) returns null and is simply skipped — the drag
      // recovers on the next frame.
      const next = moveNode(blocks, from, to);
      if (next && next !== blocks)
        setBlocks(syncCorners(next, cornerChoices, maxCornerAngle));
      return next !== null;
    },
    [blocks, cornerChoices, maxCornerAngle],
  );

  // Re-sync whenever the choice map or the angle threshold changes (e.g. the
  // corner-choice inspector flips a mode, or the angle dial re-qualifies a
  // junction as a corner). syncCorners returns input identity when nothing
  // changed, so this cannot loop.
  useEffect(() => {
    setBlocks((bs) => syncCorners(bs, cornerChoices, maxCornerAngle));
  }, [maxCornerAngle, cornerChoices]);

  const corners = useMemo(
    () => detectCorners(blocks, maxCornerAngle),
    [blocks, maxCornerAngle],
  );
  cornersRef.current = corners;

  const handleSelectCorner = useCallback(
    (cornerKey: string) => {
      const c = corners.find((x) => x.key === cornerKey);
      if (!c) return;
      setSelected({
        blockId: c.a.blockId,
        lot: c.a.lotIndex,
        level: "corner",
        cornerKey,
      });
    },
    [corners],
  );

  const handleCornerChoice = useCallback(
    (key: string, choice: CornerChoice) => {
      // Build the merged map once and reuse it for both the state update
      // and the immediate sync below — reading `cornerChoices` twice (once
      // per `new Map(cornerChoices)`) would let two synchronous calls in
      // the same tick each start from the same stale closure and clobber
      // each other's choice.
      const merged = new Map(cornerChoices);
      merged.set(key, choice);
      setCornerChoices(merged);
      // Apply the new choice immediately (e.g. switching primary re-sources
      // the shell; switching to unified mirrors the face now).
      setBlocks((bs) => syncCorners(bs, merged, maxCornerAngle));
    },
    [cornerChoices, maxCornerAngle],
  );

  // The corner inspector's data: null whenever the selection isn't a
  // corner, OR the corner it names has since dissolved (a flip/drag can
  // drop the junction below maxCornerAngle or unweld it) — FacadeControls
  // falls back to the plain lot view in that case.
  const selectedCorner = useMemo(() => {
    if (selected?.level !== "corner" || !selected.cornerKey) return null;
    const data = corners.find((c) => c.key === selected.cornerKey);
    if (!data) return null;
    const blockA = blocks.find((b) => b.id === data.a.blockId);
    const blockB = blocks.find((b) => b.id === data.b.blockId);
    const widthA = blockA?.lots[data.a.lotIndex]?.params.width ?? 0;
    const widthB = blockB?.lots[data.b.lotIndex]?.params.width ?? 0;
    return {
      data,
      choice: cornerChoice(cornerChoices, data, blocks),
      widthA,
      widthB,
    };
  }, [selected, corners, cornerChoices, blocks]);

  const layout = useMemo(
    () => (params ? computeLayout(params) : null),
    [params],
  );

  const handlePrompt = useCallback(
    async (prompt: string) => {
      // No lot selected (blank canvas) — nothing for a prompt to edit.
      if (!params) return;
      // Instant local parse, then the AI refines on top of that same state
      // (not the pre-parse closure value — otherwise the AI's echoed
      // "current" reverts the just-applied local parse when it responds).
      const next = mergeFacadeParams(params, parseFacadePromptLocal(prompt));
      setParams(next);

      setIsAILoading(true);
      setAiStatus(null);
      try {
        const res = await fetch("/api/facade-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, current: paramsToFacadeSpec(next) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const { spec } = (await res.json()) as { spec: FacadeSpec };
        setParams((prev) => specToFacadeParams(spec, prev));
        setAiStatus("AI applied");
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const clean = raw.replace(/\[[0-9;]*m/g, "").trim();
        const friendly = /Unauthenticated/i.test(clean)
          ? "AI unavailable: set AI_GATEWAY_API_KEY in Vercel env (local parse applied)"
          : `AI unavailable: ${clean.slice(0, 80)} (local parse applied)`;
        setAiStatus(friendly);
      } finally {
        setIsAILoading(false);
      }
    },
    [params, setParams],
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] bg-[var(--panel-bg)] shrink-0">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="4" y="3" width="16" height="18" />
            <line x1="4" y1="9" x2="20" y2="9" />
            <line x1="4" y1="15" x2="20" y2="15" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">Facademaker</span>
          <Link
            href="/"
            className="text-[11px] text-[var(--muted)] ml-1 hover:text-[var(--foreground)] transition-colors"
          >
            ← building editor
          </Link>
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <button
            type="button"
            onClick={handleSave}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
          >
            Load
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleLoadFile}
          />
          {loadError && (
            <span className="text-[11px] text-red-400" role="alert">
              {loadError}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono">
          {params && layout ? (
            <>
              <span>{params.storeys}F</span>
              <span>·</span>
              <span>{params.bays} bays</span>
              <span>·</span>
              <span>{params.width.toFixed(1)}m</span>
              <span>·</span>
              <span>{layout.totalHeight.toFixed(1)}m ↑</span>
            </>
          ) : (
            <span>draw a street to begin</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-[40vh] md:min-h-0 relative">
          <FacadeViewer
            blocks={blocks}
            selected={selected}
            onSelectLot={handleSelectLot}
            onCommitLine={handleCommitLine}
            onFlipChain={handleFlipChain}
            onMoveNode={handleMoveNode}
            view={view}
            onDrawModeChange={setDrawActive}
            corners={corners}
            onSelectCorner={handleSelectCorner}
            maxCornerAngle={maxCornerAngle}
            ground={ground}
            streetRef={streetRef}
            streetWidth={streetWidth}
            marquee={marquee}
            onMarquee={handleMarquee}
            onMarqueeClear={handleMarqueeClear}
            onMarqueeMoveStart={handleMarqueeMoveStart}
            onMarqueeMove={handleMarqueeMove}
            onMarqueeMoveEnd={handleMarqueeMoveEnd}
            streetNetwork={streetNetwork}
            onCommitStreet={handleCommitStreet}
          />
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            {marquee ? (
              <MarqueeControls
                marquee={marquee}
                onDelete={handleMarqueeDelete}
                onReroll={handleMarqueeReroll}
                onApply={handleMarqueeApply}
                onClear={handleMarqueeClear}
              />
            ) : selected && selectedBlock && params ? (
              <>
                <div>
                  <PromptInput
                    onApply={handlePrompt}
                    isLoading={isAILoading}
                    variant="inline"
                    placeholder="Describe your facade…"
                    suggestions={FACADE_SUGGESTIONS}
                  />
                  {aiStatus && (
                    <div className="mt-1 text-[10px] text-[var(--muted)]">
                      {aiStatus}
                    </div>
                  )}
                </div>
                <FacadeControls
                  params={params}
                  onChange={setParams}
                  view={view}
                  onViewChange={setView}
                  selection={selected}
                  block={selectedBlock}
                  onSelectionLevel={handleSelectionLevel}
                  onGenChange={handleGenChange}
                  onReroll={handleReroll}
                  onFlip={handleFlip}
                  onDeleteBlock={handleDeleteBlock}
                  corner={selectedCorner}
                  onCornerChoice={handleCornerChoice}
                  maxCornerAngle={maxCornerAngle}
                  onMaxCornerAngle={setMaxCornerAngle}
                  ground={ground}
                  onGroundChange={setGround}
                  streetWidth={streetWidth}
                  onStreetWidth={setStreetWidth}
                />
              </>
            ) : (
              <div className="text-sm text-[var(--muted)] leading-relaxed space-y-2 p-1">
                <div className="font-medium text-[var(--foreground)]">
                  Blank canvas
                </div>
                <p>
                  Sketch your first street: the pen tool in the Plan pane is
                  armed — click to place nodes, Escape to finish, click the
                  first node to close a loop.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
