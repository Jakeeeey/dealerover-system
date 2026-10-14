"use client";

import * as React from "react";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TonePill } from "./components/StatusPill";
import { cn, formatNumber } from "@/lib/utils";
import { ErrorPage } from "@/app/(dealerover-system)/dealerover-system/_components/ErrorPage";
import { DealeroverEmblemPreloader } from "@/modules/dealerover-system/bia/dealerover-hq/leaderboard/components/dealerover-emblem-preloader";
import { triggerRankConfetti } from "@/modules/dealerover-system/bia/dealerover-hq/leaderboard/components/rank-confetti";
import type { DrillTarget, InventoryRow } from "./types";
import { useInventoryReport } from "./hooks/useInventoryReport";
import { useLowStockPolicy } from "./hooks/useLowStockPolicy";
import { buildProductAggregates, FLAGGED_STATES, SEVERITY_RANK, type ProductAggregate } from "./utils/aggregate";
import { STATE_LABEL } from "./utils/severity-tone";
import { HeroBand } from "./components/HeroBand";
import { DealerSelect } from "./components/DealerSelect";
import { InventoryDashboard } from "./components/InventoryDashboard";
import { LowStockBoard } from "./components/LowStockBoard";
import { ItemDrawer, type ItemDrawerSelection } from "./components/ItemDrawer";
import { PolicyPanel } from "./components/PolicyPanel";
import { InventoryReportSkeleton } from "./InventoryReportSkeleton";

const FILTER_STORAGE_KEY = "dealerover-hq.inventory-report.filters";

interface FilterState {
  dealerId: string;
  includeZero: boolean;
  windowDays: number;
}

const DEFAULT_FILTERS: FilterState = { dealerId: "", includeZero: false, windowDays: 30 };

const DIMENSION_WORD: Record<"brand" | "category" | "supplier", string> = {
  brand: "Brand",
  category: "Category",
  supplier: "Supplier",
};

const OFFLINE_REASON_LABELS: Record<string, string> = {
  "credentials-missing": "credentials not configured",
  "credentials-rejected": "credentials rejected",
  "login-rejected": "login rejected",
  timeout: "timed out",
  unreachable: "unreachable",
  "http-error": "unreachable",
  "product-master-unreachable": "product master unreachable",
};

