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
  /** Reorder floor in pieces from the product master (0 = unset). */
  maintainingQuantity: z.number(),
  /** Demand in base pieces for this product+branch over the window (from the dealer's invoices). */
  demandQty: z.number(),
});

export type InventoryRow = z.infer<typeof InventoryRowSchema>;

export const StockOutItemSchema = z.object({
  key: z.string(),
  dealerId: z.string(),
  dealerName: z.string(),
  productId: z.number(),
  productCode: z.string(),
  productName: z.string(),
  brand: z.string(),
  category: z.string(),
  costPerUnit: z.number(),
  branchCount: z.number(),
});

export type StockOutItem = z.infer<typeof StockOutItemSchema>;

export const DealerRosterEntrySchema = z.object({
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
});

export type DealerRosterEntry = z.infer<typeof DealerRosterEntrySchema>;

export const InventoryReportResponseSchema = z.object({
  success: z.boolean(),
  generatedAt: z.string(),
  windowDays: z.number(),
  includeZero: z.boolean(),
  dealers: z.array(DealerStatusSchema),
  rows: z.array(InventoryRowSchema),
  stockOuts: z.array(StockOutItemSchema),
  roster: z.array(DealerRosterEntrySchema).optional(),
  error: z.string().optional(),
});

export type InventoryReportResponse = z.infer<typeof InventoryReportResponseSchema>;

export interface InventoryReportParams {
  dealerIds?: string[];
  includeZero?: boolean;
  windowDays?: number;
}

/** Low-stock severity states, ordered from most to least urgent. */
export type LowStockState =
  | "out"
  | "critical"
  | "low"
  | "watch"
  | "healthy"
  | "overstock"
  | "dead";

export type LowStockBasis = "policy" | "maintain";

export interface LowStockPolicy {
  basis: LowStockBasis;
  leadDays: number;
  windowDays: number;
  defaultMinCases: number;
  categoryMin: Record<string, number>;
  overrides: Record<string, number>;
}
