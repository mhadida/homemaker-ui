"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { FacadeParams, LotContext } from "@/lib/facade/types";
import { DEFAULT_FACADE, DEFAULT_LOT_CONTEXT, FACADE_DEFAULT_VIEW } from "@/lib/facade/types";
import { computeLayout } from "@/lib/facade/layout";
import type { ViewSettings } from "@/lib/building/types";

const FacadeViewer = dynamic(() => import("@/components/facade/FacadeViewer"), {
  ssr: false,
});

export default function FacadePage() {
  // Everything is live — no draft/committed split. Client-side geometry
  // rebuilds are trivially fast, so every slider tick renders immediately.
  // setParams/setContext/setView are unused until Task 6 wires up the
  // controls panel — remove these disables then.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [params, setParams] = useState<FacadeParams>(DEFAULT_FACADE);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [context, setContext] = useState<LotContext>(DEFAULT_LOT_CONTEXT);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [view, setView] = useState<ViewSettings>(FACADE_DEFAULT_VIEW);

  const layout = useMemo(() => computeLayout(params), [params]);

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
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Task 6 replaces this placeholder with FacadeControls */}
            <div className="text-[11px] text-[var(--muted)]">
              Controls coming in Task 6.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
