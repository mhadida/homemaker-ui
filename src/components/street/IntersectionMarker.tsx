"use client";
import { useState } from "react";
import type { Vec2 } from "@/lib/street/types";

/** Invisible-until-hovered clickable disc marking a derived street
 * intersection — clicking it opens the intersection inspector (roundabout
 * on/off + monument). Always rendered at every junction (not just ones with
 * a roundabout already) so any junction can have one added. Sized to cover
 * the roundabout's paved footprint when one exists so re-selecting it stays
 * easy; a smaller default radius otherwise. */
export default function IntersectionMarker({
  pos,
  radius,
  selected,
  onSelect,
}: {
  pos: Vec2;
  radius: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <mesh
      position={[pos[0], 0.025, pos[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <circleGeometry args={[radius, 32]} />
      <meshBasicMaterial
        color={selected ? "#3b82f6" : "#e5e7eb"}
        transparent
        opacity={selected ? 0.3 : hover ? 0.18 : 0}
        depthWrite={false}
      />
    </mesh>
  );
}
