"use client";

import { TonePill } from "./StatusPill";
import { cn, formatNumber } from "@/lib/utils";

interface HeroBandProps {
  dealerName: string;
  dealerCode: string;
  online: boolean;
  /** With live demand and comfortable cover. */
  wellStocked: number;
  /** In any flagged state — the exceptions list. */
  needsAttention: number;
  /** No demand to judge by (dropped or unrated). */
  notSelling: number;
}

/**
 * Single-dealer hero band — the page anchor. Identity on the left; dealer
 * status plus a three-way stock split on the right, so the page answers
 * "are we good?" in one glance. The money lives in the layer-1 panel.
 */
export function HeroBand({
  dealerName,
  dealerCode,
  online,
  wellStocked,
  needsAttention,
  notSelling,
}: HeroBandProps) {
  const stats = [
    { label: "Well-stocked", value: wellStocked, className: "text-success" },
    { label: "Needs attention", value: needsAttention, className: "text-foreground" },
    { label: "Not selling", value: notSelling, className: "text-muted-foreground" },
  ];

  return (
    <section
      aria-label="Dealer overview"
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

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <TonePill tone={online ? "success" : "warning"} className="self-start sm:self-center">
          {online ? "Online" : "Offline"}
        </TonePill>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-3 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dd className={cn("text-lg font-bold tabular-nums sm:text-xl", stat.className)}>
                {formatNumber(stat.value, "en-PH", 0)}
              </dd>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
