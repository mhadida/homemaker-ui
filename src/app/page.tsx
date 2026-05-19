"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { BuildingParams } from "@/lib/building/types";
import { DEFAULT_PARAMS } from "@/lib/building/types";
import { parsePromptLocal, mergeParams } from "@/lib/building/prompt-parser";
import { rectangularFootprint } from "@/lib/building/footprints";
import PromptInput from "@/components/demo/PromptInput";
import SliderControls from "@/components/demo/SliderControls";

const BuildingViewer = dynamic(
  () => import("@/components/demo/BuildingViewer"),
  { ssr: false }
);

export default function Home() {
  const [params, setParams] = useState<BuildingParams>(DEFAULT_PARAMS);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const handlePrompt = useCallback(
    async (prompt: string) => {
      const localUpdates = parsePromptLocal(prompt);
      setParams((prev: BuildingParams) => mergeParams(prev, localUpdates));

      setIsAILoading(true);
      setAiStatus(null);

      try {
        const res = await fetch("/api/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });

        if (res.ok) {
          const aiResult = await res.json();
          if (aiResult.storeys || aiResult.style || aiResult.width) {
            const aiUpdates: Partial<BuildingParams> = {};
            if (aiResult.storeys) aiUpdates.storeys = aiResult.storeys;
            if (aiResult.style) aiUpdates.style = aiResult.style;
            if (aiResult.roof) aiUpdates.roof = aiResult.roof;
            if (aiResult.width || aiResult.depth) {
              const w = aiResult.width || 10;
              const d = aiResult.depth || 8;
              aiUpdates.footprint = rectangularFootprint(w, d);
            }
            if (aiResult.rooms) {
              aiUpdates.rooms = aiResult.rooms.map((r: string) => ({
                type: r,
                label: r,
              }));
            }
            setParams((prev: BuildingParams) => mergeParams(prev, aiUpdates));
            setAiStatus("AI refined parameters");
          }
        } else {
          setAiStatus("Local parsing applied (AI unavailable)");
        }
      } catch {
        setAiStatus("Local parsing applied (AI unavailable)");
      } finally {
        setIsAILoading(false);
      }
    },
    []
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
          <span className="text-[11px] text-[var(--muted)] ml-1">by Bruno Postle</span>
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

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white/70 text-[10px] px-3 py-1.5 rounded-full pointer-events-none md:hidden">
            Pinch to zoom · Drag to rotate · Two-finger pan
          </div>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white/70 text-[10px] px-3 py-1.5 rounded-full pointer-events-none hidden md:block">
            Scroll to zoom · Left-drag to rotate · Right-drag to pan
          </div>
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            <PromptInput onApply={handlePrompt} isLoading={isAILoading} />

            {aiStatus && (
              <p className="text-[10px] text-[var(--muted)]">{aiStatus}</p>
            )}

            <div className="border-t border-[var(--border)]" />

            <SliderControls params={params} onChange={setParams} />
          </div>
        </div>
      </div>
    </div>
  );
}

function calculateArea(
  footprint: [number, number][],
  holes?: [number, number][][]
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
