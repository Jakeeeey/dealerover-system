"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  DealerBranch,
  DrillTarget,
  InventoryRow,
  LowStockPolicy,
  LowStockState,
  ProductDemand,
} from "../types";
import {
  buildBranchAggregates,
  FLAGGED_STATES,
  groupByDimension,
  SEVERITY_RANK,
  type ProductAggregate,
} from "../utils/aggregate";
import { CELL_WASH, STATE_LABEL, STRIP_BG } from "../utils/severity-tone";

interface ValueBlockProps {
  aggregates: ProductAggregate[];
  rows: InventoryRow[];
  branches: DealerBranch[];
  policy: LowStockPolicy;
  analytics: ProductDemand[];
  dealerActive: boolean;
  analyticsAvailable: boolean;
  onDrill: (target: DrillTarget) => void;
}

type BlockDimension = "brand" | "category" | "branch";

interface BlockCell {
  key: string;
  label: string;
  productCount: number;
  flaggedCount: number;
  value: number;
  sizedValue: number;
  worst: LowStockState;
  target: DrillTarget;
}

const DIMENSIONS: ReadonlyArray<{ id: BlockDimension; label: string }> = [
  { id: "brand", label: "Brand" },
  { id: "category", label: "Category" },
  { id: "branch", label: "Branch" },
];

/**
 * Most urgent state among a set — read from the single SEVERITY_RANK contract
 * rather than a second local copy of the ordering.
 */
function worstOf(states: LowStockState[]): LowStockState {
  let worst: LowStockState = "healthy";
  let rank = Number.POSITIVE_INFINITY;
  for (const s of states) {
    const r = SEVERITY_RANK[s];
    if (r < rank) {
      rank = r;
      worst = s;
    }
  }
  return worst;
}

/**
 * Layer 2 — value concentration. One bordered block whose cells are sized
 * by trapped value (flex-grow), one dimension at a time. Cells are not
 * cards: no per-cell border or shadow, just the shared severity wash.
 */
