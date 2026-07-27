"use client";

import type { FacadeParams, OpeningKind } from "@/lib/facade/types";
import { resolveGrid } from "@/lib/facade/layout";

// `passage` is a ground-floor TREATMENT (whole-bay arch that pierces the
// mass), not a per-cell override — so it's excluded from the tap CYCLE but
// still needs a glyph for the Record<OpeningKind> type + display.
const CYCLE: OpeningKind[] = ["window", "blank", "door", "shopfront", "garage"];
const GLYPH: Record<OpeningKind, string> = {
  window: "▢",
  blank: "·",
  door: "▯",
  shopfront: "▭",
  garage: "▤",
  passage: "∩",
};

interface BayGridProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
}

export default function BayGrid({ params, onChange }: BayGridProps) {
  const grid = resolveGrid(params);
  const defaults = resolveGrid({ ...params, cellOverrides: [] });

  const cycleCell = (storey: number, bay: number) => {
    const current = grid[storey][bay];
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const rest = (params.cellOverrides ?? []).filter(
      (o) => !(o.storey === storey && o.bay === bay),
    );
    const cellOverrides =
      next === defaults[storey][bay]
        ? rest
        : [...rest, { storey, bay, kind: next }];
    onChange({ ...params, cellOverrides, preset: undefined });
  };

  // Top storey renders first so the grid mirrors the facade.
  return (
    <div className="space-y-1">
      {[...grid].reverse().map((row, ri) => {
        const storey = grid.length - 1 - ri;
        return (
          <div key={storey} className="flex gap-1">
            {row.map((kind, bay) => {
              const overridden = (params.cellOverrides ?? []).some(
                (o) => o.storey === storey && o.bay === bay,
              );
              return (
                <button
                  key={bay}
                  type="button"
                  onClick={() => cycleCell(storey, bay)}
                  title={`Storey ${storey + 1}, bay ${bay + 1}: ${kind}`}
                  className={`flex-1 aspect-square rounded text-sm grid place-items-center transition-colors ${
                    overridden
                      ? "bg-[var(--accent)]/30 text-[var(--foreground)]"
                      : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {GLYPH[kind]}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="text-[9px] text-[var(--muted)]">
        tap to cycle: ▢ window · blank ▯ door ▭ shopfront ▤ garage
      </div>
    </div>
  );
}
