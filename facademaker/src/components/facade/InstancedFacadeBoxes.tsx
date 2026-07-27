"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  sceneWindowInstances,
  type WorldInstance,
} from "@/lib/facade/instancing";
import type { FacadeBlock } from "@/lib/facade/blocks";
import type { Ground } from "@/lib/facade/terrain";

/** Write every instance's world Matrix4 (position · Y-yaw · box scale) into the
 * mesh; optionally its per-instance colour. Plane glass uses z-scale 1. */
function writeInstances(
  mesh: THREE.InstancedMesh,
  instances: WorldInstance[],
  withColor: boolean,
): void {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  instances.forEach((inst, i) => {
    p.set(inst.worldPos[0], inst.worldPos[1], inst.worldPos[2]);
    q.setFromEuler(e.set(0, inst.yaw, 0));
    s.set(inst.size[0], inst.size[1], inst.plane ? 1 : inst.size[2]);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (withColor) {
      c.set(inst.color ?? "#ffffff");
      mesh.setColorAt(i, c);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (withColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Scene-wide glass panes as ONE InstancedMesh — the exact FacadeMesh Glass
 * material, no shadows (perf + correctness win). */
function GlassInstances({ instances }: { instances: WorldInstance[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#8fa9bd",
        roughness: 0.08,
        metalness: 0.6,
        envMapIntensity: 3.0,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useLayoutEffect(() => {
    if (ref.current) writeInstances(ref.current, instances, false);
  }, [instances]);
  if (instances.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, instances.length]} />;
}

/** Scene-wide window frames + glazing bars as ONE InstancedMesh — per-instance
 * trim colour, casts shadows like the boxes it replaces. */
function TrimInstances({ instances }: { instances: WorldInstance[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useLayoutEffect(() => {
    if (ref.current) writeInstances(ref.current, instances, true);
  }, [instances]);
  if (instances.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, instances.length]}
      castShadow
    />
  );
}

/** Scene-wide window instancing: gathers every WINDOW's glass + frame across
 * all blocks/lots into two InstancedMeshes (glass, trim), replacing the
 * ~per-window meshes FacadeMesh used to emit. */
export default function InstancedFacadeBoxes({
  blocks,
  ground,
}: {
  blocks: FacadeBlock[];
  ground: Ground;
}) {
  const instances = useMemo(
    () => sceneWindowInstances(blocks, ground),
    [blocks, ground],
  );
  const glass = useMemo(
    () => instances.filter((i) => i.material === "glass"),
    [instances],
  );
  const trim = useMemo(
    () => instances.filter((i) => i.material === "trim"),
    [instances],
  );
  return (
    <>
      <GlassInstances instances={glass} />
      <TrimInstances instances={trim} />
    </>
  );
}
