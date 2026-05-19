"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { BuildingParams, StyleId, RoofType } from "@/lib/building/types";
import {
  DEFAULT_PARAMS,
  WALL_SWATCHES,
  ROOF_SWATCHES,
  classicalStoreyHeights,
  clampHeightsForStyle,
} from "@/lib/building/types";
import { parsePromptLocal, mergeParams } from "@/lib/building/prompt-parser";
import {
  rectangularFootprint,
  lShapedFootprint,
  uShapedFootprint,
  hShapedFootprint,
  courtyardFootprint,
} from "@/lib/building/footprints";
import PromptInput from "@/components/demo/PromptInput";
import SliderControls from "@/components/demo/SliderControls";

const BuildingViewer = dynamic(
  () => import("@/components/demo/BuildingViewer"),
  { ssr: false },
);

// Inverse of BuildingSpec server schema → BuildingParams.
// Defined here so the AI's compact response can be expanded into the full
// state shape the rest of the app uses.
interface BuildingSpec {
  storeys?: number;
  width?: number;
  depth?: number;
  shape?: "rectangle" | "l" | "u" | "h" | "courtyard";
  style?: StyleId;
  roof?: RoofType;
  ridgeHeight?: number;
  wallColor?: keyof typeof WALL_HEX;
  roofColor?: keyof typeof ROOF_HEX;
  rooms?: string[];
}

const WALL_HEX: Record<string, string> = Object.fromEntries(
  WALL_SWATCHES.map((s) => [s.id, s.hex]),
);
const ROOF_HEX: Record<string, string> = Object.fromEntries(
  ROOF_SWATCHES.map((s) => [s.id, s.hex]),
);

/** Convert an AI-returned spec into a complete BuildingParams object. */
function specToParams(
  spec: BuildingSpec,
  prev: BuildingParams,
): BuildingParams {
  const next: BuildingParams = { ...prev };
  if (spec.storeys && spec.storeys !== prev.storeys) {
    next.storeys = spec.storeys;
    next.storeyHeights = classicalStoreyHeights(
      spec.storeys,
      prev.storeyHeight,
      spec.style ?? prev.style,
    );
  }
  if (spec.style && spec.style !== prev.style) {
    next.style = spec.style;
    next.storeyHeights = clampHeightsForStyle(
      next.storeyHeights ??
        classicalStoreyHeights(next.storeys, prev.storeyHeight, spec.style),
      spec.style,
    );
  }
  if (spec.roof) next.roof = spec.roof;
  if (typeof spec.ridgeHeight === "number") next.ridgeHeight = spec.ridgeHeight;
  if (spec.wallColor && WALL_HEX[spec.wallColor])
    next.wallColor = WALL_HEX[spec.wallColor];
  if (spec.roofColor && ROOF_HEX[spec.roofColor])
    next.roofColor = ROOF_HEX[spec.roofColor];

  // Footprint: derive from shape + dims if either changed
  if (spec.shape || spec.width || spec.depth) {
    const w = spec.width ?? getFootprintWidth(prev);
    const d = spec.depth ?? getFootprintDepth(prev);
    const shape = spec.shape ?? getShapeFromParams(prev);
    const { footprint, holes } = footprintForShape(shape, w, d);
    next.footprint = footprint;
    next.holes = holes;
  }

  if (spec.rooms) {
    next.rooms = spec.rooms.map((r) => ({ type: r, label: r }));
  }

  return next;
}

function footprintForShape(
  shape: "rectangle" | "l" | "u" | "h" | "courtyard",
  w: number,
  d: number,
): { footprint: [number, number][]; holes?: [number, number][][] } {
  switch (shape) {
    case "l":
      return { footprint: lShapedFootprint(w, d), holes: undefined };
    case "u":
      return { footprint: uShapedFootprint(w, d), holes: undefined };
    case "h":
      return { footprint: hShapedFootprint(w, d), holes: undefined };
    case "courtyard": {
      const c = courtyardFootprint(w, d);
      return { footprint: c.outer, holes: [c.hole] };
    }
    default:
      return { footprint: rectangularFootprint(w, d), holes: undefined };
  }
}

function getFootprintWidth(p: BuildingParams): number {
  const xs = p.footprint.map((pt) => pt[0]);
  return Math.max(...xs) - Math.min(...xs);
}

