import type { BoundaryHighlight } from "../components/CustomerMapView";
import type { BoundarySelection } from "../hooks/useBoundaryFeature";

const API_PATH = "/api/dealerover-system/bia/dealerover-hq/customer-map/boundary";

/**
 * Client fetch helper for one PSGC boundary highlight. Calls the local API
 * proxy and returns the FeatureCollection (null when there is no selection
 * or the boundary has no geometry).
 * @param {BoundarySelection | null} selection - Active boundary (null = none).
 * @param {AbortSignal} [signal] - Optional abort signal for stale requests.
 * @returns {Promise<BoundaryHighlight | null>} Boundary geometry, if any.
 * @throws {Error} When the proxy responds non-OK.
 */
export async function getBoundaryFeature(
  selection: BoundarySelection | null,
  signal?: AbortSignal,
): Promise<BoundaryHighlight | null> {
  if (!selection || !selection.name.trim()) return null;

  const params = new URLSearchParams({ level: selection.level, name: selection.name.trim() });
  if (selection.level === "barangay" && selection.city?.trim()) {
    params.set("city", selection.city.trim());
  }
  if (
    (selection.level === "barangay" || selection.level === "city") &&
    selection.province?.trim()
  ) {
    params.set("province", selection.province.trim());
  }

  const res = await fetch(`${API_PATH}?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload as { message?: string } | null)?.message || "Failed to load the boundary highlight";
    throw new Error(message);
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((payload as { features?: unknown }).features)
  ) {
    return payload as BoundaryHighlight;
  }
  return null;
}
