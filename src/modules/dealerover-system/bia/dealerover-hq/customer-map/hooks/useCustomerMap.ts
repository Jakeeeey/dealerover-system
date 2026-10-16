"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CustomerMapResponse,
  DealerLaneState,
  DealerRosterEntry,
  DealerStatus,
  LookupItem,
} from "../types";
import {
  CUSTOMER_PAGE_SIZE,
  getCustomerPage,
  getDealerRoster,
} from "../providers/customer-map-provider";

export interface UseCustomerMapResult {
  data: CustomerMapResponse | null;
  /** HQ roster — feeds the dealer picker so it never depends on map data. */
  roster: DealerRosterEntry[];
  /** Per-dealer streaming progress, keyed by dealer id. */
  dealerStates: Record<string, DealerLaneState>;
  isLoading: boolean;
  error: string | null;
  refresh: (options?: { bypassCache?: boolean }) => Promise<void>;
}

function emptyResponse(): CustomerMapResponse {
  return { success: true, dealerStatuses: [], customers: [], lookups: { storeTypes: [], classifications: [] } };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError"
  );
}

function mergeLookupUnion(
  current: LookupItem[],
  incoming: LookupItem[] | undefined,
): LookupItem[] {
  if (!incoming || incoming.length === 0) return current;
  // Dedupe by name: lookup ids are per-dealer and collide across dealers.
  const seen = new Set(current.map((item) => item.name));
  const merged = [...current];
  for (const item of incoming) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      merged.push(item);
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Streams the HQ customer map through per-dealer lanes with sequential paging.
 * The roster is fetched once, then every roster dealer runs its own lane
 * (pages sequential within a lane — parallel Directus calls on one instance
 * get 503s; lanes concurrent with each other — each dealer is a separate
 * host). Rows merge incrementally so a slow dealer never blanks or delays the
 * others' dots. A dealer that fails mid-way keeps its merged rows and records
 * its own error without affecting other lanes.
 * @returns {{ data: CustomerMapResponse | null; roster: DealerRosterEntry[]; dealerStates: Record<string, DealerLaneState>; isLoading: boolean; error: string | null; refresh: (options?: { bypassCache?: boolean }) => Promise<void> }}
 */
export function useCustomerMap(): UseCustomerMapResult {
  const [data, setData] = useState<CustomerMapResponse | null>(null);
  const [roster, setRoster] = useState<DealerRosterEntry[]>([]);
  const [dealerStates, setDealerStates] = useState<Record<string, DealerLaneState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Wave generation: a slow lane from a previous filter/refresh wave must not
  // abort or overwrite a newer one — every async continuation checks this.
  const waveRef = useRef(0);
  const laneControllersRef = useRef(new Map<string, AbortController>());
  const rosterControllerRef = useRef<AbortController | null>(null);

  const abortAllLanes = useCallback(() => {
    rosterControllerRef.current?.abort();
    rosterControllerRef.current = null;
    laneControllersRef.current.forEach((controller) => controller.abort());
    laneControllersRef.current.clear();
  }, []);

  const refresh = useCallback(async (options?: { bypassCache?: boolean }) => {
    const bypassCache = options?.bypassCache === true;
    const wave = waveRef.current + 1;
    waveRef.current = wave;
    abortAllLanes();

    // Each wave gets its own roster signal; every lane gets its own
    // AbortController below. A superseded wave is detected via the wave
    // generation counter plus the aborted signals — a slow lane from a
    // previous wave can neither abort nor overwrite a newer one.
    const rosterController = new AbortController();
    rosterControllerRef.current = rosterController;

    setIsLoading(true);
    setError(null);
    setData(null);
    setRoster([]);
    setDealerStates({});

    let rosterEntries: DealerRosterEntry[];
    try {
      rosterEntries = await getDealerRoster(rosterController.signal);
    } catch (err) {
      if (waveRef.current !== wave || rosterController.signal.aborted) return;
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to load the dealer roster");
      setIsLoading(false);
      return;
    }
    if (waveRef.current !== wave || rosterController.signal.aborted) return;
    setRoster(rosterEntries);
    if (rosterEntries.length === 0) {
      setError("No dealers found in the registry");
      setIsLoading(false);
      return;
    }

    const initialStates: Record<string, DealerLaneState> = {};
    for (const entry of rosterEntries) {
      initialStates[entry.dealerId] = {
        loading: true,
        online: true,
        scanned: 0,
        plotted: 0,
        withoutLocation: 0,
        done: false,
      };
    }
    setDealerStates(initialStates);

    let mergedTotal = 0;
    let settledLanes = 0;
    const laneErrors: string[] = [];
    const totalLanes = rosterEntries.length;

    const runLane = async (entry: DealerRosterEntry): Promise<void> => {
      const controller = new AbortController();
      laneControllersRef.current.set(entry.dealerId, controller);
      let page = 0;
      let total: number | undefined;
      let laneRows = 0;
      let laneScanned = 0;
      let laneError: string | undefined;
      try {
        for (;;) {
          if (waveRef.current !== wave || controller.signal.aborted) return;
          let pagePayload;
          try {
            pagePayload = await getCustomerPage(
              entry.dealerId,
              page,
              CUSTOMER_PAGE_SIZE,
              controller.signal,
              bypassCache ? { bypassCache: true } : undefined,
            );
          } catch (err) {
            // A superseded wave or an intentional abort is silent, never an error.
            if (waveRef.current !== wave || controller.signal.aborted) return;
            if (isAbortError(err)) return;
            laneError = err instanceof Error ? err.message : "Failed to load dealer customers";
            break;
          }
          if (waveRef.current !== wave || controller.signal.aborted) return;
          if (!pagePayload.success) {
            laneError = pagePayload.error ?? `Dealer ${entry.dealerName} is offline`;
            break;
          }
          const rows = pagePayload.customers;
          const hasMore = pagePayload.hasMore;
          if (typeof pagePayload.total === "number") total = pagePayload.total;
          laneRows += rows.length;
          // Scanned = what the dealer returned (advances to `total`);
          // laneRows = what survived mapping, i.e. what is on the map.
          laneScanned += pagePayload.fetched ?? rows.length;
          mergedTotal += rows.length;
          const done = !hasMore;
          const pageLookups = pagePayload.lookups;
          const laneTotal = total;
          // Incremental merge: this dealer's dots appear as each page lands.
          setData((previous) => {
            const base = previous ?? emptyResponse();
            return {
              success: true,
              dealerStatuses: base.dealerStatuses,
              customers: [...base.customers, ...rows],
              lookups: {
                storeTypes: mergeLookupUnion(base.lookups.storeTypes, pageLookups?.storeTypes),
                classifications: mergeLookupUnion(
                  base.lookups.classifications,
                  pageLookups?.classifications,
                ),
              },
            };
          });
          setDealerStates((previous) => ({
            ...previous,
            [entry.dealerId]: {
              loading: !done,
              online: true,
              scanned: laneScanned,
              plotted: laneRows,
              withoutLocation: Math.max(0, laneScanned - laneRows),
              ...(laneTotal !== undefined ? { total: laneTotal } : {}),
              done,
            },
          }));
          // First dots on the map end the skeleton — a still-running slow lane
          // must not hold the whole view in a loading state for minutes.
          if (mergedTotal > 0) setIsLoading(false);
          if (!hasMore) break;
          page += 1;
        }
      } finally {
        laneControllersRef.current.delete(entry.dealerId);
      }
      if (waveRef.current !== wave || controller.signal.aborted) return;
      settledLanes += 1;
      const status: DealerStatus =
        laneError !== undefined
          ? {
              dealerId: entry.dealerId,
              dealerName: entry.dealerName,
              dealerCode: entry.dealerCode,
              online: false,
              customerCount: laneRows,
              error: laneError,
            }
          : {
              dealerId: entry.dealerId,
              dealerName: entry.dealerName,
              dealerCode: entry.dealerCode,
              online: true,
              customerCount: laneRows,
            };
      const failed = laneError !== undefined;
      const finalError = laneError;
      const finalLoaded = laneRows;
      const finalTotal = total;
      setData((previous) => {
        const base = previous ?? emptyResponse();
        return { ...base, dealerStatuses: [...base.dealerStatuses, status] };
      });
      setDealerStates((previous) => ({
        ...previous,
        [entry.dealerId]: {
          loading: false,
          online: !failed,
          scanned: laneScanned,
          plotted: finalLoaded,
          withoutLocation: Math.max(0, laneScanned - finalLoaded),
          ...(finalTotal !== undefined ? { total: finalTotal } : {}),
          done: true,
          ...(failed && finalError ? { error: finalError } : {}),
        },
      }));
      if (failed && laneRows === 0) laneErrors.push(`${entry.dealerName}: ${finalError}`);
      if (settledLanes === totalLanes) {
        setIsLoading(false);
        if (mergedTotal === 0 && laneErrors.length > 0) {
          setError(
            laneErrors.length === 1
              ? laneErrors[0]
              : `${laneErrors.length} dealers are offline — their customers are hidden.`,
          );
        }
      }
    };

    await Promise.allSettled(rosterEntries.map((entry) => runLane(entry)));
  }, [abortAllLanes]);

  useEffect(() => {
    void refresh();
    return () => {
      abortAllLanes();
    };
  }, [refresh, abortAllLanes]);

  return { data, roster, dealerStates, isLoading, error, refresh };
}
