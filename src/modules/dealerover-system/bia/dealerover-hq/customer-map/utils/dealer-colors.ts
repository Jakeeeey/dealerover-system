/**
 * Fixed dealer palette for the customer map (20 colours).
 *
 * MapLibre renders markers on a WebGL canvas, which cannot consume CSS theme
 * tokens — marker fills must therefore be explicit colour values. The first
 * eight entries are the Okabe–Ito base (plus two fallbacks) that the three HQ
 * dealers ship with; later entries extend the same qualitative set so rosters
 * of up to ~20 dealers stay distinguishable in both light and dark themes.
 * Entries are append-only: one colour is assigned per dealer in roster order,
 * so appending never re-tones an existing dealer.
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
  "#F0E442", // yellow
  "#BE0032", // crimson
  "#117733", // forest green
  "#DDCC77", // sand
  "#33A02C", // bright green
  "#FB9A99", // light coral
  "#FDBF6F", // light amber
  "#CAB2D6", // lilac
  "#00BFC4", // bright cyan
  "#771155", // wine
  "#6A6A6A", // gray
  "#B3B3B3", // silver
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
