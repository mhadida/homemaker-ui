/** Window frames + glazing bars ("mullions") are WHITE or BLACK only — never
 * the pastel trim colour. Which one is chosen by the wall's lightness, the
 * Scandinavian convention: white frames on a coloured wall, black frames on a
 * white/cream wall. Pure. */

export const WINDOW_BAR_WHITE = "#f4f1ea";
export const WINDOW_BAR_BLACK = "#26262a";

/** Relative luminance (0–1) of a #rrggbb colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 1;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Above this the wall reads as white/cream → black frames; below it the wall
// has real colour → white frames. Tuned so every pastel wall (incl. scandi
// yellow) gets white frames and only cream / warm-white get black.
const LIGHT_WALL = 0.84;

export function windowBarColor(wallColor: string): string {
  return luminance(wallColor) > LIGHT_WALL ? WINDOW_BAR_BLACK : WINDOW_BAR_WHITE;
}
