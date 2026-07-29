import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { archProfile } from "./archProfile";

describe("archProfile", () => {
  it.each([2.5, 5.8, 12, 30])(
    "triangulates a finite extruded arch at %.1f m span",
    (width) => {
      const { shape, height, apex } = archProfile(width);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1.15,
        bevelEnabled: false,
        curveSegments: 18,
      });
      const positions = geometry.getAttribute("position");
      expect(positions.count).toBeGreaterThan(0);
      for (let i = 0; i < positions.count; i++) {
        expect(Number.isFinite(positions.getX(i))).toBe(true);
        expect(Number.isFinite(positions.getY(i))).toBe(true);
        expect(Number.isFinite(positions.getZ(i))).toBe(true);
      }
      expect(height).toBeGreaterThan(apex);
      geometry.dispose();
    },
  );
});
