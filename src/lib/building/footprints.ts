/** Pure footprint-coordinate helpers used by sliders and prompt parsing.
 * No rendering — just (x,y) tuples that the backend's Homemaker pipeline
 * consumes. */

export function rectangularFootprint(width: number, depth: number): [number, number][] {
  const hw = width / 2;
  const hd = depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
}

export function lShapedFootprint(
  width: number,
  depth: number,
  wingRatio: number = 0.4,
): [number, number][] {
  const hw = width / 2;
  const hd = depth / 2;
  const ww = width * wingRatio;
  const wd = depth * wingRatio;
  return [
    [-hw, -hd],
    [hw - ww, -hd],
    [hw - ww, hd - wd],
    [hw, hd - wd],
    [hw, hd],
    [-hw, hd],
  ];
}

export function uShapedFootprint(
  width: number,
  depth: number,
  wingRatio: number = 0.35,
): [number, number][] {
  const hw = width / 2;
  const hd = depth / 2;
  const ww = width * wingRatio;
  const wd = depth * wingRatio;
  return [
    [-hw, -hd],
    [-hw + ww, -hd],
    [-hw + ww, hd - wd],
    [hw - ww, hd - wd],
    [hw - ww, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
}

export function hShapedFootprint(
  width: number,
  depth: number,
  barRatio: number = 0.3,
  crossbarRatio: number = 0.3,
): [number, number][] {
  const hw = width / 2;
  const hd = depth / 2;
  const bw = width * barRatio;
  const cd = depth * crossbarRatio;
  const innerL = -hw + bw;
  const innerR = hw - bw;
  const innerB = -cd / 2;
  const innerT = cd / 2;
  return [
    [-hw, -hd], [innerL, -hd], [innerL, innerB], [innerR, innerB], [innerR, -hd], [hw, -hd],
    [hw, hd], [innerR, hd], [innerR, innerT], [innerL, innerT], [innerL, hd], [-hw, hd],
  ];
}

/** Courtyard: outer rectangle with a centered rectangular void.
 * Returns { outer, hole } so the caller can plumb them into
 * BuildingParams.footprint and BuildingParams.holes. */
export function courtyardFootprint(
  width: number,
  depth: number,
  holeRatio: number = 0.45,
): { outer: [number, number][]; hole: [number, number][] } {
  const hw = width / 2;
  const hd = depth / 2;
  const hhw = (width * holeRatio) / 2;
  const hhd = (depth * holeRatio) / 2;
  return {
    outer: [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ],
    // CW winding for hole (opposite of outer)
    hole: [
      [-hhw, -hhd],
      [-hhw, hhd],
      [hhw, hhd],
      [hhw, -hhd],
    ],
  };
}
