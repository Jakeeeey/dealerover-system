/**
 * Fixed, colour-blind-safe dealer palette for the customer map.
 *
 * MapLibre renders markers on a WebGL canvas, which cannot consume CSS theme
 * tokens — marker fills must therefore be explicit colour values. The palette
 * (Okabe–Ito plus two fallbacks) keeps the three HQ dealers visually distinct in
 * both light and dark themes; one colour is assigned per dealer in roster order.
 */
export const DEALER_COLOR_PALETTE = [
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#7F3FBF", // violet
  "#8C564B", // brown
] as const;

/** Canvas-only marker outline colour (WebGL cannot read theme tokens). */
export const MARKER_STROKE_COLOR = "#FFFFFF";

/**
 * Returns the dealer colour for a zero-based roster index, wrapping the palette.
 * @param {number} index - Position of the dealer in the HQ roster.
 * @returns {string} A hex colour string.
 */
export function getDealerColor(index: number): string {
  const safe = Number.isFinite(index) && index >= 0 ? Math.trunc(index) : 0;
  return DEALER_COLOR_PALETTE[safe % DEALER_COLOR_PALETTE.length];
}
