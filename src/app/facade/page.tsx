"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import {
  DEFAULT_FACADE,
  DEFAULT_LOT_CONTEXT,
  FACADE_DEFAULT_VIEW,
  DOOR_SWATCHES,
} from "@/lib/facade/types";
import { computeLayout } from "@/lib/facade/layout";
import {
  parseFacadePromptLocal,
  mergeFacadeParams,
} from "@/lib/facade/prompt-parser";
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
  wallColor?: string;
  trimColor?: string;
  doorColor?: string;
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
  if (spec.windowSize) Object.assign(next, WINDOW_SIZE_RATIOS[spec.windowSize]);
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
    wallColor: wallId,
    trimColor: trimId,
    doorColor: doorId,
  };
}

const FACADE_SUGGESTIONS = [
  "3-storey georgian with a stoop",
  "victorian shopfront, 4 bays",
  "modern, 2 bays, parapet",
  "garage door, 2 storeys",
];

export default function FacadePage() {
  // Everything is live — no draft/committed split. Client-side geometry
  // rebuilds are trivially fast, so every slider tick renders immediately.
  const [params, setParams] = useState<FacadeParams>(DEFAULT_FACADE);
  const [context, setContext] = useState<LotContext>(DEFAULT_LOT_CONTEXT);
  const [view, setView] = useState<ViewSettings>(FACADE_DEFAULT_VIEW);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const layout = useMemo(() => computeLayout(params), [params]);

  const handlePrompt = useCallback(
    async (prompt: string) => {
      // Instant local parse, then the AI refines.
      setParams((prev) => mergeFacadeParams(prev, parseFacadePromptLocal(prompt)));

      setIsAILoading(true);
      setAiStatus(null);
      try {
        const res = await fetch("/api/facade-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, current: paramsToFacadeSpec(params) }),
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
    [params],
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
          <span>{params.storeys}F</span>
          <span>·</span>
          <span>{params.bays} bays</span>
          <span>·</span>
          <span>{params.width.toFixed(1)}m</span>
          <span>·</span>
          <span>{layout.totalHeight.toFixed(1)}m ↑</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-[40vh] md:min-h-0 relative">
          <FacadeViewer params={params} context={context} view={view} />

          <div className="hidden md:block">
            <PromptInput
              onApply={handlePrompt}
              isLoading={isAILoading}
              variant="floating"
              placeholder="Describe your facade — e.g. victorian shopfront, 4 bays"
              suggestions={FACADE_SUGGESTIONS}
            />
          </div>
          {aiStatus && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/55 backdrop-blur-md px-3 py-1 text-[10px] text-white/75">
              {aiStatus}
            </div>
          )}
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            <div className="md:hidden">
              <PromptInput
                onApply={handlePrompt}
                isLoading={isAILoading}
                variant="inline"
                placeholder="Describe your facade…"
                suggestions={FACADE_SUGGESTIONS}
              />
              {aiStatus && (
                <div className="mt-1 text-[10px] text-[var(--muted)]">{aiStatus}</div>
              )}
            </div>
            <FacadeControls
              params={params}
              onChange={setParams}
              context={context}
              onContextChange={setContext}
              view={view}
              onViewChange={setView}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
