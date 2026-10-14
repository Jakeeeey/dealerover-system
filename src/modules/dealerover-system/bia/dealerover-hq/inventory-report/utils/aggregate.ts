import type {
  BranchKind,
  DealerBranch,
  InventoryRow,
  LowStockPolicy,
  LowStockState,
  MasterProduct,
  ProductDemand,
} from "../types";
import { computeSeverity, inventoryValue } from "./low-stock";

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
  supplier: string;
  unitName: string;
  unitCount: number;
  costPerUnit: number;
  onHand: number;
  /** Pieces sold inside the demand window (this product, all branches). */
  demandQty: number;
  /** Pieces sold inside the longer not-selling lookback. */
  demandLookback: number;
  /** ISO date of the product's most recent sale; "" when never sold. */
  lastSaleAt: string;
  branchCount: number;
  value: number;
  state: LowStockState;
  reason: string;
  reasonSource: string;
  daysOfCover: number | null;
}

export interface AggregateDealer {
  dealerId: string;
  dealerName: string;
  dealerCode: string;
}

export const SEVERITY_RANK: Record<LowStockState, number> = {
  out: 0,
  critical: 1,
  low: 2,
  watch: 3,
  dead: 4,
  overstock: 5,
  healthy: 6,
  unrated: 7,
  dropped: 8,
};

/**
 * States that count as a problem. Healthy means fine; unrated means there
 * is no recent demand to judge by; dropped means the product no longer
 * sells and holds no stock — none of the three is an alarm.
 */
export const FLAGGED_STATES: ReadonlySet<LowStockState> = new Set([
  "out",
  "critical",
  "low",
  "watch",
  "dead",
  "overstock",
]);

const ALL_STATES: readonly LowStockState[] = [
  "out",
  "critical",
  "low",
  "watch",
  "dead",
  "overstock",
  "healthy",
  "unrated",
  "dropped",
];

function demandIndex(analytics: ProductDemand[]): Map<number, ProductDemand> {
  const map = new Map<number, ProductDemand>();
  for (const entry of analytics) {
    if (!map.has(entry.productId)) map.set(entry.productId, entry);
  }
  return map;
}

function resolveDealer(
  rows: InventoryRow[],
  dealer: AggregateDealer | undefined,
): AggregateDealer {
  if (dealer) return dealer;
  const first = rows[0];
  return {
    dealerId: first?.dealerId ?? "",
    dealerName: first?.dealerName ?? "",
    dealerCode: first?.dealerCode ?? "",
  };
}

/**
 * Rolls branch rows up to one dealer x product aggregate and classifies
 * each with the shared analytics ladder. Emits one entry per MASTER
 * product, so the whole catalogue is classified: products with no stock
 * rows get onHand 0 with pack size / cost from the master and demand
 * from the analytics index — which is what tells a true stock-out (live
 * demand, nothing on hand) apart from a dropped product (no sales in the
 * lookback, no stock) and dead stock (no sales in the lookback, still
 * holding units).
 */
