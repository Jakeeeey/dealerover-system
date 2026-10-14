import { z } from "zod";
import {
  DealerRosterEntrySchema,
  InventoryAnalyticsResponseSchema,
  InventoryMetaResponseSchema,
  InventoryPageResponseSchema,
  type DealerRosterEntry,
  type InventoryAnalyticsResponse,
  type InventoryMetaResponse,
  type InventoryPageResponse,
} from "../types";

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/inventory-report";

/**
 * Client-safe fallback branch-batch size. Callers prefer
 * `meta.branchPageSize` when a meta payload is in hand.
 */
export const BRANCH_PAGE_SIZE = 10;

/** Client-side default for the not-selling lookback horizon (days). */
export const LOOKBACK_DAYS = 90;

const RosterResponseSchema = z.object({
  success: z.boolean(),
  roster: z.array(DealerRosterEntrySchema),
});

function errorMessage(payload: unknown, fallback: string): string {
  const record = payload as { message?: string; error?: string } | null;
  return record?.message ?? record?.error ?? fallback;
}

async function readPayload(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Client fetch helpers for the HQ inventory report. Calls the local API proxy
 * (which injects the server-only tokens) and validates every response
 * against the frozen zod schemas. Transport-level failures throw; a dealer
 * that is offline rides inside its schema payload (with `success: false`
 * plus `dealer.reason` / `error`) and does not throw.
 */
export async function getDealerRoster(signal?: AbortSignal): Promise<DealerRosterEntry[]> {
  const res = await fetch(`${API_PATH}?roster=1`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });

  const payload = await readPayload(res);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load the dealer roster"));
  }

  const parsed = RosterResponseSchema.parse(payload);
  if (!parsed.success) {
    throw new Error(errorMessage(payload, "Failed to load the dealer roster"));
  }
  return parsed.roster;
}

/**
 * Loads one dealer's branches plus its whole active product master. Carries
 * no stock rows — page those with {@link getInventoryPage}.
 */
export async function getInventoryMeta(
  dealerId: string,
  opts?: { refresh?: boolean; signal?: AbortSignal },
): Promise<InventoryMetaResponse> {
  const params = new URLSearchParams();
  params.set("dealerId", dealerId);
  params.set("meta", "1");
  if (opts?.refresh === true) params.set("refresh", "1");

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: opts?.signal,
  });

  const payload = await readPayload(res);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load dealer inventory"));
  }

  return InventoryMetaResponseSchema.parse(payload);
}

export interface InventoryPageQuery {
  windowDays: number;
  includeZero: boolean;
  refresh?: boolean;
  signal?: AbortSignal;
}

/**
 * Loads one branch-batch of stock rows for a dealer. The backend cannot page
 * natively, so `page`/`pageSize` slice the dealer's branch list and each
 * response reports whether more branches remain via `hasMore`.
 */
export async function getInventoryPage(
  dealerId: string,
  page: number,
  pageSize: number,
  query: InventoryPageQuery,
): Promise<InventoryPageResponse> {
  const params = new URLSearchParams();
  params.set("dealerId", dealerId);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("windowDays", String(query.windowDays));
  params.set("includeZero", query.includeZero ? "1" : "0");
  if (query.refresh === true) params.set("refresh", "1");

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: query.signal,
  });

  const payload = await readPayload(res);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load inventory page"));
  }

  return InventoryPageResponseSchema.parse(payload);
}

export interface InventoryAnalyticsQuery {
  windowDays: number;
  lookbackDays: number;
  refresh?: boolean;
  signal?: AbortSignal;
}

/**
 * Loads one dealer's per-product demand index covering the whole invoiced
 * catalogue (not just products that still hold stock). An offline dealer
 * rides inside its schema payload (`success: false` plus `error`) and does
 * not throw; transport-level failures throw.
 */
export async function getInventoryAnalytics(
  dealerId: string,
  query: InventoryAnalyticsQuery,
): Promise<InventoryAnalyticsResponse> {
  const params = new URLSearchParams();
  params.set("dealerId", dealerId);
  params.set("analytics", "1");
  params.set("windowDays", String(query.windowDays));
  params.set("lookbackDays", String(query.lookbackDays));
  if (query.refresh === true) params.set("refresh", "1");

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: query.signal,
  });

  const payload = await readPayload(res);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load inventory analytics"));
  }

  return InventoryAnalyticsResponseSchema.parse(payload);
}
