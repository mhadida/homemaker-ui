# Window Mullion Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Window glazing pattern becomes a facade parameter with four styles — georgian grid, sash 2-over-2 (current look, the default), victorian 1-over-1, none.

**Architecture:** `WindowStyleId` on `FacadeParams` (default `"sash"` = rendering unchanged); `WindowFill` switches its internal bars via a new private `MullionBars` component; the door transom (sub-project A) gets georgian bars when the style is georgian. Presets adopt natural styles. Controls chip row, local parser keywords, AI spec enum — all following the exact patterns already in each file.

**Tech Stack:** Existing stack, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-window-mullions-design.md`

## Global Constraints

- `WindowStyleId = "georgian" | "sash" | "victorian" | "none"`; `FacadeParams.windowStyle` is REQUIRED; `DEFAULT_FACADE.windowStyle = "sash"`.
- Preset styles: georgian → `"georgian"`, victorian-shopfront → `"victorian"`, modern → `"none"`.
- `sash` must render byte-identically to today's WindowFill bars (center mullion 0.05 wide + meeting rail at `0.12 h`).
- Georgian: 2 vertical bars at thirds; horizontal bar count = `Math.max(2, Math.round(h / (w / 3)))` rows; glazing bar thickness `0.04`.
- Changing the style in the controls clears `preset` (structural edit). Color-style parity: the AI echoes current via required enum, like every other field.
- Layout engine (`layout.ts`) is NOT touched — mullions are fill rendering.
- Work on branch `feature/window-mullions` off `main`. Gate per task: `npm test && npx tsc --noEmit && npm run lint`. Dev server on :3000 may be running — leave it alone. Unrelated dirty files (public/default.glb, python/vendor submodule): leave untouched.

---

### Task 1: Types, presets, and local parser (TDD)

**Files:**
- Modify: `src/lib/facade/types.ts` (type + `FacadeParams` + `DEFAULT_FACADE` + the three presets + a new options list)
- Modify: `src/lib/facade/types.test.ts` (append one test)
- Modify: `src/lib/facade/prompt-parser.ts` (keyword block)
- Modify: `src/lib/facade/prompt-parser.test.ts` (append two tests)

**Interfaces:**
- Consumes: existing types/presets/parser.
- Produces: `WindowStyleId`, `FacadeParams.windowStyle: WindowStyleId`, `WINDOW_STYLE_OPTIONS: { id: WindowStyleId; label: string }[]` — Tasks 2 and 3 import exactly these names.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feature/window-mullions
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/facade/types.test.ts` inside `describe("facade types")`:

```ts
  it("default and presets carry a valid windowStyle", () => {
    const valid = ["georgian", "sash", "victorian", "none"];
    expect(DEFAULT_FACADE.windowStyle).toBe("sash");
    for (const [id, preset] of Object.entries(FACADE_PRESETS)) {
      const p = { ...DEFAULT_FACADE, ...preset.params };
      expect(valid, id).toContain(p.windowStyle);
    }
    expect(FACADE_PRESETS.georgian.params.windowStyle).toBe("georgian");
    expect(FACADE_PRESETS["victorian-shopfront"].params.windowStyle).toBe("victorian");
    expect(FACADE_PRESETS.modern.params.windowStyle).toBe("none");
  });
```

Append to `src/lib/facade/prompt-parser.test.ts` inside `describe("parseFacadePromptLocal")`:

```ts
  it("parses window glazing styles", () => {
    expect(parseFacadePromptLocal("small panes").windowStyle).toBe("georgian");
    expect(parseFacadePromptLocal("sash windows").windowStyle).toBe("sash");
    expect(parseFacadePromptLocal("plain glass").windowStyle).toBe("none");
  });

  it("explicit glazing overrides the preset's default", () => {
    const u = parseFacadePromptLocal("georgian house with plain glass");
    expect(u.preset).toBe("georgian");
    expect(u.windowStyle).toBe("none");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/facade/types.test.ts src/lib/facade/prompt-parser.test.ts`
Expected: the 3 new tests FAIL (`windowStyle` undefined); existing tests pass.

- [ ] **Step 4: Implement**

4a. In `src/lib/facade/types.ts`, after the `PresetId` type add:

```ts
export type WindowStyleId = "georgian" | "sash" | "victorian" | "none";

/** Order matches the controls chip row. */
export const WINDOW_STYLE_OPTIONS: { id: WindowStyleId; label: string }[] = [
  { id: "georgian", label: "Georgian" },
  { id: "sash", label: "Sash" },
  { id: "victorian", label: "1-over-1" },
  { id: "none", label: "Plain" },
];
```

4b. In `FacadeParams`, after `windowHeightRatio: number;` add:

```ts
  /** Internal glazing-bar pattern for windows (and the door transom). */
  windowStyle: WindowStyleId;
```

4c. In `DEFAULT_FACADE`, after `windowHeightRatio: 0.55,` add:

```ts
  windowStyle: "sash",
```

