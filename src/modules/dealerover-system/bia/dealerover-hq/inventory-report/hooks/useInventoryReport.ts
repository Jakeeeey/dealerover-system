"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DealerBranch,
  DealerRosterEntry,
  DealerStatus,
  InventoryProgress,
  InventoryRow,
  MasterProduct,
  ProductDemand,
} from "../types";
import {
  BRANCH_PAGE_SIZE,
  getDealerRoster,
  getInventoryAnalytics,
  getInventoryMeta,
  getInventoryPage,
} from "../providers/inventory-report-provider";

export type { InventoryProgress };

export interface InventoryReportQuery {
  dealerId: string | null;
  includeZero: boolean;
  windowDays: number;
  lookbackDays: number;
}

export interface InventoryReportResult {
  roster: DealerRosterEntry[] | null;
  rosterLoading: boolean;
  dealer: DealerStatus | null;
  branches: DealerBranch[];
  products: MasterProduct[];
  rows: InventoryRow[];
  /** Per-product demand index covering the whole invoiced catalogue. */
  analytics: ProductDemand[];
  /** ISO date of the dealer's most recent invoice; "" when it has none. */
  lastInvoiceAt: string;
  /**
   * True only once a demand index has actually loaded. A failed read must never
   * be mistaken for "this dealer sold nothing" — that would flip the whole
   * catalogue to dead/dropped.
   */
  analyticsAvailable: boolean;
  progress: InventoryProgress;
  /** True only while branch pages are landing; a failed page ends the stream. */
  streaming: boolean;
  isLoading: boolean;
  error: string | null;
  generatedAt: string;
  windowDays: number;
  includeZero: boolean;
  refresh: (opts?: { bypassCache?: boolean }) => void;
}

const EMPTY_PROGRESS: InventoryProgress = { pagesDone: 0, totalPages: 0, scanned: 0, plotted: 0 };

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Loads one dealer's inventory progressively: roster once, then the dealer
 * meta (branches + product master), then one branch-batch page at a time,
 * merging rows as each lands. The per-product demand index flies alongside
 * meta (dealer id only) and never delays paging; its failure is non-fatal.
 * A wave/generation counter plus a per-wave AbortController guarantees a
 * dealer switch can never be overwritten by an older page response. Failures
 * land in `error` and are never thrown.
 */
