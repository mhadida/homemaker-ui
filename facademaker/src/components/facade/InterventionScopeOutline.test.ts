import { describe, expect, it } from "vitest";
import { buildScopeFillGeometry } from "./InterventionScopeOutline";
import type { InterventionScope } from "@/lib/facade/interventionScope";
import { groundHeightAt, type Ground } from "@/lib/facade/terrain";

const scope = (outline: [number, number][]): InterventionScope => ({
  kind: "parcel",
  outline,
  lotIds: ["brk:test"],
});

describe("buildScopeFillGeometry", () => {
  it("triangulates a parcel into a visible filled surface", () => {
    const geometry = buildScopeFillGeometry(
      scope([
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ]),
      { slope: 0, azimuth: 0 },
    );
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBe(6);
    for (let index = 0; index < positions.count; index++) {
      expect(positions.getY(index)).toBeGreaterThan(0);
    }
    geometry.dispose();
  });

  it("drapes fill vertices above sloping ground", () => {
    const ground: Ground = { slope: 0.1, azimuth: 0 };
    const geometry = buildScopeFillGeometry(
      scope([
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ]),
      ground,
    );
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      expect(y).toBeGreaterThan(groundHeightAt(x, z, ground));
    }
    geometry.dispose();
  });
});