export function ValueBlock({
  aggregates,
  rows,
  branches,
  policy,
  analytics,
  dealerActive,
  analyticsAvailable,
  onDrill,
}: ValueBlockProps) {
  const [dimension, setDimension] = React.useState<BlockDimension>("brand");
  const dealerName = aggregates[0]?.dealerName ?? rows[0]?.dealerName ?? "this dealer";

  const branchAggs = React.useMemo(
    () => buildBranchAggregates(rows, branches, policy, analytics, dealerActive, analyticsAvailable),
    [rows, branches, policy, analytics, dealerActive, analyticsAvailable],
  );

  const built = React.useMemo(() => {
    if (dimension === "branch") {
      const cells: BlockCell[] = branchAggs
        .filter((b) => b.productCount > 0 || b.value > 0)
        .map((b) => ({
          key: `branch:${b.branchId}`,
          label: b.branchName,
          productCount: b.productCount,
          flaggedCount: b.flaggedCount,
          value: b.value,
          sizedValue: b.flaggedValue,
          worst: b.worst,
          target: { kind: "branch", branchId: b.branchId, label: b.branchName } as DrillTarget,
        }));
      return cells;
    }
    const groups = groupByDimension(aggregates, dimension);
    return groups.map<BlockCell>((g) => ({
      key: `${dimension}:${g.key}`,
      label: g.label,
      productCount: g.productCount,
      flaggedCount: g.flaggedCount,
      value: g.value,
      sizedValue: g.flaggedValue,
      worst: g.worst,
      target: { kind: "dimension", dimension, key: g.key, label: g.label } as DrillTarget,
    }));
  }, [dimension, aggregates, branchAggs]);

  const showingTotal = React.useMemo(
    () => built.length > 0 && built.every((c) => c.sizedValue <= 0),
    [built],
  );

  const ordered = React.useMemo(() => {
    const list = [...built];
    if (showingTotal) list.sort((a, b) => b.value - a.value);
    else list.sort((a, b) => b.sizedValue - a.sizedValue);
    return list;
  }, [built, showingTotal]);

  const totalFlagged = React.useMemo(
    () => aggregates.filter((a) => FLAGGED_STATES.has(a.state)).length,
    [aggregates],
  );

  if (built.length === 0 || (totalFlagged === 0 && ordered.every((c) => c.value <= 0))) {
    return (
      <section aria-label="Where the value sits">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-base font-bold tracking-tight">Where the value sits</h3>
          <div role="group" aria-label="Break down by" className="flex gap-1.5">
            {DIMENSIONS.map((d) => (
              <Button
                key={d.id}
                type="button"
                variant={dimension === d.id ? "default" : "outline"}
                size="sm"
                aria-pressed={dimension === d.id}
                onClick={() => setDimension(d.id)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {aggregates.length === 0
            ? `No inventory data for ${dealerName} yet — the block will size each ${dimension} by trapped value once stock lands.`
            : `Nothing flagged at ${dealerName} — the block will size each ${dimension} by trapped value when a product needs attention.`}
        </p>
      </section>
    );
  }

  const top = ordered.slice(0, 8);
  const rest = ordered.slice(8);
  const sizeOf = (c: BlockCell): number => (showingTotal ? c.value : c.sizedValue);
  const totalSize = ordered.reduce((sum, c) => sum + sizeOf(c), 0);

  let others: BlockCell | null = null;
  if (rest.length > 0) {
    const restSize = rest.reduce((sum, c) => sum + sizeOf(c), 0);
    const restValue = rest.reduce((sum, c) => sum + c.value, 0);
    others = {
      key: "__others__",
      label: `Others (${rest.length})`,
      productCount: rest.reduce((sum, c) => sum + c.productCount, 0),
      flaggedCount: rest.reduce((sum, c) => sum + c.flaggedCount, 0),
      value: restValue,
      sizedValue: restSize,
      worst: worstOf(rest.map((c) => c.worst)),
      target: { kind: "urgent" },
    };
  }

  const cells: BlockCell[] = others ? [...top, others] : top;
  const dimensionNoun = dimension === "branch" ? "branch" : dimension === "brand" ? "brand" : "category";

  const summary = showingTotal
    ? `Total inventory value by ${dimensionNoun} at ${dealerName}, largest first.`
    : `Trapped value by ${dimensionNoun} at ${dealerName}, largest first.`;

  return (
    <section aria-label="Where the value sits">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">Where the value sits</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {showingTotal
              ? `Nothing flagged — showing total value by ${dimensionNoun}.`
              : `Sized by trapped value · ${dimensionNoun} view`}
          </p>
        </div>
        <div role="group" aria-label="Break down by" className="flex gap-1.5">
          {DIMENSIONS.map((d) => (
            <Button
              key={d.id}
              type="button"
              variant={dimension === d.id ? "default" : "outline"}
              size="sm"
              aria-pressed={dimension === d.id}
              onClick={() => setDimension(d.id)}
            >
              {d.label}
            </Button>
          ))}
        </div>
      </div>

      <div
        role="img"
        aria-label={summary}
        className="mt-3 flex flex-col gap-1.5 rounded-2xl border bg-card p-2 sm:flex-row sm:flex-wrap"
      >
        {cells.map((cell, index) => {
          const share = totalSize > 0 ? sizeOf(cell) / totalSize : 0;
          const figure = showingTotal ? cell.value : cell.sizedValue;
          const count = showingTotal ? cell.productCount : cell.flaggedCount;
          const countNoun = count === 1 ? "product" : "products";
          const othersDrill: DrillTarget = cell.target;
          // Mobile shows the first three cells plus the remainder capsule, so
          // nothing is silently dropped at 375 px.
          const isRemainder = index === cells.length - 1;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onDrill(othersDrill)}
              style={{ flexGrow: Math.max(1, Math.round(share * 100)), flexBasis: "10rem" }}
              aria-label={`${cell.label}, ${STATE_LABEL[cell.worst]}, ${formatCurrency(figure)} in ${formatNumber(count, "en-PH", 0)} ${countNoun} — view table`}
              title={`${cell.label} · ${formatCurrency(figure)} · ${formatNumber(count, "en-PH", 0)} ${countNoun}`}
              className={cn(
                "min-w-0 rounded-lg px-3 py-2 text-left transition-[background-color,border-color,opacity] duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring",
                CELL_WASH[cell.worst],
                index >= 3 && !isRemainder && "hidden sm:block",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STRIP_BG[cell.worst])} />
                <span className="block truncate text-sm font-semibold" title={cell.label}>
                  {cell.label}
                </span>
              </span>
              <span className="mt-0.5 block text-sm font-bold tabular-nums">{formatCurrency(figure)}</span>
              <span className="block text-[11px] tabular-nums opacity-80">
                {formatNumber(count, "en-PH", 0)} {showingTotal ? countNoun : `flagged ${countNoun}`}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="sr-only">
        {cells.map((cell) => (
          <li key={cell.key}>
            {cell.label}: {formatCurrency(showingTotal ? cell.value : cell.sizedValue)},{" "}
            {formatNumber(showingTotal ? cell.productCount : cell.flaggedCount, "en-PH", 0)} products
          </li>
        ))}
      </ul>
    </section>
  );
}
