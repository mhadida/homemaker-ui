import type { FacadeParams, OpeningKind } from "./types";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Resolve the (storeys × bays) grid of opening kinds: defaults from the
 * ground-floor treatment + upper-storey windows, then sparse overrides.
 * Indexed [storey][bay]; storey 0 = ground, bay 0 = leftmost. */
export function resolveGrid(params: FacadeParams): OpeningKind[][] {
  const { storeys, bays } = params;
  const doorBay = clamp(params.groundFloor.doorBay, 0, bays - 1);
  const t = params.groundFloor.treatment;

  const grid: OpeningKind[][] = [];
  for (let s = 0; s < storeys; s++) {
    const row: OpeningKind[] = [];
    for (let b = 0; b < bays; b++) {
      if (s === 0) {
        if (b === doorBay) row.push(t === "garage" ? "garage" : "door");
        else row.push(t === "shopfront" ? "shopfront" : "window");
      } else {
        row.push("window");
      }
    }
    grid.push(row);
  }

  for (const o of params.cellOverrides ?? []) {
    if (o.storey >= 0 && o.storey < storeys && o.bay >= 0 && o.bay < bays) {
      grid[o.storey][o.bay] = o.kind;
    }
  }
  return grid;
}
