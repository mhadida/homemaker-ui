"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
import { parkPlanting, type OpenFill } from "@/lib/facade/openBlock";
import MonumentMesh from "@/components/street/MonumentMesh";
import TreeMesh from "./TreeMesh";

// Surface palette (the pure lib is color-free): warm plaza stone, park green.
const PLAZA_STONE = "#9a9186";
const PARK_GREEN = "#4e7a45";

/** The ground fill for an open block — a paved plaza (optional monument) or a
 * planted park — draped on the tilted ground. The footprint is the block's
 * quad; not selectable (open space carries no inspector). */
export default function OpenBlockMesh({
  footprint,
  fill,
  seed,
  ground,
}: {
  footprint: [number, number][];
  fill: OpenFill;
  /** The block's seed — drives the deterministic park planting. */
  seed: number;
  ground: Ground;
}) {
  const geo = useMemo(() => {
    if (footprint.length < 4) return null;
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    // quad → two triangles (fl,fr,br) + (fl,br,bl)
    const order = [0, 1, 2, 0, 2, 3];
    const pos: number[] = [];
    for (const idx of order) {
      const [x, z] = footprint[idx];
      pos.push(x, yAt(x, z), z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [footprint, ground]);
  useEffect(() => () => geo?.dispose(), [geo]);

  const centroid = useMemo<[number, number]>(
    () => [
      (footprint[0][0] + footprint[1][0] + footprint[2][0] + footprint[3][0]) / 4,
      (footprint[0][1] + footprint[1][1] + footprint[2][1] + footprint[3][1]) / 4,
    ],
    [footprint],
  );

  const trees = useMemo(
    () => (fill.kind === "park" ? parkPlanting(footprint, seed) : []),
    [fill.kind, footprint, seed],
  );

  if (!geo) return null;
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial
          color={fill.kind === "plaza" ? PLAZA_STONE : PARK_GREEN}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      {fill.kind === "plaza" && fill.monument && (
        <MonumentMesh
          centre={centroid}
          kind={fill.monument}
          baseY={groundHeightAt(centroid[0], centroid[1], ground)}
        />
      )}
      {trees.map((t, i) => (
        <TreeMesh key={i} tree={t} ground={ground} tint={i} />
      ))}
    </group>
  );
}
