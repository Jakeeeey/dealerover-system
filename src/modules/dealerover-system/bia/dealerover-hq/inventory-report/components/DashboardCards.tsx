"use client";

import * as React from "react";
import { ArrowRight, Factory, Shapes, Siren, Store, Tag } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  DealerBranch,
  DrillTarget,
  InventoryProgress,
  InventoryRow,
  LowStockPolicy,
  LowStockState,
  MasterProduct,
} from "../types";
import {
  buildBranchAggregates,
  groupByDimension,
  SEVERITY_RANK,
  type ProductAggregate,
} from "../utils/aggregate";
import { CELL_WASH, STATE_LABEL, STRIP_BG, TONE_BY_STATE } from "../utils/severity-tone";
interface DashboardCardsProps {
  aggregates: ProductAggregate[];
  rows: InventoryRow[];
  branches: DealerBranch[];
  products: MasterProduct[];
  policy: LowStockPolicy;
  progress: InventoryProgress;
  onDrill: (target: DrillTarget) => void;
  onSelectItem: (dealerId: string, productId: number) => void;
}

const SEVERITY_ORDER: readonly LowStockState[] = ["out", "critical", "low", "watch", "overstock", "dead"];

/** What each severity card counts — always products at this one dealer. */
const SEVERITY_COPY: Record<LowStockState, string> = {
  out: "with nothing on hand",
  critical: "with under 3 days of cover",
  low: "below their minimum cover",
  watch: "approaching minimum cover",
  healthy: "within threshold",
  overstock: "with 60+ days of cover",
  dead: "with no movement or demand",
};

const DIMENSION_META = [
  { dimension: "brand" as const, label: "Brand", icon: Tag },
  { dimension: "category" as const, label: "Category", icon: Shapes },
  { dimension: "supplier" as const, label: "Supplier", icon: Factory },
];

function resolveUnit(unitName: string | undefined, unitCount: number): string {
  const unit = (unitName ?? "").trim();
  if (unit) return unit;
  return !unitCount || unitCount <= 1 ? "pcs" : "units";
}