export function buildProductAggregates(
  rows: InventoryRow[],
  master: MasterProduct[],
  analytics: ProductDemand[],
  policy: LowStockPolicy,
  dealerActive: boolean,
  analyticsAvailable: boolean,
  dealer?: AggregateDealer,
): ProductAggregate[] {
  const identity = resolveDealer(rows, dealer);
  const demandByProduct = demandIndex(analytics);

  const rowsByProduct = new Map<number, InventoryRow[]>();
  for (const row of rows) {
    const list = rowsByProduct.get(row.productId);
    if (list) list.push(row);
    else rowsByProduct.set(row.productId, [row]);
  }

  const masterById = new Map<number, MasterProduct>();
  for (const product of master) {
    if (!masterById.has(product.productId)) masterById.set(product.productId, product);
  }

  // Whole catalogue: every master product, plus any row-only product the
  // master no longer lists (kept so streaming rows are never dropped).
  const productIds = new Set<number>([...masterById.keys(), ...rowsByProduct.keys()]);

  const aggregates: ProductAggregate[] = [];
  for (const productId of productIds) {
    const list = rowsByProduct.get(productId) ?? [];
    const info = masterById.get(productId);
    const first = list[0];
    const demand = demandByProduct.get(productId);

    const onHand = list.reduce((sum, r) => sum + r.onHand, 0);
    const demandQty =
      demand?.demandWindow ?? list.reduce((sum, r) => sum + r.demandQty, 0);
    const demandLookback = demand?.demandLookback ?? 0;
    const lastSaleAt = demand?.lastSaleAt ?? "";
    const unitCount =
      list.find((r) => r.unitCount > 0)?.unitCount ?? info?.unitCount ?? 0;
    const costPerUnit =
      list.find((r) => r.costPerUnit > 0)?.costPerUnit ?? info?.costPerUnit ?? 0;
    const branchCount = new Set(list.map((r) => r.branchId)).size;
    const value = list.reduce(
      (sum, r) => sum + inventoryValue(r.onHand, r.unitCount, r.costPerUnit),
      0,
    );

    const severity = computeSeverity({
      onHand,
      demandWindow: demandQty,
      demandLookback,
      lastSaleAt,
      windowDays: policy.windowDays,
      leadDays: policy.leadDays,
      lookbackDays: policy.lookbackDays,
      dealerActive,
      analyticsAvailable,
      unitCount,
    });

    aggregates.push({
      key: `${identity.dealerId}:${productId}`,
      dealerId: identity.dealerId || first?.dealerId || "",
      dealerName: identity.dealerName || first?.dealerName || "",
      dealerCode: identity.dealerCode || first?.dealerCode || "",
      productId,
      productCode: first?.productCode || info?.productCode || "",
      productName: first?.productName || info?.productName || `Product ${productId}`,
      brand: first?.productBrand || info?.brand || "",
      category: first?.productCategory || info?.category || "",
      supplier: first?.supplierShortcut || "",
      unitName: first?.unitName || "",
      unitCount,
      costPerUnit,
      onHand,
      demandQty,
      demandLookback,
      lastSaleAt,
      branchCount,
      value,
      state: severity.state,
      reason: severity.reason,
      reasonSource: severity.source,
      daysOfCover: severity.numbers.daysOfCover,
    });
  }

  return aggregates;
}

export interface DimensionGroup {
  key: string;
  label: string;
  productCount: number;
  flaggedCount: number;
  value: number;
  /** Pesos tied up in this group's flagged members — the block's area. */
  flaggedValue: number;
  worst: LowStockState;
}

function dimensionValue(item: ProductAggregate, dimension: "brand" | "category" | "supplier"): string {
  const raw = dimension === "brand" ? item.brand : dimension === "category" ? item.category : item.supplier;
  return (raw ?? "").trim();
}

/**
 * Rolls per-dealer product aggregates up by brand, category, or supplier.
 * `worst` is the most urgent (best SEVERITY_RANK) member state; groups sort
 * by flagged count, then value at risk.
 */
export function groupByDimension(
  aggregates: ProductAggregate[],
  dimension: "brand" | "category" | "supplier",
): DimensionGroup[] {
  const membersByKey = new Map<string, ProductAggregate[]>();
  for (const item of aggregates) {
    const key = dimensionValue(item, dimension);
    const list = membersByKey.get(key);
    if (list) list.push(item);
    else membersByKey.set(key, [item]);
  }

  const groups: DimensionGroup[] = [];
  for (const [key, members] of membersByKey) {
    let flaggedCount = 0;
    let value = 0;
    let flaggedValue = 0;
    let worst: LowStockState = "healthy";
    let worstRank = Number.POSITIVE_INFINITY;
    for (const member of members) {
      value += member.value;
      if (FLAGGED_STATES.has(member.state)) {
        flaggedCount += 1;
        flaggedValue += member.value;
      }
      const rank = SEVERITY_RANK[member.state];
      if (rank < worstRank) {
        worstRank = rank;
        worst = member.state;
      }
    }
    groups.push({
      key,
      label: key || "Unspecified",
      productCount: members.length,
      flaggedCount,
      value,
      flaggedValue,
      worst,
    });
  }

  // Largest trapped value first: the concentration block sizes by it.
  groups.sort((a, b) => b.flaggedValue - a.flaggedValue || b.flaggedCount - a.flaggedCount);
  return groups;
}

