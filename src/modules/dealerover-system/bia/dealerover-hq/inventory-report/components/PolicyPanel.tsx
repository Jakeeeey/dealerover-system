"use client";

import { CalendarClock, Hourglass, Settings2, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LowStockPolicy } from "../types";

interface PolicyPanelProps {
  policy: LowStockPolicy;
  onLeadDays: (days: number) => void;
  onWindowDays: (days: number) => void;
  onLookbackDays: (days: number) => void;
}

/**
 * Analytics settings popover (never a dialog): lead time, demand window,
 * and not-selling lookback. No thresholds — classification comes from
 * each product's own sales history.
 */
export function PolicyPanel({ policy, onLeadDays, onWindowDays, onLookbackDays }: PolicyPanelProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs min-h-11 md:min-h-0" aria-label="Demand analytics settings">
          <Settings2 className="size-4" />
          <span className="hidden sm:inline">Analytics</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold">Demand analytics</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              States come from each product&apos;s own sales history — no minimums to configure.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ir-lead" className="flex items-center gap-1.5 text-xs">
                <Timer className="size-3.5 text-muted-foreground" aria-hidden />
                Lead time (days)
              </Label>
              <Input
                id="ir-lead"
                type="number"
                min={1}
                max={90}
                value={policy.leadDays}
                onChange={(e) => onLeadDays(Number(e.target.value))}
                className="h-8 text-xs tabular-nums"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Cover below this reads as low; twice this reads as watch.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ir-window" className="flex items-center gap-1.5 text-xs">
                <Hourglass className="size-3.5 text-muted-foreground" aria-hidden />
                Demand window (days)
              </Label>
              <Input
                id="ir-window"
                type="number"
                min={7}
                max={365}
                value={policy.windowDays}
                onChange={(e) => onWindowDays(Number(e.target.value))}
                className="h-8 text-xs tabular-nums"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Average daily demand is measured over this window.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ir-lookback" className="flex items-center gap-1.5 text-xs">
                <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
                Not-selling lookback (days)
              </Label>
              <Input
                id="ir-lookback"
                type="number"
                min={30}
                max={365}
                value={policy.lookbackDays}
                onChange={(e) => onLookbackDays(Number(e.target.value))}
                className="h-8 text-xs tabular-nums"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                No sale in this long means dead stock — or dropped, when nothing is on hand.
              </p>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
