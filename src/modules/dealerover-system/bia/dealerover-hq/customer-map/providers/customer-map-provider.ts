import {
  CustomerMapResponseSchema,
  type CustomerMapResponse,
} from "../types";

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/customer-map";

/**
 * Client fetch helper for the HQ customer map. Calls the local API proxy
 * (which injects the server-only Directus token) and validates the envelope.
 * @param {string} [dealerId] - Optional dealer id to scope the request to one dealer.
 * @returns {Promise<CustomerMapResponse>} Validated map payload.
 * @throws {Error} When the proxy responds non-OK.
 */
export async function getCustomerMap(dealerId?: string): Promise<CustomerMapResponse> {
  const params = new URLSearchParams();
  if (dealerId) params.set("dealerId", dealerId);
  const query = params.toString();

  const res = await fetch(`${API_PATH}${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload as { message?: string } | null)?.message || "Failed to load the customer map";
    throw new Error(message);
  }

  return CustomerMapResponseSchema.parse(payload);
}
