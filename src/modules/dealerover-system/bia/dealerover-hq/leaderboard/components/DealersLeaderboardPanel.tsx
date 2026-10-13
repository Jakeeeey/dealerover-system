"use client";

import React from "react";
import {
    Trophy,
    Building2,
    FileText,
    Users,
    ChevronRight,
    RefreshCw,
    Medal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import type { DealerLeaderboardEntry, LeaderboardResponse } from "../types";
import { formatDisplayDate } from "../utils/date-helpers";

export interface DealersLeaderboardPanelProps {
    data: LeaderboardResponse | null;
    isLoading: boolean;
    /** Applied range start (`YYYY-MM-DD`), for the period caption. */
    from: string;
    /** Applied range end (`YYYY-MM-DD`), for the period caption. */
    to: string;
    /** Switch to the Salesmen tab focused on this dealer. */
    onSelectDealer: (dealerId: number) => void;
}

/** Subtle per-rank accent: medal ring + left indicator strip. */
function rankAccent(rank: number): { strip: string; medal: string; text: string } {
    if (rank === 1) {
        return {
            strip: "bg-amber-500",
            medal: "bg-gradient-to-b from-amber-400 to-amber-600 text-slate-950 ring-amber-400/40",
            text: "text-amber-600 dark:text-amber-400",
        };
    }
    if (rank === 2) {
        return {
            strip: "bg-cyan-400",
            medal: "bg-gradient-to-b from-slate-200 to-slate-400 text-slate-900 ring-slate-300/40 dark:from-slate-500 dark:to-slate-700 dark:text-slate-50",
            text: "text-cyan-700 dark:text-cyan-300",
        };
    }
    if (rank === 3) {
        return {
            strip: "bg-orange-500",
            medal: "bg-gradient-to-b from-orange-300 to-amber-800 text-amber-50 ring-orange-500/40",
            text: "text-orange-700 dark:text-orange-300",
        };
    }
    return {
        strip: "bg-border",
        medal: "bg-muted text-muted-foreground ring-border",
        text: "text-foreground",
    };
}

function DealerRow({
    dealer,
    onSelect,
}: {
    dealer: DealerLeaderboardEntry;
    onSelect: (dealerId: number) => void;
}) {
    const accent = rankAccent(dealer.rank);
    return (
        <button
            type="button"
            onClick={() => onSelect(dealer.dealer_id)}
            title={`View ${dealer.dealer_name} salesmen`}
            className="group relative grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
            <span className={cn("absolute left-0 inset-y-2 w-1 rounded-r-full transition-colors", accent.strip)} aria-hidden="true" />

            <span
                className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black italic leading-none ring-1",
                    accent.medal,
                )}
            >
                {dealer.rank <= 3 ? <Medal className="h-4 w-4" /> : dealer.rank}
            </span>

            <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-bold text-foreground max-w-[220px] sm:max-w-[340px]" title={dealer.dealer_name}>
                        {dealer.dealer_name}
                    </span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono font-bold uppercase truncate max-w-[140px]">{dealer.dealer_code}</span>
                    <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        <span className="tabular-nums">{dealer.total_invoices}</span> invoices
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="tabular-nums">{dealer.salesman_count}</span> salesmen
                    </span>
                </span>
            </span>

            <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={cn("font-black tracking-tight tabular-nums text-sm sm:text-base max-w-[160px] truncate", accent.text)} title={formatCurrency(dealer.total_net_amount)}>
                    {formatCurrency(dealer.total_net_amount)}
                </span>
                <span className="flex items-center gap-1.5">
                    {dealer.is_online ? (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Online
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-bold">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Offline
                        </Badge>
                    )}
                    <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
                </span>
            </span>
        </button>
    );
}

/**
 * Dealers tab — ranks the dealers themselves. Clicking a row jumps to the
 * Salesmen tab focused on that dealer.
 */
export function DealersLeaderboardPanel({
    data,
    isLoading,
    from,
    to,
    onSelectDealer,
}: DealersLeaderboardPanelProps) {
    const dealerRankings = data?.dealerRankings ?? [];
    const periodLabel =
        from || to ? `${formatDisplayDate(from)} - ${formatDisplayDate(to)}` : "";

    return (
        <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/30 px-5 py-3">
                <h2 className="flex shrink-0 items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground">
                    <Trophy className="h-3.5 w-3.5 text-amber-500" />
                    Dealer Standings ({dealerRankings.length})
                </h2>
                {periodLabel && (
                    <span className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {periodLabel}
                    </span>
                )}
            </div>

            {isLoading ? (
                <div className="space-y-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
                    ))}
                </div>
            ) : dealerRankings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <Building2 className="h-8 w-8 text-muted-foreground/50" />
                    <span className="text-xs font-bold text-muted-foreground">No dealers found.</span>
                    <p className="max-w-xs text-[11px] text-muted-foreground/80">
                        Dealer standings appear once the roster is reachable.
                    </p>
                </div>
            ) : (
                <div>
                    {dealerRankings.map((dealer) => (
                        <DealerRow key={dealer.dealer_id} dealer={dealer} onSelect={onSelectDealer} />
                    ))}
                    <div className="flex items-center gap-2 border-t border-border/50 bg-muted/20 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <RefreshCw className="h-3 w-3" />
                        Select a dealer to view its salesmen
                    </div>
                </div>
            )}
        </section>
    );
}
