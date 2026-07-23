"use client";

import { useEffect, useMemo, useState } from "react";
import { Line as DreiLine } from "@react-three/drei";
import type { Line2 } from "three/examples/jsm/lines/webgpu/Line2.js";
import type { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import type { Line2NodeMaterial } from "three/webgpu";
import { isWebGPUPath } from "./webgpu";

/** The prop surface every call site actually uses — a strict subset of drei's
 * `<Line>` so the WebGL path is a pass-through. `segments` treats `points` as
 * independent endpoint pairs instead of a connected polyline. */
export interface NodeLineProps {
  points: ReadonlyArray<readonly number[]>;
  color: string;
  lineWidth?: number;
  segments?: boolean;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
  /** Draw on top of the scene regardless of depth (default true = normal
   * depth test). Transient drawing GUIDES pass false so the world can't
   * occlude them — a flat preview line at y≈0.08 is otherwise hidden wherever
   * it crosses a taller building or ground risen above it in the top-down
   * plan view. */
  depthTest?: boolean;
  depthWrite?: boolean;
  /** Higher = drawn later. Overlays pair a high value with depthTest={false}
   * so they sort above ordinary geometry. */
  renderOrder?: number;
}

interface LinesModule {
  Line2: typeof Line2;
  LineSegments2: typeof LineSegments2;
  Line2NodeMaterial: typeof Line2NodeMaterial;
}

let linesModule: LinesModule | null = null;
let linesModulePromise: Promise<LinesModule> | null = null;

/** `three/webgpu` is large, so it stays out of the default bundle — loaded on
 * demand and shared with the Canvas's own renderer import (same module
 * instance, so no double cost). */
function loadLinesModule(): Promise<LinesModule> {
  linesModulePromise ??= Promise.all([
    import("three/examples/jsm/lines/webgpu/Line2.js"),
    import("three/examples/jsm/lines/webgpu/LineSegments2.js"),
    import("three/webgpu"),
  ]).then(([line2, segments2, webgpu]) => {
    linesModule = {
      Line2: line2.Line2,
      LineSegments2: segments2.LineSegments2,
      Line2NodeMaterial: webgpu.Line2NodeMaterial,
    };
    return linesModule;
  });
  return linesModulePromise;
}

/** Node-material fat line: three's WebGPU `Line2` + `Line2NodeMaterial`.
 * Unlike the classic `LineMaterial` there is no `resolution` uniform to keep
 * in sync — the node material reads the viewport directly. */
function GPULine({
  points,
  color,
  lineWidth = 1,
  segments = false,
  dashed = false,
  dashSize = 1,
  gapSize = 1,
  depthTest = true,
  depthWrite = true,
  renderOrder = 0,
}: NodeLineProps) {
  const [mod, setMod] = useState<LinesModule | null>(linesModule);
  useEffect(() => {
    if (mod) return;
    let live = true;
    loadLinesModule().then((m) => {
      if (live) setMod(m);
    });
    return () => {
      live = false;
    };
  }, [mod]);

  // Style props change rarely (a selection color flip), so the material gets
  // its own memo — point edits below never recompile the render pipeline.
  const material = useMemo(
    () =>
      mod
        ? new mod.Line2NodeMaterial({
            color,
            linewidth: lineWidth,
            dashed,
            dashSize,
            gapSize,
            depthTest,
            depthWrite,
          })
        : null,
    [mod, color, lineWidth, dashed, dashSize, gapSize, depthTest, depthWrite],
  );

  // The line is built fully populated INSIDE the memo: mounting a Line2 with
  // an empty geometry lets the renderer compile the pipeline before
  // `instanceStart`/`instanceEnd` exist, which produces invalid WGSL that
  // stays cached. Never mount an empty line.
  const line = useMemo(() => {
    if (!mod || !material) return null;
    const l = segments
      ? new mod.LineSegments2(undefined, material)
      : new mod.Line2(undefined, material);
    l.geometry.setPositions(points.flatMap((p) => [p[0], p[1], p[2] ?? 0]));
    if (dashed) l.computeLineDistances();
    l.renderOrder = renderOrder;
    return l;
  }, [mod, material, segments, points, dashed, renderOrder]);

  useEffect(
    () => () => {
      material?.dispose();
    },
    [material],
  );
  useEffect(
    () => () => {
      line?.geometry.dispose();
    },
    [line],
  );

  if (!line) return null;
  return <primitive object={line} />;
}

/** Drop-in replacement for drei's `<Line>` during the WebGPU rollout: drei's
 * classic fat line (`LineMaterial`, a ShaderMaterial the node renderer
 * rejects) on the default WebGL path; a node-material `Line2` on the
 * `?webgpu` path. Phase 4 of the migration collapses this to node lines
 * only. */
export default function NodeLine(props: NodeLineProps) {
  if (isWebGPUPath()) return <GPULine {...props} />;
  const { points, ...rest } = props;
  return (
    <DreiLine points={points as unknown as [number, number, number][]} {...rest} />
  );
}
