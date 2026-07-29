"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { InterventionScope } from "@/lib/facade/interventionScope";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";
import Line from "./NodeLine";

const MAX_SEGMENT = 4;
const LIFT = 0.16;
const FILL_LIFT = 0.11;
const SCOPE_COLOR = "#0f9f9a";

/** Sample the boundary densely enough that it follows imported heightfields
 * rather than cutting through hills and hollows. */
function drapedPoints(
  scope: InterventionScope,
  ground: Ground,
): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let i = 0; i < scope.outline.length; i++) {
    const a = scope.outline[i];
    const b = scope.outline[(i + 1) % scope.outline.length];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / MAX_SEGMENT),
    );
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      points.push([x, groundHeightAt(x, z, ground) + LIFT, z]);
    }
  }
  const first = scope.outline[0];
  points.push([
    first[0],
    groundHeightAt(first[0], first[1], ground) + LIFT,
    first[1],
  ]);
  return points;
}

/** Triangulate the selected parcel in XZ and drape every triangle vertex onto
 * the terrain. A non-indexed soup lets each triangle follow its local terrain
 * samples instead of forcing one flat plane across the whole property. */
export function buildScopeFillGeometry(
  scope: InterventionScope,
  ground: Ground,
): THREE.BufferGeometry {
  const outline = [...scope.outline];
  if (
    outline.length > 1 &&
    outline[0][0] === outline[outline.length - 1][0] &&
    outline[0][1] === outline[outline.length - 1][1]
  ) {
    outline.pop();
  }
  const vertices = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const triangles =
    vertices.length >= 3
      ? THREE.ShapeUtils.triangulateShape(vertices, [])
      : [];
  const positions: number[] = [];
  for (const triangle of triangles) {
    for (const index of triangle) {
      const [x, z] = outline[index];
      positions.push(x, groundHeightAt(x, z, ground) + FILL_LIFT, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (positions.length > 0) geometry.computeVertexNormals();
  return geometry;
}

export default function InterventionScopeOutline({
  scope,
  ground,
  emphasis = "selected",
}: {
  scope: InterventionScope | null;
  ground: Ground;
  emphasis?: "selected" | "hover";
}) {
  const hovered = emphasis === "hover";
  const points = useMemo(
    () => (scope ? drapedPoints(scope, ground) : []),
    [scope, ground],
  );
  const fillGeometry = useMemo(
    () =>
      scope?.kind === "parcel"
        ? buildScopeFillGeometry(scope, ground)
        : null,
    [scope, ground],
  );
  useEffect(() => () => fillGeometry?.dispose(), [fillGeometry]);
  if (!scope || points.length < 2) return null;
  return (
    <>
      {fillGeometry && (
        <mesh
          geometry={fillGeometry}
          renderOrder={hovered ? 5 : 7}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={SCOPE_COLOR}
            transparent
            opacity={hovered ? 0.1 : 0.2}
            depthWrite={false}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
      <Line
        points={points}
        color={SCOPE_COLOR}
        lineWidth={hovered ? 2 : 4}
        depthWrite={false}
        renderOrder={hovered ? 6 : 8}
      />
    </>
  );
}
