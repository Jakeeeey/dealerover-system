"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { ErrorPage } from "@/app/(dealerover-system)/dealerover-system/_components/ErrorPage";
import { DealerFilterCombobox } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/components/FilterCombobox";
import { getDealerColor } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/utils/dealer-colors";
import { DealeroverEmblemPreloader } from "@/modules/dealerover-system/bia/dealerover-hq/leaderboard/components/dealerover-emblem-preloader";
import { triggerRankConfetti } from "@/modules/dealerover-system/bia/dealerover-hq/leaderboard/components/rank-confetti";
import type { InventoryRow } from "./types";
import { useInventoryReport } from "./hooks/useInventoryReport";
import { useLowStockPolicy } from "./hooks/useLowStockPolicy";
import { buildProductAggregates, SEVERITY_RANK } from "./utils/aggregate";
import { HeroBand } from "./components/HeroBand";
import { UrgencyPodium } from "./components/UrgencyPodium";
import { LowStockBoard } from "./components/LowStockBoard";
import { Watchlist } from "./components/Watchlist";
import { ItemDrawer, type ItemDrawerSelection } from "./components/ItemDrawer";
import { PolicyPanel } from "./components/PolicyPanel";
import { InventoryReportSkeleton } from "./InventoryReportSkeleton";

const FILTER_STORAGE_KEY = "dealerover-hq.inventory-report.filters";

interface FilterState {
  dealerIds: string[];
  includeZero: boolean;
  windowDays: number;
}

const DEFAULT_FILTERS: FilterState = { dealerIds: [], includeZero: false, windowDays: 30 };

