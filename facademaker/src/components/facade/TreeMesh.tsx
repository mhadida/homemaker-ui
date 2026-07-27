"use client";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
import type { Planting } from "@/lib/facade/openBlock";

// Palette lives here — the pure openBlock lib is color-free. A few greens so a
// park doesn't read as one flat colour; picked per tree by a stable index.
const TRUNK = "#6b5335";
const GREENS = ["#3f6f37", "#4d7d42", "#5c8a4c"];

/** One low-poly tree — a tapered trunk plus two stacked cones — standing on the
 * tilted ground at its planting point. The project's first vegetation mesh. */
export default function TreeMesh({
  tree,
  ground,
  tint,
}: {
  tree: Planting;
  ground: Ground;
  /** Stable index → foliage colour, so neighbouring trees vary. */
  tint: number;
}) {
  const [x, z] = tree.pos;
  const baseY = groundHeightAt(x, z, ground);
  const foliage = GREENS[((tint % GREENS.length) + GREENS.length) % GREENS.length];
  const trunkH = tree.height * 0.4;
  const canopyH = tree.height * 0.75;
  return (
    <group position={[x, baseY, z]}>
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[tree.radius * 0.12, tree.radius * 0.18, trunkH, 6]} />
        <meshStandardMaterial color={TRUNK} roughness={0.9} />
      </mesh>
      <mesh position={[0, trunkH + canopyH * 0.45, 0]} castShadow>
        <coneGeometry args={[tree.radius, canopyH, 7]} />
        <meshStandardMaterial color={foliage} roughness={0.85} />
      </mesh>
      <mesh position={[0, trunkH + canopyH * 0.85, 0]} castShadow>
        <coneGeometry args={[tree.radius * 0.68, canopyH * 0.6, 7]} />
        <meshStandardMaterial color={foliage} roughness={0.85} />
      </mesh>
    </group>
  );
}
