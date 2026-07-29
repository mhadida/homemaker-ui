"use client";

import { useState, useRef, useEffect } from "react";
import type {
  FacadeParams,
  PresetId,
  GroundTreatment,
} from "@/lib/facade/types";
import {
  DEFAULT_FACADE,
  FACADE_PRESETS,
  FACADE_LIMITS,
  DOOR_SWATCHES,
  WINDOW_STYLE_OPTIONS,
  suggestedBayCount,
} from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";
import type {
  Selection,
  FacadeBlock,
  BlockGenSettings,
  LotState,
} from "@/lib/facade/blocks";
import { DEFAULT_GEN } from "@/lib/facade/blocks";
import type { Corner, CornerChoice } from "@/lib/facade/corners";
import {
  clampTurretRadius,
  TURRET_RADIUS_DEFAULT,
  TURRET_RADIUS_MIN,
  TURRET_RADIUS_MAX,
} from "@/lib/facade/turret";
import type { Marquee } from "@/lib/facade/marquee";
import {
  resolveSections,
  SECTION_OFFSET_MAX,
  MASSING_DEPTH_MIN,
  MASSING_DEPTH_MAX,
  MASSING_DEPTH_DEFAULT,
} from "@/lib/facade/layout";
import {
  ROOF_HEIGHT_MIN,
  ROOF_HEIGHT_MAX,
  ROOF_HEIGHT_DEFAULT,
} from "@/lib/facade/roof";
import { GROUND_SLOPE_MAX, type Ground } from "@/lib/facade/terrain";
import {
  GABLE_HEIGHT_MIN,
  GABLE_HEIGHT_MAX,
  GABLE_HEIGHT_DEFAULT,
} from "@/lib/facade/gable";
import { STREET_WIDTH_MIN, STREET_WIDTH_MAX } from "@/lib/facade/street";
import {
  withSectionCount,
  withSectionOffset,
  withSectionBays,
  withSectionsSymmetry,
} from "@/lib/facade/sections";
import type { Street, StreetType, TrafficMode, Monument } from "@/lib/street/types";
import { STREET_SPECS, effectiveWidth, resolveTraffic } from "@/lib/street/types";
import {
  rangeAvg,
  rangeVariation,
  rangeFromAvg,
  GEN_WIDTH_BOUNDS,
  GEN_STOREYS_BOUNDS,
  GEN_VARIATION_MAX,
} from "@/lib/facade/genControls";
import { autoParcelCountForArea } from "@/lib/geo/parcelSubdivision";
import BayGrid from "./BayGrid";

interface FacadeControlsProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
  lotKind: LotState["kind"];
  onLotKindChange: (kind: LotState["kind"]) => void;
  view: ViewSettings;
  onViewChange: (v: ViewSettings) => void;
  // block inspector (Task 4)
  selection: Selection;
  block: FacadeBlock;
  onSelectionLevel: (level: "lot" | "block") => void;
  onGenChange: (gen: BlockGenSettings) => void;
  onReroll: () => void;
  onFlip: () => void;
  onDeleteBlock: () => void;
  /** M4 reversible terrace split/merge. Availability mirrors the pure guards
   * in facade/promote.ts so a button is never offered for an op that returns
   * null. */
  canSubdivide: boolean;
  canMerge: boolean;
  onSubdivide: () => void;
  onMerge: () => void;
  // corner inspector (Task 5)
  corner: { data: Corner; choice: CornerChoice; widthA: number; widthB: number } | null;
  onCornerChoice: (key: string, choice: CornerChoice) => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
  ground: Ground;
  onGroundChange: (g: Ground) => void;
  /** true once a real-terrain heightfield is loaded (Ground.hf) — hides the
   * manual Slope/Azimuth sliders, which no longer drive the ground. */
  terrainImported?: boolean;
  streetWidth: number;
  onStreetWidth: (w: number) => void;
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-[var(--muted)]">{label}</span>
        <span className="text-[11px] font-mono text-[var(--foreground)]">
          {display}
        </span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-[var(--border)] cursor-pointer accent-[var(--accent)]"
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="group">
      <summary className="cursor-pointer list-none flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
          {title}
        </span>
        <span className="text-[var(--muted)] text-[10px] group-open:rotate-90 transition-transform">
          ▸
        </span>
      </summary>
      <div className="space-y-2">{children}</div>
    </details>
  );
}

