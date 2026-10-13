import { z } from "zod";

/**
 * A single customer pin on the HQ customer map.
 * Rows are aggregated across every dealer under the HQ roster, so they carry
 * both the originating dealer identity and the resolved lookup labels.
 */
export const CustomerMapRowSchema = z.object({
  // Stable composite key: `${dealerId}:${customerId}` — ids collide across dealers.
  key: z.string(),
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
  id: z.number(),
  customer_code: z.string(),
  customer_name: z.string(),
  store_name: z.string(),
  brgy: z.string(),
  city: z.string(),
  province: z.string(),
  // store_type / classification are integer lookup ids on each dealer's Directus.
  store_type: z.number().nullable(),
  store_type_name: z.string(),
  classification: z.number().nullable(),
  classification_name: z.string(),
  price_type: z.string(),
  payment_term: z.string(),
  // 1 = active, 0 = inactive (mirrors the DB int flag). Only 1 is ever plotted.
  isActive: z.number(),
  lat: z.number(),
  lng: z.number(),
});

export type CustomerMapRow = z.infer<typeof CustomerMapRowSchema>;

/** Per-dealer fetch outcome — a failing dealer is reported offline, never fatal. */
export const DealerStatusSchema = z.object({
  dealerId: z.string(),
  dealerName: z.string(),
  dealerCode: z.string(),
  online: z.boolean(),
  customerCount: z.number(),
  error: z.string().optional(),
});

export type DealerStatus = z.infer<typeof DealerStatusSchema>;

/** A resolved lookup entry (store type or customer classification). */
export const LookupItemSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type LookupItem = z.infer<typeof LookupItemSchema>;

export const CustomerMapResponseSchema = z.object({
  success: z.boolean(),
  dealerStatuses: z.array(DealerStatusSchema),
  customers: z.array(CustomerMapRowSchema),
  lookups: z.object({
    storeTypes: z.array(LookupItemSchema),
    classifications: z.array(LookupItemSchema),
  }),
  error: z.string().optional(),
});

export type CustomerMapResponse = z.infer<typeof CustomerMapResponseSchema>;

/** Client-side filter shape applied over the loaded (active) customer set. */
export interface CustomerMapFilterState {
  dealerIds: string[];
  province: string;
  city: string;
  brgy: string;
  storeTypeName: string;
  classificationName: string;
  priceType: string;
  paymentTerm: string;
  search: string;
}

export const EMPTY_CUSTOMER_MAP_FILTERS: CustomerMapFilterState = {
  dealerIds: [],
  province: "",
  city: "",
  brgy: "",
  storeTypeName: "",
  classificationName: "",
  priceType: "",
  paymentTerm: "",
  search: "",
};
