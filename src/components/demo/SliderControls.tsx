"use client";

import type { BuildingParams, StyleId, RoofType } from "@/lib/building/types";
import {
  STYLE_OPTIONS,
  WALL_SWATCHES,
  ROOF_SWATCHES,
  classicalStoreyHeights,
  clampHeightsForStyle,
  minStoreyHeightForStyle,
  ABSOLUTE_MIN_STOREY_HEIGHT,
} from "@/lib/building/types";
import { rectangularFootprint, lShapedFootprint, uShapedFootprint, hShapedFootprint, courtyardFootprint } from "@/lib/building/footprints";

const FLOOR_LABELS = [
  ["Ground"],
  ["Ground", "Upper"],
  ["Ground", "Piano Nobile", "Attic"],
  ["Ground", "Piano Nobile", "Upper", "Attic"],
  ["Ground", "Piano Nobile", "Upper", "Upper", "Attic"],
  ["Ground", "Piano Nobile", "Upper", "Upper", "Upper", "Attic"],
] as const;

interface SliderControlsProps {
  params: BuildingParams;
  onChange: (params: BuildingParams) => void;
}

export default function SliderControls({ params, onChange }: SliderControlsProps) {
  const update = (updates: Partial<BuildingParams>) => {
    onChange({ ...params, ...updates });
  };

  const shapes = [
    { id: "rectangle", label: "Rectangle", icon: "▬" },
    { id: "l", label: "L-Shape", icon: "⌐" },
    { id: "u", label: "U-Shape", icon: "⌐⌐" },
    { id: "h", label: "H-Shape", icon: "H" },
    { id: "courtyard", label: "O-Shape", icon: "▢" },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Storeys */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
            Storeys
          </label>
          <span className="text-sm font-mono font-semibold text-[var(--foreground)]">
            {params.storeys}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={params.storeys}
          onChange={(e) => {
            const n = parseInt(e.target.value);
            update({
              storeys: n,
              storeyHeights: classicalStoreyHeights(
                n,
                params.storeyHeight,
                params.style
              ),
            });
          }}
          className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[9px] text-[var(--muted)] mt-0.5">
          <span>1</span>
          <span>6</span>
        </div>
      </div>

      {/* Per-floor heights (classical proportions on storey change, individually editable) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
            Floor Heights
          </label>
          <button
            type="button"
            onClick={() =>
              update({
                storeyHeights: classicalStoreyHeights(
                  params.storeys,
                  params.storeyHeight,
                  params.style
                ),
              })
            }
            className="text-[9px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            title="Restore classical proportions"
          >
            Reset
          </button>
        </div>
        <div className="space-y-2">
          {(
            params.storeyHeights ??
            classicalStoreyHeights(
              params.storeys,
              params.storeyHeight,
              params.style
            )
          )
            .slice(0, params.storeys)
            .map((h, i) => {
              const labels = FLOOR_LABELS[Math.min(params.storeys - 1, 5)];
              const labelText = labels[i] ?? `Floor ${i + 1}`;
              const minH = minStoreyHeightForStyle(params.style);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-[var(--muted)]">
                      {labelText}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--foreground)]">
                      {h.toFixed(2)}m
                    </span>
                  </div>
                  <input
                    type="range"
                    min={minH}
                    max={5.5}
                    step={0.05}
                    value={Math.max(h, minH)}
                    onChange={(e) => {
                      const nh = [
                        ...(params.storeyHeights ??
                          classicalStoreyHeights(
                            params.storeys,
                            params.storeyHeight,
                            params.style
                          )),
                      ].slice(0, params.storeys);
                      nh[i] = parseFloat(e.target.value);
                      update({ storeyHeights: nh });
                    }}
                    className="w-full h-1 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
                  />
                </div>
              );
            })}
        </div>
        {minStoreyHeightForStyle(params.style) >
          ABSOLUTE_MIN_STOREY_HEIGHT && (
          <p className="text-[9px] text-[var(--muted)] mt-1.5 leading-snug">
            {params.style === "fancy" ? "Fancy" : "This"} style needs
            ≥&nbsp;{minStoreyHeightForStyle(params.style).toFixed(2)}m per
            floor — the pediment surround plus the eaves cornice clearance.
          </p>
        )}
      </div>

      {/* Building Width */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
            Width
          </label>
          <span className="text-sm font-mono font-semibold text-[var(--foreground)]">
            {getFootprintWidth(params).toFixed(1)}m
          </span>
        </div>
        <input
          type="range"
          min={4}
          max={30}
          step={0.5}
          value={getFootprintWidth(params)}
          onChange={(e) => {
            const newWidth = parseFloat(e.target.value);
            const depth = getFootprintDepth(params);
            update({ footprint: rectangularFootprint(newWidth, depth) });
          }}
          className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[9px] text-[var(--muted)] mt-0.5">
          <span>4m</span>
          <span>30m</span>
        </div>
      </div>

      {/* Building Depth */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
            Depth
          </label>
          <span className="text-sm font-mono font-semibold text-[var(--foreground)]">
            {getFootprintDepth(params).toFixed(1)}m
          </span>
        </div>
        <input
          type="range"
          min={4}
          max={30}
          step={0.5}
          value={getFootprintDepth(params)}
          onChange={(e) => {
            const newDepth = parseFloat(e.target.value);
            const width = getFootprintWidth(params);
            update({ footprint: rectangularFootprint(width, newDepth) });
          }}
          className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[9px] text-[var(--muted)] mt-0.5">
          <span>4m</span>
          <span>30m</span>
        </div>
      </div>

      {/* Shape */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium block mb-1.5">
          Shape
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {shapes.map((shape) => {
            const currentShape = getShapeType(params);
            const isActive = currentShape === shape.id;
            return (
              <button
                key={shape.id}
                onClick={() => {
                  const w = getFootprintWidth(params);
                  const d = getFootprintDepth(params);
                  let footprint: [number, number][];
                  let holes: [number, number][][] | undefined = undefined;
                  switch (shape.id) {
                    case "l":
                      footprint = lShapedFootprint(w, d);
                      break;
                    case "u":
                      footprint = uShapedFootprint(w, d);
                      break;
                    case "h":
                      footprint = hShapedFootprint(w, d);
                      break;
                    case "courtyard": {
                      const c = courtyardFootprint(w, d);
                      footprint = c.outer;
                      holes = [c.hole];
                      break;
                    }
                    default:
                      footprint = rectangularFootprint(w, d);
                  }
                  update({ footprint, holes });
                }}
                className={`px-2 py-2 rounded text-xs transition-colors ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                <div className="text-base leading-none mb-0.5">{shape.icon}</div>
                <div className="text-[10px]">{shape.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Style */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium block mb-1.5">
          Style
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {STYLE_OPTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                const nextStyle = s.id as StyleId;
                const heights =
                  params.storeyHeights ??
                  classicalStoreyHeights(
                    params.storeys,
                    params.storeyHeight,
                    nextStyle
                  );
                update({
                  style: nextStyle,
                  storeyHeights: clampHeightsForStyle(heights, nextStyle),
                });
              }}
              className={`text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                params.style === s.id
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--border)] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Roof */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium block mb-1.5">
          Roof
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { id: "flat", label: "Flat" },
              { id: "pitched", label: "Pitched" },
              { id: "hip", label: "Hip" },
            ] as { id: RoofType; label: string }[]
          ).map((r) => (
            <button
              key={r.id}
              onClick={() => update({ roof: r.id })}
              className={`px-2 py-1.5 rounded text-[11px] transition-colors ${
                params.roof === r.id
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--border)] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ridge Height (only for pitched/hip) */}
      {(params.roof === "pitched" || params.roof === "hip") && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
              Ridge Height
            </label>
            <span className="text-sm font-mono font-semibold text-[var(--foreground)]">
              {params.ridgeHeight.toFixed(1)}m
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={params.ridgeHeight}
            onChange={(e) => update({ ridgeHeight: parseFloat(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
          />
        </div>
      )}

      {/* Roof color — two-swatch toggle (terracotta/slate). */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium block mb-1.5">
          Roof Color
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {ROOF_SWATCHES.map((s) => {
            const active =
              (params.roofColor || "").toLowerCase() === s.hex.toLowerCase();
            return (
              <button
                key={s.id}
                onClick={() => update({ roofColor: s.hex })}
                title={s.label}
                style={{ backgroundColor: s.hex }}
                className={`h-9 rounded border text-[10px] uppercase tracking-wider text-white/90 transition-all ${
                  active
                    ? "border-white ring-2 ring-[var(--accent)]"
                    : "border-[var(--border)] hover:border-zinc-400"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Wall Paint */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium block mb-1.5">
          Wall Paint
        </label>
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {WALL_SWATCHES.map((s) => {
            const active = (params.wallColor || "").toLowerCase() === s.hex.toLowerCase();
            return (
              <button
                key={s.id}
                onClick={() => update({ wallColor: s.hex })}
                title={s.label}
                style={{ backgroundColor: s.hex }}
                className={`h-9 rounded border transition-all ${
                  active
                    ? "border-white ring-2 ring-[var(--accent)]"
                    : "border-[var(--border)] hover:border-zinc-400"
                }`}
                aria-label={s.label}
              />
            );
          })}
        </div>
        <input
          type="color"
          value={params.wallColor || "#c7bca8"}
          onChange={(e) => update({ wallColor: e.target.value })}
          className="w-full h-7 rounded bg-[var(--border)] cursor-pointer"
        />
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function getFootprintWidth(params: BuildingParams): number {
  const xs = params.footprint.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
}

function getFootprintDepth(params: BuildingParams): number {
  const ys = params.footprint.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
}

function getShapeType(params: BuildingParams): "rectangle" | "l" | "u" | "h" | "courtyard" {
  if (params.holes && params.holes.length > 0) return "courtyard";
  const n = params.footprint.length;
  if (n === 4) return "rectangle";
  if (n === 6) return "l";
  if (n === 8) return "u";
  if (n === 12) return "h";
  return "rectangle";
}