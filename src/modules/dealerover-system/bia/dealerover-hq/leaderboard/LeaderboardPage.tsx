"use client";

import React from "react";
import { Building2, RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useLeaderboard } from "./hooks/useLeaderboard";
import { SalesmanRankingsPanel } from "./components/SalesmanRankingsPanel";
import { DealersLeaderboardPanel } from "./components/DealersLeaderboardPanel";

/**
 * DealerOver HQ — Leaderboard.
 *
 * Two views over the same payload: ranked salesmen (the ported rankings panel)
 * and ranked dealers. The Dealers tab is interactive — choosing a dealer jumps
 * back to the Salesmen tab scoped to that dealer's salesmen.
 */
export default function LeaderboardPage() {
    const { data, isLoading, error, refresh, from, to } = useLeaderboard();

    const [activeTab, setActiveTab] = React.useState("salesmen");
    const [dealerFocus, setDealerFocus] = React.useState<{ dealerId: number; token: number } | null>(null);
    const focusTokenRef = React.useRef(0);

    const handleSelectDealer = React.useCallback((dealerId: number) => {
        focusTokenRef.current += 1;
        setDealerFocus({ dealerId, token: focusTokenRef.current });
        setActiveTab("salesmen");
    }, []);

    const handleApplyRange = React.useCallback(
        (nextFrom: string, nextTo: string) => {
            void refresh(nextFrom, nextTo);
        },
        [refresh],
    );

    const handleRefresh = React.useCallback(() => {
        void refresh();
    }, [refresh]);

    return (
        <div className="mx-auto min-h-screen max-w-[1600px] space-y-6 p-2 sm:p-6 md:p-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="shrink-0 rounded-2xl bg-primary/10 p-3 text-primary">
                        <Trophy className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Leaderboard</h2>
                        <p className="text-sm text-muted-foreground">
                            DealerOver HQ sales rankings across every dealer.
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="h-9 shrink-0 gap-2 self-start sm:self-auto"
                    title="Refresh leaderboard"
                >
                    <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    Refresh
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="h-10 w-full max-w-xs bg-card border sm:w-auto">
                    <TabsTrigger value="salesmen" className="h-full gap-2">
                        <Trophy className="h-4 w-4" />
                        Salesmen
                    </TabsTrigger>
                    <TabsTrigger value="dealers" className="h-full gap-2">
                        <Building2 className="h-4 w-4" />
                        Dealers
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="salesmen" className="mt-4">
                    <SalesmanRankingsPanel
                        data={data}
                        isLoading={isLoading}
                        error={error}
                        onApplyRange={handleApplyRange}
                        onRefresh={handleRefresh}
                        dealerFocus={dealerFocus}
                    />
                </TabsContent>

                <TabsContent value="dealers" className="mt-4">
                    <DealersLeaderboardPanel
                        data={data}
                        isLoading={isLoading}
                        from={from}
                        to={to}
                        onSelectDealer={handleSelectDealer}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
