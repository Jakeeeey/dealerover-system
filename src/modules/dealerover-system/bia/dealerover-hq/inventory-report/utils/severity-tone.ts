import type { StatusTone } from "@/components/ui/status-badge";
import type { LowStockState } from "../types";

export const TONE_BY_STATE: Record<LowStockState, StatusTone> = {
  out: "destructive",
  critical: "destructive",
  low: "warning",
  watch: "info",
  healthy: "success",
  overstock: "neutral",
  dead: "neutral",
  dropped: "neutral",
  unrated: "neutral",
};

export const STATE_LABEL: Record<LowStockState, string> = {
  out: "Stock-out",
  critical: "Critical",
  low: "Low",
  watch: "Watch",
  healthy: "Healthy",
  overstock: "Overstock",
  dead: "Dead stock",
  dropped: "Dropped",
  unrated: "Unrated",
};

/**
 * Fill for a tinted surface that CARRIES TEXT (matrix cells, rank medallions,
 * legend chips). Pairs a theme-resolved `-bg` tint with the inherited
 * foreground so contrast holds in BOTH themes. The house `bg-<tone>-bg` +
 * `text-<tone>` badge pairing reads ~2:1 in light, and the `*-foreground`
 * tokens invert to near-black-on-dark. The hue is carried by the tint, the
 * STRIP_BG accent and the StatusBadge; the text stays legible.
 */
export const CELL_WASH: Record<LowStockState, string> = {
  out: "bg-destructive/15 text-foreground",
  critical: "bg-destructive/10 text-foreground",
  low: "bg-warning-bg text-foreground",
  watch: "bg-info-bg text-foreground",
  healthy: "bg-success-bg text-foreground",
  overstock: "bg-muted text-muted-foreground",
  dead: "bg-muted text-muted-foreground",
  dropped: "bg-muted text-muted-foreground",
  unrated: "bg-muted text-muted-foreground",
};

export const STRIP_BG: Record<LowStockState, string> = {
  out: "bg-destructive",
  critical: "bg-destructive",
  low: "bg-warning",
  watch: "bg-info",
  healthy: "bg-success",
  overstock: "bg-muted-foreground",
  dead: "bg-muted-foreground",
  dropped: "bg-muted-foreground",
  unrated: "bg-muted-foreground",
};