export function useInventoryReport(query: InventoryReportQuery): InventoryReportResult {
  const { dealerId: wantedDealerId, includeZero, windowDays, lookbackDays } = query;

  const [roster, setRoster] = useState<DealerRosterEntry[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [dealer, setDealer] = useState<DealerStatus | null>(null);
  const [branches, setBranches] = useState<DealerBranch[]>([]);
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [analytics, setAnalytics] = useState<ProductDemand[]>([]);
  const [analyticsAvailable, setAnalyticsAvailable] = useState(false);
  const [lastInvoiceAt, setLastInvoiceAt] = useState("");
  const [progress, setProgress] = useState<InventoryProgress>(EMPTY_PROGRESS);
  const [metaLoading, setMetaLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const [wave, setWave] = useState({ n: 0, bypassCache: false });
  const generationRef = useRef(0);

  // Roster is fetched once per mount; the first slot is the default dealer.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const loaded = await getDealerRoster();
        if (!cancelled) setRoster(loaded);
      } catch (err: unknown) {
        if (!cancelled) setError(messageOf(err, "Failed to load the dealer roster"));
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Roster order IS the slot order — the first slot is the default.
  // An empty string means "no explicit choice": fall back to the first slot.
  const effectiveDealerId =
    (wantedDealerId && wantedDealerId.trim().length > 0 ? wantedDealerId : null) ??
    roster?.[0]?.dealerId ??
    null;

  const refresh = useCallback((opts?: { bypassCache?: boolean }) => {
    // Invalidate any in-flight wave immediately, clear rows first, then let
    // the wave effect below re-run with (or without) cache bypass.
    generationRef.current += 1;
    setRows([]);
    setProgress(EMPTY_PROGRESS);
    setError(null);
    setWave((w) => ({ n: w.n + 1, bypassCache: opts?.bypassCache === true }));
  }, []);

  useEffect(() => {
    if (!effectiveDealerId) return;
    const dealerId = effectiveDealerId;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();

    // Dealer/filter change: reset rows, then load meta, then stream pages.
    setRows([]);
    setProgress(EMPTY_PROGRESS);
    setError(null);
    setDealer(null);
    setBranches([]);
    setProducts([]);
    setAnalytics([]);
    setAnalyticsAvailable(false);
    setLastInvoiceAt("");
    setMetaLoading(true);
    setStreaming(false);

    // The demand index only needs the dealer id, so it flies alongside meta
    // and never delays paging. A failure is non-fatal: the client keeps an
    // empty index and no error.
    void getInventoryAnalytics(dealerId, {
      windowDays,
      lookbackDays,
      refresh: wave.bypassCache,
      signal: controller.signal,
    }).then(
      (analyticsRes) => {
        if (generation !== generationRef.current) return;
        setAnalytics(analyticsRes.success ? analyticsRes.products : []);
        setAnalyticsAvailable(analyticsRes.success);
        setLastInvoiceAt(analyticsRes.lastInvoiceAt ?? "");
      },
      (err: unknown) => {
        if (isAbort(err)) return;
        console.error(
          `ERR_ANALYTICS_FAIL: [InventoryReport] Demand index failed for dealer "${dealerId}":`,
          err,
        );
        if (generation !== generationRef.current) return;
        setAnalytics([]);
        setLastInvoiceAt("");
      },
    );

    async function run() {
      let meta;
      try {
        meta = await getInventoryMeta(dealerId, {
          refresh: wave.bypassCache,
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if (generation !== generationRef.current) return;
        if (isAbort(err)) return;
        setMetaLoading(false);
        setError(messageOf(err, "Failed to load dealer inventory"));
        return;
      }
      // An older wave's meta must never overwrite the current dealer.
      if (generation !== generationRef.current) return;
      setMetaLoading(false);
      setGeneratedAt(new Date().toISOString());
      setDealer(meta.dealer);
      setBranches(meta.branches);
      setProducts(meta.products);

      if (!meta.success || !meta.dealer.online) {
        setError(meta.dealer.error ?? meta.error ?? "Dealer offline");
        return;
      }

      const pageSize = meta.branchPageSize > 0 ? meta.branchPageSize : BRANCH_PAGE_SIZE;
      const totalPages = Math.ceil(meta.totalBranches / pageSize);
      setProgress({ ...EMPTY_PROGRESS, totalPages });
      if (totalPages === 0) return;

      setStreaming(true);
      const merged: InventoryRow[] = [];
      let scanned = 0;
      for (let page = 0; page < totalPages; page += 1) {
        let res;
        try {
          res = await getInventoryPage(dealerId, page, pageSize, {
            windowDays,
            includeZero,
            refresh: wave.bypassCache,
            signal: controller.signal,
          });
        } catch (err: unknown) {
          if (generation !== generationRef.current) return;
          if (isAbort(err)) return;
          setError(messageOf(err, "Failed to load inventory page"));
          break;
        }
        // An older wave's page must never merge into the current dealer.
        if (generation !== generationRef.current) return;
        if (!res.success) {
          setError(res.error ?? "Failed to load inventory page");
          break;
        }
        merged.push(...res.rows);
        scanned += res.scanned;
        const landed = [...merged];
        setRows(landed);
        setProgress({ pagesDone: page + 1, totalPages, scanned, plotted: landed.length });
        if (!res.hasMore) break;
      }
      if (generation !== generationRef.current) return;
      setStreaming(false);
    }

    void run();

    return () => {
      controller.abort();
    };
    // Wave inputs: effective dealer, filters, and the refresh counter.
  }, [effectiveDealerId, windowDays, lookbackDays, includeZero, wave]);

  const isLoading = rosterLoading || metaLoading || streaming;

  return {
    roster,
    rosterLoading,
    streaming,
    dealer,
    branches,
    products,
    rows,
    analytics,
    analyticsAvailable,
    lastInvoiceAt,
    progress,
    isLoading,
    error,
    generatedAt,
    windowDays,
    includeZero,
    refresh,
  };
}
