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
  dead: "Non-moving",
  dropped: "Dropped",
  unrated: "Unrated",
};

/**
 * State-level pill overrides, used where the five semantic tones cannot tell
 * two states apart. A filled pill claims a colour; an outlined pill is
 * informational — so Non-moving (filled grey) never reads as Overstock /
 * Dropped / Unrated (outlined).
 */
export const PILL_OVERRIDE: Partial<Record<LowStockState, string>> = {
  overstock: "border-border bg-transparent text-muted-foreground",
  dropped: "border-border bg-transparent text-muted-foreground",
  unrated: "border-border bg-transparent text-muted-foreground",
};

/**
 * Fill for a tinted surface that CARRIES TEXT (matrix cells, rank medallions,
 * legend chips). An alpha tint of the VIVID tone token keeps the colour visible
 * in both themes while the inherited foreground stays legible — the near-white
 * `*-bg` tokens washed out at these sizes. Hue is carried by this tint, the
 * solid STRIP_BG accent and the solid pills; the text itself is never tinted.
 */
export const CELL_WASH: Record<LowStockState, string> = {
  out: "bg-destructive/20 text-foreground",
  critical: "bg-destructive/15 text-foreground",
  low: "bg-warning/20 text-foreground",
  watch: "bg-info/20 text-foreground",
  healthy: "bg-success/15 text-foreground",
  overstock: "bg-muted text-muted-foreground",
  dead: "bg-muted-foreground/15 text-foreground",
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

/**
 * Utilities-only pill styling, keyed by the semantic tone.
 *
 * Why not `StatusBadge`: shadcn's `Badge` defaults to the `default` variant,
 * whose `bg-primary text-primary-foreground` utilities beat globals.css
 * `.badge-*` component classes (utilities layer outranks components layer), so
 * every tone renders primary blue. House files are protected, so this module
 * renders its own pill from utilities only — same tone contract, real colours.
 */
export const TONE_PILL: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-transparent bg-success text-success-foreground",
  warning: "border-transparent bg-warning text-warning-foreground",
  info: "border-transparent bg-info text-info-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
};

/**
 * Border treatment for a panel that should carry its dominant tone. The tone
 * rides the whole 1px edge instead of a thick side stripe — a painted left bar
 * is the generic-dashboard tell the craft floor refuses, while a tinted border
 * reads as the same idea with restraint.
 */
export const PANEL_ACCENT: Record<StatusTone, string> = {
  neutral: "border-border/70",
  success: "border-success/35",
  warning: "border-warning/35",
  info: "border-info/35",
  destructive: "border-destructive/35",
};