function Toggle({
  label,
  on,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1.5 rounded text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--border)] text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function Swatches({
  label,
  swatches,
  value,
  onPick,
}: {
  label: string;
  swatches: { id: string; label: string; hex: string }[];
  value: string;
  onPick: (hex: string) => void;
}) {
  return (
    <div>
      <span className="text-[10px] text-[var(--muted)] block mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {swatches.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.label}
            onClick={() => onPick(s.hex)}
            className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
              value.toLowerCase() === s.hex.toLowerCase()
                ? "border-[var(--accent)]"
                : "border-transparent"
            }`}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>
    </div>
  );
}

const TREATMENTS: { id: GroundTreatment; label: string }[] = [
  { id: "residential", label: "Residential" },
  { id: "shopfront", label: "Shopfront" },
  { id: "garage", label: "Garage" },
  { id: "passage", label: "Passage" },
];

export default function FacadeControls({
  params,
  onChange,
  lotKind,
  onLotKindChange,
  view,
  onViewChange,
  selection,
  block,
  onSelectionLevel,
  onGenChange,
  onReroll,
  onFlip,
  onDeleteBlock,
  canSubdivide,
  canMerge,
  onSubdivide,
  onMerge,
  corner,
  onCornerChoice,
  maxCornerAngle,
  onMaxCornerAngle,
  ground,
  onGroundChange,
  terrainImported,
  streetWidth,
  onStreetWidth,
}: FacadeControlsProps) {
  const update = (u: Partial<FacadeParams>) => onChange({ ...params, ...u });
  const L = FACADE_LIMITS;
  const sections = resolveSections(params);

  const applyPreset = (id: PresetId) => {
    onChange({
      ...DEFAULT_FACADE,
      ...FACADE_PRESETS[id].params,
      cellOverrides: [],
      preset: id,
    });
  };

  // A stale "corner" selection level (the corner dissolved under a flip or
  // drag, but the selection object hasn't been re-leveled yet) falls back
  // to the plain lot view — never "block" — matching the null `corner` prop.
  const effectiveLevel: "lot" | "block" =
    selection.level === "block" ? "block" : "lot";
  const canUseArchGate =
    lotKind === "arch-gate" ||
    (selection.lot > 0 &&
      selection.lot < block.lots.length - 1 &&
      block.lots[selection.lot - 1]?.kind !== "arch-gate" &&
      block.lots[selection.lot + 1]?.kind !== "arch-gate");
  const autoBays = suggestedBayCount(params.width);

  return (
    <div className="space-y-5">
      <div className={corner ? "grid grid-cols-3 gap-1" : "grid grid-cols-2 gap-1"}>
        <Toggle
          label={`Lot ${selection.lot + 1}/${block.lots.length}`}
          on={!corner && effectiveLevel === "lot"}
          onClick={() => onSelectionLevel("lot")}
        />
        <Toggle
          label="Block"
          on={!corner && effectiveLevel === "block"}
          onClick={() => onSelectionLevel("block")}
        />
        {corner && (
          <span className="px-2 py-1.5 rounded text-[11px] text-center bg-[var(--accent)] text-white select-none">
            Corner
          </span>
        )}
      </div>

      {corner && (
        <CornerInspector
          corner={corner}
          onCornerChoice={onCornerChoice}
          maxCornerAngle={maxCornerAngle}
          onMaxCornerAngle={onMaxCornerAngle}
        />
      )}

      {!corner && effectiveLevel === "block" && (
        <BlockInspector
          block={block}
          onGenChange={onGenChange}
          onReroll={onReroll}
          onFlip={onFlip}
          onDeleteBlock={onDeleteBlock}
          maxCornerAngle={maxCornerAngle}
          onMaxCornerAngle={onMaxCornerAngle}
          canSubdivide={canSubdivide}
          canMerge={canMerge}
          onSubdivide={onSubdivide}
          onMerge={onMerge}
        />
      )}

      {!corner && effectiveLevel === "lot" && (
        <>
      <Section title="Lot use">
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label="Facade"
            on={!lotKind}
            onClick={() => onLotKindChange(undefined)}
          />
          <Toggle
            label="Arch gate"
            on={lotKind === "arch-gate"}
            onClick={() => onLotKindChange("arch-gate")}
            disabled={!canUseArchGate}
            title={
              canUseArchGate
                ? "Replace this frontage with a masonry entrance"
                : "Choose an interior lot between two buildings"
            }
          />
        </div>
        {lotKind === "arch-gate" && (
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Replaces this frontage with a masonry entrance to the lot behind.
          </p>
        )}
        {!canUseArchGate && (
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Choose an interior lot between two buildings. Subdivide a wide
            frontage first.
          </p>
        )}
      </Section>

      {lotKind !== "arch-gate" && (
        <>
      {/* Presets */}
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(FACADE_PRESETS) as PresetId[]).map((id) => (
          <Toggle
            key={id}
            label={FACADE_PRESETS[id].label}
            on={params.preset === id}
            onClick={() => applyPreset(id)}
          />
        ))}
      </div>

      <Section title="Proportions">
        <SliderRow
          label="Width"
          value={params.width}
          display={`${params.width.toFixed(1)}m`}
          min={L.width.min}
          max={L.width.max}
          step={0.5}
          onChange={(width) => update({ width, preset: undefined })}
        />
        <SliderRow
          label="Storeys"
          value={params.storeys}
          display={`${params.storeys}`}
          min={L.storeys.min}
          max={L.storeys.max}
          step={1}
          onChange={(n) =>
            update({
              storeys: n,
              storeyHeights: classicalStoreyHeights(n, params.storeyHeight),
              preset: undefined,
            })
          }
        />
        <SliderRow
          label="Storey height"
          value={params.storeyHeight}
          display={`${params.storeyHeight.toFixed(1)}m`}
          min={L.storeyHeight.min}
          max={L.storeyHeight.max}
          step={0.1}
          onChange={(h) =>
            update({
              storeyHeight: h,
              storeyHeights: classicalStoreyHeights(params.storeys, h),
              preset: undefined,
            })
          }
        />
      </Section>

      <Section title="Bays & Openings">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--muted)]">
            ≈ {(params.width / params.bays).toFixed(1)}m per bay
          </span>
          <button
            type="button"
            onClick={() => update({ bays: autoBays, preset: undefined })}
            disabled={params.bays === autoBays}
            className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] transition-colors hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-40"
          >
            Auto rhythm · {autoBays}
          </button>
        </div>
        <SliderRow
          label="Bays"
          value={params.bays}
          display={`${params.bays}`}
          min={L.bays.min}
          max={L.bays.max}
          step={1}
          onChange={(bays) => update({ bays, preset: undefined })}
        />
        <SliderRow
          label="Window width"
          value={params.windowWidthRatio}
          display={`${Math.round(params.windowWidthRatio * 100)}%`}
          min={L.windowWidthRatio.min}
          max={L.windowWidthRatio.max}
          step={0.05}
          onChange={(r) => update({ windowWidthRatio: r, preset: undefined })}
        />
        <SliderRow
          label="Window height"
          value={params.windowHeightRatio}
          display={`${Math.round(params.windowHeightRatio * 100)}%`}
          min={L.windowHeightRatio.min}
          max={L.windowHeightRatio.max}
          step={0.05}
          onChange={(r) => update({ windowHeightRatio: r, preset: undefined })}
        />
        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">
            Window style
          </span>
          <div className="grid grid-cols-3 gap-1">
            {WINDOW_STYLE_OPTIONS.map((ws) => (
              <Toggle
                key={ws.id}
                label={ws.label}
                on={params.windowStyle === ws.id}
                onClick={() =>
                  update({ windowStyle: ws.id, preset: undefined })
                }
              />
            ))}
          </div>
        </div>
        <BayGrid params={params} onChange={onChange} />
      </Section>

      <Section title="Sections">
        <SliderRow
          label="Sections"
          value={sections.length}
          display={`${sections.length}`}
          min={1}
          max={params.bays}
          step={1}
          onChange={(n) =>
            onChange({ ...withSectionCount(params, n), preset: undefined })
          }
        />
        {sections.length >= 2 && (
          <>
            <Toggle
              label={
                params.sectionsSymmetrical
                  ? "Symmetrical: on"
                  : "Symmetrical: off"
              }
              on={!!params.sectionsSymmetrical}
              onClick={() =>
                onChange({
                  ...withSectionsSymmetry(params, !params.sectionsSymmetrical),
                  preset: undefined,
                })
              }
            />
            {sections.map((s, i) => (
              <div key={i} className="rounded bg-[var(--border)]/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--muted)]">
                    S{i + 1} · {s.bays} bay{s.bays > 1 ? "s" : ""}
                  </span>
                  {!params.sectionsSymmetrical && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Shrink section ${i + 1}`}
                        onClick={() =>
                          onChange({
                            ...withSectionBays(params, i, -1),
                            preset: undefined,
                          })
                        }
                        className="w-5 h-5 rounded bg-[var(--border)] text-zinc-400 hover:text-zinc-200 text-[11px] leading-none"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`Grow section ${i + 1}`}
                        onClick={() =>
                          onChange({
                            ...withSectionBays(params, i, 1),
                            preset: undefined,
                          })
                        }
                        className="w-5 h-5 rounded bg-[var(--border)] text-zinc-400 hover:text-zinc-200 text-[11px] leading-none"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <SliderRow
                  label="Offset"
                  value={s.offset}
                  display={`${s.offset > 0 ? "+" : ""}${Math.round(s.offset * 100)}cm`}
                  min={-SECTION_OFFSET_MAX}
                  max={SECTION_OFFSET_MAX}
                  step={0.01}
                  onChange={(o) =>
                    onChange({
                      ...withSectionOffset(params, i, o),
                      preset: undefined,
                    })
                  }
                />
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title="Massing">
        <SliderRow
          label="Depth"
          value={params.massingDepth ?? MASSING_DEPTH_DEFAULT}
          display={`${(params.massingDepth ?? MASSING_DEPTH_DEFAULT).toFixed(1)}m`}
          min={MASSING_DEPTH_MIN}
          max={MASSING_DEPTH_MAX}
          step={0.5}
          onChange={(massingDepth) => update({ massingDepth })}
        />
      </Section>

      <Section title="Roof">
        <div className="grid grid-cols-3 gap-1">
          {(["flat", "gable", "hip"] as const).map((t) => (
            <Toggle
              key={t}
              label={t[0].toUpperCase() + t.slice(1)}
              on={(params.roofType ?? "flat") === t}
              onClick={() => update({ roofType: t })}
            />
          ))}
        </div>
        {(params.roofType ?? "flat") !== "flat" && (
          <>
            <div className="grid grid-cols-2 gap-1">
              {(["parallel", "perpendicular"] as const).map((o) => (
                <Toggle
                  key={o}
                  label={o === "parallel" ? "∥ street" : "⊥ street"}
                  on={(params.roofOrientation ?? "parallel") === o}
                  onClick={() => update({ roofOrientation: o })}
                />
              ))}
            </div>
            <SliderRow
              label="Height"
              value={params.roofHeight ?? ROOF_HEIGHT_DEFAULT}
              display={`${(params.roofHeight ?? ROOF_HEIGHT_DEFAULT).toFixed(2)}m`}
              min={ROOF_HEIGHT_MIN}
              max={ROOF_HEIGHT_MAX}
              step={0.25}
              onChange={(roofHeight) => update({ roofHeight })}
            />
            <div className="grid grid-cols-2 gap-1">
              {(["slate", "red"] as const).map((c) => (
                <Toggle
                  key={c}
                  label={c === "slate" ? "Slate" : "Red tile"}
                  on={(params.roofColor ?? "slate") === c}
                  onClick={() => update({ roofColor: c })}
                />
              ))}
            </div>
            {/* Dormers apply to the street-facing (parallel) roof slope. */}
            {(params.roofOrientation ?? "parallel") === "parallel" && (
              <SliderRow
                label="Dormers"
                value={Math.min(params.dormers ?? 0, params.bays)}
                display={`${Math.min(params.dormers ?? 0, params.bays)}`}
                min={0}
                max={params.bays}
                step={1}
                onChange={(dormers) => update({ dormers })}
              />
            )}
          </>
        )}
      </Section>

      <Section title="Gable">
        <div className="grid grid-cols-3 gap-1">
          {(["none", "curved", "stepped"] as const).map((g) => (
            <Toggle
              key={g}
              label={g === "none" ? "None" : g === "curved" ? "Curved" : "Stepped"}
              on={(params.gableStyle ?? "none") === g}
              onClick={() =>
                update({ gableStyle: g === "none" ? undefined : g })
              }
            />
          ))}
        </div>
        {params.gableStyle && (
          <SliderRow
            label="Gable height"
            value={params.gableHeight ?? GABLE_HEIGHT_DEFAULT}
            display={`${(params.gableHeight ?? GABLE_HEIGHT_DEFAULT).toFixed(2)}m`}
            min={GABLE_HEIGHT_MIN}
            max={GABLE_HEIGHT_MAX}
            step={0.25}
            onChange={(gableHeight) => update({ gableHeight })}
          />
        )}
      </Section>

      <Section title="Ground Floor">
        <div className="grid grid-cols-3 gap-1">
          {TREATMENTS.map((t) => (
            <Toggle
              key={t.id}
              label={t.label}
              on={params.groundFloor.treatment === t.id}
              onClick={() =>
                update({
                  groundFloor: { ...params.groundFloor, treatment: t.id },
                  preset: undefined,
                })
              }
            />
          ))}
        </div>
        <SliderRow
          label="Door bay"
          value={Math.min(params.groundFloor.doorBay, params.bays - 1)}
          display={`${Math.min(params.groundFloor.doorBay, params.bays - 1) + 1}`}
          min={0}
          max={params.bays - 1}
          step={1}
          onChange={(b) =>
            update({
              groundFloor: { ...params.groundFloor, doorBay: b },
              preset: undefined,
            })
          }
        />
        <Toggle
          label={params.groundFloor.stoop ? "Stoop: on" : "Stoop: off"}
          on={params.groundFloor.stoop}
          onClick={() =>
            update({
              groundFloor: {
                ...params.groundFloor,
                stoop: !params.groundFloor.stoop,
              },
              preset: undefined,
            })
          }
        />
        {params.groundFloor.treatment === "shopfront" && (
          <Toggle
            label={params.groundFloor.awning ? "Awning: on" : "Awning: off"}
            on={!!params.groundFloor.awning}
            onClick={() =>
              update({
                groundFloor: {
                  ...params.groundFloor,
                  awning: !params.groundFloor.awning,
                },
                preset: undefined,
              })
            }
          />
        )}
      </Section>

      <Section title="Ornament & Materials">
        <div className="grid grid-cols-2 gap-1">
          {(["cornice", "parapet", "sills", "surrounds"] as const).map((k) => (
            <Toggle
              key={k}
              label={k}
              on={params.ornament[k]}
              onClick={() =>
                update({
                  ornament: { ...params.ornament, [k]: !params.ornament[k] },
                  preset: undefined,
                })
              }
            />
          ))}
        </div>
        <Swatches
          label="Wall"
          swatches={WALL_SWATCHES}
          value={params.wallColor}
          onPick={(hex) => update({ wallColor: hex })}
        />
        <Swatches
          label="Trim"
          swatches={WALL_SWATCHES}
          value={params.trimColor}
          onPick={(hex) => update({ trimColor: hex })}
        />
        <Swatches
          label="Door"
          swatches={DOOR_SWATCHES}
          value={params.doorColor}
          onPick={(hex) => update({ doorColor: hex })}
        />
      </Section>

      <Section title="Sun">
        <SliderRow
          label="Sun azimuth"
          value={view.sunAzimuth}
          display={`${Math.round(view.sunAzimuth)}°`}
          min={0}
          max={360}
          step={1}
          onChange={(sunAzimuth) => onViewChange({ ...view, sunAzimuth })}
        />
        <SliderRow
          label="Sun altitude"
          value={view.sunAltitude}
          display={`${Math.round(view.sunAltitude)}°`}
          min={5}
          max={85}
          step={1}
          onChange={(sunAltitude) => onViewChange({ ...view, sunAltitude })}
        />
      </Section>
        </>
      )}

      {lotKind === "arch-gate" && (
        <Section title="Gate span">
          <SliderRow
            label="Width"
            value={params.width}
            display={`${params.width.toFixed(1)}m`}
            min={L.width.min}
            max={L.width.max}
            step={0.5}
            onChange={(width) => update({ width, preset: undefined })}
          />
        </Section>
      )}
        </>
      )}

      {/* Street + Topography are world state — always reachable. Topography
       * hides once real terrain is imported (Ground.hf drives the ground
       * instead of these sliders). */}
      <Section title="Street">
        <SliderRow
          label="Street width"
          value={streetWidth}
          display={`${streetWidth.toFixed(0)}m`}
          min={STREET_WIDTH_MIN}
          max={STREET_WIDTH_MAX}
          step={1}
          onChange={onStreetWidth}
        />
        <p className="text-[10px] leading-snug text-[var(--muted)]">
          Centreline + mirror derive from the first block. New blocks near the
          street auto-face it; press{" "}
          <kbd className="rounded bg-[var(--border)] px-1 font-mono">f</kbd>{" "}
          while drawing to flip the whole block&rsquo;s facing.
        </p>
      </Section>

      {!terrainImported && (
        <Section title="Topography">
          <SliderRow
            label="Ground slope"
            value={ground.slope}
            display={`${Math.round(ground.slope * 100)}%`}
            min={0}
            max={GROUND_SLOPE_MAX}
            step={0.01}
            onChange={(slope) => onGroundChange({ ...ground, slope })}
          />
          <SliderRow
            label="Slope direction"
            value={ground.azimuth}
            display={`${Math.round(ground.azimuth)}°`}
            min={0}
            max={360}
            step={5}
            onChange={(azimuth) => onGroundChange({ ...ground, azimuth })}
          />
        </Section>
      )}
    </div>
  );
}

