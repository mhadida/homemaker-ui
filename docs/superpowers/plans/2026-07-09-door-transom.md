# Door Head Alignment + Transom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground-floor doors stretch so their head aligns with the storey's window (or shopfront) head; openings ≥ 2.4 m split into a 2.1 m leaf + glazed transom.

**Architecture:** All geometry changes live in the pure layout engine (`computeLayout`'s door branch) — the door's `OpeningRect` gains an optional `transomH` field on the SAME single wall opening. The mesh layer's `DoorFill` splits its rendering (leaf panel below, frame bar + glass above) when `transomH` is present. Nothing else changes shape: BayGrid, controls, prompt, AI route are untouched.

**Tech Stack:** Existing v1 facade stack — TypeScript, vitest, R3F. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-door-transom-design.md`

## Global Constraints

- New constants (exact values): `DOOR_LEAF_HEIGHT = 2.1`, `TRANSOM_MIN = 0.3`. Transom exists iff opening height ≥ `DOOR_LEAF_HEIGHT + TRANSOM_MIN` (2.4 m).
- **Never-shrink**: the aligned door height is `max(current rule, alignment target)` — a door is never shorter than `min(DOOR_HEIGHT_MAX, sh − DOOR_HEAD_GAP − stoopRise)`.
- Alignment target priority: row contains `window` cells → window head (`SILL_HEIGHT + windowH`, same clamp formula windows use); else row contains `shopfront` → `sh − SHOPFRONT_FASCIA`; else no alignment.
- One wall opening per door (one hole); `transomH` is metadata, not a second rectangle.
- `garage` openings unchanged.
- Work on branch `feature/door-transom` off `main`. Commit per task. Gate: `npm test && npx tsc --noEmit && npm run lint`.
- A dev server may be running on :3000 — don't kill or restart it.
- Unrelated dirty files (`public/default.glb`, `python/vendor/homemaker-addon` submodule): leave untouched.

---

### Task 1: Layout engine — aligned door head + transom emission

**Files:**
- Modify: `src/lib/facade/layout.ts` (constants block ~line 44; `OpeningRect` ~line 58; door branch ~lines 139-147; the `openings.push` line ~171)
- Test: `src/lib/facade/layout.test.ts` (append to the `describe("computeLayout")` block)

**Interfaces:**
- Consumes: existing `computeLayout`, constants, `p()`/`invariants()` test helpers.
- Produces: `DOOR_LEAF_HEIGHT: 2.1` and `TRANSOM_MIN: 0.3` (exported consts); `OpeningRect.transomH?: number` — Task 2's mesh reads exactly this field name.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feature/door-transom
```

- [ ] **Step 2: Write the failing tests** — append inside `describe("computeLayout", ...)` in `src/lib/facade/layout.test.ts`:

```ts
  it("door head aligns to the window head on a tall ground floor, with transom", () => {
    // sh=3.4, ratio 0.55 → windowH=1.87, head=2.77; stoop raises door to y=0.3
    // → door h = 2.77-0.3 = 2.47 ≥ 2.4 → transom 0.37
    const layout = invariants(
      p({ storeyHeight: 3.4, storeyHeights: [3.4, 3.4, 3.4] }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    const win = layout.openings.find((o) => o.kind === "window" && o.storey === 0)!;
    expect(door.y + door.h).toBeCloseTo(win.y + win.h, 9);
    expect(door.h).toBeCloseTo(2.47, 9);
    expect(door.transomH).toBeCloseTo(2.47 - 2.1, 9); // DOOR_LEAF_HEIGHT
  });

  it("no transom below threshold; door never shrinks below the base rule", () => {
    // sh=2.8, ratio 0.45 → windowH=1.26, head=2.16 < base 2.3 → h stays 2.3, no transom
    const layout = invariants(
      p({
        storeyHeight: 2.8,
        storeyHeights: [2.8, 2.8, 2.8],
        windowHeightRatio: 0.45,
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(2.3, 9); // DOOR_HEIGHT_MAX — unchanged
    expect(door.transomH).toBeUndefined();
  });

  it("shopfront-row door aligns to the glazing head", () => {
    // sh=3.4 → shopfront head = 3.4-0.5 = 2.9 → door h=2.9, transom 0.8
    const layout = invariants(
      p({
        width: 9,
        bays: 3,
        storeyHeight: 3.4,
        storeyHeights: [3.4, 3.4, 3.4],
        groundFloor: { treatment: "shopfront", doorBay: 1, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    const shop = layout.openings.find((o) => o.kind === "shopfront")!;
    expect(door.y + door.h).toBeCloseTo(shop.y + shop.h, 9);
    expect(door.transomH).toBeCloseTo(2.9 - 2.1, 9);
  });

  it("squat storey: door keeps the current rule, no transom", () => {
    // sh=2.2 → window head 1.9 == base min(2.3, 1.9) → h=1.9 (same as v1), no transom
    const layout = invariants(
      p({
        storeyHeight: 2.2,
        storeyHeights: [2.2, 2.2, 2.2],
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(1.9, 9);
    expect(door.transomH).toBeUndefined();
  });

  it("row with no windows or shopfronts: door keeps the base rule", () => {
    // Ground row overridden to [door, blank, blank] → no alignment target
    const layout = invariants(
      p({
        storeyHeight: 3.4,
        storeyHeights: [3.4, 3.4, 3.4],
        groundFloor: { treatment: "residential", doorBay: 0, stoop: false },
        cellOverrides: [
          { storey: 0, bay: 1, kind: "blank" },
          { storey: 0, bay: 2, kind: "blank" },
        ],
      }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.h).toBeCloseTo(2.3, 9);
    expect(door.transomH).toBeUndefined();
  });

  it("stoop + transom: leaf measures from the raised threshold", () => {
    const layout = invariants(
      p({ storeyHeight: 3.4, storeyHeights: [3.4, 3.4, 3.4] }),
    );
    const door = layout.openings.find((o) => o.kind === "door")!;
    expect(door.y).toBeCloseTo(0.3, 9); // STOOP_RISE × STOOP_STEPS
    expect(layout.stoop).not.toBeNull();
    expect(door.transomH).toBeDefined();
    // leaf top (door.y + 2.1) sits below the head by exactly transomH
    expect(door.y + 2.1 + door.transomH!).toBeCloseTo(door.y + door.h, 9);
  });
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: the 6 new tests FAIL (door heights still 2.3/2.3/2.3/…, `transomH` undefined where expected); the existing 20 still pass.

- [ ] **Step 4: Implement in `src/lib/facade/layout.ts`**

4a. Add two constants right after `export const DOOR_HEAD_GAP = 0.3;`:

```ts
export const DOOR_LEAF_HEIGHT = 2.1; // fixed door-leaf height; transom fills above
export const TRANSOM_MIN = 0.3; // no sliver transoms — leaf stretches instead
```

4b. Add to `OpeningRect` (after `h: number;`):

```ts
  /** Glazed transom height above a DOOR_LEAF_HEIGHT leaf (door kind only;
   * absent when the leaf fills the whole opening). */
  transomH?: number;
```

4c. Declare the per-opening variable: change the line `let x: number, y: number, w: number, h: number;` to:

```ts
      let x: number, y: number, w: number, h: number;
      let transomH: number | undefined;
```

4d. Replace the door branch (currently):

```ts
      } else if (kind === "door") {
        const raised = s === 0 && params.groundFloor.stoop &&
          params.groundFloor.treatment === "residential";
        const yOff = raised ? stoopRise : 0;
        w = Math.min(DOOR_WIDTH, maxW);
        h = Math.min(DOOR_HEIGHT_MAX, sh - DOOR_HEAD_GAP - yOff);
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY + yOff;
      } else if (kind === "garage") {
```

with:

```ts
      } else if (kind === "door") {
        const raised = s === 0 && params.groundFloor.stoop &&
          params.groundFloor.treatment === "residential";
        const yOff = raised ? stoopRise : 0;
        w = Math.min(DOOR_WIDTH, maxW);
        // Base rule is the floor — head alignment only ever GROWS the door.
        const baseH = Math.min(DOOR_HEIGHT_MAX, sh - DOOR_HEAD_GAP - yOff);
        // Alignment target (head height above the storey floor): the row's
        // window head, else the shopfront glazing head, else none.
        let alignedHead = 0;
        const windowMaxH = sh - SILL_HEIGHT - WINDOW_HEAD_GAP;
        if (grid[s].includes("window") && windowMaxH >= MIN_WINDOW_HEIGHT) {
          const windowH = clamp(
            params.windowHeightRatio * sh,
            MIN_WINDOW_HEIGHT,
            windowMaxH,
          );
          alignedHead = SILL_HEIGHT + windowH;
        } else if (grid[s].includes("shopfront")) {
          alignedHead = sh - SHOPFRONT_FASCIA;
        }
        // Defensive cap: alignment targets are ≤ sh − DOOR_HEAD_GAP by
        // construction, but the head-gap clamp must always win.
        h = Math.min(
          Math.max(baseH, alignedHead - yOff),
          sh - DOOR_HEAD_GAP - yOff,
        );
        if (h < 1.6) continue;
        x = bayCenter - w / 2;
        y = floorY + yOff;
        if (h >= DOOR_LEAF_HEIGHT + TRANSOM_MIN) {
          transomH = h - DOOR_LEAF_HEIGHT;
        }
      } else if (kind === "garage") {
```

4e. Change the push line from:

```ts
      openings.push({ kind, storey: s, bay: b, x, y, w, h });
```

to:

```ts
      const rect: OpeningRect = { kind, storey: s, bay: b, x, y, w, h };
      if (transomH !== undefined) rect.transomH = transomH;
      openings.push(rect);
```

- [ ] **Step 5: Run the full layout suite**

Run: `npx vitest run src/lib/facade/layout.test.ts`
Expected: PASS — 26 tests (20 existing + 6 new). Note: existing tests were chosen not to assert door heights that change; if one fails, check whether its expectation encodes the OLD door rule before touching implementation.

- [ ] **Step 6: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests pass (39 total), tsc clean, lint 0 errors (3 pre-existing warnings in untouched files are OK).

- [ ] **Step 7: Commit**

```bash
git add src/lib/facade/layout.ts src/lib/facade/layout.test.ts
git commit -m "feat(facade): door head aligns to window/shopfront head, transom past 2.4m"
```

---

### Task 2: Mesh — leaf + transom rendering

**Files:**
- Modify: `src/components/facade/FacadeMesh.tsx` (the `DoorFill` component ~lines 104-127, and its call site in the openings map)

**Interfaces:**
- Consumes: `OpeningRect.transomH` (Task 1), existing `Glass` and `Trim` components in the same file.
- Produces: no new exports — rendering only.

- [ ] **Step 1: Replace `DoorFill`**

Current component (group centered on the opening):

```tsx
function DoorFill({ o, doorColor }: { o: OpeningRect; doorColor: string }) {
  return (
    <group position={[o.x + o.w / 2, o.y + o.h / 2, -0.18]}>
      ...
  );
}
```

Replace the whole component with (group now anchored at the opening BOTTOM so the leaf math is bottom-up):

```tsx
function DoorFill({
  o,
  doorColor,
  trimColor,
}: {
  o: OpeningRect;
  doorColor: string;
  trimColor: string;
}) {
  // With a transom, the leaf occupies the bottom DOOR_LEAF_HEIGHT of the
  // opening (o.h - transomH === DOOR_LEAF_HEIGHT by construction).
  const leafH = o.transomH ? o.h - o.transomH : o.h;
  return (
    <group position={[o.x + o.w / 2, o.y, -0.18]}>
      {/* leaf panel */}
      <mesh position={[0, leafH / 2, 0]} castShadow>
        <boxGeometry args={[o.w, leafH, 0.07]} />
        <meshStandardMaterial color={doorColor} roughness={0.5} />
      </mesh>
      {/* two raised panel hints (same proportions as before, bottom-up) */}
      <mesh position={[0, leafH * 0.72, 0.045]}>
        <boxGeometry args={[o.w * 0.62, leafH * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      <mesh position={[0, leafH * 0.28, 0.045]}>
        <boxGeometry args={[o.w * 0.62, leafH * 0.3, 0.015]} />
        <meshStandardMaterial color={doorColor} roughness={0.4} />
      </mesh>
      {/* knob */}
      <mesh position={[o.w * 0.32, leafH / 2, 0.06]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color="#b8a878" roughness={0.25} metalness={0.8} />
      </mesh>
      {/* glazed transom above the leaf */}
      {o.transomH && (
        <group position={[0, leafH + o.transomH / 2, 0]}>
          <Glass w={o.w} h={o.transomH} />
          {/* frame bar between leaf and transom */}
          <mesh position={[0, -o.transomH / 2 + 0.04, 0.02]}>
            <boxGeometry args={[o.w, 0.08, 0.1]} />
            <Trim color={trimColor} />
          </mesh>
          {/* slim top frame member */}
          <mesh position={[0, o.transomH / 2 - 0.035, 0]}>
            <boxGeometry args={[o.w, 0.07, 0.06]} />
            <Trim color={trimColor} />
          </mesh>
        </group>
      )}
    </group>
  );
}
```

- [ ] **Step 2: Update the call site**

In the openings map, change:

```tsx
          case "door":
            return <DoorFill key={key} o={o} doorColor={params.doorColor} />;
```

to:

```tsx
          case "door":
            return (
              <DoorFill
                key={key}
                o={o}
                doorColor={params.doorColor}
                trimColor={params.trimColor}
              />
            );
```

- [ ] **Step 3: Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all clean (mesh has no unit tests by design).

- [ ] **Step 4: VISUAL CHECKPOINT** (controller performs if implementer has no browser)

On the running dev server, open `/facade`:
1. Default (Georgian-ish, 2.95 m ground): door head now meets a target above the leaf — transom glass + frame bar visible above the door, knob at leaf mid-height.
2. Apply the Shopfront preset: the door in the shopfront row rises to the glazing head (2.9 m on 3.4 m storeys) with a tall transom.
3. Drop storey height to 2.2 m: no transom, plain shorter door (unchanged from v1).
4. Stoop toggle: steps + raised threshold still correct with the transom present.

- [ ] **Step 5: Commit**

```bash
git add src/components/facade/FacadeMesh.tsx
git commit -m "feat(facade): DoorFill renders leaf + glazed transom"
```

---

### Task 3: Finish

- [ ] **Step 1: Full gate once more**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 39 tests pass, clean.

- [ ] **Step 2: Hand off**

Use superpowers:finishing-a-development-branch (merge to main after review, per project flow).

## Self-Review Notes

- Spec coverage: alignment targets (window/shopfront/none) → Task 1 branch + tests; never-shrink → baseH max + squat test; threshold/leaf constants → 4a + threshold tests; single-opening + `transomH` metadata → 4b/4e; stoop interaction → test 6; mesh leaf/bar/glass → Task 2; garage untouched (no code path change).
- Numeric expectations were derived from the implementation formulas: 3.4 m storey → windowH 1.87 → head 2.77 → door 2.47/transom 0.37; shopfront 3.4 → head 2.9 → transom 0.8; 2.2 m storey → 1.9 base = aligned (no change).
- Type consistency: `transomH` optional on `OpeningRect` (Task 1) is exactly what `DoorFill` reads (Task 2); `Glass`/`Trim` exist in FacadeMesh.tsx today.
