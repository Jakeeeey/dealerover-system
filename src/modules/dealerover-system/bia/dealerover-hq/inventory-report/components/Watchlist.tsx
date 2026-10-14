"use client";

import { ChevronRight } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { LowStockState } from "../types";
import type { ProductAggregate } from "../utils/aggregate";

const TONE_BY_STATE: Record<LowStockState, StatusTone> = {
  out: "destructive",
  critical: "destructive",
  low: "warning",
  watch: "info",
  healthy: "success",
  overstock: "neutral",
  dead: "neutral",
};

interface WatchlistProps {
  items: ProductAggregate[];
  onSelect: (dealerId: string, productId: number) => void;
}

function resolveUnit(unitName: string | undefined, unitCount: number): string {
  const unit = (unitName ?? "").trim();
  if (unit) return unit;
  return !unitCount || unitCount <= 1 ? "pcs" : "units";
}

function displayUnitsLabel(onHand: number, unitCount: number, unitName?: string): string {
  const unit = resolveUnit(unitName, unitCount);
  if (!unitCount || unitCount <= 0) return `${formatNumber(onHand, "en-PH", 0)} ${unit}`;
  const units = onHand / unitCount;
  const rounded = Math.round(units * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

/** Prose watchlist rows, each jumping to the item drawer. */
export function Watchlist({ items, onSelect }: WatchlistProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Nothing needs attention</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every tracked product is within its threshold. Loosen the policy to surface watch items.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={() => onSelect(item.dealerId, item.productId)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color,opacity] duration-150 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <StatusBadge tone={TONE_BY_STATE[item.state]} className="shrink-0">
              {item.state}
            </StatusBadge>
            <span className="min-w-0 flex-1 text-xs leading-snug sm:text-[13px]">
              <span className="font-medium">{item.dealerName}</span>
              <span className="text-muted-foreground"> is {item.state === "out" ? "out of " : "low on "}</span>
              <span className="font-medium">{item.productName}</span>
              <span className="text-muted-foreground">
                {" — "}
                {displayUnitsLabel(item.onHand, item.unitCount, item.unitName)} left
                {item.daysOfCover !== null ? `, ${Math.round(item.daysOfCover * 10) / 10} days cover` : ""}
                {item.effectiveMin > 0 ? `, minimum ${displayUnitsLabel(item.effectiveMin, item.unitCount, item.unitName)}` : ""} ·{" "}
                {formatCurrency(item.value)} at risk
              </span>
            </span>
            <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:block">
              {formatNumber(item.onHand, "en-PH", 0)} pcs
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}
