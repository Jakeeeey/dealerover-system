import type { LowStockState } from "../types";

export type ReasonSource = "demand" | "none";

export interface SeverityNumbers {
  onHand: number;
  demandWindow: number;
  demandLookback: number;
  windowDays: number;
  daysOfCover: number | null;
  unitCount: number;
}

export interface SeverityInput {
  onHand: number;
  demandWindow: number;
  demandLookback: number;
  lastSaleAt: string;
  windowDays: number;
  leadDays: number;
  lookbackDays: number;
  dealerActive: boolean;
  /** False when the demand index could not be loaded — nothing can be judged. */
  analyticsAvailable: boolean;
  unitCount: number;
}

export interface SeverityResult {
  state: LowStockState;
  reason: string;
  source: ReasonSource;
  numbers: SeverityNumbers;
}

const EPSILON = 1e-9;

function formatDays(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDaily(demandWindow: number, windowDays: number): string {
  if (!Number.isFinite(demandWindow) || !Number.isFinite(windowDays) || windowDays <= 0) return "0";
  return formatDays(Math.max(0, demandWindow) / windowDays);
}

/**
 * Days of cover = on-hand pieces / average daily demand over the window.
 * Returns null when there is no demand signal (no sales in the window).
 */
export function daysOfCover(
  onHand: number,
  demandQty: number,
  windowDays: number,
): number | null {
  if (!Number.isFinite(onHand) || !Number.isFinite(demandQty) || !Number.isFinite(windowDays)) {
    return null;
  }
  if (windowDays <= 0 || demandQty <= 0) return null;
  const avgDaily = demandQty / windowDays;
  if (avgDaily <= EPSILON) return null;
  return Math.max(0, onHand) / avgDaily;
}

/**
 * Inventory value in pesos.
 * Formula: value = (pieces ÷ pieces-per-display-unit) × cost-per-display-unit.
 * costPerUnit is the cost per display unit (Box/Tie/Pack/Half Box/Pieces);
 * unitCount is pieces per that display unit.
 */
export function inventoryValue(pieces: number, unitCount: number, costPerUnit: number): number {
  if (!Number.isFinite(pieces) || !Number.isFinite(unitCount) || !Number.isFinite(costPerUnit)) {
    return 0;
  }
  if (unitCount <= 0 || costPerUnit <= 0 || pieces <= 0) return 0;
  return (pieces / unitCount) * costPerUnit;
}

/**
 * Whole days since an ISO date string. Returns null for empty/unparsable
 * dates ("" means the product has never sold).
 */
export function daysSince(dateIso: string, now: number = Date.now()): number | null {
  if (!dateIso) return null;
  const time = Date.parse(dateIso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / (24 * 60 * 60 * 1000)));
}

/**
 * Pure analytics classifier. No configured minimums: the state comes from
 * the product's own sales history (window demand, lookback demand,
 * last-sale date) plus whether the dealer itself is still selling.
 *
 * Decision ladder, evaluated in order:
 *  0. Demand index unavailable → unrated (never guess from an empty index).
 *  1. Nothing sold in the lookback → dead (holding stock) or dropped
 *     (no stock either — likely delisted).
 *  2. Dealer has no invoices in the window → unrated (no demand signal).
 *  3. Product has no sales in the window → unrated (nothing to judge by).
 *  4. No stock but live demand → out (a true stock-out).
 *  5. Otherwise rank by measured days of cover.
 */
export function computeSeverity(input: SeverityInput): SeverityResult {
  const {
    onHand,
    demandWindow,
    demandLookback,
    windowDays,
    leadDays,
    lookbackDays,
    dealerActive,
    analyticsAvailable,
    unitCount,
  } = input;
  const safeOnHand = Number.isFinite(onHand) ? Math.max(0, onHand) : 0;
  const safeWindow = Number.isFinite(demandWindow) ? Math.max(0, demandWindow) : 0;
  const safeLookback = Number.isFinite(demandLookback) ? Math.max(0, demandLookback) : 0;
  const doc = daysOfCover(safeOnHand, safeWindow, windowDays);
  const numbers: SeverityNumbers = {
    onHand: safeOnHand,
    demandWindow: safeWindow,
    demandLookback: safeLookback,
    windowDays,
    daysOfCover: doc,
    unitCount: Number.isFinite(unitCount) && unitCount > 0 ? unitCount : 0,
  };

  // An unloaded demand index is not evidence of anything: never let a failed
  // read flip the whole catalogue to dead/dropped.
  if (!analyticsAvailable) {
    return { state: "unrated", reason: "demand data unavailable", source: "none", numbers };
  }

  if (safeLookback <= 0) {
    if (safeOnHand > 0) {
      return {
        state: "dead",
        reason: `no sales in ${lookbackDays} days`,
        source: "demand",
        numbers,
      };
    }
    return {
      state: "dropped",
      reason: `no sales in ${lookbackDays} days and no stock`,
      source: "demand",
      numbers,
    };
  }

  if (!dealerActive) {
    return {
      state: "unrated",
      reason: `dealer has no sales in the last ${windowDays} days`,
      source: "none",
      numbers,
    };
  }

  if (safeWindow <= 0) {
    return {
      state: "unrated",
      reason: `no sales in the last ${windowDays} days`,
      source: "none",
      numbers,
    };
  }

  if (safeOnHand <= 0) {
    return {
      state: "out",
      reason: `stock-out · ${formatDaily(safeWindow, windowDays)}/day demand`,
      source: "demand",
      numbers,
    };
  }

  const cover = doc ?? 0;
  const daily = formatDaily(safeWindow, windowDays);
  const coverReason = `${formatDays(cover)} days cover at ${daily}/day demand`;
  const safeLead = Number.isFinite(leadDays) && leadDays > 0 ? leadDays : 7;

  if (cover < 3) {
    return { state: "critical", reason: coverReason, source: "demand", numbers };
  }
  if (cover < safeLead) {
    return { state: "low", reason: coverReason, source: "demand", numbers };
  }
  if (cover < 2 * safeLead) {
    return { state: "watch", reason: coverReason, source: "demand", numbers };
  }
  if (cover > 60) {
    return { state: "overstock", reason: coverReason, source: "demand", numbers };
  }
  return { state: "healthy", reason: coverReason, source: "demand", numbers };
}
