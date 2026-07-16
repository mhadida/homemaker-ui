import { computeLayout, MASSING_DEPTH_DEFAULT, type OpeningRect } from "./layout";
import { lotPlacements, type FacadeBlock } from "./blocks";
import { levelingFor, type Ground } from "./terrain";
import type { WindowStyleId } from "./types";

/** Feature flag: when on, windows render as scene-wide `InstancedMesh`
 * (glass + frames) instead of per-window meshes in FacadeMesh. Default on;
 * flip to false to fall back to the byte-identical per-mesh path. */
export const USE_INSTANCING = true;

// Constants MIRRORED from FacadeMesh (must stay in sync with WindowFill /
// MullionBars). Instancing reproduces those meshes as data.
const FRAME_T = 0.07; // window frame member thickness
const FRAME_D = 0.06; // frame depth
const GLASS_RECESS = 0.15; // how far frames/glass sit behind the wall face
const GLAZING_BAR = 0.04; // thin internal glazing-bar thickness

/** One repeated facade element as data, in the facade's LOCAL frame (x right,
 * y up, z out from the wall). `material` selects which scene-wide
 * `InstancedMesh` it joins; `plane` glass uses a plane, everything else a unit
 * box scaled to `size`. Per-instance color is applied at compose time (trim/
 * wall/door colors vary per building; glass is constant). */
export interface BoxInstance {
  material: "glass" | "trim";
  pos: [number, number, number];
  /** (w, h, d) — box dimensions; for a `plane`, d is ignored. */
  size: [number, number, number];
  plane?: boolean;
}

/** Internal glazing bars for a w×h pane, positions RELATIVE to the pane
 * centre. Mirrors FacadeMesh.MullionBars exactly. */
function mullionInstances(
  w: number,
  h: number,
  style: WindowStyleId,
): BoxInstance[] {
  if (style === "none") return [];
  if (style === "victorian")
    return [{ material: "trim", pos: [0, h * 0.12, 0], size: [w, 0.05, FRAME_D] }];
  if (style === "sash")
    return [
      { material: "trim", pos: [0, 0, 0], size: [0.05, h, FRAME_D] },
      { material: "trim", pos: [0, h * 0.12, 0], size: [w, 0.05, FRAME_D] },
    ];
  // georgian: vertical bars at thirds + horizontal bars for ~square panes
  const rows = Math.max(2, Math.round(h / (w / 3)));
  const bars: BoxInstance[] = [];
  for (const x of [-w / 6, w / 6])
    bars.push({ material: "trim", pos: [x, 0, 0], size: [GLAZING_BAR, h, FRAME_D] });
  for (let i = 0; i < rows - 1; i++)
    bars.push({
      material: "trim",
      pos: [0, -h / 2 + ((i + 1) * h) / rows, 0],
      size: [w, GLAZING_BAR, FRAME_D],
    });
  return bars;
}

/** Every box/plane one WindowFill opening renders, as data in the facade LOCAL
 * frame. Mirrors FacadeMesh.WindowFill exactly: a glass plane, a 4-member
 * trim frame, and the style's glazing bars — the window group sits at
 * (cx, cy, -GLASS_RECESS). */
export function windowInstances(
  o: OpeningRect,
  style: WindowStyleId,
): BoxInstance[] {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const gz = -GLASS_RECESS; // window group z
  const out: BoxInstance[] = [];
  // glass plane (group-local [0,0,-0.02])
  out.push({ material: "glass", pos: [cx, cy, gz - 0.02], size: [o.w, o.h, 0], plane: true });
  // frame: top, bottom, left, right
  out.push({ material: "trim", pos: [cx, cy + o.h / 2 - FRAME_T / 2, gz], size: [o.w, FRAME_T, FRAME_D] });
  out.push({ material: "trim", pos: [cx, cy - o.h / 2 + FRAME_T / 2, gz], size: [o.w, FRAME_T, FRAME_D] });
  out.push({ material: "trim", pos: [cx - o.w / 2 + FRAME_T / 2, cy, gz], size: [FRAME_T, o.h, FRAME_D] });
  out.push({ material: "trim", pos: [cx + o.w / 2 - FRAME_T / 2, cy, gz], size: [FRAME_T, o.h, FRAME_D] });
  // glazing bars — pane-centre-relative → offset into the window group frame
  for (const b of mullionInstances(o.w, o.h, style))
    out.push({ ...b, pos: [cx + b.pos[0], cy + b.pos[1], gz + b.pos[2]] });
  return out;
}

/** One window box in WORLD space, ready for an `InstancedMesh`: a position +
 * a Y-yaw + box dimensions (a plane for glass) compose the instance Matrix4.
 * `color` carries the building's trim colour (trim only; glass is constant). */
export interface WorldInstance {
  worldPos: [number, number, number];
  yaw: number;
  size: [number, number, number];
  material: "glass" | "trim";
  color?: string;
  plane?: boolean;
}

/** Every WINDOW's glass + frame across every lot of every block, in world
 * space. Mirrors SceneContents' BlockGroup placement EXACTLY: each lot sits at
 * (position.x, datum, position.z) rotated by rotationY, where datum is the
 * ground-levelled floor height (`levelingFor`). Only `kind === "window"`
 * openings become instances here — doors/shopfronts/garages/passages keep
 * their bespoke per-lot meshes.
 *
 * KNOWN LIMITATION: section-relief z-offsets are ignored (assumes flush
 * strips, the common case). A window inside an offset section strip would be
 * shifted by `strip.offset` in local z; that offset is not applied here. */
export function sceneWindowInstances(
  blocks: FacadeBlock[],
  ground: Ground,
): WorldInstance[] {
  const out: WorldInstance[] = [];
  for (const block of blocks) {
    const placements = lotPlacements(block);
    block.lots.forEach((lot, i) => {
      const { position, rotationY } = placements[i];
      const yaw = rotationY;
      const depth = lot.params.massingDepth ?? MASSING_DEPTH_DEFAULT;
      const { datum } = levelingFor(
        position[0],
        position[2],
        lot.params.width,
        depth,
        yaw,
        ground,
      );
      const ox = position[0];
      const oy = datum;
      const oz = position[2];
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const layout = computeLayout(lot.params);
      const { trimColor, windowStyle } = lot.params;
      for (const o of layout.openings) {
        if (o.kind !== "window") continue;
        for (const b of windowInstances(o, windowStyle)) {
          const [lx, ly, lz] = b.pos;
          // Rotate the facade-local point by yaw about Y, then translate to the
          // lot origin (matches the three.js Y-rotation used in levelingFor /
          // BlockGroup: wx = lx·cos + lz·sin, wz = −lx·sin + lz·cos).
          out.push({
            worldPos: [ox + lx * cos + lz * sin, oy + ly, oz - lx * sin + lz * cos],
            yaw,
            size: b.size,
            material: b.material,
            color: b.material === "trim" ? trimColor : undefined,
            plane: b.plane,
          });
        }
      }
    });
  }
  return out;
}