function CornerInspector({
  corner,
  onCornerChoice,
  maxCornerAngle,
  onMaxCornerAngle,
}: {
  corner: { data: Corner; choice: CornerChoice; widthA: number; widthB: number };
  onCornerChoice: (key: string, choice: CornerChoice) => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
}) {
  const { data, choice, widthA, widthB } = corner;
  return (
    <div className="space-y-5">
      <Section title="Corner building">
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label="Unified"
            on={choice.mode === "unified"}
            onClick={() => onCornerChoice(data.key, { ...choice, mode: "unified" })}
          />
          <Toggle
            label="2 facades"
            on={choice.mode === "two-facades"}
            onClick={() =>
              onCornerChoice(data.key, { ...choice, mode: "two-facades" })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label={`Street A · ${widthA.toFixed(1)}m`}
            on={choice.primary === "a"}
            onClick={() => onCornerChoice(data.key, { ...choice, primary: "a" })}
          />
          <Toggle
            label={`Street B · ${widthB.toFixed(1)}m`}
            on={choice.primary === "b"}
            onClick={() => onCornerChoice(data.key, { ...choice, primary: "b" })}
          />
        </div>
        <p className="text-[10px] text-[var(--muted)] leading-relaxed">
          Shell (storeys, colors, cornice, parapet, glazing style) is always
          shared.{" "}
          {choice.mode === "unified"
            ? `Faces mirror Street ${choice.primary.toUpperCase()} — windows, bays, ground floor.`
            : "Each frontage keeps its own windows, bays, and ground floor."}
        </p>
        {choice.mode === "unified" && (
          <>
            <span className="text-[10px] text-[var(--muted)] block">
              Corner turret
            </span>
            <div className="grid grid-cols-3 gap-1">
              <Toggle
                label="None"
                on={(choice.turret ?? "none") === "none"}
                onClick={() =>
                  onCornerChoice(data.key, { ...choice, turret: "none" })
                }
              />
              <Toggle
                label="To ground"
                on={choice.turret === "ground"}
                onClick={() =>
                  onCornerChoice(data.key, { ...choice, turret: "ground" })
                }
              />
              <Toggle
                label="Corbelled"
                on={choice.turret === "corbel"}
                onClick={() =>
                  onCornerChoice(data.key, { ...choice, turret: "corbel" })
                }
              />
            </div>
            {(choice.turret === "ground" || choice.turret === "corbel") && (
              <SliderRow
                label="Turret radius"
                value={choice.turretRadius ?? TURRET_RADIUS_DEFAULT}
                display={`${(choice.turretRadius ?? TURRET_RADIUS_DEFAULT).toFixed(1)} m`}
                min={TURRET_RADIUS_MIN}
                max={TURRET_RADIUS_MAX}
                step={0.1}
                onChange={(v) =>
                  onCornerChoice(data.key, {
                    ...choice,
                    turretRadius: clampTurretRadius(v),
                  })
                }
              />
            )}
          </>
        )}
      </Section>
      <DetectionSection
        maxCornerAngle={maxCornerAngle}
        onMaxCornerAngle={onMaxCornerAngle}
        turn={data.turn}
      />
    </div>
  );
}

function DetectionSection({
  maxCornerAngle,
  onMaxCornerAngle,
  turn,
}: {
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
  turn?: number;
}) {
  return (
    <Section title="Detection">
      <SliderRow
        label="Max corner angle (global)"
        value={maxCornerAngle}
        display={`${Math.round(maxCornerAngle)}°`}
        min={0}
        max={180}
        step={5}
        onChange={onMaxCornerAngle}
      />
      <p className="text-[10px] text-[var(--muted)]">
        {turn !== undefined
          ? `This corner turns ${Math.round(turn)}°. `
          : ""}
        Junctions turning more than the max stay separate buildings.
      </p>
    </Section>
  );
}

function BlockInspector({
  block,
  onGenChange,
  onReroll,
  onFlip,
  onDeleteBlock,
  maxCornerAngle,
  onMaxCornerAngle,
  canSubdivide,
  canMerge,
  onSubdivide,
  onMerge,
}: {
  block: FacadeBlock;
  onGenChange: (gen: BlockGenSettings) => void;
  onReroll: () => void;
  onFlip: () => void;
  onDeleteBlock: () => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
  /** One lot and a frontage long enough for two — see subdivideBlock. */
  canSubdivide: boolean;
  /** A terrace with no hand-edited lot — see mergeBlock. */
  canMerge: boolean;
  onSubdivide: () => void;
  onMerge: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );
  const gen = block.gen;
  const update = (u: Partial<BlockGenSettings>) => onGenChange({ ...gen, ...u });
  const windowWidthRatio =
    gen.windowWidthRatio ?? DEFAULT_GEN.windowWidthRatio;
  const windowHeightRatio =
    gen.windowHeightRatio ?? DEFAULT_GEN.windowHeightRatio;
  return (
    <div className="space-y-5">
      <Section title="Generation">
        {/* Average + variation view over the stored min/max ranges — the
         * saved shape and the generator are untouched (genControls.ts). */}
        <SliderRow
          label="Avg building width"
          value={rangeAvg(gen.lotWidth)}
          display={`${rangeAvg(gen.lotWidth).toFixed(1)}m`}
          min={GEN_WIDTH_BOUNDS.lo}
          max={GEN_WIDTH_BOUNDS.hi}
          step={0.5}
          onChange={(v) =>
            update({
              lotWidth: rangeFromAvg(
                v,
                rangeVariation(gen.lotWidth),
                GEN_WIDTH_BOUNDS.lo,
                GEN_WIDTH_BOUNDS.hi,
              ),
            })
          }
        />
        <SliderRow
          label="Width variation"
          value={rangeVariation(gen.lotWidth)}
          display={`${Math.round(rangeVariation(gen.lotWidth) * 100)}%`}
          min={0}
          max={GEN_VARIATION_MAX}
          step={0.05}
          onChange={(v) =>
            update({
              lotWidth: rangeFromAvg(
                rangeAvg(gen.lotWidth),
                v,
                GEN_WIDTH_BOUNDS.lo,
                GEN_WIDTH_BOUNDS.hi,
              ),
            })
          }
        />
        <SliderRow
          label="Avg height (storeys)"
          value={rangeAvg(gen.storeys)}
          display={`${rangeAvg(gen.storeys).toFixed(1)}`}
          min={GEN_STOREYS_BOUNDS.lo}
          max={GEN_STOREYS_BOUNDS.hi}
          step={0.5}
          onChange={(v) =>
            update({
              storeys: rangeFromAvg(
                v,
                rangeVariation(gen.storeys),
                GEN_STOREYS_BOUNDS.lo,
                GEN_STOREYS_BOUNDS.hi,
                true,
              ),
            })
          }
        />
        <SliderRow
          label="Height variation"
          value={rangeVariation(gen.storeys)}
          display={`${Math.round(rangeVariation(gen.storeys) * 100)}%`}
          min={0}
          max={GEN_VARIATION_MAX}
          step={0.05}
          onChange={(v) =>
            update({
              storeys: rangeFromAvg(
                rangeAvg(gen.storeys),
                v,
                GEN_STOREYS_BOUNDS.lo,
                GEN_STOREYS_BOUNDS.hi,
                true,
              ),
            })
          }
        />
        <div className="border-t border-[var(--border)] pt-2">
          <span className="mb-1 block text-[10px] text-[var(--muted)]">
            Window opening range
          </span>
          <div className="space-y-2">
            <SliderRow
              label="Width min"
              value={windowWidthRatio.min}
              display={`${Math.round(windowWidthRatio.min * 100)}%`}
              min={FACADE_LIMITS.windowWidthRatio.min}
              max={FACADE_LIMITS.windowWidthRatio.max}
              step={0.05}
              onChange={(min) =>
                update({
                  windowWidthRatio: {
                    min,
                    max: Math.max(min, windowWidthRatio.max),
                  },
                })
              }
            />
            <SliderRow
              label="Width max"
              value={windowWidthRatio.max}
              display={`${Math.round(windowWidthRatio.max * 100)}%`}
              min={FACADE_LIMITS.windowWidthRatio.min}
              max={FACADE_LIMITS.windowWidthRatio.max}
              step={0.05}
              onChange={(max) =>
                update({
                  windowWidthRatio: {
                    min: Math.min(windowWidthRatio.min, max),
                    max,
                  },
                })
              }
            />
            <SliderRow
              label="Height min"
              value={windowHeightRatio.min}
              display={`${Math.round(windowHeightRatio.min * 100)}%`}
              min={FACADE_LIMITS.windowHeightRatio.min}
              max={FACADE_LIMITS.windowHeightRatio.max}
              step={0.05}
              onChange={(min) =>
                update({
                  windowHeightRatio: {
                    min,
                    max: Math.max(min, windowHeightRatio.max),
                  },
                })
              }
            />
            <SliderRow
              label="Height max"
              value={windowHeightRatio.max}
              display={`${Math.round(windowHeightRatio.max * 100)}%`}
              min={FACADE_LIMITS.windowHeightRatio.min}
              max={FACADE_LIMITS.windowHeightRatio.max}
              step={0.05}
              onChange={(max) =>
                update({
                  windowHeightRatio: {
                    min: Math.min(windowHeightRatio.min, max),
                    max,
                  },
                })
              }
            />
          </div>
        </div>
        <SliderRow
          label="Shopfront share"
          value={gen.shopfrontShare}
          display={`${Math.round(gen.shopfrontShare * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(shopfrontShare) => update({ shopfrontShare })}
        />
        <SliderRow
          label="Style variation"
          value={gen.variation}
          display={`${Math.round(gen.variation * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(variation) => update({ variation })}
        />
        <SliderRow
          label="Depth jitter"
          value={gen.depthJitter}
          display={`${Math.round(gen.depthJitter * 100)}cm`}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(depthJitter) => update({ depthJitter })}
        />
        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">
            Preset pool
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(FACADE_PRESETS) as PresetId[]).map((id) => {
              const on = gen.presets.includes(id);
              return (
                <Toggle
                  key={id}
                  label={FACADE_PRESETS[id].label}
                  on={on}
                  onClick={() =>
                    update({
                      presets: on
                        ? gen.presets.filter((p) => p !== id)
                        : [...gen.presets, id],
                    })
                  }
                />
              );
            })}
          </div>
        </div>
        <div className="text-[9px] text-[var(--muted)]">
          Settings apply on the next reroll. Seed {block.seed} ·{" "}
          {block.lots.length} lots.
        </div>
      </Section>

      <Section title="Actions">
        <div className="grid grid-cols-2 gap-1">
          <Toggle label="Reroll" on={false} onClick={onReroll} />
          <Toggle label="Flip side" on={block.flipped} onClick={onFlip} />
          {/* Shown only when the pure op would actually succeed, so a button
            * is never offered for something that returns null. Merge in
            * particular HIDES rather than disables when a lot is hand-edited:
            * a visible-but-dead button invites the user to try to destroy
            * their own work. */}
          {canSubdivide && (
            <Toggle label="Subdivide" on={false} onClick={onSubdivide} />
          )}
          {canMerge && (
            <Toggle label="Merge to one lot" on={false} onClick={onMerge} />
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirmDelete) {
              onDeleteBlock();
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
              confirmTimer.current = window.setTimeout(
                () => setConfirmDelete(false),
                3000,
              );
            }
          }}
          className={`w-full px-2 py-1.5 rounded text-[11px] transition-colors ${
            confirmDelete
              ? "bg-red-600 text-white"
              : "bg-[var(--border)] text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {confirmDelete ? "Confirm delete?" : "Delete block"}
        </button>
      </Section>

      <DetectionSection
        maxCornerAngle={maxCornerAngle}
        onMaxCornerAngle={onMaxCornerAngle}
      />
    </div>
  );
}

/** The marquee (rubber-band) selection inspector: whole-selection actions
 * (delete, reroll) plus bulk restyle applied to every selected lot. Rendered
 * INSTEAD of the lot/block/corner inspector while a marquee is live. */
export function MarqueeControls({
  marquee,
  onDelete,
  onReroll,
  onApply,
  onClear,
}: {
  marquee: Marquee;
  onDelete: () => void;
  onReroll: () => void;
  /** Apply a per-lot transform to every selected lot. */
  onApply: (fn: (p: FacadeParams) => FacadeParams) => void;
  onClear: () => void;
}) {
  const [storeys, setStoreys] = useState(3);
  const nBlocks = marquee.blocks.length;
  const nLots = marquee.lots.length;
  const nNodes = marquee.nodes.length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const applyPreset = (id: PresetId) =>
    // Preserve each lot's own width — a bulk preset restyles character across
    // a street of varying widths, it must not collapse every lot to one size.
    onApply((p) => ({
      ...DEFAULT_FACADE,
      ...FACADE_PRESETS[id].params,
      width: p.width,
      cellOverrides: [],
      preset: id,
    }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--foreground)]">
          Selection
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          Clear
        </button>
      </div>
      <p className="text-[11px] text-[var(--muted)] font-mono">
        {plural(nBlocks, "block")} · {plural(nLots, "lot")} ·{" "}
        {plural(nNodes, "node")} selected
      </p>

      <div className="grid grid-cols-2 gap-1">
        <Toggle label="Reroll" on={false} onClick={onReroll} />
        <button
          type="button"
          onClick={onDelete}
          className="px-2 py-1.5 rounded text-[11px] bg-red-600/85 text-white hover:bg-red-600 transition-colors"
        >
          Delete selection
        </button>
      </div>

      <Section title="Bulk restyle">
        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">
            Preset
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(FACADE_PRESETS) as PresetId[]).map((id) => (
              <Toggle
                key={id}
                label={FACADE_PRESETS[id].label}
                on={false}
                onClick={() => applyPreset(id)}
              />
            ))}
          </div>
        </div>

        <SliderRow
          label="Storeys (apply to all)"
          value={storeys}
          display={`${storeys}`}
          min={FACADE_LIMITS.storeys.min}
          max={FACADE_LIMITS.storeys.max}
          step={1}
          onChange={(n) => {
            setStoreys(n);
            onApply((p) => ({
              ...p,
              storeys: n,
              storeyHeights: classicalStoreyHeights(n, p.storeyHeight),
            }));
          }}
        />

        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">Roof</span>
          <div className="grid grid-cols-3 gap-1">
            {(["flat", "gable", "hip"] as const).map((t) => (
              <Toggle
                key={t}
                label={t[0].toUpperCase() + t.slice(1)}
                on={false}
                onClick={() => onApply((p) => ({ ...p, roofType: t }))}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 mt-1">
            {(["slate", "red"] as const).map((c) => (
              <Toggle
                key={c}
                label={c === "slate" ? "Slate" : "Red tile"}
                on={false}
                onClick={() => onApply((p) => ({ ...p, roofColor: c }))}
              />
            ))}
          </div>
        </div>

        <Swatches
          label="Wall color"
          swatches={WALL_SWATCHES}
          value=""
          onPick={(hex) => onApply((p) => ({ ...p, wallColor: hex }))}
        />
        <Swatches
          label="Trim color"
          swatches={WALL_SWATCHES}
          value=""
          onPick={(hex) => onApply((p) => ({ ...p, trimColor: hex }))}
        />
      </Section>

      <p className="text-[10px] text-[var(--muted)] leading-relaxed">
        <kbd className="rounded bg-[var(--border)] px-1 font-mono">⌘/Ctrl</kbd>
        <kbd className="ml-0.5 rounded bg-[var(--border)] px-1 font-mono">A</kbd>{" "}
        selects every block. Selected nodes move with the selection; node-merge
        (welding) isn&rsquo;t supported yet.
      </p>
    </div>
  );
}

const STREET_TYPES: { id: StreetType; label: string }[] = [
  { id: "alley", label: "Alley" },
  { id: "street", label: "Street" },
  { id: "road", label: "Road" },
  { id: "boulevard", label: "Boulevard" },
  { id: "canal", label: "Canal" },
];

const TRAFFIC_MODES: { id: TrafficMode; label: string }[] = [
  { id: "cars", label: "Cars" },
  { id: "shared", label: "Shared" },
  { id: "peds", label: "Peds" },
];

/** ± band around a street type's default width — proportional (not a fixed
 * delta) so it scales sensibly from an alley (3.5 m default) through a
 * boulevard (24 m default). */
function widthOverrideRange(type: StreetType): { min: number; max: number } {
  const base = STREET_SPECS[type].width;
  return {
    min: Math.max(1.5, Math.round(base * 0.5 * 2) / 2),
    max: Math.round(base * 1.75 * 2) / 2,
  };
}

/** The Street inspector (Task 8): change type, override width (around the
 * type default), delete, and show the Krier/Alexander advisory as subtle
 * muted text (never blocking). Rendered INSTEAD of the lot/block/corner
 * inspector when a drawn street is selected — the road network is
 * independent of blocks/lots. */
export function StreetInspector({
  street,
  advisory,
  onChange,
  onDelete,
}: {
  street: Street;
  /** streetAdvisory(street) — computed by the caller so this stays a plain
   * presentational component. */
  advisory: string | null;
  onChange: (next: Street) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );
  const width = effectiveWidth(street);
  const range = widthOverrideRange(street.type);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--foreground)]">
          Street
        </span>
      </div>

      <Section title="Type">
        <div className="grid grid-cols-2 gap-1">
          {STREET_TYPES.map((t) => (
            <Toggle
              key={t.id}
              label={t.label}
              on={street.type === t.id}
              onClick={() =>
                // A new type resets any width override — an old override
                // sized for the previous type (e.g. an alley's 5 m) reads as
                // nonsensical carried onto a boulevard.
                onChange({ ...street, type: t.id, width: undefined })
              }
            />
          ))}
        </div>
        <SliderRow
          label="Width override"
          value={width}
          display={`${width.toFixed(1)}m`}
          min={range.min}
          max={range.max}
          step={0.5}
          onChange={(w) => onChange({ ...street, width: w })}
        />
        {advisory && (
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            {advisory}
          </p>
        )}
      </Section>

      {/* Water carries boats, not traffic modes. */}
      {street.type !== "canal" && (
        <Section title="Traffic">
          <div className="grid grid-cols-3 gap-1">
            {TRAFFIC_MODES.map((m) => (
              <Toggle
                key={m.id}
                label={m.label}
                on={resolveTraffic(street) === m.id}
                onClick={() => onChange({ ...street, traffic: m.id })}
              />
            ))}
          </div>
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Shared is a fietsstraat — cars are guests on red asphalt;
            pedestrian-only paves in light cobble.
          </p>
        </Section>
      )}

      <Section title="Actions">
        <button
          type="button"
          onClick={() => {
            if (confirmDelete) {
              onDelete();
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
              confirmTimer.current = window.setTimeout(
                () => setConfirmDelete(false),
                3000,
              );
            }
          }}
          className={`w-full px-2 py-1.5 rounded text-[11px] transition-colors ${
            confirmDelete
              ? "bg-red-600 text-white"
              : "bg-[var(--border)] text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {confirmDelete ? "Confirm delete?" : "Delete street"}
        </button>
      </Section>
    </div>
  );
}

const MONUMENTS: { id: Monument["kind"]; label: string }[] = [
  { id: "obelisk", label: "Obelisk" },
  { id: "fountain", label: "Fountain" },
  { id: "statue", label: "Statue" },
  { id: "triumphal-arch", label: "Triumphal arch" },
];

/** The Intersection inspector (Task 8): toggle a roundabout on/off at a
 * derived street junction and pick its monument. Writes go through
 * `onSetRoundabout(monument | null)` — null removes the entry from
 * `network.roundabouts`, turning the roundabout off. */
/** The Square inspector: pick (or clear) the monument standing at a derived
 * square's centroid. The square itself is always derived from its closed
 * loop — only this choice is stored (network.squares, sparse). */
export function SquareInspector({
  monument,
  area,
  onSetMonument,
}: {
  /** null → no monument on this square yet. */
  monument: Monument | null;
  /** interior area, m² (display only) */
  area: number;
  onSetMonument: (monument: Monument | null) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--foreground)]">
          Square
        </span>
        <span className="text-[10px] text-[var(--muted)]">
          {Math.round(area)} m²
        </span>
      </div>

      <Section title="Monument">
        <div className="grid grid-cols-2 gap-1">
          <Toggle
            label="None"
            on={!monument}
            onClick={() => onSetMonument(null)}
          />
          {MONUMENTS.map((m) => (
            <Toggle
              key={m.id}
              label={m.label}
              on={monument?.kind === m.id}
              onClick={() => onSetMonument({ kind: m.id })}
            />
          ))}
        </div>
        <p className="text-[10px] leading-snug text-[var(--muted)]">
          Buildings lining the inside of this loop face the square with a
          second frontage automatically.
        </p>
      </Section>
    </div>
  );
}

