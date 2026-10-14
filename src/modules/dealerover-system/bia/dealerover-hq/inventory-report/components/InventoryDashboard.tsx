"use client";

import * as React from "react";
import { ArrowRight, Award, Flame, Medal, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { SeverityPill } from "./StatusPill";
import { cn, formatCurrency, formatDateLong, formatNumber } from "@/lib/utils";
import type { StatusTone } from "@/components/ui/status-badge";
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
import { CELL_WASH, PANEL_ACCENT, STATE_LABEL, STRIP_BG } from "../utils/severity-tone";
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
  /** ISO date of the dealer's newest invoice — drives the demand freshness line. */
  lastInvoiceAt: string;
  onDrill: (target: DrillTarget) => void;
  onSelectItem: (dealerId: string, productId: number) => void;
}

/**
 * The coverage ladder, best cover last. Every product with live demand sits on
 * exactly one rung, so the rungs always sum to the dealer's selling catalogue.
 */
const DEMAND_ORDER: readonly LowStockState[] = [
  "out",
  "critical",
  "low",
  "watch",
  "healthy",
  "overstock",
];

type DemandUnit = "pieces" | "value";

/** How many urgent rows the panel shows — the rest live in the urgent list. */
const URGENT_LIMIT = 5;

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

/** Cost value of what sold in the window — same pricing basis as stock value. */
function soldValueOf(item: ProductAggregate): number {
  if (!item.unitCount || item.unitCount <= 0 || !item.costPerUnit) return 0;
  return (item.demandQty / item.unitCount) * item.costPerUnit;
}

/**
 * Last 30 days against the 90-day monthly average. 1 = steady; above means the
 * product is accelerating. Derived from the two windows we already hold, so it
 * costs no extra request.
 */
function momentumOf(item: ProductAggregate): number | null {
  const monthly = item.demandLookback / 3;
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  return item.demandQty / monthly;
}

/** Medals for the podium — solid gold, neutral silver, pale bronze. */
function RankBadge({ index }: { index: number }) {
  if (index === 0)
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
        <Trophy className="size-4" aria-hidden />
      </span>
    );
  if (index === 1)
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground">
        <Medal className="size-4" aria-hidden />
      </span>
    );
  if (index === 2)
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning">
        <Award className="size-4" aria-hidden />
      </span>
    );
  return (
    <span className="flex size-7 shrink-0 items-center justify-center text-[11px] font-bold tabular-nums text-muted-foreground">
      {index + 1}
    </span>
  );
}