function readStoredFilters(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    const dealerId = typeof parsed.dealerId === "string" ? parsed.dealerId : "";
    const includeZero = parsed.includeZero === true;
    const windowDays =
      typeof parsed.windowDays === "number" && Number.isFinite(parsed.windowDays)
        ? Math.min(365, Math.max(7, Math.trunc(parsed.windowDays)))
        : 30;
    return { dealerId, includeZero, windowDays };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function dimensionField(item: ProductAggregate, dimension: "brand" | "category" | "supplier"): string {
  const raw = dimension === "brand" ? item.brand : dimension === "category" ? item.category : item.supplier;
  return (raw ?? "").trim();
}

/**
 * True when the dealer has at least one invoice inside the demand window.
 * Without a recent invoice there is no demand signal, so cover-based
 * states cannot be judged — the classifier falls back to stock-only
 * states (dead / dropped / unrated).
 */
function isDemandActive(lastInvoiceAt: string, windowDays: number): boolean {
  if (!lastInvoiceAt) return false;
  const time = Date.parse(lastInvoiceAt);
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= Math.max(windowDays, 1) * 24 * 60 * 60 * 1000;
}

export default function InventoryReportPage() {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);
  const [drill, setDrill] = React.useState<DrillTarget | null>(null);
  const [selection, setSelection] = React.useState<ItemDrawerSelection | null>(null);
  const policy = useLowStockPolicy();

  // "" means "let the hook default to roster[0]"; lookbackDays is the analytics
  // horizon the hook uses to build the per-product demand index.
  const query = React.useMemo(
    () => ({
      dealerId: filters.dealerId || null,
      includeZero: filters.includeZero,
      windowDays: filters.windowDays,
      lookbackDays: policy.policy.lookbackDays,
    }),
    [filters.dealerId, filters.includeZero, filters.windowDays, policy.policy.lookbackDays],
  );
  const {
    roster,
    dealer,
    branches,
    products,
    rows,
    analytics,
    analyticsAvailable,
    lastInvoiceAt,
    progress,
    streaming,
    isLoading,
    error,
    refresh,
  } = useInventoryReport(query);

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

  const activeDealerId = filters.dealerId || roster?.[0]?.dealerId || "";
  const dealerName = dealer?.dealerName || roster?.find((r) => r.dealerId === activeDealerId)?.dealerName || "this dealer";

  // A persisted dealer that has left the roster must not trap the page.
  React.useEffect(() => {
    if (!roster || roster.length === 0) return;
    if (filters.dealerId && !roster.some((r) => r.dealerId === filters.dealerId)) {
      persistFilters({ ...filters, dealerId: "" });
    }
  }, [roster, filters, persistFilters]);

  // A drill is scoped to one dealer — changing the dealer drops back to cards.
  React.useEffect(() => {
    setDrill(null);
  }, [activeDealerId]);

  const handleSelect = React.useCallback((dealerId: string, productId: number) => {
    setSelection({ dealerId, productId });
  }, []);

  const effectivePolicy = React.useMemo(
    () => ({
      leadDays: policy.policy.leadDays,
      windowDays: filters.windowDays,
      lookbackDays: policy.policy.lookbackDays,
    }),
    [policy.policy.leadDays, policy.policy.lookbackDays, filters.windowDays],
  );

  const dealerActive = React.useMemo(
    () => analyticsAvailable && isDemandActive(lastInvoiceAt, filters.windowDays),
    [analyticsAvailable, lastInvoiceAt, filters.windowDays],
  );

  const dealerInfo = React.useMemo(() => {
    if (dealer) {
      return { dealerId: dealer.dealerId, dealerName: dealer.dealerName, dealerCode: dealer.dealerCode };
    }
    const fallback = roster?.find((r) => r.dealerId === activeDealerId);
    if (fallback) {
      return { dealerId: fallback.dealerId, dealerName: fallback.dealerName, dealerCode: fallback.dealerCode };
    }
    return undefined;
  }, [dealer, roster, activeDealerId]);

  const aggregates = React.useMemo(
    () =>
      buildProductAggregates(
        rows ?? [],
        products ?? [],
        analytics,
        effectivePolicy,
        dealerActive,
        analyticsAvailable,
        dealerInfo,
      ),
    [rows, products, analytics, effectivePolicy, dealerActive, analyticsAvailable, dealerInfo],
  );

  // The master is fully classified, so the hero figure comes straight from
  // the aggregates — exception counts live in layer 1, not the hero.
  const flaggedCount = React.useMemo(
    () => aggregates.filter((a) => FLAGGED_STATES.has(a.state)).length,
    [aggregates],
  );
  const totalValue = React.useMemo(() => aggregates.reduce((sum, a) => sum + a.value, 0), [aggregates]);

  const drillView = React.useMemo(() => {
    if (!drill) return null;
    if (drill.kind === "urgent") {
      const items = aggregates
        .filter((a) => FLAGGED_STATES.has(a.state))
        .sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || b.value - a.value);
      return {
        title: `Most urgent at ${dealerName}`,
        summary: `Every flagged product at ${dealerName}, ranked by severity.`,
        emptyHint: `Nothing is flagged at ${dealerName} — every product is healthy, unrated, or dropped.`,
        items,
      };
    }
    if (drill.kind === "severity") {
      const items = aggregates.filter((a) => a.state === drill.state);
      return {
        title: `${STATE_LABEL[drill.state]} at ${dealerName}`,
        summary: `Products at ${dealerName} in the ${STATE_LABEL[drill.state].toLowerCase()} tier, ranked by severity.`,
        emptyHint: `No ${STATE_LABEL[drill.state].toLowerCase()} products at ${dealerName} right now.`,
        items,
      };
    }
    if (drill.kind === "dimension") {
      const items = aggregates.filter((a) => dimensionField(a, drill.dimension) === drill.key);
      return {
        title: drill.label,
        summary: `${DIMENSION_WORD[drill.dimension]} spotlight at ${dealerName} — every product under “${drill.label}”.`,
        emptyHint: `No products under “${drill.label}” at ${dealerName} right now.`,
        items,
      };
    }
    const scopedRows = (rows ?? []).filter((r) => r.branchId === drill.branchId);
    const scopedIds = new Set(scopedRows.map((r) => r.productId));
    const scopedMaster = (products ?? []).filter((p) => scopedIds.has(p.productId));
    return {
      title: drill.label,
      summary: `Every product stocked at ${drill.label} (${dealerName}), ranked by severity.`,
      emptyHint: `No products stocked at ${drill.label} right now.`,
      items: buildProductAggregates(
        scopedRows,
        scopedMaster,
        analytics,
        effectivePolicy,
        dealerActive,
        analyticsAvailable,
        dealerInfo,
      ),
    };
  }, [drill, aggregates, rows, products, analytics, effectivePolicy, dealerActive, analyticsAvailable, dealerInfo, dealerName]);

  const drillKey = drill
    ? drill.kind === "severity"
      ? `severity:${drill.state}`
      : drill.kind === "dimension"
        ? `dimension:${drill.dimension}:${drill.key}`
        : drill.kind === "branch"
          ? `branch:${drill.branchId}`
          : "urgent"
    : "dashboard";

  const drawerSource = drillView?.items ?? aggregates;
  const drawerAggregate = React.useMemo(
    () =>
      selection
        ? (drawerSource.find((a) => a.dealerId === selection.dealerId && a.productId === selection.productId) ?? null)
        : null,
    [drawerSource, selection],
  );

  const drawerBranchRows: InventoryRow[] = React.useMemo(() => {
    if (!selection) return [];
    return (rows ?? []).filter(
      (r) => r.dealerId === selection.dealerId && r.productId === selection.productId,
    );
  }, [rows, selection]);

  // `streaming` comes from the hook (a failed page ends the stream); deriving
  // it from progress left the "Streaming" strip up forever after a failure.

  const celebratedRef = React.useRef(false);
  // A dormant dealer never celebrates: with no demand signal the board is
  // unrated, not healthy.
  const allClear =
    !isLoading && !streaming && aggregates.length > 0 && flaggedCount === 0 && dealerActive;
  React.useEffect(() => {
    celebratedRef.current = false;
  }, [activeDealerId]);
  React.useEffect(() => {
    if (allClear && !celebratedRef.current) {
      celebratedRef.current = true;
      triggerRankConfetti(1);
    }
  }, [allClear]);

  if (isLoading && (rows?.length ?? 0) === 0 && !dealer) {
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
  // A failure that cannot be attributed to a dealer (registry/roster) is fatal;
  // a dealer-scoped failure keeps the shell so another dealer can be picked.
  if (error && !dealer) return <ErrorPage message={error} onRefresh={() => refresh()} />;

  const offline = dealer && !dealer.online;
  const offlineReason = offline ? (OFFLINE_REASON_LABELS[dealer.reason ?? ""] ?? dealer.reason ?? "unreachable") : "";
  const streamError = error && dealer && dealer.online ? error : null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1600px] space-y-6 p-2 sm:p-6 md:p-10">
      <HeroBand
        dealerName={dealer?.dealerName ?? ""}
        dealerCode={dealer?.dealerCode ?? ""}
        online={!offline}
        totalValue={totalValue}
      />

      {/* Toolbar — scope | analytics | action: every control keeps its own
          group when the row wraps. Anything that is a STATUS (streaming,
          offline) lives in its own strip below, so a state never gets
          mistaken for a control. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44 sm:w-56">
            <DealerSelect
              dealers={roster ?? []}
              value={activeDealerId}
              onChange={(id) => persistFilters({ ...filters, dealerId: id })}
              disabled={isLoading}
            />
          </div>
          <label className="inline-flex h-8 min-h-11 items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground md:min-h-0">
            <Switch
              checked={filters.includeZero}
              onCheckedChange={(checked) => persistFilters({ ...filters, includeZero: checked })}
              aria-label="Include zero-stock rows"
            />
            Zero-stock
          </label>
        </div>

        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Demand analytics">
          <PolicyPanel
            policy={effectivePolicy}
            onLeadDays={policy.setLeadDays}
            onWindowDays={(days) => persistFilters({ ...filters, windowDays: Math.min(365, Math.max(7, Math.trunc(days) || 30)) })}
            onLookbackDays={policy.setLookbackDays}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh({ bypassCache: true })}
          disabled={isLoading}
          className="ml-auto h-8 gap-2 text-xs min-h-11 md:min-h-0"
          title="Refresh report"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {streaming && (
        <p
          className="flex flex-wrap items-center gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin text-info" aria-hidden />
          <TonePill tone="info">Streaming</TonePill>
          <span>
            Branch page {formatNumber((progress?.pagesDone ?? 0) + 1, "en-PH", 0)} of{" "}
            {formatNumber(progress?.totalPages ?? 0, "en-PH", 0)} ·{" "}
            {formatNumber(progress?.scanned ?? 0, "en-PH", 0)} rows scanned — the cards fill in as each
            branch lands.
          </span>
        </p>
      )}

      {offline && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" role="status">
          <TonePill tone="warning">
            Dealer offline
          </TonePill>
          <span>
            {dealer.dealerName} is {offlineReason} — showing last synced data only.
          </span>
        </p>
      )}

      {streamError && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" role="alert">
          <TonePill tone="warning">Partial data</TonePill>
          <span>
            {streamError} — the pages already loaded stay on screen; refresh to retry the rest.
          </span>
        </p>
      )}

      {dealer && !analyticsAvailable && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" role="alert">
          <TonePill tone="warning">Demand data unavailable</TonePill>
          <span>
            The sales index for this dealer did not load, so products cannot be graded. Look for
            ERR_ANALYTICS_FAIL in the server log, then refresh.
          </span>
        </p>
      )}

      {dealer && analyticsAvailable && !dealerActive && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" role="status">
          <TonePill tone="warning">Stale demand</TonePill>
          <span>
            No sales in the last {filters.windowDays} days — demand signals unavailable, showing stock-only classification.
          </span>
        </p>
      )}

      {drill && drillView ? (
        <section aria-label="Drill-down table" className="space-y-3">
          {/* The way out lives in a sticky bar: a ghost button beside a heading
              was easy to miss once the table scrolled. */}
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-card px-3 py-2 shadow-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDrill(null)}
              className="h-8 gap-2 text-xs min-h-11 md:min-h-0"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to dashboard
            </Button>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{drillView.title}</h3>
              <p className="truncate text-xs text-muted-foreground" title={drillView.summary}>
                {drillView.summary}
              </p>
            </div>
            <TonePill tone="info" className="ml-auto">
              {formatNumber(drillView.items.length, "en-PH", 0)}{" "}
              {drillView.items.length === 1 ? "product" : "products"}
            </TonePill>
          </div>

          <LowStockBoard
            key={drillKey}
            aggregates={drillView.items}
            dealers={dealer ? [dealer] : []}
            onSelect={handleSelect}
            emptyHint={drillView.emptyHint}
          />
        </section>
      ) : (
        <InventoryDashboard
          aggregates={aggregates}
          rows={rows ?? []}
          branches={branches ?? []}
          products={products ?? []}
          analytics={analytics}
          dealerActive={dealerActive}
          analyticsAvailable={analyticsAvailable}
          policy={effectivePolicy}
          progress={{
            pagesDone: progress?.pagesDone ?? 0,
            totalPages: progress?.totalPages ?? 0,
            scanned: progress?.scanned ?? 0,
            plotted: progress?.plotted ?? 0,
          }}
          onDrill={setDrill}
          onSelectItem={handleSelect}
        />
      )}

      <ItemDrawer
        selection={selection}
        aggregate={drawerAggregate}
        branchRows={drawerBranchRows}
        windowDays={filters.windowDays}
        lookbackDays={effectivePolicy.lookbackDays}
        leadDays={effectivePolicy.leadDays}
        dealerActive={dealerActive}
        analyticsAvailable={analyticsAvailable}
        onClose={() => setSelection(null)}
        onSelect={handleSelect}
      />
    </div>
  );
}

export { InventoryReportSkeleton };
