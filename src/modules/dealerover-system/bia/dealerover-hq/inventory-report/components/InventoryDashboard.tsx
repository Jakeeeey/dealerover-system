"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
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
  ProductDemand,
} from "../types";
import {
  FLAGGED_STATES,
  SEVERITY_RANK,
  type ProductAggregate,
} from "../utils/aggregate";
import { CELL_WASH, STATE_LABEL, TONE_BY_STATE } from "../utils/severity-tone";
import { ValueBlock } from "./ValueBlock";

export interface InventoryDashboardProps {
  aggregates: ProductAggregate[];
  rows: InventoryRow[];
  branches: DealerBranch[];
  products: MasterProduct[];
  analytics: ProductDemand[];
  dealerActive: boolean;
  analyticsAvailable: boolean;
  policy: LowStockPolicy;
  progress: InventoryProgress;
  onDrill: (target: DrillTarget) => void;
  onSelectItem: (dealerId: string, productId: number) => void;
}

const FLAGGED_ORDER: readonly LowStockState[] = [
  "out",
  "critical",
  "low",
  "watch",
  "dead",
  "overstock",
];

function resolveUnit(unitName: string | undefined, unitCount: number): string {
  const unit = (unitName ?? "").trim();
  if (unit) return unit;
  return !unitCount || unitCount <= 1 ? "pcs" : "units";
}