/**
 * Three axes. The layout follows the client's sketch: STOCK is the hero on the
 * left with MOST URGENT divided inside it (one panel, a hairline apart — never a
 * box inside a box), while VALUE and DEMAND stack as lighter facts on the right,
 * DEMAND carrying the podium, the fire and the Pieces|Value toggle.
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
  lastInvoiceAt,
  onDrill,
  onSelectItem,
}: InventoryDashboardProps) {
  const [demandUnit, setDemandUnit] = React.useState<DemandUnit>("pieces");

  const streaming = progress.totalPages > 0 && progress.pagesDone < progress.totalPages;
  const dealerName = aggregates[0]?.dealerName ?? rows[0]?.dealerName ?? "this dealer";

  const stats = React.useMemo(() => {
    const map = new Map<LowStockState, { count: number; value: number }>();
    const tracked: LowStockState[] = [
      "out",
      "critical",
      "low",
      "watch",
      "healthy",
      "overstock",
      "dead",
      "dropped",
      "unrated",
    ];
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

  const totalValue = React.useMemo(() => aggregates.reduce((sum, a) => sum + a.value, 0), [aggregates]);

  const moving = React.useMemo(
    () =>
      aggregates
        .filter((a) => a.demandLookback > 0)
        .reduce((acc, a) => ({ count: acc.count + 1, value: acc.value + a.value }), {
          count: 0,
          value: 0,
        }),
    [aggregates],
  );
  const nonMoving = stats.get("dead") ?? { count: 0, value: 0 };
  const dropped = stats.get("dropped") ?? { count: 0, value: 0 };
  const unrated = stats.get("unrated") ?? { count: 0, value: 0 };
  const nonMovingShare = totalValue > 0 ? Math.round((nonMoving.value / totalValue) * 100) : 0;

  /** Rungs that cannot serve demand: out, critical, low, watch. */
  const cannotCover = React.useMemo(
    () =>
      (["out", "critical", "low", "watch"] as const).reduce(
        (sum, s) => sum + (stats.get(s)?.count ?? 0),
        0,
      ),
    [stats],
  );

  const coverageSegments = React.useMemo(
    () =>
      DEMAND_ORDER.map((state) => ({ state, count: stats.get(state)?.count ?? 0 })).filter(
        (s) => s.count > 0,
      ),
    [stats],
  );

  const soldPieces = React.useMemo(
    () => aggregates.reduce((sum, a) => sum + a.demandQty, 0),
    [aggregates],
  );
  const soldValue = React.useMemo(
    () => aggregates.reduce((sum, a) => sum + soldValueOf(a), 0),
    [aggregates],
  );
  const topMovers = React.useMemo(
    () =>
      aggregates
        .filter((a) => a.demandQty > 0)
        .sort((a, b) =>
          demandUnit === "pieces" ? b.demandQty - a.demandQty : soldValueOf(b) - soldValueOf(a),
        )
        .slice(0, 5),
    [aggregates, demandUnit],
  );

  const urgent = React.useMemo(
    () =>
      aggregates
        .filter((a) => FLAGGED_STATES.has(a.state))
        .sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state] || b.value - a.value)
        .slice(0, URGENT_LIMIT),
    [aggregates],
  );

  const coverageTone: StatusTone = !analyticsAvailable
    ? "neutral"
    : (stats.get("out")?.count ?? 0) + (stats.get("critical")?.count ?? 0) > 0
      ? "destructive"
      : cannotCover > 0
        ? "warning"
        : aggregates.length > 0
          ? "success"
          : "neutral";

  const bandSegments = [
    { id: "moving", label: "Moving", ...moving, className: "bg-success" },
    { id: "non-moving", label: "Non-moving", ...nonMoving, className: "bg-muted-foreground" },
  ].filter((s) => s.value > 0);

  const freshnessLabel = React.useMemo(() => {
    if (!lastInvoiceAt) return "No invoice history";
    const parsed = new Date(lastInvoiceAt);
    return Number.isNaN(parsed.getTime())
      ? "No invoice history"
      : `Sales through ${formatDateLong(parsed)}`;
  }, [lastInvoiceAt]);

  const catalogueLine = `${formatNumber(dropped.count, "en-PH", 0)} dropped · ${formatNumber(
    unrated.count,
    "en-PH",
    0,
  )} unrated · ${formatNumber(products.length, "en-PH", 0)} SKUs tracked`;

  const hasData = aggregates.length > 0;
  const demandTotal = demandUnit === "pieces" ? soldPieces : soldValue;

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
        {/* ── STOCK (hero) + MOST URGENT, one panel, divided ─────────────── */}
        <section
          aria-label="Stock"
          className={cn(
            "flex flex-col rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:col-span-2",
            PANEL_ACCENT[coverageTone],
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-base font-bold tracking-tight">Stock</h3>
            <p className="text-xs text-muted-foreground">
              Cover over a {formatNumber(policy.windowDays, "en-PH", 0)}-day sales window ·{" "}
              {formatNumber(policy.lookbackDays, "en-PH", 0)}-day lookback
            </p>
          </div>

          {!hasData ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No inventory data for {dealerName} yet.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                {!analyticsAvailable ? (
                  "Sales index unavailable — products cannot be graded until it loads."
                ) : cannotCover === 0 ? (
                  <>
                    Every one of the{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatNumber(moving.count, "en-PH", 0)}
                    </span>{" "}
                    selling products covers its demand.
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                      {formatNumber(cannotCover, "en-PH", 0)}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatNumber(moving.count, "en-PH", 0)}
                    </span>{" "}
                    selling products cannot cover demand.
                  </>
                )}
              </p>

              {coverageSegments.length > 0 && (
                <div
                  role="img"
                  aria-label={`Coverage: ${coverageSegments
                    .map((s) => `${STATE_LABEL[s.state]} ${formatNumber(s.count, "en-PH", 0)} products`)
                    .join("; ")}`}
                  className="mt-4 flex h-3 overflow-hidden rounded-full"
                >
                  {coverageSegments.map((s) => (
                    <span
                      key={s.state}
                      style={{ flexGrow: s.count, flexBasis: 0 }}
                      title={`${STATE_LABEL[s.state]} · ${formatNumber(s.count, "en-PH", 0)} products`}
                      className={cn("min-w-1", STRIP_BG[s.state])}
                    />
                  ))}
                </div>
              )}

              <ul className="mt-3 divide-y divide-border/60 border-t">
                {DEMAND_ORDER.map((state) => {
                  const count = stats.get(state)?.count ?? 0;
                  const share = moving.count > 0 ? (count / moving.count) * 100 : 0;
                  return (
                    <li key={state}>
                      <button
                        type="button"
                        onClick={() => onDrill({ kind: "severity", state })}
                        aria-label={`${STATE_LABEL[state]}: ${formatNumber(count, "en-PH", 0)} products, ${share.toFixed(1)}% of selling products — view table`}
                        className="group -mx-2 flex w-[calc(100%_+_1rem)] items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors duration-200 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STRIP_BG[state])} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">
                          {STATE_LABEL[state]}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {share.toFixed(1)}%
                        </span>
                        <span className="w-8 shrink-0 text-right font-semibold tabular-nums">
                          {formatNumber(count, "en-PH", 0)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-3 text-xs text-muted-foreground">{catalogueLine}</p>

              {urgent.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="text-base font-bold tracking-tight">Most urgent</h3>
                    <button
                      type="button"
                      onClick={() => onDrill({ kind: "urgent" })}
                      aria-label={`Open the urgent list for ${dealerName}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Open Urgent List
                      <ArrowRight className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  <ol className="mt-2 divide-y divide-border/60">
                    {urgent.map((item, index) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => onSelectItem(item.dealerId, item.productId)}
                          aria-label={`Rank ${index + 1}: ${item.productName} at ${item.dealerName}, ${STATE_LABEL[item.state]} — ${item.reason}`}
                          className={cn(
                            "-mx-3 flex w-[calc(100%_+_1.5rem)] items-center gap-3 px-3 py-2 text-left transition-colors duration-200 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                            CELL_WASH[item.state],
                          )}
                        >
                          <span
                            aria-hidden
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background/60 text-[11px] font-bold tabular-nums"
                          >
                            0{index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold" title={item.productName}>
                              {item.productName}
                            </span>
                            <span
                              className="block truncate text-[11px] text-muted-foreground"
                              title={item.reason}
                            >
                              {inUnits(item.onHand, item)} on hand · {item.reason}
                            </span>
                          </span>
                          <SeverityPill state={item.state} className="shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── RIGHT RAIL: VALUE over DEMAND (the podium) ─────────────────── */}
        <div className="flex flex-col gap-4">
          <section
            aria-label="Inventory value"
            className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
          >
            <h3 className="text-base font-bold tracking-tight">Inventory value</h3>
            <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
              {formatCurrency(totalValue)}
            </p>
            <p className="mt-1 text-sm tabular-nums text-muted-foreground">
              {totalValue > 0 ? (
                <>
                  <span className="font-semibold text-foreground">{formatCurrency(nonMoving.value)}</span> not
                  moving · {formatNumber(nonMovingShare, "en-PH", 0)}% of the total
                </>
              ) : (
                `No stock value recorded for ${dealerName} yet.`
              )}
            </p>

            {bandSegments.length > 0 && (
              <div
                role="img"
                aria-label={`Value composition: ${bandSegments
                  .map(
                    (s) =>
                      `${s.label} ${formatCurrency(s.value)} in ${formatNumber(s.count, "en-PH", 0)} products`,
                  )
                  .join("; ")}`}
                className="mt-4 flex h-3 overflow-hidden rounded-full"
              >
                {bandSegments.map((s) => (
                  <span
                    key={s.id}
                    style={{ flexGrow: s.value, flexBasis: 0 }}
                    title={`${s.label} · ${formatCurrency(s.value)} · ${formatNumber(s.count, "en-PH", 0)} products`}
                    className={cn("min-w-1", s.className)}
                  />
                ))}
              </div>
            )}

            <dl className="mt-3 divide-y divide-border/60 border-t">
              {[
                { label: "Moving", count: moving.count, value: moving.value },
                { label: "Non-moving", count: nonMoving.count, value: nonMoving.value },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="text-sm text-muted-foreground">{row.label}</dt>
                  <dd className="flex items-baseline gap-2 text-right">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatNumber(row.count, "en-PH", 0)} SKUs
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(row.value)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            {nonMoving.count > 0 && (
              <button
                type="button"
                onClick={() => onDrill({ kind: "severity", state: "dead" })}
                aria-label={`View the ${formatNumber(nonMoving.count, "en-PH", 0)} non-moving products`}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border/70 px-3 py-2 text-xs font-medium shadow-sm transition-[background-color,border-color,box-shadow] duration-200 hover:bg-muted/60 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring md:min-h-0"
              >
                View non-moving
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            )}
          </section>

          <section
            aria-label="Demand"
            className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h3 className="text-base font-bold tracking-tight">Demand</h3>
              <div className="inline-flex rounded-lg border border-border/70 p-0.5" role="group" aria-label="Demand unit">
                {(["pieces", "value"] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setDemandUnit(unit)}
                    aria-pressed={demandUnit === unit}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-ring",
                      demandUnit === unit
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-2 text-sm text-muted-foreground">
              {!analyticsAvailable ? (
                "Sales cannot be shown until the index loads."
              ) : (
                <>
                  <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                    {demandUnit === "pieces"
                      ? formatNumber(soldPieces, "en-PH", 0)
                      : formatCurrency(soldValue)}
                  </span>{" "}
                  {demandUnit === "pieces" ? "pieces sold" : "sold"} in the last{" "}
                  {formatNumber(policy.windowDays, "en-PH", 0)} days.
                </>
              )}
            </p>

            {topMovers.length > 0 && (
              <ol className="mt-3 divide-y divide-border/60 border-t">
                {topMovers.map((item, index) => {
                  const metric = demandUnit === "pieces" ? item.demandQty : soldValueOf(item);
                  const share = demandTotal > 0 ? (metric / demandTotal) * 100 : 0;
                  const momentum = momentumOf(item);
                  // "On fire" is a podium claim, not a threshold: nearly every
                  // mover here sits near 3x (its whole 90-day volume landed in
                  // the window), so a pass/fail test lights up the entire list
                  // and means nothing. Only the top row wears it, and only
                  // while it is genuinely accelerating.
                  const onFire = index === 0 && momentum !== null && momentum >= 1.15;
                  const hot = !onFire && momentum !== null && momentum >= 1.15;
                  const cooling = momentum !== null && momentum <= 0.85;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => onSelectItem(item.dealerId, item.productId)}
                        aria-label={`Rank ${index + 1}: ${item.productName} — ${formatNumber(item.demandQty, "en-PH", 0)} pieces sold in the window${onFire ? ", on fire" : ""} — open item`}
                        className={cn(
                          "group -mx-2 flex w-[calc(100%_+_1rem)] items-center gap-2.5 px-2 py-2 text-left transition-colors duration-200 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                          onFire && "bg-warning/10",
                        )}
                      >
                        <RankBadge index={index} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold" title={item.productName}>
                            {item.productName}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">{share.toFixed(1)}%</span>
                            {onFire && (
                              <span className="inline-flex items-center gap-0.5 font-semibold text-warning">
                                <Flame
                                  className="size-3 transition-transform duration-200 group-hover:scale-125"
                                  aria-hidden
                                />
                                on fire
                              </span>
                            )}
                            {hot && (
                              <span className="inline-flex items-center gap-0.5 font-medium text-success">
                                <TrendingUp className="size-3" aria-hidden />
                                {momentum?.toFixed(1)}×
                              </span>
                            )}
                            {cooling && (
                              <span className="inline-flex items-center gap-0.5">
                                <TrendingDown className="size-3" aria-hidden />
                                {momentum?.toFixed(1)}×
                              </span>
                            )}
                            {!onFire && !hot && !cooling && <span>steady</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold tabular-nums">
                            {demandUnit === "pieces"
                              ? formatNumber(metric, "en-PH", 0)
                              : formatCurrency(metric)}
                          </span>
                          {demandUnit === "pieces" && (
                            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                              pcs
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <p className="mt-auto pt-3 text-xs text-muted-foreground">{freshnessLabel}</p>
          </section>
        </div>
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
