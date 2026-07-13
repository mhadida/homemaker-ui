"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  DEFAULT_GEN,
  type BlockGenSettings,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";
import { rerollBlock, generateBlock, deleteLot } from "@/lib/facade/generate";
import { moveNode } from "@/lib/facade/nodes";
import {
  syncCorners,
  detectCorners,
  cornerChoice,
  DEFAULT_MAX_CORNER_ANGLE,
  type CornerChoice,
} from "@/lib/facade/corners";
import type { ViewSettings } from "@/lib/building/types";
import { WALL_SWATCHES } from "@/lib/building/types";
import FacadeControls from "@/components/facade/FacadeControls";
import PromptInput from "@/components/demo/PromptInput";

const FacadeViewer = dynamic(() => import("@/components/facade/FacadeViewer"), {
  ssr: false,
});

// AI spec <-> FacadeParams plumbing (mirrors the main page's BuildingSpec flow).
interface FacadeSpec {
  storeys?: number;
  width?: number;
  bays?: number;
  treatment?: "residential" | "shopfront" | "garage";
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

  const handleSelectLot = useCallback((blockId: string, lot: number) => {
    setSelected((s) =>
      s?.blockId === blockId && s.lot === lot && s.level === "lot"
        ? { blockId, lot, level: "block" } // second click promotes to block
        : { blockId, lot, level: "lot" },
    );
  }, []);

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

  // Delete/Backspace removes the selection: the selected lot (street refits,
  // length preserved) or the whole block at block level / last lot. Direct —
  // no two-step confirm for keyboard deletion. Skipped while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.repeat) return; // OS key-repeat must not cascade-delete lots
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
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
  ]);

  const handleSelectionLevel = useCallback(
    (level: "lot" | "block") =>
      setSelected((s) => (s ? { blockId: s.blockId, lot: s.lot, level } : s)),
    [],
  );

  const handleCommitLine = useCallback(
    (a: [number, number], b: [number, number]) => {
      const seed = Math.floor(Math.random() * 1e9);
      const line = { a, b };
      const gen = structuredClone(DEFAULT_GEN);
      const newBlock: FacadeBlock = {
        id: nextBlockId(),
        line,
        flipped: false,
        gen,
        seed,
        lots: generateBlock(line, false, gen, seed),
      };
      setBlocks((bs) =>
        syncCorners([...bs, newBlock], cornerChoices, maxCornerAngle),
      );
      setSelected({ blockId: newBlock.id, lot: 0, level: "block" });
    },
    [cornerChoices, maxCornerAngle],
  );

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
            onMoveNode={handleMoveNode}
            view={view}
            onDrawModeChange={setDrawActive}
            corners={corners}
            onSelectCorner={handleSelectCorner}
            maxCornerAngle={maxCornerAngle}
          />
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            {selected && selectedBlock && params ? (
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
