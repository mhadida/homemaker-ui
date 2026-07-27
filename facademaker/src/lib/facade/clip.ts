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

/* ── Plan-pane heights ──────────────────────────────────────────────────────
 * Same failure mode as `far` above, one milestone later. The top-down plan
 * camera (y = 60) and the Walk pick-surface (y = 50) were sized when the
 * tallest thing in the world was a ~20 m hand-drawn facade. Real-city import
 * broke that: one Rotterdam bbox alone holds buildings at 106 m, 95 m and
 * 75 m, so roofs were clipped by the camera's NEAR plane (leaving the
 * double-sided wall interior showing) and were unclickable — an orthographic
 * ray starts at the near plane — while buildings above the catcher stole the
 * clicks that were meant to place a walk start. Derive both from the tallest
 * building the world supports so they cannot drift below the geometry again. */

/** Tallest building the world is expected to contain (m). The Burj Khalifa is
 * 828 m, so this clears every building on Earth. Nothing clamps building
 * heights TO this — it is the headroom the cameras are sized against. */
export const MAX_BUILDING_HEIGHT = 1000;

/** How far below the y = 0 datum real terrain may dip (m). The Dead Sea shore
 * is ≈ −430 m, so this covers any land surface. */
export const MAX_TERRAIN_DEPTH = 1000;

/** Slack (m) between the tallest building, the Walk catcher, and the camera. */
const PLAN_CAM_MARGIN = 50;

/** Near plane of the top-down plan camera. Exported so the "nothing pokes
 * above the near plane" invariant is testable rather than implicit. */
export const PLAN_CAM_NEAR = 0.1;

/** Height of the top-down plan camera. An orthographic camera's apparent size
 * comes from `zoom`, not distance, so lifting it above the tallest building
 * costs nothing visually — and ortho depth is LINEAR, so the wider near..far
 * range barely moves depth precision (≈0.1 mm over the full span at 24-bit,
 * still orders of magnitude finer than the ~5 mm that separates the flat
 * ground layers). */
export const PLAN_CAM_Y = MAX_BUILDING_HEIGHT + PLAN_CAM_MARGIN;

/** Far plane of the plan camera: measured from the camera, so it must span the
 * whole drop from PLAN_CAM_Y past the lowest ground. */
export const PLAN_CAM_FAR = PLAN_CAM_Y + MAX_TERRAIN_DEPTH;

/** Height of the Walk pick-surface plane: above every building, so in the
 * top-down view it is the nearest hit for every click and its stopPropagation
 * wins over lot/street/context-building selection — but below the camera's
 * near plane, or it would be clipped and catch nothing at all. Rays are
 * vertical, so the reported x/z are unaffected by the height. */
export const WALK_CATCHER_Y = MAX_BUILDING_HEIGHT + PLAN_CAM_MARGIN / 2;
