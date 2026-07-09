# Four-View Workspace — Design Spec (v2 sub-project B)

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming session)
**Depends on:** facade designer v1 (merged). Prerequisite for sub-project C
(the plan pane is C's drawing surface).

## Purpose

Work on the facade in four simultaneous views — plan, two elevations,
perspective — like a CAD workspace, on the existing `/facade` page.

## Decisions

| Question | Decision |
|---|---|
| The two elevation panes | Overview + detail of the SAME elevation (a one-facade building has exactly one elevation; corner buildings are deferred) |
| Grid UX | Equal 2×2 grid + maximize toggle per pane; mobile = single pane + view-switcher strip |
| Rendering | Rendered everywhere — one scene, same materials/sun/shadows in all four panes; orthographic cameras for plan + elevations (NOT drawing-style) |
| Elevation direction | **Always perpendicular to the facade plane** — camera direction derived from the facade's normal, never from world axes (binding; pays off for C's angled blocks) |

## Architecture

One R3F `Canvas`, one scene graph (facade mesh, context, ground, lights —
unchanged), split into four viewports with drei's `<View>` — each view has its
own camera and controls. No scene duplication; every edit updates all panes
simultaneously because they are windows onto the same scene.

## The panes

| Pane | Camera | Controls | Framing |
|---|---|---|---|
| Plan | Orthographic, top-down | pan/zoom only (no rotate) | fits footprint + context |
| Perspective | Current viewer verbatim | front-hemisphere orbit | unchanged |
| Elevation: overview | Orthographic along facade normal | pan/zoom | auto-fitted to facade bounds + margin; refits on width/height change |
| Elevation: detail | Orthographic along facade normal | pan/zoom | starts framed on the ground floor; free zoom for close work |

Plan shows: wall footprint (with thickness), stoop, neighbor masses,
sidewalk/road strips.

## Interactions

- Double-click (or corner button) maximizes a pane to the full viewer area;
  again restores the 2×2 grid.
- Mobile: one pane at a time + a switcher strip (2×2 unusable at phone width).
- **Save image** captures the maximized pane; in grid view it captures the
  perspective pane. (Keeps the opaque-sky compositing from v1.)
- Sun sliders affect all panes (rendered everywhere).
- No editing gestures inside panes in B — edits stay in the controls panel and
  bay grid. Plan-pane drawing arrives with C.

## Testing

Viewer/interaction code is verified visually (per repo convention). Any new
pure helpers (e.g. elevation-fit math: facade bounds → ortho frustum) get
vitest coverage in `src/lib/facade/`.

## Not in scope

Drawing in plan (C); street elevations tracking multiple blocks (C); side
elevations / corner buildings (deferred); drawing-style rendering.
