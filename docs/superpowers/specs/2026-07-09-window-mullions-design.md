# Window Mullion Styles — Design Spec (v2 sub-project A2)

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming session)
**Depends on:** sub-project A (door/transom — the transom inherits the style).
Independent of B and C; C's generator will randomize `windowStyle` later.

## Purpose

Windows currently hardcode one glazing pattern (center mullion + meeting
rail). Make the pattern a facade parameter with four styles.

## Decisions

| Question | Decision |
|---|---|
| Styles | `georgian` (small-pane grid), `sash` (2-over-2, current look), `victorian` (1-over-1, rail only), `none` (clean pane) |
| Scope | Facade-wide parameter (`FacadeParams.windowStyle`), not per-cell |
| Default | `sash` — rendering unchanged until the user picks |
| Sequencing | A2, immediately after door/transom merges, before B |

## Type & data

- `src/lib/facade/types.ts`:
  `export type WindowStyleId = "georgian" | "sash" | "victorian" | "none";`
  `FacadeParams.windowStyle: WindowStyleId` (required; `DEFAULT_FACADE` uses `"sash"`).
- Presets: georgian → `"georgian"`, victorian-shopfront → `"victorian"`,
  modern → `"none"`.

## Rendering (`WindowFill` in FacadeMesh.tsx — pure fill, no layout change)

Bar thickness 0.04 m, trim color, same depth as existing frame members.

- `georgian`: 2 vertical bars at thirds; horizontal bars pitched for roughly
  square panes — rows = `max(2, round(h / (w / 3)))`.
- `sash`: current — one center mullion + one meeting rail at 0.12 h.
- `victorian`: meeting rail only.
- `none`: frame + glass only.

Door **transom** (from A): `georgian` adds vertical bars at thirds; other
styles keep the transom plain. Shopfront glazing keeps its own existing
mullion rhythm — untouched.

## Controls, parser, AI

- Controls: 4-chip segmented row under the window sliders in Bays & Openings;
  changing it clears `preset` (structural edit).
- Local parser: "small panes" / "georgian windows" → georgian; "sash" → sash;
  "single pane" / "plain glass" → none. (Bare "victorian"/"georgian" continue
  to hit the preset keywords first, which now set windowStyle via the preset.)
- AI route: `windowStyle: z.enum(["georgian","sash","victorian","none"])`
  added to FacadeSpec (required, echo-current); client maps it 1:1.

## Testing

- types test: presets carry valid `windowStyle`.
- parser tests: the three keyword groups above.
- Mesh rendering verified visually (repo convention).

## Not in scope

Per-cell window styles (future via cellOverrides if ever needed); shopfront
mullion styles; diamond/leaded patterns.