export function IntersectionInspector({
  monument,
  onSetRoundabout,
}: {
  /** null → no roundabout at this junction yet. */
  monument: Monument | null;
  onSetRoundabout: (monument: Monument | null) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--foreground)]">
          Intersection
        </span>
      </div>

      <Section title="Roundabout">
        <Toggle
          label={monument ? "Roundabout: on" : "Roundabout: off"}
          on={!!monument}
          onClick={() => onSetRoundabout(monument ? null : { kind: "obelisk" })}
        />
        {monument && (
          <div className="grid grid-cols-2 gap-1">
            {MONUMENTS.map((m) => (
              <Toggle
                key={m.id}
                label={m.label}
                on={monument.kind === m.id}
                onClick={() => onSetRoundabout({ kind: m.id })}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** View-only planning boundary, kept separate from editable-object selection. */
export function InterventionScopePanel({
  kind,
  area,
  lotCount,
  mergeCount,
  canSplit,
  canMerge,
  splitActive,
  splitError,
  onSplit,
  onAutoSplit,
  onMerge,
  onCancelSplit,
  onClear,
}: {
  kind: "parcel" | "rectangle";
  area: number;
  lotCount: number;
  mergeCount: number;
  canSplit: boolean;
  canMerge: boolean;
  splitActive: boolean;
  splitError: string | null;
  onSplit: () => void;
  onAutoSplit: (count: number) => void;
  onMerge: () => void;
  onCancelSplit: () => void;
  onClear: () => void;
}) {
  const [autoMode, setAutoMode] = useState<"count" | "area">("count");
  const [autoCount, setAutoCount] = useState(2);
  const [targetArea, setTargetArea] = useState(() =>
    Math.max(4, Math.round(area / 2)),
  );
  useEffect(() => {
    setTargetArea(Math.max(4, Math.round(area / 2)));
  }, [area]);
  const resolvedAutoCount =
    autoMode === "count"
      ? Math.max(1, Math.min(50, Math.floor(autoCount)))
      : autoParcelCountForArea(area, targetArea);
  const areaLabel =
    area >= 10_000
      ? `${(area / 10_000).toFixed(2)} ha`
      : `${Math.round(area).toLocaleString()} m²`;
  return (
    <Section title="Intervention scope">
      <div className="rounded-md border border-[#0f9f9a]/50 bg-[#0f9f9a]/10 p-2.5">
        <p className="text-[11px] font-medium text-[var(--foreground)]">
          {kind === "parcel" ? "Property parcel" : "Drawn area"}
        </p>
        <p className="mt-1 text-[11px] font-mono text-[var(--muted)]">
          {areaLabel} · {lotCount.toLocaleString()}{" "}
          {lotCount === 1 ? "parcel" : "parcels"}
        </p>
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--muted)]">
        This boundary defines the study area without changing or selecting the
        buildings inside it.
      </p>
      {mergeCount > 1 && (
        <div className="space-y-1.5 rounded border border-[var(--border)] p-2.5">
          <p className="text-[10px] font-medium text-[var(--foreground)]">
            Combine parcels
          </p>
          <button
            type="button"
            disabled={!canMerge}
            onClick={onMerge}
            className="w-full rounded bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Merge {mergeCount.toLocaleString()} parcels
          </button>
          <p className="text-[10px] leading-relaxed text-[var(--muted)]">
            Selected parcels must share boundaries and form one connected
            property.
          </p>
        </div>
      )}
      {kind === "parcel" && lotCount === 1 && (
        <>
          <button
            type="button"
            disabled={!canSplit}
            onClick={splitActive ? onCancelSplit : onSplit}
            className={`w-full rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              splitActive
                ? "border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-[#f59e0b]"
                : "bg-[var(--accent)] text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            }`}
          >
            {splitActive ? "Cancel parcel cut" : "✂ Split parcel"}
          </button>
          <p className="text-[10px] leading-relaxed text-[var(--muted)]">
            Draw one cut between two property edges. Endpoints snap to the
            boundary; invalid cuts and sliver parcels are rejected.
          </p>
          <div className="space-y-2 rounded border border-[var(--border)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium text-[var(--foreground)]">
                Automatic subdivision
              </p>
              <div
                role="group"
                aria-label="Automatic parcel split method"
                className="flex rounded border border-[var(--border)] p-0.5"
              >
                {(["count", "area"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={autoMode === mode}
                    onClick={() => setAutoMode(mode)}
                    className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                      autoMode === mode
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {mode === "count" ? "By count" : "By area"}
                  </button>
                ))}
              </div>
            </div>
            {autoMode === "count" ? (
              <label className="flex items-center justify-between gap-3 text-[10px] text-[var(--muted)]">
                Number of parcels
                <input
                  aria-label="Number of parcels"
                  type="number"
                  min={2}
                  max={50}
                  step={1}
                  value={autoCount}
                  onChange={(event) => setAutoCount(Number(event.target.value))}
                  className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right font-mono text-[11px] text-[var(--foreground)]"
                />
              </label>
            ) : (
              <label className="flex items-center justify-between gap-3 text-[10px] text-[var(--muted)]">
                Target area
                <span className="flex items-center gap-1">
                  <input
                    aria-label="Target parcel area"
                    type="number"
                    min={4}
                    step={1}
                    value={targetArea}
                    onChange={(event) =>
                      setTargetArea(Number(event.target.value))
                    }
                    className="w-20 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right font-mono text-[11px] text-[var(--foreground)]"
                  />
                  m²
                </span>
              </label>
            )}
            <button
              type="button"
              disabled={!canSplit || resolvedAutoCount < 2}
              onClick={() => onAutoSplit(resolvedAutoCount)}
              className="w-full rounded bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Split into {resolvedAutoCount.toLocaleString()} parcels
            </button>
            <p className="text-[10px] leading-relaxed text-[var(--muted)]">
              Generates approximately equal areas using clean straight cuts.
              Complex parcels may require the manual tool.
            </p>
          </div>
        </>
      )}
      {splitError && (
        <p role="alert" className="text-[10px] leading-relaxed text-red-400">
          {splitError}
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] rounded border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] transition-colors hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]"
        >
          Clear scope
        </button>
      </div>
    </Section>
  );
}

/**
 * M2 context buildings — visibility toggle, count, truncation notice, fetch
 * error, and Restore hidden. Rendered by the page OUTSIDE the block/street/
 * marquee selection ternary (Task 7 fix round 1): the primary M2 flow is
 * "load a place, look at the backdrop" with nothing selected, so gating this
 * behind a selection would make the count/toggle/truncation notice — and
 * critically "Restore hidden", the only way to undo a demolition — all
 * unreachable whenever nothing happens to be selected. Renders nothing
 * unless `contextLoaded` (a place is loaded), so a scene with no place is
 * byte-identical.
 */
export function ContextPanel({
  contextLoaded,
  contextCount,
  contextVisible,
  onToggleContext,
  contextTruncated,
  contextTotal,
  contextLoading,
  contextError,
  hiddenCount,
  onRestoreHidden,
  streetCount,
  streetsLoading,
  streetsTruncated,
  streetsTotal,
  streetsError,
  parcelCount,
  parcelsLoading,
  parcelsTruncated,
  parcelsError,
}: {
  contextLoaded?: boolean;
  contextCount?: number;
  contextVisible?: boolean;
  onToggleContext?: () => void;
  contextTruncated?: boolean;
  contextTotal?: number;
  contextLoading?: boolean;
  contextError?: string | null;
  hiddenCount?: number;
  onRestoreHidden?: () => void;
  streetCount?: number;
  streetsLoading?: boolean;
  streetsTruncated?: boolean;
  streetsTotal?: number;
  streetsError?: string | null;
  parcelCount?: number;
  parcelsLoading?: boolean;
  parcelsTruncated?: boolean;
  parcelsError?: string | null;
}) {
  if (!contextLoaded) return null;
  return (
    <Section title="Context">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]">
          {contextLoading
            ? "Loading buildings…"
            : `${(contextCount ?? 0).toLocaleString()} buildings`}
        </span>
        <button
          type="button"
          onClick={onToggleContext}
          aria-pressed={contextVisible ?? true}
          className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
            contextVisible ?? true
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30"
          }`}
        >
          {contextVisible ?? true ? "Shown" : "Hidden"}
        </button>
      </div>
      {contextTruncated && (
        <p className="text-[11px] text-[var(--muted)]">
          Showing the first {(contextCount ?? 0).toLocaleString()} of{" "}
          {(contextTotal ?? 0).toLocaleString()} — zoom into a smaller area for the rest.
        </p>
      )}
      {contextError && (
        <p className="text-[11px] text-red-400" role="alert">
          Buildings unavailable: {contextError}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]">
          {parcelsLoading
            ? "Loading parcels…"
            : `${(parcelCount ?? 0).toLocaleString()} cadastral parcels`}
        </span>
      </div>
      {parcelsTruncated && (
        <p className="text-[11px] text-[var(--muted)]">
          Parcel results were capped — zoom into a smaller area for complete
          boundaries.
        </p>
      )}
      {parcelsError && (
        <p className="text-[11px] text-red-400" role="alert">
          Parcels unavailable: {parcelsError}
        </p>
      )}
      {!parcelsLoading && !parcelsError && (parcelCount ?? 0) > 0 && (
        <p className="text-[10px] leading-relaxed text-[var(--muted)]">
          BRK Kadastrale Kaart via{" "}
          <a
            href="https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1?f=html"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-[var(--foreground)]"
          >
            PDOK / Kadaster
          </a>
          {" · "}
          CC BY 4.0 · indicative geometry, not survey measurements
        </p>
      )}
      {(hiddenCount ?? 0) > 0 && (
        <button
          type="button"
          onClick={onRestoreHidden}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
        >
          Restore hidden ({hiddenCount})
        </button>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]">
          {streetsLoading
            ? "Loading streets…"
            : `${(streetCount ?? 0).toLocaleString()} streets`}
        </span>
      </div>
      {streetsTruncated && (
        <p className="text-[11px] text-[var(--muted)]">
          Showing the first {(streetCount ?? 0).toLocaleString()} of{" "}
          {(streetsTotal ?? 0).toLocaleString()} streets — zoom into a smaller area for the rest.
        </p>
      )}
      {streetsError && (
        <p className="text-[11px] text-red-400" role="alert">
          Streets unavailable: {streetsError}
        </p>
      )}
    </Section>
  );
}

/**
 * M4 — the selected imported building. Shows what promotion WOULD produce
 * (frontage and depth read straight off a trial `promoteParcel`, never
 * re-derived, so the panel cannot disagree with the result and the depth
 * clamp is not duplicated), then offers Promote or Demolish.
 *
 * Demolish lives here rather than on the mesh click because an instant,
 * unconfirmed demolition on a single click was a real hazard. Rendered by the
 * page OUTSIDE the block/street/marquee selection ternary, for the same reason
 * ContextPanel is: the M4 flow is "load a place, click a building" with no
 * block selected.
 */
export function ContextBuildingPanel({
  id,
  parcelId,
  area,
  vertices,
  preview,
  onPromote,
  onDemolish,
  onClose,
}: {
  id: string;
  parcelId: string | null;
  area: number | null;
  vertices: number | null;
  /** null when the parcel cannot carry a facade. */
  preview: { width: number; depth: number } | null;
  onPromote: () => void;
  onDemolish: () => void;
  onClose: () => void;
}) {
  return (
    <Section title="Context building">
      <p className="text-[11px] text-[var(--muted)]">{id}</p>
      {parcelId && area !== null && vertices !== null ? (
        <>
          <p className="break-all text-[10px] text-[var(--muted)]">
            Parent parcel {parcelId}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            {Math.round(area).toLocaleString()} m² lot · {vertices} boundary
            vertices
          </p>
        </>
      ) : (
        <p className="text-[11px] text-red-400" role="alert">
          No containing cadastral parcel was found. This building cannot be
          promoted to a lot.
        </p>
      )}
      {preview ? (
        <p className="text-[11px] text-[var(--muted)]">
          Promotes to a {preview.width.toFixed(1)} m frontage,{" "}
          {preview.depth.toFixed(1)} m deep.
        </p>
      ) : (
        <p className="text-[11px] text-[var(--muted)]">
          {parcelId
            ? "This parcel is too small to carry a facade."
            : "Promotion requires a parent parcel."}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onPromote}
          disabled={!preview}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--accent)] text-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Promote to lot
        </button>
        <button
          type="button"
          onClick={onDemolish}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
        >
          Demolish
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
        >
          Close
        </button>
      </div>
    </Section>
  );
}
