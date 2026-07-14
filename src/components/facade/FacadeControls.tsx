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
} from "@/lib/facade/types";
import type { ViewSettings } from "@/lib/building/types";
import { WALL_SWATCHES, classicalStoreyHeights } from "@/lib/building/types";
import type { Selection, FacadeBlock, BlockGenSettings } from "@/lib/facade/blocks";
import type { Corner, CornerChoice } from "@/lib/facade/corners";
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
import { STREET_WIDTH_MIN, STREET_WIDTH_MAX } from "@/lib/facade/street";
import {
  withSectionCount,
  withSectionOffset,
  withSectionBays,
  withSectionsSymmetry,
} from "@/lib/facade/sections";
import BayGrid from "./BayGrid";

interface FacadeControlsProps {
  params: FacadeParams;
  onChange: (p: FacadeParams) => void;
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
  // corner inspector (Task 5)
  corner: { data: Corner; choice: CornerChoice; widthA: number; widthB: number } | null;
  onCornerChoice: (key: string, choice: CornerChoice) => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
  ground: Ground;
  onGroundChange: (g: Ground) => void;
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
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1.5 rounded text-[11px] transition-colors ${
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
];

export default function FacadeControls({
  params,
  onChange,
  view,
  onViewChange,
  selection,
  block,
  onSelectionLevel,
  onGenChange,
  onReroll,
  onFlip,
  onDeleteBlock,
  corner,
  onCornerChoice,
  maxCornerAngle,
  onMaxCornerAngle,
  ground,
  onGroundChange,
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
        />
      )}

      {!corner && effectiveLevel === "lot" && (
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
            Glazing
          </span>
          <div className="grid grid-cols-4 gap-1">
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
          </>
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

      {/* Street + Topography are world state — always reachable. */}
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
          while drawing to flip the facing.
        </p>
      </Section>

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
}: {
  block: FacadeBlock;
  onGenChange: (gen: BlockGenSettings) => void;
  onReroll: () => void;
  onFlip: () => void;
  onDeleteBlock: () => void;
  maxCornerAngle: number;
  onMaxCornerAngle: (deg: number) => void;
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
  return (
    <div className="space-y-5">
      <Section title="Generation">
        <SliderRow
          label="Lot width min"
          value={gen.lotWidth.min}
          display={`${gen.lotWidth.min.toFixed(1)}m`}
          min={4}
          max={gen.lotWidth.max}
          step={0.5}
          onChange={(v) => update({ lotWidth: { ...gen.lotWidth, min: v } })}
        />
        <SliderRow
          label="Lot width max"
          value={gen.lotWidth.max}
          display={`${gen.lotWidth.max.toFixed(1)}m`}
          min={gen.lotWidth.min}
          max={14}
          step={0.5}
          onChange={(v) => update({ lotWidth: { ...gen.lotWidth, max: v } })}
        />
        <SliderRow
          label="Storeys min"
          value={gen.storeys.min}
          display={`${gen.storeys.min}`}
          min={1}
          max={gen.storeys.max}
          step={1}
          onChange={(v) => update({ storeys: { ...gen.storeys, min: v } })}
        />
        <SliderRow
          label="Storeys max"
          value={gen.storeys.max}
          display={`${gen.storeys.max}`}
          min={gen.storeys.min}
          max={6}
          step={1}
          onChange={(v) => update({ storeys: { ...gen.storeys, max: v } })}
        />
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
          label="Variation"
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
