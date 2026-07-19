"use client";
import { useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import type { Street } from "@/lib/street/types";
import { effectiveWidth, minRadiusOf } from "@/lib/street/types";
import { filletCentreline } from "@/lib/street/geometry";
import { canalOffsets, canalWaterY, CANAL_BED_DEPTH } from "@/lib/street/canal";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const WATER = "#2f6b8f";
const QUAY = "#6b6660";   // stone retaining wall
const WALK = "#8a857c";   // light-stone sidewalk
const SELECTED = "#3b82f6";

export default function CanalMesh({
  street, selected = false, onSelect, ground,
}: {
  street: Street;
  selected?: boolean;
  onSelect?: () => void;
  ground: Ground;
}) {
  const [hover, setHover] = useState(false);
  const geos = useMemo(() => {
    const cl = filletCentreline(street.points, minRadiusOf(street), 8, street.closed);
    if (cl.length < 2) return null;
    const w = effectiveWidth(street);
    const { water, quayFoot, bank } = canalOffsets(cl, w);
    const waterY = canalWaterY(cl, w, ground);
    const gy = (p: [number, number]) => groundHeightAt(p[0], p[1], ground);

    const waterPos: number[] = [];
    const quayPos: number[] = [];
    const walkPos: number[] = [];
    const bedPos: number[] = [];
    const bedY = waterY - CANAL_BED_DEPTH;
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) =>
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);

    for (let i = 0; i < cl.length - 1; i++) {
      // water: flat level quad strip between the two water edges
      const wl0 = water.left[i], wl1 = water.left[i + 1];
      const wr0 = water.right[i], wr1 = water.right[i + 1];
      quad(waterPos,
        [wl0[0], waterY, wl0[1]], [wr0[0], waterY, wr0[1]],
        [wr1[0], waterY, wr1[1]], [wl1[0], waterY, wl1[1]]);
      // bed: an opaque floor under the transparent water
      quad(bedPos,
        [wl0[0], bedY, wl0[1]], [wr0[0], bedY, wr0[1]],
        [wr1[0], bedY, wr1[1]], [wl1[0], bedY, wl1[1]]);

      for (const side of ["left", "right"] as const) {
        const we0 = water[side][i], we1 = water[side][i + 1];
        const qf0 = quayFoot[side][i], qf1 = quayFoot[side][i + 1];
        const be0 = bank[side][i], be1 = bank[side][i + 1];
        // quay inner wall: water edge from the BED up to draped bank grade —
        // the submerged stretch shows through the transparent water.
        quad(quayPos,
          [we0[0], bedY, we0[1]], [we1[0], bedY, we1[1]],
          [we1[0], gy(we1), we1[1]], [we0[0], gy(we0), we0[1]]);
        // quay top cap: water edge → quay foot at grade
        quad(quayPos,
          [we0[0], gy(we0), we0[1]], [we1[0], gy(we1), we1[1]],
          [qf1[0], gy(qf1), qf1[1]], [qf0[0], gy(qf0), qf0[1]]);
        // sidewalk: quay foot → bank edge at grade
        quad(walkPos,
          [qf0[0], gy(qf0), qf0[1]], [qf1[0], gy(qf1), qf1[1]],
          [be1[0], gy(be1), be1[1]], [be0[0], gy(be0), be0[1]]);
      }
    }
    const mk = (pos: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    return { water: mk(waterPos), quay: mk(quayPos), walk: mk(walkPos), bed: mk(bedPos) };
  }, [street, ground]);

  useEffect(
    () => () => {
      geos?.water.dispose();
      geos?.quay.dispose();
      geos?.walk.dispose();
      geos?.bed.dispose();
    },
    [geos],
  );
  if (!geos) return null;
  const stone = selected ? SELECTED : hover ? "#9aa2ab" : QUAY;
  const walk = selected ? SELECTED : WALK;
  return (
    <group
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      onPointerOver={onSelect ? (e) => { e.stopPropagation(); setHover(true); } : undefined}
      onPointerOut={onSelect ? () => setHover(false) : undefined}
    >
      <mesh geometry={geos.walk} receiveShadow>
        <meshStandardMaterial color={walk} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.quay} castShadow receiveShadow>
        <meshStandardMaterial color={stone} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Opaque bed under the transparent water — gives the channel real
       * depth instead of a bottomless void. */}
      <mesh geometry={geos.bed}>
        <meshStandardMaterial color="#3d453f" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.water}>
        <meshStandardMaterial
          color={WATER} roughness={0.2} metalness={0.1}
          transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