function inUnits(pieces: number, item: ProductAggregate): string {
  if (!item.unitCount || item.unitCount <= 0)
    return `${formatNumber(pieces, "en-PH", 0)} ${resolveUnit(item.unitName, item.unitCount)}`;
  const units = pieces / item.unitCount;
  const rounded = Math.round(units * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${resolveUnit(item.unitName, item.unitCount)}`;
}

/**
 * Layer 1 — the statement: one dominant at-risk figure, its composition as
 * a single proportional band, exception counters for non-zero tiers only,
 * and a muted prose line for everything at zero. Layer 2 (ValueBlock)
 * follows; layer 3 (drill + drawer) lives on the page.
 */
export function InventoryDashboard({
  aggregates,
  rows,
  branches,
  products,
  analytics,
  dealerActive,
  analyticsAvailable,
  policy,
  progress,
  onDrill,
  onSelectItem,
}: InventoryDashboardProps) {
  const streaming = progress.totalPages > 0 && progress.pagesDone < progress.totalPages;
  const dealerName = aggregates[0]?.dealerName ?? rows[0]?.dealerName ?? "this dealer";

  const stats = React.useMemo(() => {
    const map = new Map<LowStockState, { count: number; value: number }>();
    const tracked: LowStockState[] = ["out", "critical", "low", "watch", "dead", "overstock", "dropped", "unrated"];
    for (const s of tracked) map.set(s, { count: 0, value: 0 });
    for (const item of aggregates) {
      const entry = map.get(item.state);
      if (entry) {
        entry.count += 1;
        entry.value += item.value;
      }
    }
    return map;
  }, [aggregates]);

  const valueAtRisk = React.useMemo(
    () => aggregates.reduce((sum, a) => sum + (FLAGGED_STATES.has(a.state) ? a.value : 0), 0),
    [aggregates],
  );
  const flaggedCount = React.useMemo(
    () => aggregates.filter((a) => FLAGGED_STATES.has(a.state)).length,
    [aggregates],
  );

  const shortage = React.useMemo(() => {
    let value = 0;
    let count = 0;
    for (const s of ["out", "critical", "low", "watch"] as const) {
      const e = stats.get(s) ?? { count: 0, value: 0 };
      value += e.value;
      count += e.count;
    }
    return { value, count };
  }, [stats]);
  const deadStock = React.useMemo(
    () => stats.get("dead") ?? { count: 0, value: 0 },
    [stats],
  );
  const overstock = React.useMemo(
    () => stats.get("overstock") ?? { count: 0, value: 0 },
    [stats],
  );

  const urgent = React.useMemo(
    () =>
      aggregates
        .filter((a) => FLAGGED_STATES.has(a.state))
        .sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || b.value - a.value)
        .slice(0, 3),
    [aggregates],
  );

  const nonZeroTiers = FLAGGED_ORDER.filter((s) => (stats.get(s)?.count ?? 0) > 0);
  const zeroTiers = FLAGGED_ORDER.filter((s) => (stats.get(s)?.count ?? 0) === 0);
  const dropped = stats.get("dropped") ?? { count: 0, value: 0 };
  const unrated = stats.get("unrated") ?? { count: 0, value: 0 };

  const contextSentence = React.useMemo(() => {
    if (flaggedCount === 0) return null;
    const parts: string[] = [];
    if (shortage.count > 0) parts.push("shortages");
    if (deadStock.count > 0) parts.push("dead stock");
    if (overstock.count > 0) parts.push("overstock");
    const countText = `${formatNumber(flaggedCount, "en-PH", 0)} ${flaggedCount === 1 ? "product" : "products"}`;
    if (parts.length === 1 && deadStock.count === flaggedCount) {
      return `trapped in ${countText} that have not sold in ${policy.lookbackDays} days`;
    }
    if (parts.length === 1 && shortage.count === flaggedCount) {
      return `trapped in ${countText} short on cover`;
    }
    if (parts.length === 1 && overstock.count === flaggedCount) {
      return `tied up in ${countText} holding over 60 days of cover`;
    }
    return `trapped in ${countText} across ${parts.join(", ")}`;
  }, [flaggedCount, shortage.count, deadStock.count, overstock.count, policy.lookbackDays]);

  const bandSegments = [
    { id: "shortage", label: "Shortages", ...shortage, className: "bg-destructive" },
    { id: "dead", label: "Dead stock", ...deadStock, className: "bg-warning" },
    { id: "overstock", label: "Overstock", ...overstock, className: "bg-muted-foreground/40" },
  ].filter((s) => s.value > 0);

  const collapsedLine = React.useMemo(() => {
    const info =
      `${formatNumber(dropped.count, "en-PH", 0)} dropped · ` +
      `${formatNumber(unrated.count, "en-PH", 0)} unrated · ` +
      `${formatNumber(products.length, "en-PH", 0)} SKUs tracked`;
    if (zeroTiers.length === 0) return info;
    const names = zeroTiers.map((s) => STATE_LABEL[s].toLowerCase()).join(", ");
    return `No ${names} · ${info}`;
  }, [zeroTiers, dropped.count, unrated.count, products.length]);

  return (
    <div className="space-y-6">
      {streaming && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
          Updating… page {formatNumber(progress.pagesDone + 1, "en-PH", 0)} of{" "}
          {formatNumber(progress.totalPages, "en-PH", 0)}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label="Value at risk" className="rounded-2xl border bg-card p-4 sm:p-5 lg:col-span-2">
          {flaggedCount === 0 ? (
            <div>
              <h3 className="text-base font-bold tracking-tight">Value at risk</h3>
              <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">All clear</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {aggregates.length === 0
                  ? `No inventory data for ${dealerName} yet.`
                  : `Nothing needs attention at ${dealerName}.`}
              </p>
            </div>
          ) : (
            <div>
              <h3 className="text-base font-bold tracking-tight">Value at risk</h3>
              <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                {formatCurrency(valueAtRisk)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{contextSentence}</p>

              {bandSegments.length > 0 && (
                <div className="mt-4">
                  <div
                    role="img"
                    aria-label={`Composition: ${bandSegments.map((s) => `${s.label} ${formatCurrency(s.value)} in ${formatNumber(s.count, "en-PH", 0)} products`).join("; ")}`}
                    className="flex h-4 overflow-hidden rounded-lg"
                  >
                    {bandSegments.map((s) => (
                      <div
                        key={s.id}
                        style={{ flexGrow: s.value, flexBasis: 0 }}
                        title={`${s.label} · ${formatCurrency(s.value)} · ${formatNumber(s.count, "en-PH", 0)} products`}
                        className={cn("min-w-1", s.className)}
                      />
                    ))}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {bandSegments.map((s) => (
                      <li key={s.id} className="tabular-nums">
                        {s.label} · {formatCurrency(s.value)} · {formatNumber(s.count, "en-PH", 0)}{" "}
                        {s.count === 1 ? "product" : "products"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                {nonZeroTiers.map((state) => {
                  const e = stats.get(state) ?? { count: 0, value: 0 };
                  return (
                    <button
                      key={state}
                      type="button"
                      onClick={() => onDrill({ kind: "severity", state })}
                      aria-label={`${STATE_LABEL[state]}: ${e.count} products, ${formatCurrency(e.value)} — view table`}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-[background-color,border-color] duration-200 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <StatusBadge tone={TONE_BY_STATE[state]}>{STATE_LABEL[state]}</StatusBadge>
                      <span className="font-semibold tabular-nums">{formatNumber(e.count, "en-PH", 0)}</span>
                      <span className="tabular-nums text-muted-foreground">{formatCurrency(e.value)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">{collapsedLine}</p>
        </section>

        <section aria-label="Most urgent" className="rounded-2xl border bg-card p-4 sm:p-5">
          <h3 className="text-base font-bold tracking-tight">Most urgent</h3>
          {urgent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {aggregates.length === 0
                ? `No inventory data for ${dealerName} yet.`
                : `Nothing flagged at ${dealerName}.`}
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {urgent.map((item, index) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(item.dealerId, item.productId)}
                    aria-label={`Rank ${index + 1}: ${item.productName} at ${item.dealerName}, ${STATE_LABEL[item.state]} — ${item.reason}`}
                    className="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color] duration-200 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
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
          {urgent.length > 0 && (
            <button
              type="button"
              onClick={() => onDrill({ kind: "urgent" })}
              aria-label={`Open the ranked board for ${dealerName}`}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-[background-color,border-color] duration-200 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring md:min-h-0"
            >
              Open ranked board
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          )}
        </section>
      </div>

      <ValueBlock
        aggregates={aggregates}
        rows={rows}
        branches={branches}
        policy={policy}
        analytics={analytics}
        dealerActive={dealerActive}
        analyticsAvailable={analyticsAvailable}
        onDrill={onDrill}
      />
    </div>
  );
}
