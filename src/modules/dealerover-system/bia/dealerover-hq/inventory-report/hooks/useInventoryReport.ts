"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  DealerRosterEntry,
  DealerStatus,
  InventoryReportResponse,
  InventoryRow,
  StockOutItem,
} from "../types";
import {
  getDealerRoster,
  getInventoryReport,
  type InventoryReportQuery,
} from "../providers/inventory-report-provider";

function toUserMessage(message: string): string {
  return message.replace(/^[A-Z][A-Z0-9_]*:\s*/, "");
}

export interface DealerFetchState {
  loading: boolean;
  online: boolean;
  reason?: string;
  rowCount: number;
}

interface DealerBucket {
  status: DealerStatus | null;
  rows: InventoryRow[];
  stockOuts: StockOutItem[];
}

function offlineStatus(
  dealerId: string,
  roster: DealerRosterEntry[],
  reason: string,
  message: string,
): DealerStatus {
  const entry = roster.find((r) => r.dealerId === dealerId);
  return {
    dealerId,
    dealerName: entry?.dealerName ?? `Dealer ${dealerId}`,
    dealerCode: entry?.dealerCode ?? "",
    online: false,
    rowCount: 0,
    error: message,
    reason,
  };
}

/**
 * Loads the HQ inventory report progressively — one request per dealer fired
 * in parallel, merged as each resolves. Loaded dealers stay visible while a
 * slow dealer (e.g. Men2 Dagupan) is still pending; a failing dealer keeps
 * its own reason and never affects the others. Previous data is kept on
 * filter changes until each dealer's new response replaces it
 * (stale-while-revalidate), and a request-sequence guard drops out-of-order
 * responses so a slow earlier wave cannot overwrite newer data.
 */
