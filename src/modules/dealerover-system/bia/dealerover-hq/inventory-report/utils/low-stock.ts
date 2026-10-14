import type { InventoryRow, LowStockPolicy, LowStockState } from "../types";

export type ReasonSource = "demand" | "relative" | "minimum" | "none";

export interface SeverityNumbers {
  onHand: number;
  demandQty: number;
  windowDays: number;
  daysOfCover: number | null;
  effectiveMin: number;
  unitCount: number;
}

export interface SeverityInput {
  onHand: number;
  demandQty: number;
  windowDays: number;
  movementAfter: number;
  effectiveMin: number;
  unitCount: number;
  leadDays: number;
  peerMedian: number | null;
  unitName?: string;
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

function formatCases(pieces: number, unitCount: number, unitName?: string): string {
  const unit = (unitName ?? "").trim();
  if (unit) {
    if (!Number.isFinite(unitCount) || unitCount <= 0) return `${Math.round(pieces)} ${unit}`;
    const units = pieces / unitCount;
    const rounded = Math.round(units * 10) / 10;
    const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${label} ${unit}`;
  }
  if (!Number.isFinite(unitCount) || unitCount <= 0) return `${Math.round(pieces)} pcs`;
  const cases = pieces / unitCount;
  const rounded = Math.round(cases * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} ${rounded === 1 ? "case" : "cases"}`;
}

/**
 * Days of cover = on-hand pieces / average daily demand over the window.
 * Returns null when there is no demand signal (no invoices in the window).
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
 * Pure severity classifier for one branch-level inventory row.
 * Demand cover wins when demand exists; otherwise the relative peer-median
 * rule and the minimum-threshold rule decide.
 */
export function computeSeverity(input: SeverityInput): SeverityResult {
  const { onHand, demandQty, windowDays, movementAfter, effectiveMin, unitCount, leadDays, peerMedian, unitName } =
    input;
  const safeOnHand = Number.isFinite(onHand) ? onHand : 0;
  const doc = daysOfCover(safeOnHand, demandQty, windowDays);
  const numbers: SeverityNumbers = {
    onHand: safeOnHand,
    demandQty: Number.isFinite(demandQty) ? demandQty : 0,
    windowDays,
    daysOfCover: doc,
    effectiveMin: Number.isFinite(effectiveMin) ? effectiveMin : 0,
    unitCount: Number.isFinite(unitCount) && unitCount > 0 ? unitCount : 0,
  };

  if (safeOnHand <= 0) {
    return { state: "out", reason: "stock-out", source: "demand", numbers };
  }

  const noMovement = movementAfter === 0;
  const noDemand = !Number.isFinite(demandQty) || demandQty <= 0;

  if (doc !== null) {
    if (doc < 3) {
      return {
        state: "critical",
        reason: `${formatDays(doc)} days cover vs ${leadDays}-day minimum`,
        source: "demand",
        numbers,
      };
    }
    if (doc < leadDays) {
      return {
        state: "low",
        reason: `${formatDays(doc)} days cover vs ${leadDays}-day minimum`,
        source: "demand",
        numbers,
      };
    }
    if (doc < 2 * leadDays) {
      return {
        state: "watch",
        reason: `${formatDays(doc)} days cover vs ${leadDays}-day minimum`,
        source: "demand",
        numbers,
      };
    }
    if (doc > 60) {
      return { state: "overstock", reason: `${formatDays(doc)} days cover on hand`, source: "demand", numbers };
    }
    if (noMovement && noDemand) {
      return { state: "dead", reason: "no movement and no demand", source: "demand", numbers };
    }
    return { state: "healthy", reason: `${formatDays(doc)} days cover`, source: "demand", numbers };
  }

  // No demand signal — relative peer-median rule first.
  if (peerMedian !== null && Number.isFinite(peerMedian) && peerMedian > 0) {
    const ratio = safeOnHand / peerMedian;
    if (ratio < 0.5) {
      const pct = Math.round((1 - ratio) * 100);
      return {
        state: "low",
        reason: `${pct}% below peer median (${formatCases(safeOnHand, unitCount, unitName)} vs ${formatCases(peerMedian, unitCount, unitName)} median)`,
        source: "relative",
        numbers,
      };
    }
  }

  // Minimum-threshold rule.
  if (numbers.effectiveMin > 0 && safeOnHand < numbers.effectiveMin) {
    return {
      state: "low",
      reason: `${formatCases(safeOnHand, unitCount, unitName)} vs ${formatCases(numbers.effectiveMin, unitCount, unitName)} minimum`,
      source: "minimum",
      numbers,
    };
  }

  if (noMovement && noDemand) {
    return { state: "dead", reason: "no movement and no demand", source: "none", numbers };
  }

  return { state: "healthy", reason: "within threshold", source: "none", numbers };
}

/**
 * Effective minimum in PIECES for a row.
 * Maintain basis wins when the product master carries a maintaining quantity;
 * otherwise the per-item override, then the per-category minimum, then the
 * policy default (in display units, converted via pack size).
 */
export function effectiveMinPieces(
  row: Pick<InventoryRow, "maintainingQuantity" | "productCategory" | "productId" | "dealerId" | "unitCount">,
  policy: LowStockPolicy,
): { min: number; source: "maintain" | "override" | "category" | "policy" } {
  if (policy.basis === "maintain" && row.maintainingQuantity > 0) {
    return { min: row.maintainingQuantity, source: "maintain" };
  }
  const overrideKey = `${row.dealerId}:${row.productId}`;
  const override = policy.overrides[overrideKey];
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return { min: override, source: "override" };
  }
  const categoryMinCases = policy.categoryMin[row.productCategory];
  if (typeof categoryMinCases === "number" && Number.isFinite(categoryMinCases) && categoryMinCases > 0) {
    return { min: categoryMinCases * Math.max(row.unitCount, 0), source: "category" };
  }
  if (policy.defaultMinCases > 0) {
    return { min: policy.defaultMinCases * Math.max(row.unitCount, 0), source: "policy" };
  }
  return { min: 0, source: "policy" };
}

/** Median on-hand (pieces) for one productCode across the network. */
export function peerMedianFor(rows: { onHand: number }[]): number | null {
  if (rows.length === 0) return null;
  const sorted = rows.map((r) => r.onHand).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
