/** First-person walk mode — the pure movement math. The camera work
 * (pointer lock, ground-follow) lives in FacadeViewer's WalkControls; this
 * module only answers "where am I after dt seconds of these keys". */

/** Eye height above the ground surface, metres. */
export const EYE_HEIGHT = 1.75;

/** Brisk walking speed, m/s. */
export const WALK_SPEED = 2.5;

export interface WalkKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** Next plan position after `dt` seconds of walking.
 *
 * `forward` is the camera's look direction projected to the plan ([x, z],
 * any length — normalized here); strafing moves along its perpendicular.
 * Diagonal input is normalized so combined keys never exceed `speed`.
 * A (near-)vertical look has no horizontal direction — no movement. */
export function walkStep(
  pos: readonly [number, number],
  forward: readonly [number, number],
  keys: WalkKeys,
  dt: number,
  speed: number = WALK_SPEED,
): [number, number] {
  const fl = Math.hypot(forward[0], forward[1]);
  if (fl < 1e-6) return [pos[0], pos[1]];
  const fx = forward[0] / fl;
  const fz = forward[1] / fl;
  // right = forward × up, projected to the plan
  const rx = -fz;
  const rz = fx;
  let mx = 0;
  let mz = 0;
  if (keys.forward) {
    mx += fx;
    mz += fz;
  }
  if (keys.back) {
    mx -= fx;
    mz -= fz;
  }
  if (keys.right) {
    mx += rx;
    mz += rz;
  }
  if (keys.left) {
    mx -= rx;
    mz -= rz;
  }
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-6) return [pos[0], pos[1]];
  const k = (speed * dt) / ml;
  return [pos[0] + mx * k, pos[1] + mz * k];
}
