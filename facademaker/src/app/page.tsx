"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
  blockFrame,
  syncLineToLots,
  nextBlockId,
  reserveBlockIds,
  DEFAULT_GEN,
  type BlockGenSettings,
  type BuildingDisplay,
  type FacadeBlock,
  type Selection,
} from "@/lib/facade/blocks";
import {
  toJSON,
  toCompactJSON,
  fromJSON,
  sceneHasContent,
  type SceneState,
} from "@/lib/facade/document";
import {
  stripStreetBlocks,
  syncStreetBlocks,
} from "@/lib/facade/streetBlocks";
import { rerollBlock, generateBlock, deleteLot } from "@/lib/facade/generate";
import {
  mergeBlock,
  parcelPreview,
  promoteParcel,
  subdivideBlock,
} from "@/lib/facade/promote";
import { parcelArea } from "@/lib/geo/parcel";
import { moveNode, deriveNodes } from "@/lib/facade/nodes";
import { DEFAULT_GROUND, type Ground, type Heightfield } from "@/lib/facade/terrain";
import { streetRefOf, STREET_WIDTH_DEFAULT } from "@/lib/facade/street";
import { anchorOf, type GeoAnchor, type LngLatBBox } from "@/lib/geo/project";
import type { ContextBuilding } from "@/lib/geo/buildings";
import { normalizeImportedStreetWidths } from "@/lib/geo/streets";
import {
  DEMO_ANCHOR,
  DEMO_BBOX,
  DEMO_BUILDINGS_URL,
  DEMO_STREETS_URL,
  DEMO_TERRAIN_URL,
  isDemoPlaceFrame,
} from "@/lib/geo/demoPlace";
import {
  EMPTY_NETWORK,
  nextStreetId,
  reserveStreetIds,
  type Monument,
  type Street,
  type StreetNetwork,
  type StreetType,
  type Vec2,
} from "@/lib/street/types";
import { deriveIntersections, moveStreetNode, pruneRoundabouts } from "@/lib/street/intersections";
import { deriveSquares, pruneSquareMonuments } from "@/lib/street/squares";
import { streetAdvisory } from "@/lib/street/geometry";
import { canalGradeAdvisory } from "@/lib/street/canal";
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
  StreetInspector,
  IntersectionInspector,
  SquareInspector,
  ContextPanel,
  ContextBuildingPanel,
} from "@/components/facade/FacadeControls";
import PromptInput from "@/components/demo/PromptInput";

