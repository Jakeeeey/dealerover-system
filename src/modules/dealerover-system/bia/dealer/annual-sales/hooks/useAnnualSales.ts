"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  type DashboardResponse,
} from "../types/annual-sales.schema";
import { fetchDashboardData } from "../services/annual-sales";

export function useAnnualSales(params: Record<string, string> = {}) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const paramsKey = JSON.stringify(params);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchDashboardData(params);
      if (controller.signal.aborted) return;
      setData(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : "ERR_INTERNAL_FAIL: Failed to load annual sales data",
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { data, isLoading, error, refresh };
}
