"use client";
import { useMemo } from "react";
import type { StreetNetwork, Monument } from "@/lib/street/types";
import { deriveIntersections } from "@/lib/street/intersections";
import StreetRibbonMesh from "./StreetRibbonMesh";
import RoundaboutMesh from "./RoundaboutMesh";

export default function StreetNetworkView({ network }: { network: StreetNetwork }) {
  const roundabouts = useMemo(() => new Map(network.roundabouts), [network.roundabouts]);
  const intersections = useMemo(() => deriveIntersections(network), [network]);
  return (
    <group>
      {network.streets.map((s) => (
        <StreetRibbonMesh key={s.id} street={s} />
      ))}
      {intersections.map((it) => {
        const m: Monument | undefined = roundabouts.get(it.key);
        if (!m) return null;
        return (
          <RoundaboutMesh
            key={it.key}
            centre={it.pos}
            outerR={9}
            islandR={3}
            monument={m}
          />
        );
      })}
    </group>
  );
}
