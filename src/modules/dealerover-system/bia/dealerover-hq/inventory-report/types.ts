import { z } from "zod";

/**
 * DealerOver HQ — Inventory Report types.
 *
 * Server aggregates per-dealer Spring Boot running-inventory rows with the
 * dealer's own Directus product master / branches / invoices, then ships one
 * flat dealer-tagged row set. A failing dealer is reported offline, never fatal.
 */

export const DealerStatusSchema = z.object({
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
  online: z.boolean(),
  rowCount: z.number(),
  error: z.string().optional(),
  reason: z.string().optional(),
});

export type DealerStatus = z.infer<typeof DealerStatusSchema>;

export const InventoryRowSchema = z.object({
  key: z.string(),
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
  branchId: z.number(),
  branchName: z.string(),
  productId: z.number(),
  productCode: z.string(),
  productName: z.string(),
  productBarcode: z.string(),
  productBrand: z.string(),
  productCategory: z.string(),
  supplierShortcut: z.string(),
  unitName: z.string(),
  /** Pieces per display unit (Box/Tie/Pack/Half Box/Pieces). Raw row first, else product master. */
  unitCount: z.number(),
  /** On-hand stock in base pieces. */
  onHand: z.number(),
  lastCount: z.number(),
  movementAfter: z.number(),
  lastCutoff: z.string(),
  /** Cost per display unit from the product master. */
  costPerUnit: z.number(),
  /** Demand in base pieces for this product+branch over the window (from the dealer's invoices). */
  demandQty: z.number(),
});

export type InventoryRow = z.infer<typeof InventoryRowSchema>;

export const DealerRosterEntrySchema = z.object({
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
});

export type DealerRosterEntry = z.infer<typeof DealerRosterEntrySchema>;

/** Physical role of a branch, derived from the dealer's own branch flags. */
export const BranchKindSchema = z.enum([
  "selling",
  "warehouse",
  "moving",
  "bad_stock",
  "return",
  "other",
]);

export type BranchKind = z.infer<typeof BranchKindSchema>;

export const DealerBranchSchema = z.object({
  branchId: z.number(),
  branchName: z.string(),
  kind: BranchKindSchema,
});

export type DealerBranch = z.infer<typeof DealerBranchSchema>;

/** Active product from the dealer's own product master (cost + pack size). */
export const MasterProductSchema = z.object({
  productId: z.number(),
  productCode: z.string(),
  productName: z.string(),
  brand: z.string(),
  category: z.string(),
  unitCount: z.number(),
  costPerUnit: z.number(),
});

export type MasterProduct = z.infer<typeof MasterProductSchema>;

/**
 * Meta payload for one dealer: its branches and its whole active product
 * master. The master is what lets the client still see products that are out
 * of stock everywhere (zero rows are dropped from the stock pages).
 */
export const InventoryMetaResponseSchema = z.object({
  success: z.boolean(),
  dealer: DealerStatusSchema,
  branches: z.array(DealerBranchSchema),
  products: z.array(MasterProductSchema),
  totalBranches: z.number(),
  branchPageSize: z.number(),
  error: z.string().optional(),
});

export type InventoryMetaResponse = z.infer<typeof InventoryMetaResponseSchema>;

/** One branch-batch of stock rows, paged because the dealer backend cannot page. */
export const InventoryPageResponseSchema = z.object({
  success: z.boolean(),
  dealerId: z.string(),
  page: z.number(),
  pageSize: z.number(),
  totalBranches: z.number(),
  branchIds: z.array(z.number()),
  hasMore: z.boolean(),
  /** Raw backend rows examined for this page, before the zero-stock filter. */
  scanned: z.number(),
  rows: z.array(InventoryRowSchema),
  error: z.string().optional(),
});

export type InventoryPageResponse = z.infer<typeof InventoryPageResponseSchema>;

/**
 * Per-product demand facts over two horizons. The index covers the WHOLE
 * active catalogue (not just products that still hold stock), which is what
 * lets a zero-stock product be told apart from a delisted one: with no stock
 * rows to inspect, demand is the only evidence available.
 */
export const ProductDemandSchema = z.object({
  productId: z.number(),
  /** Pieces sold inside the demand window. */
  demandWindow: z.number(),
  /** Pieces sold inside the longer not-selling lookback. */
  demandLookback: z.number(),
  /** ISO date of the product's most recent sale; "" when it has never sold. */
  lastSaleAt: z.string(),
});

export type ProductDemand = z.infer<typeof ProductDemandSchema>;

export const InventoryAnalyticsResponseSchema = z.object({
  success: z.boolean(),
  dealerId: z.string(),
  windowDays: z.number(),
  lookbackDays: z.number(),
  /** ISO date of the dealer's most recent invoice; "" when it has none. */
  lastInvoiceAt: z.string(),
  products: z.array(ProductDemandSchema),
  error: z.string().optional(),
});

export type InventoryAnalyticsResponse = z.infer<typeof InventoryAnalyticsResponseSchema>;

/** Low-stock severity states, ordered from most to least urgent. */
export type LowStockState =
  | "out"
  | "critical"
  | "low"
  | "watch"
  | "healthy"
  | "overstock"
  | "dead"
  | "dropped"
  | "unrated";

/**
 * Analytics parameters. There are deliberately no configured minimums: a
 * product's state comes from its own sales history, never from a hand-set
 * threshold.
 */
export interface LowStockPolicy {
  /** Days of cover below which a stocked product counts as "low". */
  leadDays: number;
  /** Demand window in days — average daily demand is derived from here. */
  windowDays: number;
  /** Days without a sale before a product counts as not selling any more. */
  lookbackDays: number;
}

/** Progress of a progressive, branch-paged dealer load. */
export interface InventoryProgress {
  /** Branch pages that have landed. */
  pagesDone: number;
  totalPages: number;
  /** Raw backend rows examined so far, before the zero-stock filter. */
  scanned: number;
  /** Rows kept after the zero-stock filter. */
  plotted: number;
}

/** What a dashboard card drills into on the board (page 2). */
export type DrillTarget =
  | { kind: "urgent" }
  | { kind: "severity"; state: LowStockState }
  | { kind: "dimension"; dimension: "brand" | "category" | "supplier"; key: string; label: string }
  | { kind: "branch"; branchId: number; label: string };
