"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

interface HeroBandProps {
  dealersOnline: number;
  dealersTotal: number;
  skusTracked: number;
  outCount: number;
  criticalCount: number;
  lowCount: number;
  totalValue: number;
}

const VALUE_FORMULA = "Value = (pieces ÷ pieces-per-display-unit) × cost-per-display-unit, summed over every branch row.";

const MICRO_LABEL = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

export function HeroBand({
  dealersOnline,
  dealersTotal,
  skusTracked,
  outCount,
  criticalCount,
  lowCount,
  totalValue,
}: HeroBandProps) {
  const degraded = dealersOnline < dealersTotal;

  return (
    <section
      aria-label="Inventory overview"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/dealerover-emblem.svg" alt="DealerOver" className="size-10 shrink-0 sm:size-12" />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Inventory Report</h2>
          <p className="truncate text-sm text-muted-foreground">
            Low-stock signals across every dealer — demand cover, minimums, and value at risk.
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 sm:text-right">
          <p className={MICRO_LABEL}>Network inventory value</p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="truncate text-2xl font-black tracking-tight tabular-nums sm:text-3xl">
                  {formatCurrency(totalValue)}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 text-xs">
                {VALUE_FORMULA}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 animate-pulse rounded-full", degraded ? "bg-warning" : "bg-success")}
              />
              {formatNumber(dealersOnline, "en-PH", 0)}/{formatNumber(dealersTotal, "en-PH", 0)}
              <StatusBadge tone={degraded ? "warning" : "success"}>{degraded ? "Degraded" : "Online"}</StatusBadge>
            </p>
            <p className={MICRO_LABEL}>Dealers online</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums text-destructive">
              {formatNumber(outCount, "en-PH", 0)}
            </p>
            <p className={MICRO_LABEL}>Stock-outs</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums">
              {formatNumber(criticalCount + lowCount, "en-PH", 0)}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {formatNumber(criticalCount, "en-PH", 0)} critical
              </span>
            </p>
            <p className={MICRO_LABEL}>Critical + low</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tabular-nums">{formatNumber(skusTracked, "en-PH", 0)}</p>
            <p className={MICRO_LABEL}>SKUs tracked</p>
          </div>
        </div>
      </div>
    </section>
  );
}
