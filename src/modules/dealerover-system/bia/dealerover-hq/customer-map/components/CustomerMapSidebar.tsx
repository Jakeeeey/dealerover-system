"use client";

import * as React from "react";
import { ChevronsLeft, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import {
  GroupedFilterFields,
  countActiveFilters,
  type CustomerMapFilterProps,
} from "./CustomerMapFilterFields";

/**
 * Floating filter panel overlaid inside the map (desktop, `lg` and up): a
 * glass card pinned to the left edge of the map stage. Hiding it removes it
 * entirely — a compact floating button stays behind to reopen it.
 */
export function CustomerMapSidebar(props: CustomerMapFilterProps) {
  const { onReset, resultCount, disabled = false } = props;
  const [hidden, setHidden] = React.useState(false);
  const activeCount = countActiveFilters(props.filters);

  const activeBadge = activeCount > 0 && (
    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
      {activeCount}
    </span>
  );

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        aria-label="Show filters"
        title="Show filters"
        className="relative flex size-10 items-center justify-center rounded-full border border-border/60 bg-card/85 text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-accent"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      aria-label="Customer map filters"
      className="flex h-full w-72 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/85 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">Filters</span>
          {activeBadge}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onReset}
            disabled={disabled || activeCount === 0}
            aria-label="Reset filters"
            title="Reset filters"
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => setHidden(true)}
            aria-label="Hide filters"
            title="Hide filters"
          >
            <ChevronsLeft className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <GroupedFilterFields {...props} />
      </div>

      <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">
          {formatNumber(resultCount)}
        </span>{" "}
        shown
      </div>
    </aside>
  );
}
