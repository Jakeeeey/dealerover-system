"use client";

import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { CELL_WASH, STATE_LABEL, STRIP_BG, TONE_BY_STATE } from "../utils/severity-tone";
import type { ProductAggregate } from "../utils/aggregate";

interface UrgencyPodiumProps {
  items: ProductAggregate[];
  onSelect: (dealerId: string, productId: number) => void;
}

function unitNameOf(item: ProductAggregate): string {
  const unit = (item.unitName ?? "").trim();
  if (unit) return unit;
  return !item.unitCount || item.unitCount <= 1 ? "pcs" : "units";
}

function inUnits(pieces: number, item: ProductAggregate): string {
  if (!item.unitCount || item.unitCount <= 0) return `${formatNumber(pieces, "en-PH", 0)} ${unitNameOf(item)}`;
  const units = pieces / item.unitCount;
  const rounded = Math.round(units * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${unitNameOf(item)}`;
}

function coverLabel(item: ProductAggregate): string {
  if (item.daysOfCover === null) return "—";
  const rounded = Math.round(item.daysOfCover * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}d`;
}

export function UrgencyPodium({ items, onSelect }: UrgencyPodiumProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label="Most urgent stock situations" className="space-y-2">
      <h3 className="text-sm font-semibold">Most urgent</h3>
      <div className="grid gap-2 sm:gap-3 md:grid-cols-3">
        {items.map((item, index) => {
          const rank = index + 1;
          const first = rank === 1;
          const code = item.productCode || `id:${item.productId}`;
          return (
            <motion.button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.dealerId, item.productId)}
              whileHover={{ scale: 1.02, y: -4 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              aria-label={`Rank ${rank}: ${item.productName} at ${item.dealerName}, ${STATE_LABEL[item.state]}`}
              className={cn(
                "relative min-w-0 overflow-hidden rounded-lg border bg-card text-left transition-[box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-ring",
                first ? "p-4 shadow-md sm:-translate-y-2.5" : "p-3 shadow-sm hover:shadow-md",
              )}
            >
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", STRIP_BG[item.state])} />
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-black tabular-nums",
                    CELL_WASH[item.state],
                  )}
                >
                  {rank}
                </span>
                <StatusBadge tone={TONE_BY_STATE[item.state]}>{STATE_LABEL[item.state]}</StatusBadge>
              </span>
              <span className="mt-2 block min-w-0">
                <span className="block truncate text-sm font-semibold" title={item.productName}>
                  {item.productName}
                </span>
                <span
                  className="block truncate font-mono text-[10px] uppercase text-muted-foreground"
                  title={`${code} · ${item.dealerName}`}
                >
                  {code} · {item.dealerName}
                </span>
              </span>
              <span className="mt-2 grid grid-cols-3 gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold tabular-nums">{inUnits(item.onHand, item)}</span>
                  <span className="block text-[11px] text-muted-foreground">On hand</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold tabular-nums">{coverLabel(item)}</span>
                  <span className="block text-[11px] text-muted-foreground">Days cover</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold tabular-nums">
                    {inUnits(item.effectiveMin, item)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">Minimum</span>
                </span>
              </span>
              <span className="mt-1.5 block truncate text-[11px] tabular-nums text-muted-foreground">
                {formatCurrency(item.value)} at risk
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
