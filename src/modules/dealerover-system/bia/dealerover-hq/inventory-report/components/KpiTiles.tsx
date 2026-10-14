"use client";

import { CircleAlert, CircleCheck, CircleX, Info, PackageSearch, Store, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface KpiTilesProps {
  dealersOnline: number;
  dealersTotal: number;
  skusTracked: number;
  outCount: number;
  criticalCount: number;
  lowCount: number;
  totalValue: number;
}

const VALUE_FORMULA = "Value = (pieces ÷ pieces-per-display-unit) × cost-per-display-unit, summed over every branch row.";

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0 rounded-lg bg-muted p-2 text-muted-foreground">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold tabular-nums leading-tight">{value}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {label}
            {hint ? ` · ${hint}` : ""}
          </span>
        </span>
      </CardContent>
    </Card>
  );
}

/** KPI strip for the inventory report. */
export function KpiTiles({
  dealersOnline,
  dealersTotal,
  skusTracked,
  outCount,
  criticalCount,
  lowCount,
  totalValue,
}: KpiTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
      <Tile
        icon={<Store className="size-4" />}
        label="Dealers online"
        value={`${dealersOnline}/${dealersTotal}`}
      />
      <Tile
        icon={<PackageSearch className="size-4" />}
        label="SKUs tracked"
        value={formatNumber(skusTracked, "en-PH", 0)}
      />
      <Tile icon={<CircleX className="size-4" />} label="Stock-outs" value={formatNumber(outCount, "en-PH", 0)} />
      <Tile
        icon={<TriangleAlert className="size-4" />}
        label="Critical + low"
        value={formatNumber(criticalCount + lowCount, "en-PH", 0)}
        hint={`${formatNumber(criticalCount, "en-PH", 0)} critical`}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="min-w-0">
              <Tile
                icon={<CircleCheck className="size-4" />}
                label="Inventory value"
                value={formatCurrency(totalValue)}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64 text-xs">
            {VALUE_FORMULA}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="col-span-2 hidden items-center gap-1 text-[11px] text-muted-foreground lg:hidden">
        <Info className="size-3 shrink-0" />
        <CircleAlert className="hidden" />
        {VALUE_FORMULA}
      </span>
    </div>
  );
}
