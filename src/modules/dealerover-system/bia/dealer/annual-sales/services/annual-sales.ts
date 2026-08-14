import {
  DashboardResponseSchema,
  type DashboardResponse,
} from "../types/annual-sales.schema";

/**
 * Fetches the annual sales dashboard data (summary + monthly aggregates) for one selected dealer.
 * Calls the local Next.js API route, which logs into that dealer's own Spring Boot backend.
 * @param params - Query parameters: dealerId (required for real data), dateFrom, dateTo, customerName, supplierName, year
 * @returns {Promise<DashboardResponse>} Aggregated dashboard data with summary and monthly breakdown
 * @throws {ERR_API_FAIL} When the API request fails or returns a non-OK status
 * @throws {ERR_VALIDATION_FAILED} When the response fails Zod schema validation
 */
export async function fetchDashboardData(
  params: Record<string, string> = {},
): Promise<DashboardResponse> {
  const query = new URLSearchParams({
    ...params,
    _t: Date.now().toString(),
  }).toString();
  const url = `/api/dealerover-system/bia/dealer/annual-sales${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ERR_API_FAIL: Failed to fetch annual sales data: ${response.statusText}`,
    );
  }

  const rawData = await response.json();
  return DashboardResponseSchema.parse(rawData);
}
