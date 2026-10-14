"use client";

import * as React from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LowStockPolicy } from "../types";

interface PolicyPanelProps {
  policy: LowStockPolicy;
  categories: string[];
  onBasis: (basis: LowStockPolicy["basis"]) => void;
  onLeadDays: (days: number) => void;
  onWindowDays: (days: number) => void;
  onDefaultMinCases: (units: number) => void;
  onCategoryMin: (category: string, units: number) => void;
}

/**
 * Policy popover (never a dialog): basis toggle, cover thresholds, and
 * per-category minimums in display units.
 */
export function PolicyPanel({
  policy,
  categories,
  onBasis,
  onLeadDays,
  onWindowDays,
  onDefaultMinCases,
  onCategoryMin,
}: PolicyPanelProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs min-h-11 md:min-h-0" aria-label="Low-stock threshold policy">
          <Settings2 className="size-4" />
          <span className="hidden sm:inline">Thresholds</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold">Minimum basis</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(["policy", "maintain"] as const).map((basis) => (
                <Button
                  key={basis}
                  variant={policy.basis === basis ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-7 text-xs", policy.basis !== basis && "text-muted-foreground")}
                  onClick={() => onBasis(basis)}
                  aria-pressed={policy.basis === basis}
                >
                  {basis === "policy" ? "Threshold" : "Maintain"}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Maintain uses each product&apos;s master quantity when set, otherwise the threshold values below.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ir-lead" className="text-xs">Lead time (days)</Label>
              <Input
                id="ir-lead"
                type="number"
                min={1}
                max={90}
                value={policy.leadDays}
                onChange={(e) => onLeadDays(Number(e.target.value))}
                className="h-8 text-xs tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ir-window" className="text-xs">Demand window (days)</Label>
              <Input
                id="ir-window"
                type="number"
                min={7}
                max={365}
                value={policy.windowDays}
                onChange={(e) => onWindowDays(Number(e.target.value))}
                className="h-8 text-xs tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ir-default-min" className="text-xs">Default minimum (display units)</Label>
            <Input
              id="ir-default-min"
              type="number"
              min={0}
              step="any"
              value={policy.defaultMinCases}
              onChange={(e) => onDefaultMinCases(Number(e.target.value))}
              className="h-8 text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Category minimums (display units)</p>
            {categories.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No categories in the current result set.</p>
            ) : (
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {categories.map((category) => (
                  <div key={category} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px]">{category || "Uncategorized"}</span>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={policy.categoryMin[category] ?? ""}
                      placeholder="—"
                      onChange={(e) => onCategoryMin(category, Number(e.target.value))}
                      className="h-7 w-20 text-xs tabular-nums"
                      aria-label={`${category} minimum display units`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