export interface BranchAggregate {
  branchId: number;
  branchName: string;
  kind: BranchKind;
  productCount: number;
  flaggedCount: number;
  counts: Record<LowStockState, number>;
  onHand: number;
  value: number;
  /** Pesos tied up in this branch's flagged products — the block's area. */
  flaggedValue: number;
  worst: LowStockState;
}

/**
 * Rolls branch rows up per branch and classifies every product-branch ROW
 * with the shared analytics ladder (the row's own demandQty is the window
 * demand; the lookback demand and last-sale date come from the
 * product-level analytics index). Joined to the branch's kind; ordered by
 * flagged count, then value at risk.
 */
export function buildBranchAggregates(
  rows: InventoryRow[],
  branches: DealerBranch[],
  policy: LowStockPolicy,
  analytics: ProductDemand[],
  dealerActive: boolean,
  analyticsAvailable: boolean,
): BranchAggregate[] {
  const demandByProduct = demandIndex(analytics);

  const rowsByBranch = new Map<number, InventoryRow[]>();
  const statesByBranch = new Map<number, LowStockState[]>();
  for (const row of rows) {
    const demand = demandByProduct.get(row.productId);
    const severity = computeSeverity({
      onHand: row.onHand,
      demandWindow: row.demandQty,
      demandLookback: demand?.demandLookback ?? 0,
      lastSaleAt: demand?.lastSaleAt ?? "",
      windowDays: policy.windowDays,
      leadDays: policy.leadDays,
      lookbackDays: policy.lookbackDays,
      dealerActive,
      analyticsAvailable,
      unitCount: row.unitCount,
    });
    const rowList = rowsByBranch.get(row.branchId);
    if (rowList) rowList.push(row);
    else rowsByBranch.set(row.branchId, [row]);
    const stateList = statesByBranch.get(row.branchId);
    if (stateList) stateList.push(severity.state);
    else statesByBranch.set(row.branchId, [severity.state]);
  }

  const branchById = new Map(branches.map((branch) => [branch.branchId, branch]));
  const branchIds = new Set<number>([
    ...branches.map((branch) => branch.branchId),
    ...rowsByBranch.keys(),
  ]);

  const out: BranchAggregate[] = [];
  for (const branchId of branchIds) {
    const info = branchById.get(branchId);
    const list = rowsByBranch.get(branchId) ?? [];
    const states = statesByBranch.get(branchId) ?? [];
    const counts = {} as Record<LowStockState, number>;
    for (const state of ALL_STATES) counts[state] = 0;
    let flaggedCount = 0;
    let onHand = 0;
    let value = 0;
    let flaggedValue = 0;
    let worst: LowStockState = "healthy";
    let worstRank = Number.POSITIVE_INFINITY;
    states.forEach((state, index) => {
      counts[state] += 1;
      const flagged = FLAGGED_STATES.has(state);
      if (flagged) flaggedCount += 1;
      const rank = SEVERITY_RANK[state];
      if (rank < worstRank) {
        worstRank = rank;
        worst = state;
      }
      const row = list[index];
      if (row) {
        onHand += row.onHand;
        const rowValue = inventoryValue(row.onHand, row.unitCount, row.costPerUnit);
        value += rowValue;
        if (flagged) flaggedValue += rowValue;
      }
    });
    out.push({
      branchId,
      branchName: info?.branchName ?? list[0]?.branchName ?? `Branch ${branchId}`,
      kind: info?.kind ?? "other",
      productCount: new Set(list.map((row) => row.productId)).size,
      flaggedCount,
      counts,
      onHand,
      value,
      flaggedValue,
      worst,
    });
  }

  out.sort((a, b) => b.flaggedValue - a.flaggedValue || b.flaggedCount - a.flaggedCount);
  return out;
}
