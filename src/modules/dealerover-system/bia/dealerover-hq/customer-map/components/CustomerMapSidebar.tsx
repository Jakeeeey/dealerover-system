"use client";

import * as React from "react";
import { ChevronsLeft, ChevronsRight, Filter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import {
  FilterFields,
  countActiveFilters,
  type CustomerMapFilterProps,
} from "./CustomerMapFilterFields";

/**
 * Alternative desktop presentation: a vertical filter rail (split) beside the
 * map, collapsible to a slim icon strip so the map can take the full width.
 * Toggle-able at any width the layout switch is shown at.
 */
export function CustomerMapSidebar(props: CustomerMapFilterProps) {
  const { onReset, resultCount, disabled = false } = props;
  const [collapsed, setCollapsed] = React.useState(false);
  const activeCount = countActiveFilters(props.filters);

  const activeBadge = activeCount > 0 && (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
      {activeCount}
    </span>
  );

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-3 rounded-2xl border border-border bg-card py-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setCollapsed(false)}
          aria-label="Expand filters"
          title="Expand filters"
        >
          <ChevronsRight className="size-4" />
        </Button>
        <div className="flex flex-col items-center gap-1.5 text-muted-foreground" title="Filters">
          <Filter className="size-4" />
          {activeBadge}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="size-4 text-muted-foreground" />
          Filters
          {activeBadge}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
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
            className="size-8"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse filters"
            title="Collapse filters"
          >
            <ChevronsLeft className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <FilterFields {...props} stacked />
      </div>

      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">
          {formatNumber(resultCount)}
        </span>{" "}
        shown
      </div>
    </aside>
  );
}