function readStoredFilters(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    const dealerIds = Array.isArray(parsed.dealerIds)
      ? parsed.dealerIds.filter((v): v is string => typeof v === "string")
      : [];
    const includeZero = parsed.includeZero === true;
    const windowDays =
      typeof parsed.windowDays === "number" && Number.isFinite(parsed.windowDays)
        ? Math.min(365, Math.max(7, Math.trunc(parsed.windowDays)))
        : 30;
    return { dealerIds, includeZero, windowDays };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export default function InventoryReportPage() {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [selection, setSelection] = React.useState<ItemDrawerSelection | null>(null);
  const policy = useLowStockPolicy();

  const query = React.useMemo(
    () => ({ dealerIds: filters.dealerIds, includeZero: filters.includeZero, windowDays: filters.windowDays }),
    [filters.dealerIds, filters.includeZero, filters.windowDays],
  );
  const { data, isLoading, error, refresh, dealerStates } = useInventoryReport(query);

  React.useEffect(() => {
    setFilters(readStoredFilters());
  }, []);

  const persistFilters = React.useCallback((next: FilterState) => {
    setFilters(next);
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors.
    }
  }, []);

  React.useEffect(() => {
    if (policy.policy.windowDays !== filters.windowDays) {
      policy.setWindowDays(filters.windowDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.windowDays]);

  const handleSelect = React.useCallback((dealerId: string, productId: number) => {
    setSelection({ dealerId, productId });
  }, []);

  const effectivePolicy = React.useMemo(
    () => ({ ...policy.policy, windowDays: filters.windowDays }),
    [policy.policy, filters.windowDays],
  );

  const aggregates = React.useMemo(
    () => buildProductAggregates(data?.rows ?? [], effectivePolicy),
    [data, effectivePolicy],
  );

  const dealers = React.useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string; code: string; color: string }[] = [];
    const source = (data?.roster?.length ? data.roster : (data?.dealers ?? [])).map((d) => ({
      dealerId: d.dealerId,
      dealerName: d.dealerName,
      dealerCode: d.dealerCode,
    }));
    source.forEach((status, index) => {
      if (seen.has(status.dealerId)) return;
      seen.add(status.dealerId);
      list.push({
        id: status.dealerId,
        name: status.dealerName,
        code: status.dealerCode,
        color: getDealerColor(index),
      });
    });
    return list;
  }, [data]);

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of data?.rows ?? []) {
      if (row.productCategory.trim()) set.add(row.productCategory);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const kpis = React.useMemo(() => {
    const dealersOnline = (data?.dealers ?? []).filter((d) => d.online).length;
    const out = aggregates.filter((a) => a.state === "out").length;
    const critical = aggregates.filter((a) => a.state === "critical").length;
    const low = aggregates.filter((a) => a.state === "low").length;
    const totalValue = aggregates.reduce((sum, a) => sum + a.value, 0);
    return {
      dealersOnline,
      dealersTotal: data?.dealers.length ?? 0,
      skusTracked: aggregates.length + (data?.stockOuts.length ?? 0),
      outCount: (data?.stockOuts.length ?? 0) + out,
      criticalCount: critical,
      lowCount: low,
      totalValue,
    };
  }, [aggregates, data]);

  const watchItems = React.useMemo(() => {
    const urgent = aggregates
      .filter((a) => a.state === "out" || a.state === "critical" || a.state === "low")
      .sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || b.value - a.value)
      .slice(0, 15);
    return urgent;
  }, [aggregates]);

  const podiumItems = React.useMemo(() => watchItems.slice(0, 3), [watchItems]);

  const drawerAggregate = React.useMemo(
    () =>
      selection
        ? (aggregates.find((a) => a.dealerId === selection.dealerId && a.productId === selection.productId) ?? null)
        : null,
    [aggregates, selection],
  );

  const drawerBranchRows: InventoryRow[] = React.useMemo(() => {
    if (!selection) return [];
    return (data?.rows ?? []).filter(
      (r) => r.dealerId === selection.dealerId && r.productId === selection.productId,
    );
  }, [data, selection]);

  const drawerNetwork = React.useMemo(() => {
    if (!drawerAggregate) return [];
    const code = drawerAggregate.productCode || `id:${drawerAggregate.productId}`;
    return aggregates.filter((a) => (a.productCode || `id:${a.productId}`) === code);
  }, [aggregates, drawerAggregate]);

  const pendingDealerNames = React.useMemo(() => {
    const nameById = new Map(dealers.map((d) => [d.id, d.name]));
    return Object.entries(dealerStates)
      .filter(([, state]) => state.loading)
      .map(([id]) => nameById.get(id) ?? `Dealer ${id}`);
  }, [dealerStates, dealers]);

  const celebratedRef = React.useRef(false);
  const networkClear =
    !!data &&
    data.success &&
    (data.rows.length > 0 || (data.stockOuts.length ?? 0) > 0) &&
    pendingDealerNames.length === 0 &&
    kpis.outCount === 0 &&
    kpis.criticalCount + kpis.lowCount === 0;
  React.useEffect(() => {
    if (networkClear && !celebratedRef.current) {
      celebratedRef.current = true;
      triggerRankConfetti(1);
    }
  }, [networkClear]);

  if (isLoading && !data) {
    return (
      <div className="relative mx-auto min-h-screen w-full max-w-[1600px] space-y-6 p-2 sm:p-6 md:p-10">
        <InventoryReportSkeleton />
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <DealeroverEmblemPreloader
            label="Loading Inventory Report..."
            sublabel="Streaming dealer stock…"
          />
        </div>
      </div>
    );
  }
  if (error) return <ErrorPage message={error} onRefresh={() => void refresh()} />;
  if (data && !data.success) {
    return <ErrorPage message={data.error ?? "Failed to load the inventory report"} onRefresh={() => void refresh()} />;
  }

  const offline = (data?.dealers ?? []).filter((d) => !d.online);

  const OFFLINE_REASON_LABELS: Record<string, string> = {
    "credentials-missing": "credentials not configured",
    "credentials-rejected": "credentials rejected",
    "login-rejected": "login rejected",
    timeout: "timed out",
    unreachable: "unreachable",
    "http-error": "unreachable",
    "product-master-unreachable": "product master unreachable",
  };

  const offlineByReason = new Map<string, typeof offline>();
  for (const d of offline) {
    const key = d.reason ?? "unreachable";
    const list = offlineByReason.get(key);
    if (list) {
      list.push(d);
    } else {
      offlineByReason.set(key, [d]);
    }
  }
  const offlineSummary = Array.from(offlineByReason.entries())
    .map(
      ([reason, list]) =>
        `${OFFLINE_REASON_LABELS[reason] ?? reason}: ${list.map((d) => d.dealerName).join(", ")}`,
    )
    .join(" · ");

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1600px] space-y-6 p-2 sm:p-6 md:p-10">
      <HeroBand
        dealersOnline={kpis.dealersOnline}
        dealersTotal={kpis.dealersTotal}
        skusTracked={kpis.skusTracked}
        outCount={kpis.outCount}
        criticalCount={kpis.criticalCount}
        lowCount={kpis.lowCount}
        totalValue={kpis.totalValue}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44 sm:w-56">
          <DealerFilterCombobox
            dealers={dealers}
            selected={filters.dealerIds}
            onChange={(ids) => persistFilters({ ...filters, dealerIds: ids })}
            disabled={isLoading}
          />
        </div>
        {pendingDealerNames.length > 0 && (
          <span className="flex min-w-0 max-w-56 items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-info" />
            <span className="truncate" title={pendingDealerNames.join(", ")}>
              Loading {pendingDealerNames.join(", ")}…
            </span>
          </span>
        )}
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5" role="group" aria-label="Minimum basis">
          {(["policy", "maintain"] as const).map((basis) => (
            <Button
              key={basis}
              variant={policy.policy.basis === basis ? "default" : "ghost"}
              size="sm"
              className={cn("h-7 px-2.5 text-xs min-h-11 md:min-h-0", policy.policy.basis !== basis && "text-muted-foreground")}
              onClick={() => policy.setBasis(basis)}
              aria-pressed={policy.policy.basis === basis}
            >
              {basis === "policy" ? "Policy" : "Maintain"}
            </Button>
          ))}
        </div>
        <PolicyPanel
          policy={effectivePolicy}
          categories={categories}
          onBasis={policy.setBasis}
          onLeadDays={policy.setLeadDays}
          onWindowDays={(days) => persistFilters({ ...filters, windowDays: Math.min(365, Math.max(7, Math.trunc(days) || 30)) })}
          onDefaultMinCases={policy.setDefaultMinCases}
          onCategoryMin={policy.setCategoryMin}
        />
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground">
          <Switch
            checked={filters.includeZero}
            onCheckedChange={(checked) => persistFilters({ ...filters, includeZero: checked })}
            aria-label="Include zero-stock rows"
          />
          Zero-stock
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="h-8 gap-2 text-xs min-h-11 md:min-h-0"
          title="Refresh report"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {offline.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" role="status">
          <StatusBadge tone="warning">
            {offline.length} {offline.length === 1 ? "dealer" : "dealers"} offline
          </StatusBadge>
          <span>
            {offlineSummary} — showing data from reachable dealers only.
          </span>
        </p>
      )}

      <UrgencyPodium items={podiumItems} onSelect={handleSelect} />

      <LowStockBoard aggregates={aggregates} dealers={data?.dealers ?? []} onSelect={handleSelect} />

      <section aria-label="Watchlist" className="space-y-2">
        <h3 className="text-sm font-semibold">Watchlist</h3>
        <Watchlist items={watchItems} onSelect={handleSelect} />
      </section>

      <ItemDrawer
        selection={selection}
        aggregate={drawerAggregate}
        branchRows={drawerBranchRows}
        network={drawerNetwork}
        windowDays={filters.windowDays}
        leadDays={policy.policy.leadDays}
        onCommit={policy.setOverride}
        onReset={policy.resetOverride}
        onClose={() => setSelection(null)}
        onSelect={handleSelect}
      />
    </div>
  );
}

export { InventoryReportSkeleton };