function inUnits(pieces: number, item: ProductAggregate): string {
  if (!item.unitCount || item.unitCount <= 0) return `${formatNumber(pieces, "en-PH", 0)} ${resolveUnit(item.unitName, item.unitCount)}`;
  const units = pieces / item.unitCount;
  const rounded = Math.round(units * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${resolveUnit(item.unitName, item.unitCount)}`;
}

function StreamingNote({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
      role="status"
      aria-label="Still streaming dealer stock"
    >
      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
      Updating…
    </span>
  );
}

function DrillCue({ label }: { label: string }) {
  return (
    <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <ArrowRight className="size-3.5" aria-hidden />
    </span>
  );
}

const CARD_BUTTON =
  "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-sm transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Gamified default view — no tables. Every card is a real button that drills
 * into the ranked board; the board (page 2) is where tables live.
 */
export function DashboardCards({
  aggregates,
  rows,
  branches,
  products,
  policy,
  progress,
  onDrill,
  onSelectItem,
}: DashboardCardsProps) {
  const streaming = progress.totalPages > 0 && progress.pagesDone < progress.totalPages;
  const dealerName = aggregates[0]?.dealerName ?? rows[0]?.dealerName ?? "this dealer";
  const totalProducts = Math.max(products.length, aggregates.length, 1);

  const urgent = React.useMemo(
    () =>
      aggregates
        .filter((a) => a.state !== "healthy")
        .sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || b.value - a.value)
        .slice(0, 3),
    [aggregates],
  );

  const severityStats = React.useMemo(() => {
    const counts = new Map<LowStockState, { count: number; value: number }>();
    for (const state of SEVERITY_ORDER) counts.set(state, { count: 0, value: 0 });
    for (const item of aggregates) {
      const entry = counts.get(item.state);
      if (entry) {
        entry.count += 1;
        entry.value += item.value;
      }
    }
    return counts;
  }, [aggregates]);

  const dimensionTops = React.useMemo(
    () =>
      DIMENSION_META.map((meta) => ({
        ...meta,
        groups: groupByDimension(aggregates, meta.dimension),
      })),
    [aggregates],
  );

  const branchAggs = React.useMemo(
    () => buildBranchAggregates(rows, branches, policy),
    [rows, branches, policy],
  );
  const topBranch = branchAggs.find((b) => b.productCount > 0) ?? branchAggs[0] ?? null;

  return (
    <div className="space-y-4">
      <section aria-label="Most urgent" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Siren className="size-4 text-destructive" aria-hidden />
            Most urgent
          </h3>
          <StreamingNote visible={streaming} />
        </div>
        {urgent.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {aggregates.length === 0 && products.length === 0
              ? `No inventory data for ${dealerName} yet.`
              : `All clear — every product at ${dealerName} is within threshold.`}
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {urgent.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelectItem(item.dealerId, item.productId)}
                  aria-label={`Rank ${index + 1}: ${item.productName} at ${item.dealerName}, ${STATE_LABEL[item.state]} — ${item.reason}`}
                  className="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[transform,opacity,background-color,border-color] duration-200 hover:-translate-y-px hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-black tabular-nums",
                      CELL_WASH[item.state],
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={item.productName}>
                      {item.productName}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={item.reason}>
                      {inUnits(item.onHand, item)} on hand · {item.reason} · {formatCurrency(item.value)} at risk
                    </span>
                  </span>
                  <StatusBadge tone={TONE_BY_STATE[item.state]} className="shrink-0">
                    {STATE_LABEL[item.state]}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={() => onDrill({ kind: "urgent" })}
          aria-label={`Most urgent: open the ranked board for ${dealerName}`}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-[transform,opacity,background-color,border-color] duration-200 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring md:min-h-0"
        >
          Open ranked board
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </section>

      <section aria-label="Stock health by severity" className="space-y-2">
        <h3 className="text-sm font-semibold">Stock health</h3>
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {SEVERITY_ORDER.map((state) => {
            const stats = severityStats.get(state) ?? { count: 0, value: 0 };
            const share = Math.min(100, Math.max(0, (stats.count / totalProducts) * 100));
            return (
              <button
                key={state}
                type="button"
                onClick={() => onDrill({ kind: "severity", state })}
                aria-label={`${STATE_LABEL[state]}: ${stats.count} products at ${dealerName}, ${formatCurrency(stats.value)} at risk — view table`}
                className={CARD_BUTTON}
              >
                <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", STRIP_BG[state])} />
                <StatusBadge tone={TONE_BY_STATE[state]} className="self-start">
                  {STATE_LABEL[state]}
                </StatusBadge>
                <span className="mt-2 text-3xl font-black tabular-nums tracking-tight">
                  {formatNumber(stats.count, "en-PH", 0)}
                </span>
                <span className="mt-0.5 text-xs text-muted-foreground">
                  {stats.count === 1 ? "product" : "products"} at {dealerName} {SEVERITY_COPY[state]}
                </span>
                <span className="mt-1.5 text-sm font-semibold tabular-nums">
                  {formatCurrency(stats.value)}{" "}
                  <span className="text-[11px] font-normal text-muted-foreground">at risk</span>
                </span>
                <span aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", STRIP_BG[state])} style={{ width: `${share}%` }} />
                </span>
                <span className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(share)}% of {formatNumber(totalProducts, "en-PH", 0)} products
                </span>
                <DrillCue label="View table" />
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Where the risk sits" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Where the risk sits</h3>
          <StreamingNote visible={streaming} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          {dimensionTops.map(({ dimension, label, icon: Icon, groups }) => {
            const top = groups[0] ?? null;
            return (
              <button
                key={dimension}
                type="button"
                onClick={() =>
                  top && onDrill({ kind: "dimension", dimension, key: top.key, label: top.label })
                }
                disabled={!top}
                aria-label={
                  top
                    ? `${label} spotlight: ${top.label} at ${dealerName}, ${top.flaggedCount} flagged products — view table`
                    : `${label} spotlight: no products at ${dealerName}`
                }
                className={cn(CARD_BUTTON, !top && "opacity-60")}
              >
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden />
                  {label} spotlight
                </span>
                <span className="mt-1.5 block truncate text-base font-bold" title={top?.label ?? "No products"}>
                  {top?.label ?? "No products yet"}
                </span>
                {top && (
                  <span className="mt-1.5 self-start">
                    <StatusBadge tone={TONE_BY_STATE[top.worst]}>{STATE_LABEL[top.worst]}</StatusBadge>
                  </span>
                )}
                <span className="mt-1.5 text-xs text-muted-foreground">
                  {top
                    ? `${formatNumber(top.flaggedCount, "en-PH", 0)} of ${formatNumber(top.productCount, "en-PH", 0)} flagged · ${formatCurrency(top.value)} at risk`
                    : `Nothing tracked at ${dealerName} yet.`}
                </span>
                {top && <DrillCue label="View table" />}
              </button>
            );
          })}

          <button
            key="branch"
            type="button"
            onClick={() =>
              topBranch &&
              onDrill({ kind: "branch", branchId: topBranch.branchId, label: topBranch.branchName })
            }
            disabled={!topBranch}
            aria-label={
              topBranch
                ? `Branch spotlight: ${topBranch.branchName} at ${dealerName}, ${topBranch.flaggedCount} flagged products — view table`
                : `Branch spotlight: no branches at ${dealerName}`
            }
            className={cn(CARD_BUTTON, !topBranch && "opacity-60")}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Store className="size-3.5" aria-hidden />
              Branch spotlight
            </span>
            <span className="mt-1.5 block truncate text-base font-bold" title={topBranch?.branchName ?? "No branches"}>
              {topBranch?.branchName ?? "No branches yet"}
            </span>
            {topBranch && (
              <span className="mt-1.5 self-start">
                <StatusBadge tone={TONE_BY_STATE[topBranch.worst]}>{STATE_LABEL[topBranch.worst]}</StatusBadge>
              </span>
            )}
            <span className="mt-1.5 text-xs text-muted-foreground">
              {topBranch
                ? `${formatNumber(topBranch.flaggedCount, "en-PH", 0)} of ${formatNumber(topBranch.productCount, "en-PH", 0)} flagged · ${formatCurrency(topBranch.value)} at risk`
                : `Nothing tracked at ${dealerName} yet.`}
            </span>
            {topBranch && <DrillCue label="View table" />}
          </button>
        </div>
      </section>
    </div>
  );
}