export function useInventoryReport(query: InventoryReportQuery) {
  const [roster, setRoster] = useState<DealerRosterEntry[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [buckets, setBuckets] = useState<Record<string, DealerBucket>>({});
  const [dealerStates, setDealerStates] = useState<Record<string, DealerFetchState>>({});
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const [waveParams, setWaveParams] = useState({ windowDays: query.windowDays, includeZero: query.includeZero });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Serialize the id list so the effect fires on filter changes, not renders.
  const dealerIdsKey = useMemo(() => [...query.dealerIds].sort().join(","), [query.dealerIds]);
  const { includeZero, windowDays } = query;

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controllers = new Map<string, AbortController>();

    async function run() {
      // Roster first (fetched once per session — the route serves it from the
      // already-cached dealer list), so the picker never depends on selection.
      let currentRoster = roster;
      if (!currentRoster) {
        setRosterLoading(true);
        try {
          const loaded = await getDealerRoster();
          if (cancelled) return;
          currentRoster = loaded;
          setRoster(loaded);
        } catch (err: unknown) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : "Failed to load the dealer roster";
          setError((prev) => prev ?? message);
          toast.error("Dealer roster failed", { description: toUserMessage(message) });
        } finally {
          if (!cancelled) setRosterLoading(false);
        }
      } else {
        setRosterLoading(false);
      }
      if (cancelled) return;

      const wanted = dealerIdsKey ? dealerIdsKey.split(",") : [];
      // Empty selection = every roster dealer, as explicit per-dealer
      // requests (never one combined call that a slow dealer would block).
      const rosterIds = (currentRoster ?? []).map((r) => r.dealerId);
      const targets = wanted.length ? wanted : rosterIds;
      const rosterSnapshot = currentRoster ?? [];

      setWaveParams({ windowDays, includeZero });
      setGeneratedAt(new Date().toISOString());
      if (!cancelled) setError(null);

      // Drop dealers that are no longer selected; keep everyone else's data
      // visible while their refresh is in flight.
      setBuckets((prev) => {
        const next: Record<string, DealerBucket> = {};
        for (const id of targets) {
          next[id] = prev[id] ?? { status: null, rows: [], stockOuts: [] };
        }
        return next;
      });
      setDealerStates((prev) => {
        const next: Record<string, DealerFetchState> = {};
        for (const id of targets) {
          const old = prev[id];
          next[id] = {
            loading: true,
            online: old?.online ?? true,
            reason: old?.reason,
            rowCount: old?.rowCount ?? 0,
          };
        }
        return next;
      });

      // No resolvable target (roster failed and nothing selected): fall back
      // to one combined request so the page still shows something.
      const waves = targets.length
        ? targets.map((id) => ({ id, params: { dealerIds: [id], includeZero, windowDays } }))
        : [{ id: "", params: { dealerIds: [] as string[], includeZero, windowDays } }];

      const settle = (id: string, response: InventoryReportResponse) => {
        if (cancelled) return;
        setGeneratedAt(response.generatedAt);
        if (!id) {
          // Combined fallback: split rows back out per dealer.
          setBuckets(() => {
            const next: Record<string, DealerBucket> = {};
            for (const status of response.dealers) {
              next[status.dealerId] = {
                status,
                rows: response.rows.filter((r) => r.dealerId === status.dealerId),
                stockOuts: response.stockOuts.filter((s) => s.dealerId === status.dealerId),
              };
            }
            return next;
          });
          setDealerStates(() => {
            const next: Record<string, DealerFetchState> = {};
            for (const status of response.dealers) {
              next[status.dealerId] = {
                loading: false,
                online: status.online,
                reason: status.reason,
                rowCount: status.rowCount,
              };
            }
            return next;
          });
          return;
        }
        const status =
          response.dealers.find((d) => d.dealerId === id) ??
          ({
            dealerId: id,
            dealerName: rosterSnapshot.find((r) => r.dealerId === id)?.dealerName ?? `Dealer ${id}`,
            dealerCode: rosterSnapshot.find((r) => r.dealerId === id)?.dealerCode ?? "",
            online: true,
            rowCount: response.rows.length,
          } satisfies DealerStatus);
        const rows = response.rows.filter((r) => r.dealerId === id);
        const stockOuts = response.stockOuts.filter((s) => s.dealerId === id);
        setBuckets((prev) => ({ ...prev, [id]: { status, rows, stockOuts } }));
        setDealerStates((prev) => ({
          ...prev,
          [id]: { loading: false, online: status.online, reason: status.reason, rowCount: rows.length },
        }));
      };

      const fail = (id: string, err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Dealer backend unreachable";
        if (!id) {
          setError(message);
          toast.error("Inventory report failed", { description: toUserMessage(message) });
          return;
        }
        // Keep this dealer's previous rows on screen; record its own reason.
        setBuckets((prev) => {
          const old = prev[id];
          if (old?.status) return prev;
          return { ...prev, [id]: { status: offlineStatus(id, rosterSnapshot, "unreachable", message), rows: [], stockOuts: [] } };
        });
        setDealerStates((prev) => ({
          ...prev,
          [id]: { loading: false, online: false, reason: "unreachable", rowCount: prev[id]?.rowCount ?? 0 },
        }));
      };

      await Promise.all(
        waves.map(async ({ id, params }) => {
          const controller = new AbortController();
          if (id) controllers.set(id, controller);
          try {
            const response = await getInventoryReport(params, controller.signal);
            settle(id, response);
          } catch (err: unknown) {
            fail(id, err);
          }
        }),
      );
    }

    void run();

    return () => {
      cancelled = true;
      for (const controller of controllers.values()) controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerIdsKey, includeZero, windowDays, tick]);

  const data = useMemo<InventoryReportResponse | null>(() => {
    const statuses = Object.values(buckets)
      .map((b) => b.status)
      .filter((s): s is DealerStatus => s !== null);
    if (!statuses.length) return null;
    return {
      success: true,
      generatedAt,
      windowDays: waveParams.windowDays,
      includeZero: waveParams.includeZero,
      dealers: statuses,
      rows: Object.values(buckets).flatMap((b) => b.rows),
      stockOuts: Object.values(buckets).flatMap((b) => b.stockOuts),
      roster: roster ?? undefined,
    };
  }, [buckets, generatedAt, waveParams, roster]);

  // Initial roster / first responses still pending — NOT "any dealer loading".
  const isLoading =
    rosterLoading ||
    (data === null && Object.values(dealerStates).some((s) => s.loading));

  return { data, isLoading, error, refresh, dealerStates };
}
