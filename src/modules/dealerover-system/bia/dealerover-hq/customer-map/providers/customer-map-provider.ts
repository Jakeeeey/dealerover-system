import {
  CustomerPageResponseSchema,
  DealerRosterEntrySchema,
  type CustomerPageResponse,
  type DealerRosterEntry,
} from "../types";

/**
 * Rows per page for the streaming lanes. Mirrors the server's
 * `CUSTOMER_PAGE_SIZE` (kept local — the service module is server-only and
 * must never be bundled into the client). Measured: `limit=1000` answers in
 * ~4.2 s on the slowest dealer while a full 14.6k-row pull takes ~117 s.
 */
export const CUSTOMER_PAGE_SIZE = 1000;

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/customer-map";

/**
 * Fetches the HQ dealer roster. The picker is fed from this, never from the
 * map payload, so it renders even when every dealer is unreachable.
 * @param {AbortSignal} [signal] - Lane/wave abort signal.
 * @returns {Promise<DealerRosterEntry[]>} Validated roster entries.
 * @throws {Error} When the proxy responds non-OK.
 */
export async function getDealerRoster(signal?: AbortSignal): Promise<DealerRosterEntry[]> {
  const res = await fetch(`${API_PATH}?roster=1`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload as { message?: string } | null)?.message || "Failed to load the dealer roster";
    throw new Error(message);
  }

  const roster = (payload as { roster?: unknown } | null)?.roster ?? [];
  return (roster as unknown[]).map((entry) => DealerRosterEntrySchema.parse(entry));
}

/**
 * Fetches one page of one dealer's customers (`sort=id` server-side keeps
 * paging deterministic). Unit of progress for the per-dealer streaming lanes.
 * @param {string} dealerId - Roster dealer id to page.
 * @param {number} page - Zero-based page index (sequential per dealer).
 * @param {number} pageSize - Rows per page.
 * @param {AbortSignal} [signal] - Lane abort signal.
 * @param {{ bypassCache?: boolean }} [options] - Skip server caches on refresh.
 * @returns {Promise<CustomerPageResponse>} Validated page payload.
 * @throws {Error} When the proxy responds non-OK.
 */
export async function getCustomerPage(
  dealerId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
  options?: { bypassCache?: boolean },
): Promise<CustomerPageResponse> {
  const params = new URLSearchParams();
  params.set("dealerId", dealerId);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (options?.bypassCache) params.set("refresh", "1");

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload as { message?: string } | null)?.message || "Failed to load the customer page";
    throw new Error(message);
  }

  return CustomerPageResponseSchema.parse(payload);
}
