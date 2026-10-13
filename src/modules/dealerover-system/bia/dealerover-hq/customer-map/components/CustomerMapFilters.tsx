"use client";

import * as React from "react";
import { ChevronsUpDown, Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatNumber } from "@/lib/utils";
import {
  FilterFields,
  countActiveFilters,
  type CustomerMapFilterProps,
} from "./CustomerMapFilterFields";

/**
 * Mobile filter presentation: a floating glass pill overlaid inside the map
 * (rendered only below `lg` by the page) that opens a full-height drawer, so
 * filters are always one tap away and the map keeps the viewport.
 */
export function CustomerMapFilters(props: CustomerMapFilterProps) {
  const { onReset, resultCount, disabled = false } = props;
  const [open, setOpen] = React.useState(false);
  const activeCount = countActiveFilters(props.filters);

  const countLabel = (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">
        {formatNumber(resultCount)}
      </span>{" "}
      shown
    </span>
  );

  const activeBadge = activeCount > 0 && (
    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
      {activeCount}
    </span>
  );

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/85 px-2 py-1.5 shadow-lg backdrop-blur-md">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="h-9 w-auto min-w-0 justify-start gap-2 px-3 text-sm font-normal"
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Filter className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Filters</span>
              {activeBadge}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex w-[90vw] flex-col p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow the customer map by dealer and location.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <FilterFields {...props} stacked />
          </div>
          <SheetFooter className="flex-row items-center justify-between gap-3 border-t p-4">
            {countLabel}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={onReset}
                disabled={disabled || activeCount === 0}
              >
                Reset
              </Button>
              <Button size="sm" className="h-9" onClick={() => setOpen(false)}>
                Show {formatNumber(resultCount)}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {countLabel}
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={onReset}
        disabled={disabled || activeCount === 0}
        aria-label="Reset filters"
        title="Reset filters"
      >
        <RotateCcw className="size-4" />
      </Button>
    </div>
  );
}
