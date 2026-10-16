"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LeaderboardResponse } from "../types";
import { fetchLeaderboard } from "../providers/leaderboard-provider";

/** Strips a leading machine code (`ERR_API_FAIL: `) before showing it to the user. */
function toUserMessage(message: string): string {
  return message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "");
}

/**
 * Loads the DealerOver HQ leaderboard and exposes refresh controls.
 *
 * @returns {{
 *   data: LeaderboardResponse | null;
 *   isLoading: boolean;
 *   error: string | null;
 *   refresh: (from?: string, to?: string) => Promise<void>;
 *   from: string;
 *   to: string;
 * }} The applied range plus the latest payload.
 */
export function useLeaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Applied range in a ref so `refresh` can stay stable (no dep churn) while
  // still remembering the last requested dates.
  const rangeRef = useRef<{ from: string; to: string }>({ from: "", to: "" });

  const refresh = useCallback(async (nextFrom?: string, nextTo?: string) => {
    if (nextFrom !== undefined) rangeRef.current.from = nextFrom;
    if (nextTo !== undefined) rangeRef.current.to = nextTo;

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchLeaderboard(
        rangeRef.current.from || undefined,
        rangeRef.current.to || undefined,
      );
      setData(result);
      setFrom(result.from);
      setTo(result.to);
      rangeRef.current = { from: result.from, to: result.to };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      setError(message);
      toast.error("Error", { description: toUserMessage(message) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, isLoading, error, refresh, from, to };
}
