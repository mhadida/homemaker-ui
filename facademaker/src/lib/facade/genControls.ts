/** Average + variation view over the generator's stored {min, max} ranges.
 *
 * The STORED shape (BlockGenSettings.lotWidth / .storeys as min/max) and the
 * generator itself are untouched — saved scenes stay byte-identical and no
 * migration is needed. These helpers only re-parameterize the sliders:
 * avg = midpoint, variation = half-spread as a fraction of the average. */

export interface Range {
  min: number;
  max: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export const rangeAvg = (r: Range): number => (r.min + r.max) / 2;

/** 0 = every building identical; 0.5 = min/max spread ±50% of the average. */
export const rangeVariation = (r: Range): number => {
  const avg = rangeAvg(r);
  return avg > 0 ? (r.max - r.min) / (2 * avg) : 0;
};

/** Rebuild a stored range from the slider view. `integer` rounds both ends
 * (storeys); the result is clamped into [lo, hi] and kept ordered. */
export function rangeFromAvg(
  avg: number,
  variation: number,
  lo: number,
  hi: number,
  integer = false,
): Range {
  let min = avg * (1 - variation);
  let max = avg * (1 + variation);
  if (integer) {
    min = Math.round(min);
    max = Math.round(max);
  }
  min = clamp(min, lo, hi);
  max = clamp(max, lo, hi);
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

/** Slider bounds for the avg/variation view. */
export const GEN_WIDTH_BOUNDS = { lo: 4, hi: 16 } as const;
export const GEN_STOREYS_BOUNDS = { lo: 1, hi: 6 } as const;
export const GEN_VARIATION_MAX = 0.6;
