# Facademaker extraction audit

Audited 2026-07-27 after extracting Homemaker UI's `/facade` route into this
standalone Next.js project.

## Verification completed

- TypeScript: pass
- ESLint: pass
- Vitest: 46 files, 731 tests pass
- Next.js 16 production build: pass
- Browser smoke tests: desktop, 768 px, and 320 px
- Offline Amsterdam fixture: 1,585 buildings and 212 streets load
- Autosave refresh: demo restores from local fixtures without an Overpass call
- API validation: all four POST routes return 400 for an empty payload

## Problems fixed during extraction

### Imported-city cameras ignored the imported scene

All panes now share one world envelope derived from editable blocks, street
points, context footprints, and terrain extents. Plan and 3D take a first-fit
snapshot as imported layers arrive, elevation cameras use the same city-scale
centre and clipping range, and subsequent ordinary edits preserve user camera
movement. Pure bounds/camera tests cover blank, mixed-layer, and city-scale
scenes.

### Heavy scenes duplicated geometry and rendered continuously

The 1,585-building demo previously built the same merged context and displaced
ground geometries once per pane. Both are now built once at the viewer
boundary, shared as immutable geometry, and disposed by their single owner.
Mobile first render mounts only its active pane; hidden panes are unmounted.
Static editing uses render-on-demand, plan/elevation skip expensive shadow
passes, and a context-heavy scene caps DPR at 1.

Before the native-WebGPU stress test crashed the persistent test browser, the
default WebGL demo completed a desktop-to-mobile transition and delivered two
post-resize frames in 29 ms. See the remaining clean-process verification gate
below.

### Default WebGPU could blank or stall all four viewports

Native WebGPU produced invalid depth/scissor render passes in Chromium's
quad-view layout and could become unresponsive with the imported demo. The
async renderer now receives the live canvas size, and classic WebGL is the
production default. Native WebGPU remains available behind `?webgpu`;
WebGPURenderer's WebGL2 backend remains available behind `?webgl2`.

### The offline demo became an online request after refresh

Context footprints are intentionally omitted from the serialized document.
The generic restore path therefore saw the demo bbox and called
`/api/buildings`, turning refresh into a slow, rate-limited Overpass request.
Restore now recognizes the exact committed demo projection frame and reloads
the local building fixture.

### Production builds depended on Google Fonts

`next/font/google` made a network request during `next build`, so an offline or
restricted build failed. The fork now uses a system font stack and builds
without fetching fonts.

### Nested project root inference was ambiguous

Next detected both the parent and Facademaker lockfiles. Turbopack now uses the
parent dependency root while this directory is nested, and automatically uses
the local project root after a standalone install.

### Missing failure and small-screen affordances

The fork now has an editor error boundary, an application icon, a horizontally
scrollable compact header, and a labeled place-picker dialog with initial
focus, Escape handling, and viewport-aware map height.

## Remaining findings

### P1 verification gate — repeat heavy resize in a clean browser process

The default WebGL path passed one full-demo responsive transition after the
geometry/lifecycle fixes. The subsequent explicit `?webgpu` run hard-crashed
Chromium, and the plugin's persistent browser/GPU process remained unstable
across later tabs, so those later resize failures are not clean evidence about
the default path. Run the demo-load/refresh/resize loop in fresh Chromium and
Safari processes before declaring this P1 fully closed.

### P2 — Native WebGPU remains experimental

Native WebGPU is no longer on any production-default path. The explicit
`?webgpu` diagnostic run still crashed Chromium under the full imported demo;
keep it opt-in until a targeted Chromium/Safari matrix covers initial sizing,
maximize/restore, device loss, demo import, and repeated responsive resizes.

### P2 — Core UI modules are too large to audit confidently

- `src/components/facade/FacadeViewer.tsx`: about 3,000 lines
- `src/app/page.tsx`: about 2,000 lines
- `src/components/facade/FacadeControls.tsx`: about 1,700 lines
- `src/components/facade/FacadeMesh.tsx`: about 1,000 lines

Split page state into document/import/selection hooks, pane rendering into
separate components, and inspector sections into focused modules. This is a
maintainability and regression-risk issue, not merely style.

### P2 — Browser-critical flows have no repeatable end-to-end test

The pure-function suite is strong, but it cannot catch blank renderers,
autosave-triggered network calls, focus behavior, or responsive stalls. Add a
small browser suite for blank startup, demo load plus refresh, place-picker
keyboard behavior, renderer query modes, and 320/768/1440 viewport smoke tests.

### P2 — The place-picker dialog does not trap focus

It now labels the dialog, focuses Cancel, and closes on Escape, but keyboard
focus can still leave the modal. Add a real focus trap or migrate to the native
`<dialog>` top layer with tested focus return.

### Dependency advisory follow-up

Lockfile generation's online npm summary reported seven advisories: one low,
one moderate, and five high. The environment did not permit sending the
dependency tree to npm for advisory details, and the offline cache had no
usable records. Do not apply a forced upgrade blindly; run `npm audit` in the
project's normal trusted CI environment and review whether each path reaches a
production dependency.