function getFootprintDepth(p: BuildingParams): number {
  const ys = p.footprint.map((pt) => pt[1]);
  return Math.max(...ys) - Math.min(...ys);
}

function getShapeFromParams(
  p: BuildingParams,
): "rectangle" | "l" | "u" | "h" | "courtyard" {
  if (p.holes && p.holes.length > 0) return "courtyard";
  const n = p.footprint.length;
  if (n === 4) return "rectangle";
  if (n === 6) return "l";
  if (n === 8) return "u";
  if (n === 12) return "h";
  return "rectangle";
}

/** Build the compact BuildingSpec snapshot of current params for the AI. */
function paramsToSpec(p: BuildingParams): BuildingSpec {
  const wallSwatch = WALL_SWATCHES.find(
    (s) => s.hex.toLowerCase() === (p.wallColor || "").toLowerCase(),
  );
  const roofSwatch = ROOF_SWATCHES.find(
    (s) => s.hex.toLowerCase() === (p.roofColor || "").toLowerCase(),
  );
  return {
    storeys: p.storeys,
    width: Math.round(getFootprintWidth(p) * 10) / 10,
    depth: Math.round(getFootprintDepth(p) * 10) / 10,
    shape: getShapeFromParams(p),
    style: p.style,
    roof: p.roof,
    ridgeHeight: p.ridgeHeight,
    wallColor: wallSwatch?.id as BuildingSpec["wallColor"],
    roofColor: roofSwatch?.id as BuildingSpec["roofColor"],
    rooms: p.rooms.map((r) => r.type),
  };
}

export default function Home() {
  const [params, setParams] = useState<BuildingParams>(DEFAULT_PARAMS);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const handlePrompt = useCallback(
    async (prompt: string) => {
      // Optimistic local-keyword pass so the user sees something instantly
      // while the AI call (~500ms-1s) is in flight.
      const localUpdates = parsePromptLocal(prompt);
      setParams((prev) => mergeParams(prev, localUpdates));

      setIsAILoading(true);
      setAiStatus(null);

      try {
        // Snapshot the *current* params as context — this is how we get
        // "merge after first prompt" behaviour without branching logic. The
        // AI sees what's set and is instructed to keep unmentioned fields.
        const current = paramsToSpec(params);

        const res = await fetch("/api/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, current }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const { spec } = (await res.json()) as { spec: BuildingSpec };
        setParams((prev) => specToParams(spec, prev));
        setAiStatus("AI applied");
      } catch (e) {
        setAiStatus(
          e instanceof Error
            ? `AI unavailable: ${e.message.slice(0, 60)} (local parse applied)`
            : "AI unavailable (local parse applied)",
        );
      } finally {
        setIsAILoading(false);
      }
    },
    [params],
  );

  const sumHeights =
    params.storeyHeights && params.storeyHeights.length >= params.storeys
      ? params.storeyHeights
          .slice(0, params.storeys)
          .reduce((a, b) => a + b, 0)
      : params.storeys * params.storeyHeight;
  const totalHeight =
    sumHeights + (params.roof !== "flat" ? params.ridgeHeight : 0);
  const footprintArea = calculateArea(params.footprint, params.holes);

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
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">Homemaker</span>
          <span className="text-[11px] text-[var(--muted)] ml-1">
            by Bruno Postle
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] font-mono">
          <span>{params.storeys}F</span>
          <span>·</span>
          <span>{totalHeight.toFixed(1)}m</span>
          <span>·</span>
          <span>{footprintArea.toFixed(0)}m²</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-[40vh] md:min-h-0 relative">
          <BuildingViewer params={params} />

          {/* Floating prompt pill, bottom-center of the viewer */}
          <PromptInput onApply={handlePrompt} isLoading={isAILoading} />

          {aiStatus && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/55 backdrop-blur-md px-3 py-1 text-[10px] text-white/75">
              {aiStatus}
            </div>
          )}
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            <SliderControls params={params} onChange={setParams} />
          </div>
        </div>
      </div>
    </div>
  );
}

function calculateArea(
  footprint: [number, number][],
  holes?: [number, number][][],
): number {
  const ringArea = (ring: [number, number][]) => {
    let a = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += ring[i][0] * ring[j][1];
      a -= ring[j][0] * ring[i][1];
    }
    return Math.abs(a) / 2;
  };
  let area = ringArea(footprint);
  if (holes) for (const h of holes) area -= ringArea(h);
  return area;
}
