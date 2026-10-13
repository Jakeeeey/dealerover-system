"use client";

import * as React from "react";
import { Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import {
  FilterFields,
  countActiveFilters,
  type CustomerMapFilterProps,
} from "./CustomerMapFilterFields";

/**
 * Desktop filter presentation: a compact, wrapping command bar pinned above the
 * map. Always fully visible — the map fills the remaining height, so nothing
 * ever pushes the filters out of view.
 */
export function CustomerMapToolbar(props: CustomerMapFilterProps) {
  const { onReset, resultCount, disabled = false } = props;
  const activeCount = countActiveFilters(props.filters);

  return (
    <Card className="shrink-0 border-border shadow-none">
      <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="flex items-center gap-1.5 border-r pr-2">
          <Filter className="size-4 text-muted-foreground" />
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {activeCount}
            </span>
          )}
        </div>

        <FilterFields {...props} />

        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {formatNumber(resultCount)}
            </span>{" "}
            shown
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={disabled || activeCount === 0}
            className="h-8 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Reset filters"
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
