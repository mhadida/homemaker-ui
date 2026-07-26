"use client";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ContextBuilding } from "@/lib/geo/buildings";
import { footprintBase, visibleBuildings } from "@/lib/geo/buildings";
import type { Ground } from "@/lib/facade/terrain";

/** Neutral grey — reads as backdrop against the app's warmer wall colours. */
const CONTEXT_COLOR = "#8d8880";
const HIGHLIGHT_COLOR = "#c0b8a8";
/** Brighter than hover: the inspector is open on this one. */
const SELECTED_COLOR = "#d8c48a";

/** One merged geometry for every building, plus a per-TRIANGLE building-id
 * lookup: a raycast gives us `faceIndex`, and faceBuilding[faceIndex] is the
 * building that triangle belongs to. That is the only way to resolve an
 * individual building inside a merged mesh (which we need, because thousands
 * of separate meshes would be thousands of draw calls). */
function buildMerged(buildings: ContextBuilding[], ground: Ground) {
  const positions: number[] = [];
  const faceBuilding: string[] = [];
  for (const b of buildings) {
    const base = footprintBase(b.footprint, ground);
    const top = base + b.height;
    const n = b.footprint.length;
    // Walls: a quad (2 triangles) per footprint edge.
    for (let i = 0; i < n; i++) {
      const [x0, z0] = b.footprint[i];
      const [x1, z1] = b.footprint[(i + 1) % n];
      positions.push(x0, base, z0, x1, base, z1, x1, top, z1);
      positions.push(x0, base, z0, x1, top, z1, x0, top, z0);
      faceBuilding.push(b.id, b.id);
    }
    // Roof cap: real triangulation, because footprints are frequently
    // non-convex and a triangle fan would produce a wrong cap.
    const contour = b.footprint.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [ia, ib, ic] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const pa = b.footprint[ia];
      const pb = b.footprint[ib];
      const pc = b.footprint[ic];
      positions.push(pa[0], top, pa[1], pb[0], top, pb[1], pc[0], top, pc[1]);
      faceBuilding.push(b.id);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return { geo, faceBuilding };
}

/** Real building footprints as inert grey backdrop massing (M2), selectable
 * for promotion or demolition (M4). Renders nothing when hidden or empty, so a
 * scene with no place loaded is unchanged. `onSelect` undefined => not
 * interactive (Select tool off): no hover, no click.
 *
 * Clicking SELECTS rather than demolishing: an instant, unconfirmed demolition
 * on a single click was a real hazard, and Demolish now lives in the inspector
 * beside Promote. */
export default function ContextBuildings({
  buildings,
  ground,
  hiddenIds,
  visible,
  selectedId,
  onSelect,
}: {
  buildings: ContextBuilding[];
  ground: Ground;
  hiddenIds: ReadonlySet<string>;
  visible: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const shown = useMemo(
    () => visibleBuildings(buildings, hiddenIds),
    [buildings, hiddenIds],
  );
  const merged = useMemo(
    () => (shown.length ? buildMerged(shown, ground) : null),
    [shown, ground],
  );
  useEffect(() => () => merged?.geo.dispose(), [merged]);

  // Drop a stale hover when the set changes (e.g. the hovered one was
  // hidden) — derived directly rather than reset via a setState-in-effect
  // round trip, which the react-hooks/set-state-in-effect rule rejects.
  const validHovered = useMemo(
    () => (hovered && shown.some((b) => b.id === hovered) ? hovered : null),
    [hovered, shown],
  );

  // Selection outranks hover, so the inspector's subject stays lit while the
  // cursor wanders off it. Validated against the visible set too, so a stale
  // id (its building was demolished or promoted) simply stops highlighting.
  const litId = useMemo(() => {
    const wanted = selectedId ?? validHovered;
    return wanted && shown.some((b) => b.id === wanted) ? wanted : null;
  }, [selectedId, validHovered, shown]);

  // A lit building needs its own little geometry — you cannot tint one
  // building inside a merged mesh.
  const hoverGeo = useMemo(() => {
    if (!litId) return null;
    const b = shown.find((x) => x.id === litId);
    return b ? buildMerged([b], ground).geo : null;
  }, [litId, shown, ground]);
  useEffect(() => () => hoverGeo?.dispose(), [hoverGeo]);

  if (!visible || !merged) return null;

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>): string | undefined =>
    typeof e.faceIndex === "number" ? merged.faceBuilding[e.faceIndex] : undefined;

  return (
    <>
      <mesh
        geometry={merged.geo}
        receiveShadow
        onPointerMove={
          onSelect
            ? (e) => {
                // No stopPropagation here (unlike onClick below): this mesh
                // sits above MarqueeSurface's catcher plane in the plan view,
                // so stopping the walk would freeze the rubber-band rect (and
                // street-ribbon hover) wherever the cursor crosses a
                // footprint. The hover handler has already run by this point,
                // so nothing is lost by letting the event keep walking.
                setHovered(idAt(e) ?? null);
              }
            : undefined
        }
        onPointerOut={onSelect ? () => setHovered(null) : undefined}
        onClick={
          onSelect
            ? (e) => {
                e.stopPropagation();
                const id = idAt(e);
                if (id) onSelect(id);
              }
            : undefined
        }
      >
        {/* DoubleSide: OSM ways wind either way, so a single-sided cap or wall
            would be invisible from outside on roughly half the buildings. */}
        <meshStandardMaterial
          color={CONTEXT_COLOR}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      {hoverGeo && (
        <mesh geometry={hoverGeo}>
          <meshStandardMaterial
            color={selectedId === litId ? SELECTED_COLOR : HIGHLIGHT_COLOR}
            roughness={0.9}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </>
  );
}
