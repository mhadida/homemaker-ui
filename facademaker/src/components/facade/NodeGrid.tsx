"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { MeshBasicNodeMaterial } from "three/webgpu";

/** The drei `<Grid>` props SceneContents actually uses. */
export interface NodeGridProps {
  args: [number, number];
  cellSize: number;
  cellThickness: number;
  cellColor: string;
  sectionSize: number;
  sectionThickness: number;
  sectionColor: string;
  fadeDistance: number;
  fadeStrength: number;
  infiniteGrid?: boolean;
  position?: [number, number, number];
}

interface GridModule {
  webgpu: typeof import("three/webgpu");
  tsl: typeof import("three/tsl");
}

let gridModule: GridModule | null = null;
let gridModulePromise: Promise<GridModule> | null = null;

function loadGridModule(): Promise<GridModule> {
  gridModulePromise ??= Promise.all([
    import("three/webgpu"),
    import("three/tsl"),
  ]).then(([webgpu, tsl]) => {
    gridModule = { webgpu, tsl };
    return gridModule;
  });
  return gridModulePromise;
}

const _plane = new THREE.Plane();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3();

/** TSL port of drei's `<Grid>` shader (v10.7.7) for the WebGPU renderer —
 * drei's version is a GLSL ShaderMaterial the node renderer can't compile.
 * Same math: antialiased cell/section lines via `fwidth`, alpha fade with
 * distance from the camera's projection onto the grid plane, `infiniteGrid`
 * scaling the plane in the vertex stage. `followCamera`/`fadeFrom` are not
 * ported (unused here). */
export default function NodeGrid({
  args,
  cellSize,
  cellThickness,
  cellColor,
  sectionSize,
  sectionThickness,
  sectionColor,
  fadeDistance,
  fadeStrength,
  infiniteGrid = false,
  position,
}: NodeGridProps) {
  const [mod, setMod] = useState<GridModule | null>(gridModule);
  useEffect(() => {
    if (mod) return;
    let live = true;
    loadGridModule().then((m) => {
      if (live) setMod(m);
    });
    return () => {
      live = false;
    };
  }, [mod]);

  const meshRef = useRef<THREE.Mesh>(null);

  const built = useMemo(() => {
    if (!mod) return null;
    const { MeshBasicNodeMaterial } = mod.webgpu;
    const { color, float, fwidth, mix, positionGeometry, positionWorld, uniform } =
      mod.tsl;

    // Camera position projected onto the grid plane, updated per frame below
    // (drei does the same via a plain uniform).
    const camProj = uniform(new THREE.Vector3());

    const scale = infiniteGrid ? 1 + fadeDistance : 1;
    // drei's vertex stage: swizzle the XY plane onto XZ and scale it out to
    // cover the fade radius. positionNode is local space; the model matrix
    // still applies, so the tilted-ground group works unchanged.
    const localPosition = positionGeometry.xzy.mul(scale);

    const grid = (size: number, thickness: number) => {
      const r = localPosition.xz.div(size);
      const g = r.sub(0.5).fract().sub(0.5).abs().div(fwidth(r));
      const line = g.x.min(g.y).add(1 - thickness);
      return float(1).sub(line.min(1));
    };
    const g1 = grid(cellSize, cellThickness);
    const g2 = grid(sectionSize, sectionThickness);

    const dist = positionWorld.sub(camProj).length();
    const d = float(1).sub(dist.div(fadeDistance).min(1));
    const baseAlpha = g1.add(g2).mul(d.pow(fadeStrength));

    const material = new MeshBasicNodeMaterial();
    material.positionNode = localPosition;
    material.colorNode = mix(
      color(cellColor),
      color(sectionColor),
      g2.mul(sectionThickness).min(1),
    );
    material.opacityNode = mix(baseAlpha.mul(0.75), baseAlpha, g2);
    material.transparent = true;
    material.side = THREE.BackSide;
    // drei discards fully transparent fragments so the huge plane never
    // writes depth where there is no line.
    material.alphaTest = 1e-4;
    return { material, camProj };
  }, [
    mod,
    cellSize,
    cellThickness,
    cellColor,
    sectionSize,
    sectionThickness,
    sectionColor,
    fadeDistance,
    fadeStrength,
    infiniteGrid,
  ]);

  useEffect(
    () => () => {
      built?.material.dispose();
    },
    [built],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !built) return;
    _plane
      .setFromNormalAndCoplanarPoint(_up, _zero)
      .applyMatrix4(mesh.matrixWorld);
    _plane.projectPoint(
      state.camera.position,
      built.camProj.value as THREE.Vector3,
    );
  });

  if (!built) return null;
  return (
    <mesh
      ref={meshRef}
      position={position}
      frustumCulled={false}
      material={built.material as MeshBasicNodeMaterial}
    >
      <planeGeometry args={args} />
    </mesh>
  );
}
