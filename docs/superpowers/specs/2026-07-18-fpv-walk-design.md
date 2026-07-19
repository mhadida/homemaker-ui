# FPV Walk Mode — Design

**Status:** agreed (choices made in-session); implementing
**Date:** 2026-07-18
**Branch:** `feature/fpv-walk`

## Goal

Walk around the streets in first person: eye height **1.75 m** above the
street/ground surface, **walking speed**, **WASD + mouse-look**. Entered via a
**Walk toggle in the 3D pane**; Esc (pointer-lock exit) leaves. v1 is
**walk-through** — no collision with buildings.

## Architecture

- **Pure helper** `src/lib/facade/walk.ts` (unit-tested):
  - `EYE_HEIGHT = 1.75`, `WALK_SPEED = 2.5` (m/s, brisk walk).
  - `walkStep(pos, forward, keys, dt, speed?)` → next `[x, z]`. `forward` is
    the camera's horizontal look direction; strafing uses its perpendicular;
    diagonal movement is normalized (never faster than `speed`); a
    near-vertical look (degenerate horizontal forward) moves nothing.
- **`WalkControls`** (in `FacadeViewer.tsx`, mounted inside the perspective
  `<View>` INSTEAD of OrbitControls while walking):
  - drei `PointerLockControls` for mouse-look (locks on mount, `onUnlock` →
    exit walk mode — Esc works for free).
  - WASD tracked in a ref via window key listeners; `useFrame` applies
    `walkStep` and pins `camera.y = groundHeightAt(x, z) + EYE_HEIGHT`
    (ground-follow works on slopes).
  - On exit, reports a look-at target (a few metres ahead) so the returning
    OrbitControls doesn't lurch back to the scene origin.
- **Walk button** on the 3D pane cell (DOM overlay, beside Maximize). While
  walking it becomes a hint ("Esc to exit"); pointer lock makes clicking it
  moot anyway.

## Non-goals (v1)

Collision, stairs/kerb steps, gamepad, mobile touch walk, head-bob, sprint.

## Testing

- `walk.test.ts`: forward/strafe direction math, diagonal normalization,
  opposing keys cancel, degenerate forward, dt scaling, custom speed.
- Everything else is a browser check: enter walk on a seeded street scene,
  WASD around, slope follow, Esc exit restores orbit.
