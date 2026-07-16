"use client";
import { useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import type { Street } from "@/lib/street/types";
import { effectiveWidth, minRadiusOf } from "@/lib/street/types";
import { filletCentreline, streetRibbon } from "@/lib/street/geometry";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const PAVING: Record<Street["type"], string> = {
  alley: "#6f6a63",
  street: "#4a4a4c",
  road: "#3f3f44",
  boulevard: "#3a3a40",
};

const SELECTED_COLOR = "#3b82f6"; // matches the app-wide accent used for other 3D selection highlights

export default function StreetRibbonMesh({
  street,
  selected = false,
  onSelect,
  ground,
}: {
  street: Street;
  /** Selection highlight — tints the paving toward the accent color. */
  selected?: boolean;
  /** Clicking the ribbon selects this street. Undefined → not selectable
   * (byte-identical to before selection existed). */
  onSelect?: () => void;
  /** Tilted ground plane — each vertex lifts to the surface height. */
  ground: Ground;
}) {
  const [hover, setHover] = useState(false);
  const geo = useMemo(() => {
    const cl = filletCentreline(street.points, minRadiusOf(street), 8, street.closed);
    if (cl.length < 2) return null;
    const { left, right } = streetRibbon(cl, effectiveWidth(street), street.closed);
    const pos: number[] = [];
    const yAt = (x: number, z: number) => groundHeightAt(x, z, ground) + 0.02;
    for (let i = 0; i < cl.length - 1; i++) {
      const l0 = left[i], l1 = left[i + 1], r0 = right[i], r1 = right[i + 1];
      pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r0[0], yAt(r0[0], r0[1]), r0[1], r1[0], yAt(r1[0], r1[1]), r1[1]);
      pos.push(l0[0], yAt(l0[0], l0[1]), l0[1], r1[0], yAt(r1[0], r1[1]), r1[1], l1[0], yAt(l1[0], l1[1]), l1[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [street, ground]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh
      geometry={geo}
      receiveShadow
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
      onPointerOver={
        onSelect
          ? (e) => {
              e.stopPropagation();
              setHover(true);
            }
          : undefined
      }
      onPointerOut={onSelect ? () => setHover(false) : undefined}
    >
      <meshStandardMaterial
        color={selected ? SELECTED_COLOR : hover ? "#7c8a9c" : PAVING[street.type]}
        roughness={0.95}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
