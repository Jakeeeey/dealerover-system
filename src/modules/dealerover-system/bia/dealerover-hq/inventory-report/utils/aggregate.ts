import type { InventoryRow, LowStockPolicy, LowStockState } from "../types";
import {
  computeSeverity,
  effectiveMinPieces,
  inventoryValue,
  peerMedianFor,
} from "./low-stock";

export interface ProductAggregate {
  key: string;
  dealerId: string;
  dealerName: string;
  dealerCode: string;
  productId: number;
  productCode: string;
  productName: string;
  brand: string;
  category: string;
  unitName: string;
  unitCount: number;
  costPerUnit: number;
  maintainingQuantity: number;
  onHand: number;
  demandQty: number;
  movementAfter: number;
  branchCount: number;
  value: number;
  state: LowStockState;
  reason: string;
  reasonSource: string;
  daysOfCover: number | null;
  effectiveMin: number;
  minSource: "maintain" | "override" | "category" | "policy";
}

export const SEVERITY_RANK: Record<LowStockState, number> = {
  out: 0,
  critical: 1,
  low: 2,
  watch: 3,
  dead: 4,
  healthy: 5,
  overstock: 6,
};

/**
 * Rolls branch rows up to one dealer x product aggregate and classifies each
 * with the shared severity rules. Peer medians are computed per productCode
 * across the whole network (product-level on-hand sums).
 */
export function buildProductAggregates(rows: InventoryRow[], policy: LowStockPolicy): ProductAggregate[] {
  const byKey = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const key = `${row.dealerId}:${row.productId}`;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const byCode = new Map<string, number[]>();
  const aggregates: ProductAggregate[] = [];

  const prelim = Array.from(byKey.entries()).map(([key, list]) => {
    const first = list[0];
    const onHand = list.reduce((sum, r) => sum + r.onHand, 0);
    const demandQty = list.reduce((sum, r) => sum + r.demandQty, 0);
    const movementAfter = list.reduce((sum, r) => sum + r.movementAfter, 0);
    const unitCount = list.find((r) => r.unitCount > 0)?.unitCount ?? 0;
    const costPerUnit = list.find((r) => r.costPerUnit > 0)?.costPerUnit ?? 0;
    const maintainingQuantity = list.reduce((max, r) => Math.max(max, r.maintainingQuantity), 0);
    const branchCount = new Set(list.map((r) => r.branchId)).size;
    const value = list.reduce((sum, r) => sum + inventoryValue(r.onHand, r.unitCount, r.costPerUnit), 0);
    return { key, first, list, onHand, demandQty, movementAfter, unitCount, costPerUnit, maintainingQuantity, branchCount, value };
  });

  for (const p of prelim) {
    const code = p.first.productCode || `id:${p.first.productId}`;
    const arr = byCode.get(code);
    if (arr) arr.push(p.onHand);
    else byCode.set(code, [p.onHand]);
  }

  const medianByCode = new Map<string, number | null>();
  for (const [code, hands] of byCode) {
    medianByCode.set(code, peerMedianFor(hands.map((onHand) => ({ onHand }))));
  }

  for (const p of prelim) {
    const code = p.first.productCode || `id:${p.first.productId}`;
    const { min, source } = effectiveMinPieces(
      {
        maintainingQuantity: p.maintainingQuantity,
        productCategory: p.first.productCategory,
        productId: p.first.productId,
        dealerId: p.first.dealerId,
        unitCount: p.unitCount,
      },
      policy,
    );
    const severity = computeSeverity({
      onHand: p.onHand,
      demandQty: p.demandQty,
      windowDays: policy.windowDays,
      movementAfter: p.movementAfter,
      effectiveMin: min,
      unitCount: p.unitCount,
      leadDays: policy.leadDays,
      peerMedian: medianByCode.get(code) ?? null,
      unitName: p.first.unitName,
    });
    aggregates.push({
      key: p.key,
      dealerId: p.first.dealerId,
      dealerName: p.first.dealerName,
      dealerCode: p.first.dealerCode,
      productId: p.first.productId,
      productCode: p.first.productCode,
      productName: p.first.productName,
      brand: p.first.productBrand,
      category: p.first.productCategory,
      unitName: p.first.unitName,
      unitCount: p.unitCount,
      costPerUnit: p.costPerUnit,
      maintainingQuantity: p.maintainingQuantity,
      onHand: p.onHand,
      demandQty: p.demandQty,
      movementAfter: p.movementAfter,
      branchCount: p.branchCount,
      value: p.value,
      state: severity.state,
      reason: severity.reason,
      reasonSource: severity.source,
      daysOfCover: severity.numbers.daysOfCover,
      effectiveMin: min,
      minSource: source,
    });
  }

  return aggregates;
}
