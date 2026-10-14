import {
  DealerRosterEntrySchema,
  InventoryReportResponseSchema,
  type DealerRosterEntry,
  type InventoryReportResponse,
} from "../types";

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/inventory-report";

export interface InventoryReportQuery {
  dealerIds: string[];
  includeZero: boolean;
  windowDays: number;
}

function errorMessage(payload: unknown, fallback: string): string {
  const record = payload as { message?: string; error?: string } | null;
  return record?.message ?? record?.error ?? fallback;
}

/**
 * Client fetch helper for the HQ inventory report. Calls the local API proxy
 * (which injects the server-only tokens) and validates the envelope.
 */
export async function getInventoryReport(
  query: InventoryReportQuery,
  signal?: AbortSignal,
): Promise<InventoryReportResponse> {
  const params = new URLSearchParams();
  for (const id of query.dealerIds) params.append("dealerIds", id);
  params.set("includeZero", query.includeZero ? "1" : "0");
  params.set("windowDays", String(query.windowDays));

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load the inventory report"));
  }

  const envelope = payload as { success?: boolean; data?: unknown };
  return InventoryReportResponseSchema.parse(envelope.data ?? payload);
}

/**
 * Lightweight dealer roster for the picker. Never depends on the selected
 * dealers, so the filter options stay stable while per-dealer data streams in.
 */
export async function getDealerRoster(signal?: AbortSignal): Promise<DealerRosterEntry[]> {
  const res = await fetch(`${API_PATH}?roster=1`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(errorMessage(payload, "Failed to load the dealer roster"));
  }

  const envelope = payload as { success?: boolean; data?: unknown };
  const parsed = InventoryReportResponseSchema.parse(envelope.data ?? payload);
  const roster = (parsed.roster ?? []).map((entry) => DealerRosterEntrySchema.parse(entry));
  return roster;
}