4d. In `FACADE_PRESETS`, add to each preset's `params` (after its `windowHeightRatio` line):
- georgian: `windowStyle: "georgian",`
- "victorian-shopfront": `windowStyle: "victorian",`
- modern: `windowStyle: "none",`

4e. In `src/lib/facade/prompt-parser.ts`, insert AFTER the ornament block and BEFORE the colors block (so explicit glazing keywords override a preset's `windowStyle` set earlier by `Object.assign`):

```ts
  // Window glazing — explicit keywords override a preset's default style.
  if (/\bsmall panes?\b|\bgeorgian windows?\b|\bglazing bars?\b/.test(lower)) {
    updates.windowStyle = "georgian";
  } else if (/\bsash\b/.test(lower)) {
    updates.windowStyle = "sash";
  } else if (/\bsingle pane\b|\bplain glass\b|\bplain windows?\b/.test(lower)) {
    updates.windowStyle = "none";
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/facade/types.test.ts src/lib/facade/prompt-parser.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — expect errors ONLY if some FacadeParams literal misses `windowStyle`; the only complete literals are `DEFAULT_FACADE` (fixed in 4c) and test fixtures that spread it. If tsc reports others, add `windowStyle: "sash"` there and note it in your report.

- [ ] **Step 6: Full gate and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 42 tests pass, clean.

```bash
git add src/lib/facade/types.ts src/lib/facade/types.test.ts src/lib/facade/prompt-parser.ts src/lib/facade/prompt-parser.test.ts
git commit -m "feat(facade): windowStyle param — types, presets, parser keywords"
```

---

### Task 2: Mesh — MullionBars + transom bars

**Files:**
- Modify: `src/components/facade/FacadeMesh.tsx` (WindowFill, DoorFill, both call sites)

**Interfaces:**
- Consumes: `WindowStyleId` from `@/lib/facade/types` (Task 1); existing `Glass`, `Trim`, `FRAME_T`, `FRAME_D`, `GLASS_RECESS`.
- Produces: rendering only, no exports.

- [ ] **Step 1: Add the import**

Extend the existing types import in `src/components/facade/FacadeMesh.tsx`:

```ts
import type { FacadeParams, WindowStyleId } from "@/lib/facade/types";
```

- [ ] **Step 2: Add `MullionBars` (private, above `WindowFill`)**

```tsx
const GLAZING_BAR = 0.04; // thin internal glazing-bar thickness

/** Internal glazing bars for a w×h pane, centered on the group origin.
 * "sash" reproduces the pre-windowStyle rendering exactly. */
function MullionBars({
  w,
  h,
  style,
  trimColor,
}: {
  w: number;
  h: number;
  style: WindowStyleId;
  trimColor: string;
}) {
  if (style === "none") return null;
  if (style === "victorian") {
    return (
      <mesh position={[0, h * 0.12, 0]}>
        <boxGeometry args={[w, 0.05, FRAME_D]} />
        <Trim color={trimColor} />
      </mesh>
    );
  }
  if (style === "sash") {
    return (
      <>
        <mesh>
          <boxGeometry args={[0.05, h, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
        <mesh position={[0, h * 0.12, 0]}>
          <boxGeometry args={[w, 0.05, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      </>
    );
  }
  // georgian: vertical bars at thirds + horizontal bars for ~square panes
  const rows = Math.max(2, Math.round(h / (w / 3)));
  return (
    <>
      {[-w / 6, w / 6].map((x, i) => (
        <mesh key={`v${i}`} position={[x, 0, 0]}>
          <boxGeometry args={[GLAZING_BAR, h, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <mesh key={`h${i}`} position={[0, -h / 2 + ((i + 1) * h) / rows, 0]}>
          <boxGeometry args={[w, GLAZING_BAR, FRAME_D]} />
          <Trim color={trimColor} />
        </mesh>
      ))}
    </>
  );
}
```

- [ ] **Step 3: Switch `WindowFill` to use it**

Add `windowStyle` to the props:

```tsx
function WindowFill({
  o,
  trimColor,
  windowStyle,
}: {
  o: OpeningRect;
  trimColor: string;
  windowStyle: WindowStyleId;
}) {
```

and replace the two hardcoded bar meshes at the end of the group (the `{/* central mullion + transom bar (sash feel) */}` comment and the two `<mesh>` blocks after it) with:

```tsx
      <MullionBars w={o.w} h={o.h} style={windowStyle} trimColor={trimColor} />
```

- [ ] **Step 4: Georgian bars in the door transom**

Add `windowStyle: WindowStyleId` to `DoorFill`'s props (same pattern as Step 3). Inside the transom `<group>` (the `{o.transomH && (...)}` block), after the `<Glass …/>` line, add:

```tsx
          {windowStyle === "georgian" &&
            [-o.w / 6, o.w / 6].map((x, i) => (
              <mesh key={i} position={[x, 0, 0]}>
                <boxGeometry args={[GLAZING_BAR, o.transomH!, FRAME_D]} />
                <Trim color={trimColor} />
              </mesh>
            ))}
```

- [ ] **Step 5: Update both call sites**

In the openings map:

```tsx
          case "window":
            return (
              <WindowFill
                key={key}
                o={o}
                trimColor={params.trimColor}
                windowStyle={params.windowStyle}
              />
            );
          case "door":
            return (
              <DoorFill
                key={key}
                o={o}
                doorColor={params.doorColor}
                trimColor={params.trimColor}
                windowStyle={params.windowStyle}
              />
            );
```

- [ ] **Step 6: Gate and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: clean (42 tests).

```bash
git add src/components/facade/FacadeMesh.tsx
git commit -m "feat(facade): MullionBars — georgian/sash/victorian/plain glazing"
```

---

### Task 3: Controls, AI route, page wiring

**Files:**
- Modify: `src/components/facade/FacadeControls.tsx` (chip row in Bays & Openings)
- Modify: `src/app/api/facade-prompt/route.ts` (schema + system prompt)
- Modify: `src/app/facade/page.tsx` (spec interface + both mapping functions)

**Interfaces:**
- Consumes: `WINDOW_STYLE_OPTIONS`, `WindowStyleId` (Task 1).
- Produces: end-to-end control of `windowStyle`.

- [ ] **Step 1: Controls chip row**

In `src/components/facade/FacadeControls.tsx`: extend the types import with `WindowStyleId` and the values import with `WINDOW_STYLE_OPTIONS` (both from `@/lib/facade/types`). In the "Bays & Openings" `<Section>`, insert between the "Window height" `SliderRow` and `<BayGrid …/>`:

```tsx
        <div>
          <span className="text-[10px] text-[var(--muted)] block mb-1">
            Glazing
          </span>
          <div className="grid grid-cols-4 gap-1">
            {WINDOW_STYLE_OPTIONS.map((ws) => (
              <Toggle
                key={ws.id}
                label={ws.label}
                on={params.windowStyle === ws.id}
                onClick={() =>
                  update({ windowStyle: ws.id, preset: undefined })
                }
              />
            ))}
          </div>
        </div>
```

- [ ] **Step 2: AI route**

In `src/app/api/facade-prompt/route.ts`:

2a. Schema — after the `windowSize` line add:

```ts
  windowStyle: z.enum(["georgian", "sash", "victorian", "none"]),
```

2b. System prompt — in the "Current facade" block add:

```ts
    `- windowStyle: ${have.windowStyle ?? "sash"}`,
```

and in the Meanings block add:

```ts
    '- windowStyle: internal glazing bars — georgian (small-pane grid), sash (2-over-2), victorian (1-over-1), none (plain glass). Echo current unless the user mentions panes/glazing.',
```

- [ ] **Step 3: Page wiring**

In `src/app/facade/page.tsx`:

3a. The local `FacadeSpec` interface — after `windowSize?: …` add:

```ts
  windowStyle?: "georgian" | "sash" | "victorian" | "none";
```

3b. In `specToFacadeParams`, after the `windowSize` handling add:

```ts
  if (spec.windowStyle) next.windowStyle = spec.windowStyle;
```

3c. In `paramsToFacadeSpec`'s return object, after `windowSize: nearestWindowSize(p),` add:

```ts
    windowStyle: p.windowStyle,
```

- [ ] **Step 4: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 42 tests pass, clean.

- [ ] **Step 5: VISUAL CHECKPOINT** (controller performs if implementer has no browser)

On `/facade`: Georgian preset shows small-pane grids (and georgian transom bars over the door); Shopfront preset shows 1-over-1; Modern shows clean panes; the Glazing chips switch styles live and un-highlight the preset chip; "plain glass" in the prompt switches to none.

- [ ] **Step 6: Commit**

```bash
git add src/components/facade/FacadeControls.tsx src/app/api/facade-prompt/route.ts src/app/facade/page.tsx
git commit -m "feat(facade): glazing style chips + AI/parser wiring"
```

---

### Task 4: Finish

- [ ] **Step 1:** Full gate once more: `npm test && npx tsc --noEmit && npm run lint` — 42 tests, clean.
- [ ] **Step 2:** Hand off via superpowers:finishing-a-development-branch.

## Self-Review Notes

- Spec coverage: type/default/presets → T1 (4a-4d + test); parser → T1 4e + tests; four render styles + sash-identical default + transom bars → T2; chips clearing preset → T3.1; AI enum + echo + page mapping → T3.2-3.3. Layout untouched (no task touches layout.ts).
- Sash-identical check: MullionBars "sash" branch reproduces the exact two meshes removed from WindowFill (0.05 bars, rail at 0.12 h, FRAME_D depth).
- Type consistency: `WindowStyleId`/`WINDOW_STYLE_OPTIONS` (T1) consumed by T2/T3 with matching names; `windowStyle` required on FacadeParams — T1 Step 5 flags any missed literal via tsc.
