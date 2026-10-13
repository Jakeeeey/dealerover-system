"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerMapResponse } from "../types";
import { getCustomerMap } from "../providers/customer-map-provider";

/**
 * Loads the HQ customer map payload and exposes refresh + status flags.
 * @param {string} [dealerId] - Optional dealer id to scope the fetch to one dealer.
 * @returns {{ data: CustomerMapResponse | null; isLoading: boolean; error: string | null; refresh: () => Promise<void> }}
 */
export function useCustomerMap(dealerId?: string) {
  const [data, setData] = useState<CustomerMapResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const result = await getCustomerMap(dealerId);
      if (controller.signal.aborted) return;
      setData(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load the customer map");
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [dealerId]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
