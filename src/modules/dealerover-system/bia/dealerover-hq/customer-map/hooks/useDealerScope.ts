"use client";

import { useEffect, useState } from "react";
import type { BoundaryHighlight } from "../components/CustomerMapView";
import { getDealerScope } from "../providers/scope-provider";

interface DealerScopeState {
  key: string;
  data: BoundaryHighlight | null;
  unresolved: string[];
  isLoading: boolean;
}

/**
 * Loads the merged territory highlight for one dealer. Returns null until a
 * dealer is picked or when the dealer has no drawable territory.
 * @param {string | null} dealerId - Active roster dealer id (null/blank = none).
 * @returns {{ data: BoundaryHighlight | null; unresolved: string[]; isLoading: boolean }} Territory + undrawn labels + status.
 */
export function useDealerScope(dealerId: string | null): {
  data: BoundaryHighlight | null;
  unresolved: string[];
  isLoading: boolean;
} {
  const trimmed = typeof dealerId === "string" ? dealerId.trim() : "";

  // Empty key = no dealer. The state resets during render (the sanctioned
  // "adjust state during render" pattern) so no effect-time setState is needed.
  const key = trimmed;
  const [state, setState] = useState<DealerScopeState>({
    key,
    data: null,
    unresolved: [],
    isLoading: key !== "",
  });
  if (state.key !== key) {
    setState({ key, data: null, unresolved: [], isLoading: key !== "" });
  }

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();

    getDealerScope(key, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setState({ key, data: payload.data, unresolved: payload.unresolved, isLoading: false });
      })
      .catch((error: unknown) => {
        // getDealerScope never rejects by contract; this is belt-and-braces
        // so a future regression cannot leave the highlight spinner stuck.
        if (controller.signal.aborted) return;
        console.error("[CustomerMap] Failed to load dealer scope:", error);
        setState({ key, data: null, unresolved: [], isLoading: false });
      });

    return () => controller.abort();
  }, [key]);

  const settled = state.key === key;
  return {
    data: settled ? state.data : null,
    unresolved: settled ? state.unresolved : [],
    isLoading: settled && state.isLoading,
  };
}
