import { z } from "zod";
import type { BoundaryHighlight } from "../components/CustomerMapView";

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/customer-map/scope";

// Lightweight shape check: the route always answers 200 (empty on any server
// failure), so anything off-shape here means the payload is unusable, not that
// the dealer has no territory — both cases converge to "no highlight".
const ScopeFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable(),
});

const ScopeResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(ScopeFeatureSchema),
  }),
  resolved: z.array(z.string()),
  unresolved: z.array(z.string()),
});

/**
 * Client fetch helper for one dealer's merged territory highlight. Calls the
 * local scope proxy and returns the FeatureCollection plus the names that had
 * no geometry (for the "not drawn" notice).
 * @param {string} dealerId - Roster dealer id whose territory to draw.
 * @param {AbortSignal} [signal] - Optional abort signal for stale requests.
 * @returns {Promise<{ data: BoundaryHighlight | null; unresolved: string[] }>} Territory geometry (null when none) + undrawn labels. Never throws.
 */
export async function getDealerScope(
  dealerId: string,
  signal?: AbortSignal,
): Promise<{ data: BoundaryHighlight | null; unresolved: string[] }> {
  const fallback = { data: null, unresolved: [] as string[] };
  if (!dealerId.trim()) return fallback;

  try {
    const params = new URLSearchParams({ dealerId: dealerId.trim() });
    const res = await fetch(`${API_PATH}?${params.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
    });
    if (!res.ok) return fallback;

    const payload: unknown = await res.json().catch(() => null);
    const parsed = ScopeResponseSchema.safeParse(payload);
    if (!parsed.success) return fallback;
    return { data: parsed.data.data, unresolved: parsed.data.unresolved };
  } catch {
    // Offline proxy, aborted request, or bad JSON — all converge to "no
    // highlight" so a scope failure can never break the map.
    return fallback;
  }
}
