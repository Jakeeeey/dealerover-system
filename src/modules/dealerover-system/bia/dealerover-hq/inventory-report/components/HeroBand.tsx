"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils";

interface HeroBandProps {
  dealerName: string;
  dealerCode: string;
  online: boolean;
  totalValue: number;
}

const VALUE_FORMULA = "Value = (pieces ÷ pieces-per-display-unit) × cost-per-display-unit, summed over every branch row.";

/**
 * Single-dealer hero band — the page anchor. Identity on the left, dealer
 * status plus the dealer's total inventory value on the right. Exception
 * counts live in layer 1, not here.
 */
export function HeroBand({ dealerName, dealerCode, online, totalValue }: HeroBandProps) {
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
            {dealerName || "No dealer selected"}
            {dealerCode ? ` · ${dealerCode}` : ""}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 sm:text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="truncate text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
                  {formatCurrency(totalValue)}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 text-xs">
                {VALUE_FORMULA}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p className="text-xs text-muted-foreground">Dealer inventory value</p>
        </div>
        <StatusBadge tone={online ? "success" : "warning"} className="self-start sm:self-center">
          {online ? "Online" : "Offline"}
        </StatusBadge>
      </div>
    </section>
  );
}
