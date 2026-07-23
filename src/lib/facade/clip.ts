/** World size + the camera clip planes derived from it.
 *
 * These three numbers used to live apart as unrelated magic constants — the
 * ground half-extent in SceneContents, the orbit dolly limit and the camera
 * far plane both inline in FacadeViewer — and they drifted: `far` (2000) was
 * smaller than the distance from a zoomed-out camera to the far corner of the
 * ground, so zooming out sliced the ground at the far plane and the sky showed
 * through the cut ("zoom out to gray"). Deriving `far` from the world radius
 * and the dolly limit keeps them in lockstep: the far plane always contains
 * the whole ground, whatever the other two become. Pure — no three/React. */

/** Half-extent (m) of the square ground plane: it spans ±GROUND_HALF on both
 * axes, so the world is 2·GROUND_HALF on a side. */
export const GROUND_HALF = 2000;

/** Farthest any ground vertex sits from the world centre — the plane's corner,
 * GROUND_HALF·√2. */
export const WORLD_RADIUS = Math.hypot(GROUND_HALF, GROUND_HALF);

/** How far OrbitControls may dolly the 3D camera back from its target. */
export const ORBIT_MAX_DISTANCE = 600;

/** Slack (m) added past the exact world-covering distance so the ground's far
 * edge never grazes the far plane. */
const FAR_MARGIN = 500;

/** Perspective far plane that always contains the whole ground: with the
 * target at the world centre, a fully dollied-out camera sits ORBIT_MAX_DISTANCE
 * from centre and the farthest ground corner is WORLD_RADIUS beyond that, so
 * the far plane must clear their sum (plus a margin). Parameterised for the
 * test; the defaults are the live values. */
export function perspectiveFar(
  orbitMaxDistance: number = ORBIT_MAX_DISTANCE,
  worldRadius: number = WORLD_RADIUS,
): number {
  return orbitMaxDistance + worldRadius + FAR_MARGIN;
}

/** The live far plane, precomputed. */
export const PERSPECTIVE_FAR = perspectiveFar();