const FacadeViewer = dynamic(() => import("@/components/facade/FacadeViewer"), {
  ssr: false,
});
const PlacePicker = dynamic(() => import("@/components/facade/PlacePicker"), {
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
  // The scene starts BLANK: no buildings until the user draws. The pen is
  // auto-armed in FacadeViewer only when the world is TRULY empty (no blocks
  // and no streets); a streets-only scene stays idle so streets are clickable.
  const [blocks, setBlocks] = useState<FacadeBlock[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [view, setView] = useState<ViewSettings>(FACADE_DEFAULT_VIEW);
  // Building render mode — pure view state (not persisted). full = detailed
  // facades; massing = plain volume boxes; outline = wireframe; off = hidden.
  const [display, setDisplay] = useState<BuildingDisplay>("full");
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [drawActive, setDrawActive] = useState(false);
  const [cornerChoices, setCornerChoices] = useState<Map<string, CornerChoice>>(
    () => new Map(),
  );
  const [maxCornerAngle, setMaxCornerAngle] = useState(DEFAULT_MAX_CORNER_ANGLE);
  const [ground, setGround] = useState<Ground>(DEFAULT_GROUND);
  // Geo anchor for the loaded real-terrain heightfield (Ground.hf) — null
  // while the ground is the manual flat/tilted plane. Picker + load/clear
  // state are page-local UI, not part of the saved document.
  const [anchor, setAnchor] = useState<GeoAnchor | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  // Synchronous gate shared by real/demo imports. React's disabled state does
  // not commit until the next render, so two clicks in the same event turn
  // could otherwise start two imports before either button visibly disables.
  // A successful import keeps the gate closed until Clear terrain resets it.
  const placeLoadLockRef = useRef(false);
  // "Demo place": loads the committed Amsterdam fixture (terrain + buildings
  // + streets) from static /fixtures/*.json — no Overpass/AWS calls. Own
  // loading/error UI, separate from the real-place loaders above.
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  // Context buildings (M2). The footprints are page state ONLY — never
  // serialized; `bbox` is the key they are re-fetched from on load.
  const [contextBuildings, setContextBuildings] = useState<ContextBuilding[]>([]);
  const [bbox, setBbox] = useState<LngLatBBox | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [contextVisible, setContextVisible] = useState(true);
  // Loading/error/truncation UI (spinner, error banner, truncation notice).
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [buildingsInfo, setBuildingsInfo] = useState<{ truncated: boolean; total: number } | null>(null);
  const [streetWidth, setStreetWidth] = useState(STREET_WIDTH_DEFAULT);
  // Auto-populate editable buildings along street frontages (SP-2c). Default
  // on; transient UI state (like drawActive/marquee) — not part of the saved
  // document, since the derived blocks it produces already are.
  const [buildingsFromStreets, setBuildingsFromStreets] = useState(true);
  // The standalone road network (independent of blocks/lots). Empty by
  // default so every existing path is byte-identical.
  const [streetNetwork, setStreetNetwork] =
    useState<StreetNetwork>(EMPTY_NETWORK);
  // Whether the network currently holds any IMPORTED street — the
  // `street-osm-` id prefix `loadStreets`/src/lib/geo/streets.ts stamps on
  // every fetched street identifies them (hand-drawn streets never carry it).
  // Drives the Auto-buildings toggle's disabled state (generating frontages
  // for ~227 real streets would create thousands of lots — see IMPORTANT 5)
  // and the stash/restore of the user's buildingsFromStreets preference
  // around an import (loadStreets / handleClearTerrain below).
  const hasImportedStreets = useMemo(
    () => streetNetwork.streets.some((s) => s.id.startsWith("street-osm-")),
    [streetNetwork],
  );
  // A place is a single scene-level frame. Treat any surviving part of that
  // frame as loaded so a partially restored document cannot be overlaid with
  // a second place. "Clear terrain" removes all of these imported parts.
  const hasLoadedPlace =
    ground.hf !== undefined ||
    anchor !== null ||
    bbox !== null ||
    hasImportedStreets ||
    contextBuildings.length > 0;
  const placeLoadBlocked =
    hasLoadedPlace || terrainLoading || demoLoading;
  // Street-network selection: a clicked ribbon or a clicked derived
  // intersection opens its own inspector, mutually exclusive with the
  // block/lot/corner selection and the marquee. null by default so every
  // existing path is byte-identical.
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null);
  const [selectedIntersection, setSelectedIntersection] = useState<
    string | null
  >(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  // The imported context building the M4 inspector is open on. UI-only —
  // never serialized, never restored from the autosave.
  const [selectedContextBuilding, setSelectedContextBuilding] = useState<
    string | null
  >(null);
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
  // Request token for `loadContextBuildings`: an Overpass fetch takes ~15s,
  // so a later call (a second place, or a cleared terrain) must be able to
  // invalidate an earlier one's eventual state updates rather than racing it.
  const buildingsReqRef = useRef(0);
  /** Fetch context footprints for a bbox. Deliberately swallows its error into
   * `buildingsError`: a failed backdrop must never roll back a good terrain
   * load (Overpass is slow and rate-limits). Declared ahead of `applyScene`,
   * which re-fetches from a loaded document's saved bbox. */
  const loadContextBuildings = useCallback(
    async (box: LngLatBBox, a: GeoAnchor) => {
      const token = ++buildingsReqRef.current;
      setBuildingsError(null);
      setBuildingsInfo(null);
      setBuildingsLoading(true);
      try {
        const res = await fetch("/api/buildings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bbox: box, anchor: a }),
        });
        const json = (await res.json()) as {
          buildings?: ContextBuilding[];
          truncated?: boolean;
          total?: number;
          error?: string;
        };
        if (!res.ok || !json.buildings) throw new Error(json.error ?? `HTTP ${res.status}`);
        // A newer call (second place, or a clear) superseded this one while
        // it was in flight — drop the response rather than letting it land.
        if (buildingsReqRef.current !== token) return;
        setContextBuildings(json.buildings);
        setBuildingsInfo({ truncated: !!json.truncated, total: json.total ?? json.buildings.length });
      } catch (e) {
        if (buildingsReqRef.current !== token) return;
        setContextBuildings([]);
        setBuildingsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (buildingsReqRef.current === token) setBuildingsLoading(false);
      }
    },
    [],
  );

  /** Restore the demo backdrop from the committed fixture. The terrain and
   * street network already live in the serialized scene; only context
   * footprints are intentionally omitted for localStorage size. */
  const loadDemoContextBuildings = useCallback(async () => {
    const token = ++buildingsReqRef.current;
    setBuildingsError(null);
    setBuildingsInfo(null);
    setBuildingsLoading(true);
    try {
      const res = await fetch(DEMO_BUILDINGS_URL);
      const json = (await res.json()) as {
        buildings?: ContextBuilding[];
        truncated?: boolean;
        total?: number;
      };
      if (!res.ok || !json.buildings)
        throw new Error(`buildings fixture: HTTP ${res.status}`);
      if (buildingsReqRef.current !== token) return;
      setContextBuildings(json.buildings);
      setBuildingsInfo({
        truncated: !!json.truncated,
        total: json.total ?? json.buildings.length,
      });
    } catch (e) {
      if (buildingsReqRef.current !== token) return;
      setContextBuildings([]);
      setBuildingsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (buildingsReqRef.current === token) setBuildingsLoading(false);
    }
  }, []);

  // Request token for `loadStreets`, same reasoning as `buildingsReqRef`.
  const streetsReqRef = useRef(0);
  const [streetsLoading, setStreetsLoading] = useState(false);
  const [streetsError, setStreetsError] = useState<string | null>(null);
  const [streetsInfo, setStreetsInfo] = useState<{ truncated: boolean; total: number } | null>(null);
  // The user's buildingsFromStreets preference from BEFORE the first import
  // in a run — stashed below right before an import forces it off, restored
  // by handleClearTerrain once the imported streets are gone. Default mirrors
  // buildingsFromStreets' own initial value, so a Clear Terrain before any
  // import is a no-op.
  const buildingsFromStreetsStashRef = useRef(true);

  /** Fetch real streets + canals for a bbox and adopt them as the network.
   * Like the buildings loader, this deliberately swallows its error: a failed
   * street import must never roll back a good terrain load. */
  const loadStreets = useCallback(async (box: LngLatBBox, a: GeoAnchor) => {
    const token = ++streetsReqRef.current;
    setStreetsError(null);
    setStreetsInfo(null);
    setStreetsLoading(true);
    try {
      const res = await fetch("/api/streets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bbox: box, anchor: a }),
      });
      const json = (await res.json()) as {
        streets?: Street[]; truncated?: boolean; total?: number; error?: string;
      };
      if (!res.ok || !json.streets) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (streetsReqRef.current !== token) return;
      reserveStreetIds(json.streets);
      // Importing REPLACES the network (consistent with terrain and context
      // buildings being replaced); appending would duplicate on a second load
      // of the same place.
      setStreetNetwork({ ...EMPTY_NETWORK, streets: json.streets });
      setStreetsInfo({ truncated: !!json.truncated, total: json.total ?? json.streets.length });
      // syncStreetBlocks would otherwise generate parametric frontage
      // buildings along EVERY imported street — thousands of lots on top of
      // the real footprints already loaded as context. Stash the user's real
      // preference only when no import is ALREADY live (hasImportedStreets
      // reflects the network from before this fetch replaced it) — a second
      // "Load place" on top of an existing import must not overwrite the
      // stash with the already-forced-off value.
      if (!hasImportedStreets) {
        setBuildingsFromStreets((prev) => {
          buildingsFromStreetsStashRef.current = prev;
          return false;
        });
      } else {
        setBuildingsFromStreets(false);
      }
    } catch (e) {
      if (streetsReqRef.current !== token) return;
      setStreetsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (streetsReqRef.current === token) setStreetsLoading(false);
    }
  }, [hasImportedStreets]);

  /** Replace the whole scene from a loaded document. Re-syncs corners
   * defensively (idempotent for clean saves; repairs hand-edited files) and
   * bumps the block-id counter so newly-drawn blocks can't collide. */
  const applyScene = useCallback((s: SceneState) => {
    const normalizedStreetNetwork = {
      ...s.streetNetwork,
      streets: normalizeImportedStreetWidths(s.streetNetwork.streets),
    };
    placeLoadLockRef.current =
      s.ground.hf !== undefined ||
      s.anchor !== null ||
      s.bbox !== null ||
      normalizedStreetNetwork.streets.some((street) =>
        street.id.startsWith("street-osm-"),
      );
    reserveBlockIds(s.blocks);
    reserveStreetIds(normalizedStreetNetwork.streets);
    setBlocks(syncCorners(s.blocks, s.cornerChoices, s.maxCornerAngle));
    setCornerChoices(s.cornerChoices);
    setGround(s.ground);
    setAnchor(s.anchor);
    setBbox(s.bbox);
    setHiddenIds(s.hiddenIds);
    setContextBuildings([]);
    setBuildingsError(null);
    setBuildingsInfo(null);
    // Invalidate any in-flight buildings fetch from the scene being replaced
    // (same race handleClearTerrain guards against) — bump BEFORE the
    // conditional re-fetch below so, when the loaded doc has a bbox, the
    // fresh fetch's own token bump still wins and the stale fetch's `finally`
    // becomes a no-op; when it doesn't, this bump+reset is the only thing
    // that stops the stale fetch from resolving onto a bbox-less scene.
    buildingsReqRef.current++;
    setBuildingsLoading(false);
    // Footprints are not in the document. The committed demo must remain
    // offline across refreshes; arbitrary real places re-fetch from Overpass.
    if (isDemoPlaceFrame(s.bbox, s.anchor)) void loadDemoContextBuildings();
    else if (s.bbox && s.anchor) void loadContextBuildings(s.bbox, s.anchor);
    setStreetWidth(s.streetWidth);
    setMaxCornerAngle(s.maxCornerAngle);
    // Invalidate any in-flight streets fetch too — the loaded document's own
    // streetNetwork is adopted directly below (no re-fetch to race it), so a
    // still-arriving import must not clobber it a few seconds later.
    streetsReqRef.current++;
    setStreetsLoading(false);
    setStreetsError(null);
    setStreetsInfo(null);
    setStreetNetwork(normalizedStreetNetwork);
    setSelected(
      s.blocks.length > 0
        ? { blockId: s.blocks[0].id, lot: 0, level: "block" }
        : null,
    );
    setSelectedStreet(null);
    setSelectedIntersection(null);
    setSelectedSquare(null);
  }, [loadContextBuildings, loadDemoContextBuildings]);

  const handleSave = useCallback(() => {
    const text = toJSON({
      blocks,
      cornerChoices,
      ground,
      streetWidth,
      maxCornerAngle,
      streetNetwork,
      anchor,
      bbox,
      hiddenIds,
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
  }, [blocks, cornerChoices, ground, streetWidth, maxCornerAngle, streetNetwork, anchor, bbox, hiddenIds]);

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

  /** "Load place": fetch a real heightfield for the picked bbox and adopt it
   * as the ground, replacing the manual flat/tilted plane. */
  const handleLoadPlace = useCallback(async (bbox: LngLatBBox) => {
    if (placeLoadLockRef.current || hasLoadedPlace) return;
    placeLoadLockRef.current = true;
    let adopted = false;
    setTerrainError(null);
    setTerrainLoading(true);
    try {
      const a = anchorOf(bbox);
      const res = await fetch("/api/terrain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bbox, anchor: a }),
      });
      const json = (await res.json()) as { heightfield?: Heightfield; error?: string };
      if (!res.ok || !json.heightfield) throw new Error(json.error ?? `HTTP ${res.status}`);
      setGround((g) => ({ ...g, hf: json.heightfield }));
      setAnchor(a);
      setBbox(bbox);
      setHiddenIds(new Set());
      setPickerOpen(false);
      adopted = true;
      void loadContextBuildings(bbox, a);
      void loadStreets(bbox, a);
    } catch (e) {
      setTerrainError(e instanceof Error ? e.message : String(e));
    } finally {
      // A failed request may be retried. A successful one stays locked until
      // Clear terrain removes the loaded place from this scene.
      if (!adopted) placeLoadLockRef.current = false;
      setTerrainLoading(false);
    }
  }, [hasLoadedPlace, loadContextBuildings, loadStreets]);

  /** Drop the loaded heightfield, reverting to the manual flat/tilted plane
   * (the Topography sliders reappear). */
  const handleClearTerrain = useCallback(() => {
    placeLoadLockRef.current = false;
    // Invalidate any in-flight buildings fetch — otherwise it can resolve
    // after this clear and repopulate contextBuildings on a bbox-less scene.
    // Also reset buildingsLoading directly: bumping the token makes the
    // in-flight fetch's own `finally` a no-op (stale token), so nothing else
    // would ever clear the flag — it would otherwise stay stuck `true` and
    // resurface as a permanent "Loading buildings…" if a later document
    // (bbox valid, anchor missing/malformed — deserializeScene validates them
    // independently) repopulates `bbox` without starting a new fetch.
    buildingsReqRef.current++;
    setBuildingsLoading(false);
    // Same reasoning for the streets fetch: bumping the token alone leaves
    // an in-flight loader's own `finally` a no-op (stale token), so
    // `streetsLoading` must be reset here directly too.
    streetsReqRef.current++;
    setStreetsLoading(false);
    setStreetsError(null);
    setStreetsInfo(null);
    // Surgical, not wholesale: drop only IMPORTED streets (the `street-osm-`
    // id prefix loadStreets/src/lib/geo/streets.ts stamps on every fetched
    // street) so hand-drawn streets survive "Clear terrain" the same way
    // hand-drawn blocks already do — this button means "drop the loaded
    // heightfield", not "delete my drawings". Pruning roundabouts/square
    // monuments afterward drops any that would otherwise dangle on a
    // removed junction.
    setStreetNetwork((n) =>
      pruneSquareMonuments(
        pruneRoundabouts({
          ...n,
          streets: n.streets.filter((s) => !s.id.startsWith("street-osm-")),
        }),
      ),
    );
    // Restore the user's pre-import Auto-buildings preference now that the
    // imported streets are gone — but only if an import had actually forced
    // it off (hasImportedStreets reflects the network from before the filter
    // above ran); otherwise this would silently override a preference the
    // user set by hand before ever loading a place.
    if (hasImportedStreets) {
      setBuildingsFromStreets(buildingsFromStreetsStashRef.current);
    }
    setGround((g) => ({ slope: g.slope, azimuth: g.azimuth })); // drop hf
    setAnchor(null);
    setBbox(null);
    setContextBuildings([]);
    setHiddenIds(new Set());
    setBuildingsError(null);
    setBuildingsInfo(null);
  }, [hasImportedStreets]);

  /** "Demo place": adopt the committed Amsterdam fixture as the scene, byte-
   * for-byte the same end state "Load place" would leave for that bbox — but
   * fetching the three static /fixtures/*.json files instead of hitting
   * Overpass/AWS. Reuses the same state shape and the same buildingsFromStreets
   * pre-import stash loadStreets uses (mirrored inline since there is no
   * server round-trip to await). */
  const handleLoadDemoPlace = useCallback(async () => {
    if (placeLoadLockRef.current || hasLoadedPlace) return;
    placeLoadLockRef.current = true;
    let adopted = false;
    // Bump BOTH tokens before touching any state — an in-flight real
    // Overpass/terrain fetch from an earlier "Load place" must not be able
    // to land after this and clobber the demo (same race loadContextBuildings
    // / loadStreets / handleClearTerrain guard against).
    const bToken = ++buildingsReqRef.current;
    const sToken = ++streetsReqRef.current;
    setTerrainError(null);
    setDemoError(null);
    setDemoLoading(true);
    setBuildingsLoading(true);
    setBuildingsError(null);
    setBuildingsInfo(null);
    setStreetsLoading(true);
    setStreetsError(null);
    setStreetsInfo(null);
    try {
      const [terrainRes, buildingsRes, streetsRes] = await Promise.all([
        fetch(DEMO_TERRAIN_URL),
        fetch(DEMO_BUILDINGS_URL),
        fetch(DEMO_STREETS_URL),
      ]);
      const [terrainJson, buildingsJson, streetsJson] = (await Promise.all([
        terrainRes.json(),
        buildingsRes.json(),
        streetsRes.json(),
      ])) as [
        { heightfield?: Heightfield },
        { buildings?: ContextBuilding[]; truncated?: boolean; total?: number },
        { streets?: Street[]; truncated?: boolean; total?: number },
      ];
      if (!terrainRes.ok || !terrainJson.heightfield)
        throw new Error(`terrain fixture: HTTP ${terrainRes.status}`);
      if (!buildingsRes.ok || !buildingsJson.buildings)
        throw new Error(`buildings fixture: HTTP ${buildingsRes.status}`);
      if (!streetsRes.ok || !streetsJson.streets)
        throw new Error(`streets fixture: HTTP ${streetsRes.status}`);

      // A newer call (a real "Load place", another demo click, or a clear)
      // superseded this one while the fetches were in flight — drop it.
      if (buildingsReqRef.current !== bToken || streetsReqRef.current !== sToken)
        return;

      const normalizedStreets = normalizeImportedStreetWidths(
        streetsJson.streets,
      );
      reserveStreetIds(normalizedStreets);
      setGround((g) => ({ ...g, hf: terrainJson.heightfield! }));
      setAnchor(DEMO_ANCHOR);
      setBbox(DEMO_BBOX);
      setHiddenIds(new Set());
      setPickerOpen(false);
      adopted = true;

      setContextBuildings(buildingsJson.buildings);
      setBuildingsInfo({
        truncated: !!buildingsJson.truncated,
        total: buildingsJson.total ?? buildingsJson.buildings.length,
      });

      // Importing REPLACES the network, same as loadStreets.
      setStreetNetwork({ ...EMPTY_NETWORK, streets: normalizedStreets });
      setStreetsInfo({
        truncated: !!streetsJson.truncated,
        total: streetsJson.total ?? streetsJson.streets.length,
      });

      // Same stash-then-force-off dance loadStreets does, so "Clear terrain"
      // restores the user's real preference afterward.
      if (!hasImportedStreets) {
        setBuildingsFromStreets((prev) => {
          buildingsFromStreetsStashRef.current = prev;
          return false;
        });
      } else {
        setBuildingsFromStreets(false);
      }
    } catch (e) {
      if (buildingsReqRef.current === bToken && streetsReqRef.current === sToken)
        setDemoError(e instanceof Error ? e.message : String(e));
    } finally {
      if (buildingsReqRef.current === bToken) setBuildingsLoading(false);
      if (streetsReqRef.current === sToken) setStreetsLoading(false);
      if (!adopted) placeLoadLockRef.current = false;
      setDemoLoading(false);
    }
  }, [hasImportedStreets, hasLoadedPlace]);

  /** Demolish one context building (click-to-hide), wired to ContextBuildings'
   * onHide via FacadeViewer/SceneContents (gated behind the Select tool). */
  const handleHideContextBuilding = useCallback((id: string) => {
    setHiddenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  /** Bring every demolished context building back — a hidden one cannot be
   * clicked again, so this is the only way out. */
  const handleRestoreHidden = useCallback(() => setHiddenIds(new Set()), []);

  /** Context buildings suppressed because they were PROMOTED. Derived from the
   * blocks, never stored — which is what stops "Restore hidden" resurrecting a
   * grey copy on top of a promoted block, and makes deleting a promoted block
   * bring the real building back, a natural undo with no undo stack. */
  const promotedSources = useMemo(
    () =>
      new Set(
        blocks
          .map((b) => b.parcel?.source)
          .filter((s): s is string => s !== undefined),
      ),
    [blocks],
  );

  /** What the backdrop actually hides: demolished PLUS promoted. `hiddenIds`
   * alone still drives the Restore-hidden count, so restoring only ever brings
   * back things the user demolished. */
  const suppressedIds = useMemo(() => {
    if (promotedSources.size === 0) return hiddenIds;
    const next = new Set(hiddenIds);
    for (const id of promotedSources) next.add(id);
    return next;
  }, [hiddenIds, promotedSources]);

  const selectedContextObj = useMemo(
    () =>
      selectedContextBuilding
        ? (contextBuildings.find((b) => b.id === selectedContextBuilding) ?? null)
        : null,
    [selectedContextBuilding, contextBuildings],
  );

  /** The plot geometry promotion WOULD use. Goes through parcelPreview, the
   * same helper promoteParcel itself builds on, so the panel and the result
   * cannot disagree and the depth clamp is not duplicated. Critically it is
   * PURE: promoteParcel allocates a block id, so calling it from a render-time
   * memo would bump the id counter on every render. */
  const promotePreview = useMemo(
    () =>
      selectedContextObj
        ? parcelPreview(selectedContextObj, streetNetwork)
        : null,
    [selectedContextObj, streetNetwork],
  );

  /** Promote the selected footprint into an editable block. */
  const handlePromoteContextBuilding = useCallback(() => {
    if (!selectedContextObj) return;
    const block = promoteParcel(
      selectedContextObj,
      streetNetwork,
      DEFAULT_GEN,
      Math.floor(Math.random() * 1e9),
    );
    if (!block) return;
    // Every block mutation funnels through syncCorners, so a promoted block
    // joins corner detection the moment it lands.
    setBlocks((bs) => syncCorners([...bs, block], cornerChoices, maxCornerAngle));
    setSelectedContextBuilding(null);
    setSelected({ blockId: block.id, lot: 0, level: "block" });
  }, [selectedContextObj, streetNetwork, cornerChoices, maxCornerAngle]);

  // Restore the autosave once on mount (survives refresh/crash). Guarded so
  // Strict Mode's double-invoke can't apply it twice.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return;
    const res = fromJSON(saved);
    // Content = hand-drawn blocks/streets OR a loaded real place (terrain
    // `ground.hf` and/or context-buildings `bbox`) — see sceneHasContent.
    if (res.ok && sceneHasContent(res.scene)) applyScene(res.scene);
    else window.localStorage.removeItem(AUTOSAVE_KEY);
  }, [applyScene]);

  // Debounced autosave — one write 500 ms after the last change, so live
  // node drags don't hammer localStorage every frame. Emptying a scene
  // clears the key so a refresh doesn't resurrect deleted buildings — but
  // ONLY after the scene has actually held content this session, so the
  // mount-time empty pass can't wipe a good save before restore lands.
  // "Content" is blocks/streets OR a loaded real place — a terrain
  // heightfield (`ground.hf`) and/or a context-buildings bbox (`bbox`) are
  // real scene state (Milestone 1/2) worth restoring on refresh even before
  // any block is drawn on top of them, so they must count too (otherwise a
  // place-only scene is silently never autosaved). See sceneHasContent.
  const everHadContentRef = useRef(false);
  useEffect(() => {
    if (!sceneHasContent({ blocks, streetNetwork, ground, bbox })) {
      if (everHadContentRef.current) window.localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }
    everHadContentRef.current = true;
    const id = window.setTimeout(() => {
      // Compact, not pretty-printed: nothing reads this by eye, and the
      // indented form of a real-city scene measured 2.79 MB — past Chrome's
      // ~5 MB UTF-16 budget. See toCompactJSON.
      const text = toCompactJSON({
        blocks,
        cornerChoices,
        ground,
        streetWidth,
        maxCornerAngle,
        streetNetwork,
        anchor,
        bbox,
        hiddenIds,
      });
      // A full quota must NEVER take the editor down: this runs in a timeout,
      // so an uncaught QuotaExceededError escapes as an unhandled error and
      // kills the React tree. The scene is still in memory and Save still
      // works, so degrading to "no autosave" is the correct failure.
      try {
        window.localStorage.setItem(AUTOSAVE_KEY, text);
      } catch {
        try {
          // The stale value is itself occupying the quota — free it and retry
          // once, which succeeds whenever the new scene is no bigger.
          window.localStorage.removeItem(AUTOSAVE_KEY);
          window.localStorage.setItem(AUTOSAVE_KEY, text);
        } catch (err) {
          console.warn(
            "Autosave skipped — scene too large for localStorage.",
            err,
          );
        }
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [blocks, cornerChoices, ground, streetWidth, maxCornerAngle, streetNetwork, anchor, bbox, hiddenIds]);

  const selectedBlock = selected
    ? (blocks.find((b) => b.id === selected.blockId) ?? null)
    : null;
  const selectedLot = selectedBlock
    ? selectedBlock.lots[Math.min(selected!.lot, selectedBlock.lots.length - 1)]
    : null;
  const params = selectedLot ? selectedLot.params : null;

  // The street inspector's data: null when nothing (or a since-deleted
  // street) is selected.
  const selectedStreetObj = useMemo(
    () =>
      selectedStreet
        ? (streetNetwork.streets.find((s) => s.id === selectedStreet) ?? null)
        : null,
    [selectedStreet, streetNetwork.streets],
  );

  // The intersection inspector's data: the derived junction + its current
  // roundabout choice (null → no roundabout there yet). Falls back to null
  // when the selected key no longer derives (e.g. a node move split it up).
  const intersections = useMemo(
    () => deriveIntersections(streetNetwork),
    [streetNetwork],
  );
  const selectedSquareData = useMemo(() => {
    if (!selectedSquare) return null;
    const sq = deriveSquares(streetNetwork).find(
      (q) => q.streetId === selectedSquare,
    );
    if (!sq) return null;
    const monument =
      (streetNetwork.squares ?? []).find(([id]) => id === selectedSquare)?.[1] ??
      null;
    return { square: sq, monument };
  }, [selectedSquare, streetNetwork]);

  const selectedIntersectionData = useMemo(() => {
    if (!selectedIntersection) return null;
    const it = intersections.find((i) => i.key === selectedIntersection);
    if (!it) return null;
    const monument =
      streetNetwork.roundabouts.find(([k]) => k === it.key)?.[1] ?? null;
    return { intersection: it, monument };
  }, [selectedIntersection, intersections, streetNetwork.roundabouts]);

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
      // ...and any street/intersection selection, so the inspector panel
      // can't show a stale Street/Intersection view under a fresh lot pick.
      setSelectedStreet(null);
      setSelectedIntersection(null);
      setSelectedSquare(null);
      setSelectedContextBuilding(null);
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

  /** M4 — split one lot into a terrace and back. `?? b` keeps the block
   * unchanged if the pure op declines; the buttons below only render when it
   * would succeed, so that is belt-and-braces. */
  const handleSubdivide = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => subdivideBlock(b, seed) ?? b);
  }, [updateSelectedBlock]);

  const handleMerge = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9);
    updateSelectedBlock((b) => mergeBlock(b, seed) ?? b);
  }, [updateSelectedBlock]);

  /** Availability mirrors subdivideBlock / mergeBlock's own guards exactly, so
   * a button is never offered for an operation that would return null. */
  const canSubdivide =
    !!selectedBlock &&
    selectedBlock.lots.length === 1 &&
    blockFrame(selectedBlock).length >= 2 * selectedBlock.gen.lotWidth.min;

  const canMerge =
    !!selectedBlock &&
    selectedBlock.lots.length > 1 &&
    !selectedBlock.lots.some((l) => l.customized);

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
      setSelectedStreet(null);
      setSelectedIntersection(null);
      setSelectedSquare(null);
    },
    [blocks],
  );

  const handleMarqueeClear = useCallback(() => setMarquee(null), []);

  /** Drop every kind of selection without touching the scene. The viewer calls
   * this whenever the Select tool goes off — nothing stays selected outside
   * selection mode. (handleClearAll wipes the scene too; this is selection
   * only.) */
  const handleClearSelection = useCallback(() => {
    setSelected(null);
    setSelectedStreet(null);
    setSelectedIntersection(null);
    setSelectedSquare(null);
    setSelectedContextBuilding(null);
    setMarquee(null);
  }, []);

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

  const handleDeleteStreet = useCallback((id: string) => {
    setStreetNetwork((n) =>
      pruneSquareMonuments(
        pruneRoundabouts({ ...n, streets: n.streets.filter((s) => s.id !== id) }),
      ),
    );
    setSelectedStreet(null);
  }, []);

  /** Backspace mid-chain in the pen: remove the just-committed segment's
   * block (the chain anchor rewinds in PenSurface). Same corner re-sync as
   * every block removal. */
  const handleUndoSegment = useCallback(
    (blockId: string) => {
      setBlocks((bs) =>
        syncCorners(
          bs.filter((b) => b.id !== blockId),
          cornerChoices,
          maxCornerAngle,
        ),
      );
      setSelected((s) => (s?.blockId === blockId ? null : s));
    },
    [cornerChoices, maxCornerAngle],
  );

  /** Wipe the whole scene (the Select-mode Clear-all button; the button
   * itself carries the two-step confirm). Content only — view settings,
   * ground and street width survive. Also drops the autosave so a refresh
   * doesn't resurrect the cleared scene. */
  const handleClearAll = useCallback(() => {
    setBlocks([]);
    setCornerChoices(new Map());
    setStreetNetwork(EMPTY_NETWORK);
    setSelected(null);
    setSelectedStreet(null);
    setSelectedIntersection(null);
    setSelectedSquare(null);
    setMarquee(null);
    // Invalidate any in-flight streets/buildings fetch — otherwise it can
    // resolve after this clear and repopulate the just-wiped network (or the
    // truncation/error banners) a few seconds later (same race
    // handleClearTerrain guards against).
    streetsReqRef.current++;
    setStreetsLoading(false);
    setStreetsError(null);
    setStreetsInfo(null);
    buildingsReqRef.current++;
    setBuildingsLoading(false);
    setBuildingsError(null);
    setBuildingsInfo(null);
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // storage unavailable — the state reset above still cleared the scene
    }
  }, []);

  // Computed OUTSIDE the updater so the boolean reaches the drag handler
  // synchronously (mirrors handleMoveNode). moveStreetNode is pure and moves
  // welded junction copies together; derived frontage blocks refit via the
  // streetNetwork effect below — no extra plumbing here.
  const handleMoveStreetNode = useCallback(
    (from: [number, number], to: [number, number]) => {
      const next = moveStreetNode(streetNetwork, from, to);
      if (next) setStreetNetwork(next);
      return next !== null;
    },
    [streetNetwork],
  );

  // Delete/Backspace removes the selection: the selected lot (street refits,
  // length preserved) or the whole block at block level / last lot, or a
  // selected road-network street. Direct — no two-step confirm for keyboard
  // deletion. Skipped while typing.
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
        setSelectedStreet(null);
        setSelectedIntersection(null);
        setSelectedSquare(null);
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
      // A selected road-network street deletes too (parity with lots/blocks;
      // roundabouts on the removed street's junctions are pruned).
      if (selectedStreet) {
        e.preventDefault();
        handleDeleteStreet(selectedStreet);
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
    selectedStreet,
    handleDeleteStreet,
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
      setSelectedStreet(null);
      setSelectedIntersection(null);
      setSelectedSquare(null);
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
  const handleCommitStreet = useCallback(
    (type: StreetType, points: Vec2[], closed?: boolean) => {
      setStreetNetwork((n) => ({
        ...n,
        streets: [
          ...n.streets,
          { id: nextStreetId(), type, points, ...(closed ? { closed: true } : {}) },
        ],
      }));
    },
    [],
  );

  // ── Street network selection + inspector edits ───────────────────────────
  const handleSelectStreet = useCallback((id: string) => {
    setSelected(null);
    setMarquee(null);
    setSelectedIntersection(null);
    setSelectedSquare(null);
    setSelectedStreet(id);
  }, []);

  const handleSelectSquare = useCallback((streetId: string) => {
    setSelected(null);
    setSelectedStreet(null);
    setSelectedIntersection(null);
    setSelectedSquare(streetId);
  }, []);

  const handleSetSquareMonument = useCallback(
    (streetId: string, m: Monument | null) => {
      setStreetNetwork((n) => {
        const rest = (n.squares ?? []).filter(([id]) => id !== streetId);
        return {
          ...n,
          squares: m ? [...rest, [streetId, m] as [string, Monument]] : rest,
        };
      });
    },
    [],
  );

  const handleSelectIntersection = useCallback((key: string) => {
    setSelected(null);
    setMarquee(null);
    setSelectedStreet(null);
    setSelectedIntersection(key);
  }, []);

  const handleStreetChange = useCallback((next: Street) => {
    setStreetNetwork((n) => ({
      ...n,
      streets: n.streets.map((s) => (s.id === next.id ? next : s)),
    }));
  }, []);

  /** Upsert or remove the roundabout at one derived-intersection key. A null
   * monument removes the entry (roundabout off); a Monument sets/replaces it
   * (turning the roundabout on, or swapping the monument kind). */
  const handleSetRoundabout = useCallback(
    (key: string, monument: Monument | null) => {
      setStreetNetwork((n) => ({
        ...n,
        roundabouts: monument
          ? [...n.roundabouts.filter(([k]) => k !== key), [key, monument]]
          : n.roundabouts.filter(([k]) => k !== key),
      }));
    },
    [],
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

  // Derive frontage blocks from the street network whenever it (or the
  // corner settings that its miters depend on) changes — covers drawing,
  // moving, retyping, and deleting streets without per-handler plumbing.
  // The functional setBlocks reads `blocks` fresh each call, so `blocks`
  // itself is deliberately NOT a dependency (that would loop). The guard
  // keeps a pure hand-drawn / empty scene byte-identical (same reference in
  // → same reference out → React bails the re-render).
  useEffect(() => {
    // Imported networks can contain hundreds of streets and produce thousands
    // of lots. The control is disabled for them, so restored state must not
    // bypass that UI invariant and regenerate an entire city.
    if (!buildingsFromStreets || hasImportedStreets) return;
    setBlocks((cur) => {
      if (streetNetwork.streets.length === 0 && !cur.some((b) => b.source))
        return cur;
      return syncStreetBlocks(streetNetwork, cur, {
        gen: DEFAULT_GEN,
        maxCornerAngle,
        cornerChoices,
      });
    });
  }, [
    streetNetwork,
    buildingsFromStreets,
    hasImportedStreets,
    maxCornerAngle,
    cornerChoices,
  ]);

  // While auto-buildings are OFF, keep derived blocks stripped — not just at
  // the moment of toggling off, but whenever a source-tagged block could
  // appear (e.g. Loading a file that contains a street network + its derived
  // blocks). Reacting to streetNetwork too closes the "toggle says off but a
  // loaded file's auto-buildings still show" desync. The same-ref guard keeps
  // it loop-free (nothing to strip → same array → no re-render).
  // NOTE: toggling off is destructive — a hand-customized auto-building is
  // removed and re-toggling on regenerates a fresh one. The toggle is an
  // "auto-buildings on/off" switch, not a hide/show of edited state.
  useEffect(() => {
    if (buildingsFromStreets && !hasImportedStreets) return;
    setBlocks(stripStreetBlocks);
  }, [buildingsFromStreets, hasImportedStreets, streetNetwork]);

  // A loaded/autosaved document can restore imported streets before the
  // transient toggle state settles. Keep the disabled control truthful and
  // ensure the stripped state is what the next autosave persists.
  useEffect(() => {
    if (hasImportedStreets) setBuildingsFromStreets(false);
  }, [hasImportedStreets]);

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
      setSelectedStreet(null);
      setSelectedIntersection(null);
      setSelectedSquare(null);
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
      <header className="flex h-12 shrink-0 items-center gap-4 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel-bg)] px-3">
        <div className="flex min-w-max items-center gap-2">
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
          <span className="ml-1 hidden text-[11px] text-[var(--muted)] xl:inline">
            parametric streets &amp; façades
          </span>
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
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <button
            type="button"
            onClick={() => {
              if (placeLoadBlocked) return;
              setTerrainError(null);
              setPickerOpen(true);
            }}
            disabled={placeLoadBlocked}
            title={
              hasLoadedPlace
                ? "Clear terrain before loading another place"
                : terrainLoading || demoLoading
                  ? "A place is already loading"
                  : "Choose a real place to load"
            }
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--muted)] disabled:hover:border-[var(--border)]"
          >
            Load place
          </button>
          <button
            type="button"
            onClick={handleLoadDemoPlace}
            disabled={placeLoadBlocked}
            title={
              hasLoadedPlace
                ? "Clear terrain before loading another place"
                : terrainLoading || demoLoading
                  ? "A place is already loading"
                  : "Load a committed Amsterdam snapshot — terrain, buildings and streets with no network calls"
            }
            className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {demoLoading ? "Loading demo…" : "Demo place"}
          </button>
          {demoError && (
            <span className="text-[11px] text-red-400" role="alert">
              {demoError}
            </span>
          )}
          {ground.hf && (
            <button
              type="button"
              onClick={handleClearTerrain}
              className="text-[11px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30 transition-colors"
            >
              Clear terrain
            </button>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <button
            type="button"
            onClick={() => setBuildingsFromStreets((v) => !v)}
            aria-pressed={buildingsFromStreets}
            disabled={hasImportedStreets}
            title={
              hasImportedStreets
                ? "Disabled while a real place is loaded — generating frontages for every imported street would create thousands of lots"
                : "Auto-populate editable buildings along drawn streets"
            }
            className={`text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              buildingsFromStreets
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)]/30"
            }`}
          >
            Auto-buildings
          </button>
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          <div
            role="group"
            aria-label="Building display mode"
            className="flex items-center rounded border border-[var(--border)] overflow-hidden text-[11px]"
          >
            {(
              [
                ["full", "Full"],
                ["massing", "Massing"],
                ["outline", "Outline"],
                ["off", "Buildings off"],
              ] as const
            ).map(([mode, label], i) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDisplay(mode)}
                aria-pressed={display === mode}
                className={`px-2 py-0.5 transition-colors ${
                  i > 0 ? "border-l border-[var(--border)]" : ""
                } ${
                  display === mode
                    ? "text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-3 text-[11px] text-[var(--muted)] font-mono 2xl:flex">
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
            onMoveStreetNode={handleMoveStreetNode}
            onUndoSegment={handleUndoSegment}
            onClearAll={handleClearAll}
            cornerChoices={cornerChoices}
            display={display}
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
            selectedStreet={selectedStreet}
            onSelectStreet={handleSelectStreet}
            selectedIntersection={selectedIntersection}
            onSelectIntersection={handleSelectIntersection}
            selectedSquare={selectedSquare}
            onSelectSquare={handleSelectSquare}
            onClearSelection={handleClearSelection}
            contextBuildings={contextBuildings}
            hiddenIds={suppressedIds}
            contextVisible={contextVisible}
            selectedContextBuilding={selectedContextBuilding}
            onSelectContextBuilding={setSelectedContextBuilding}
          />
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--panel-bg)] overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Context (M2) is rendered above the selection ternary — the
             * primary flow is "load a place, look at the backdrop" with
             * nothing selected, so it must not depend on what (if anything)
             * is selected below. Gated internally on `contextLoaded`. */}
            <ContextPanel
              contextLoaded={!!bbox}
              contextCount={contextBuildings.length}
              contextVisible={contextVisible}
              onToggleContext={() => setContextVisible((v) => !v)}
              contextTruncated={!!buildingsInfo?.truncated}
              contextTotal={buildingsInfo?.total ?? 0}
              contextLoading={buildingsLoading}
              contextError={buildingsError}
              hiddenCount={hiddenIds.size}
              onRestoreHidden={handleRestoreHidden}
              streetCount={streetNetwork.streets.length}
              streetsLoading={streetsLoading}
              streetsTruncated={!!streetsInfo?.truncated}
              streetsTotal={streetsInfo?.total ?? 0}
              streetsError={streetsError}
            />
            {/* M4 inspector — also above the selection ternary, for the same
             * reason: the flow is "load a place, click a building" with no
             * block selected. */}
            {selectedContextObj && (
              <ContextBuildingPanel
                id={selectedContextObj.id}
                area={parcelArea(selectedContextObj.footprint)}
                vertices={selectedContextObj.footprint.length}
                preview={promotePreview}
                onPromote={handlePromoteContextBuilding}
                onDemolish={() => {
                  handleHideContextBuilding(selectedContextObj.id);
                  setSelectedContextBuilding(null);
                }}
                onClose={() => setSelectedContextBuilding(null)}
              />
            )}
            {marquee ? (
              <MarqueeControls
                marquee={marquee}
                onDelete={handleMarqueeDelete}
                onReroll={handleMarqueeReroll}
                onApply={handleMarqueeApply}
                onClear={handleMarqueeClear}
              />
            ) : selectedStreetObj ? (
              <StreetInspector
                street={selectedStreetObj}
                advisory={
                  canalGradeAdvisory(selectedStreetObj, ground) ??
                  streetAdvisory(selectedStreetObj)
                }
                onChange={handleStreetChange}
                onDelete={() => handleDeleteStreet(selectedStreetObj.id)}
              />
            ) : selectedIntersectionData ? (
              <IntersectionInspector
                monument={selectedIntersectionData.monument}
                onSetRoundabout={(m) =>
                  handleSetRoundabout(
                    selectedIntersectionData.intersection.key,
                    m,
                  )
                }
              />
            ) : selectedSquareData ? (
              <SquareInspector
                monument={selectedSquareData.monument}
                area={selectedSquareData.square.area}
                onSetMonument={(m) =>
                  handleSetSquareMonument(selectedSquareData.square.streetId, m)
                }
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
                  canSubdivide={canSubdivide}
                  canMerge={canMerge}
                  onSubdivide={handleSubdivide}
                  onMerge={handleMerge}
                  corner={selectedCorner}
                  onCornerChoice={handleCornerChoice}
                  maxCornerAngle={maxCornerAngle}
                  onMaxCornerAngle={setMaxCornerAngle}
                  ground={ground}
                  onGroundChange={setGround}
                  terrainImported={!!ground.hf}
                  streetWidth={streetWidth}
                  onStreetWidth={setStreetWidth}
                />
              </>
            ) : (
              <div className="text-sm text-[var(--muted)] leading-relaxed space-y-2 p-1">
                <div className="font-medium text-[var(--foreground)]">
                  Draw a street
                </div>
                <p>
                  Pick the 🛣 Roads tool in the Plan pane and click to place
                  vertices, Escape to finish, click the first vertex to close a
                  loop. Click any street to edit or delete it (or select it and
                  press Delete).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <PlacePicker
          onLoad={handleLoadPlace}
          onCancel={() => setPickerOpen(false)}
          loading={terrainLoading}
          error={terrainError}
        />
      )}
    </div>
  );
}
