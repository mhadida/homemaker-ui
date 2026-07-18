"use client";
import { useMemo } from "react";
import type { StreetNetwork, Monument } from "@/lib/street/types";
import { deriveIntersections } from "@/lib/street/intersections";
import StreetRibbonMesh from "./StreetRibbonMesh";
import CanalMesh from "./CanalMesh";
import RoundaboutMesh from "./RoundaboutMesh";
import IntersectionMarker from "./IntersectionMarker";
import type { Ground } from "@/lib/facade/terrain";

const ROUNDABOUT_OUTER_R = 9;
const ROUNDABOUT_ISLAND_R = 3;
/** Clickable radius at a plain (no roundabout) junction — generous enough to
 * hit without precision, small enough not to blanket nearby geometry. */
const JUNCTION_MARKER_R = 3;

export default function StreetNetworkView({
  network,
  selectedStreet = null,
  onSelectStreet,
  selectedIntersection = null,
  onSelectIntersection,
  ground,
}: {
  network: StreetNetwork;
  /** Selected street id — tints its ribbon. */
  selectedStreet?: string | null;
  /** Undefined → ribbons aren't selectable (byte-identical to before
   * selection existed). */
  onSelectStreet?: (id: string) => void;
  /** Selected intersection key — tints its marker. */
  selectedIntersection?: string | null;
  /** Undefined → intersections aren't selectable. */
  onSelectIntersection?: (key: string) => void;
  /** Tilted ground plane — drapes ribbons/roundabouts/markers onto it. */
  ground: Ground;
}) {
  const roundabouts = useMemo(() => new Map(network.roundabouts), [network.roundabouts]);
  const intersections = useMemo(() => deriveIntersections(network), [network]);
  return (
    <group>
      {network.streets.map((s) =>
        s.type === "canal" ? (
          <CanalMesh
            key={s.id}
            street={s}
            selected={selectedStreet === s.id}
            onSelect={onSelectStreet ? () => onSelectStreet(s.id) : undefined}
            ground={ground}
          />
        ) : (
          <StreetRibbonMesh
            key={s.id}
            street={s}
            selected={selectedStreet === s.id}
            onSelect={onSelectStreet ? () => onSelectStreet(s.id) : undefined}
            ground={ground}
          />
        ),
      )}
      {intersections.map((it) => {
        const m: Monument | undefined = roundabouts.get(it.key);
        return (
          <group key={it.key}>
            {m && (
              <RoundaboutMesh
                centre={it.pos}
                outerR={ROUNDABOUT_OUTER_R}
                islandR={ROUNDABOUT_ISLAND_R}
                monument={m}
                ground={ground}
              />
            )}
            {onSelectIntersection && (
              <IntersectionMarker
                pos={it.pos}
                radius={m ? ROUNDABOUT_OUTER_R : JUNCTION_MARKER_R}
                selected={selectedIntersection === it.key}
                onSelect={() => onSelectIntersection(it.key)}
                ground={ground}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
