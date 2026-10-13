"use client";

import * as React from "react";
import { ChevronsUpDown, Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn, formatNumber } from "@/lib/utils";
import type { CustomerMapFilterState } from "../types";
import {
  DealerFilterCombobox,
  FilterCombobox,
  type DealerFilterOption,
} from "./FilterCombobox";

interface CustomerMapFiltersProps {
  filters: CustomerMapFilterState;
  onChange: (patch: Partial<CustomerMapFilterState>) => void;
  onReset: () => void;
  dealers: DealerFilterOption[];
  provinceOptions: string[];
  cityOptions: string[];
  brgyOptions: string[];
  storeTypeOptions: string[];
  classificationOptions: string[];
  priceTypeOptions: string[];
  paymentTermOptions: string[];
  resultCount: number;
  disabled?: boolean;
}

interface FilterFieldsProps extends Omit<CustomerMapFiltersProps, "onReset" | "resultCount"> {
  /** Stack controls vertically (mobile drawer) instead of a wrapping row (desktop toolbar). */
  stacked?: boolean;
}

function toOptions(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * The filter controls themselves, rendered either as a wrapping desktop row
 * (`stacked={false}`) or a full-width vertical stack (`stacked`).
 */
function FilterFields({
  filters,
  onChange,
  dealers,
  provinceOptions,
  cityOptions,
  brgyOptions,
  storeTypeOptions,
  classificationOptions,
  priceTypeOptions,
  paymentTermOptions,
  disabled = false,
  stacked = false,
}: FilterFieldsProps) {
  const w = (inline: string) => (stacked ? "w-full" : inline);
  const labelClass = stacked ? "mb-1 block text-xs font-medium text-muted-foreground" : "sr-only";

  return (
    <>
      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Dealer</label>
        <DealerFilterCombobox
          dealers={dealers}
          selected={filters.dealerIds}
          onChange={(ids) => onChange({ dealerIds: ids })}
          disabled={disabled}
          className={w("w-44")}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Province</label>
        <FilterCombobox
          className={w("w-40")}
          placeholder="Province"
          allLabel="All provinces"
          options={toOptions(provinceOptions)}
          value={filters.province}
          onChange={(value) => onChange({ province: value })}
          disabled={disabled}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>City</label>
        <FilterCombobox
          className={w("w-40")}
          placeholder="City"
          allLabel="All cities"
          options={toOptions(cityOptions)}
          value={filters.city}
          onChange={(value) => onChange({ city: value })}
          disabled={disabled || !filters.province}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Barangay</label>
        <FilterCombobox
          className={w("w-40")}
          placeholder="Barangay"
          allLabel="All barangays"
          options={toOptions(brgyOptions)}
          value={filters.brgy}
          onChange={(value) => onChange({ brgy: value })}
          disabled={disabled || !filters.city}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Store type</label>
        <FilterCombobox
          className={w("w-40")}
          placeholder="Store type"
          allLabel="All store types"
          options={toOptions(storeTypeOptions)}
          value={filters.storeTypeName}
          onChange={(value) => onChange({ storeTypeName: value })}
          disabled={disabled}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Classification</label>
        <FilterCombobox
          className={w("w-40")}
          placeholder="Classification"
          allLabel="All classifications"
          options={toOptions(classificationOptions)}
          value={filters.classificationName}
          onChange={(value) => onChange({ classificationName: value })}
          disabled={disabled}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Price type</label>
        <FilterCombobox
          className={w("w-36")}
          placeholder="Price type"
          allLabel="All price types"
          options={toOptions(priceTypeOptions)}
          value={filters.priceType}
          onChange={(value) => onChange({ priceType: value })}
          disabled={disabled}
        />
      </div>

      <div className={stacked ? "w-full" : undefined}>
        <label className={labelClass}>Payment term</label>
        <FilterCombobox
          className={w("w-36")}
          placeholder="Payment term"
          allLabel="All terms"
          options={toOptions(paymentTermOptions)}
          value={filters.paymentTerm}
          onChange={(value) => onChange({ paymentTerm: value })}
          disabled={disabled}
        />
      </div>

      <div className={cn("relative", stacked && "w-full")}>
        <label className={labelClass}>Search</label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder="Search name, code, store"
          className={cn("h-8 pl-8 text-xs", stacked ? "w-full" : "w-56")}
          aria-label="Search customers"
          disabled={disabled}
        />
      </div>
    </>
  );
}

/**
 * Persistent filter command bar.
 *
 * Desktop (`lg+`): a compact wrapping toolbar that stays pinned above the map,
 * so filters are always reachable without scrolling.
 * Mobile: the same controls collapse into a bottom-anchored sheet the map can
 * never push off-screen.
 */
export function CustomerMapFilters(props: CustomerMapFiltersProps) {
  const { filters, onReset, resultCount, disabled = false } = props;
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const activeCount = React.useMemo(() => {
    let count = 0;
    if (filters.dealerIds.length > 0) count += 1;
    if (filters.province) count += 1;
    if (filters.city) count += 1;
    if (filters.brgy) count += 1;
    if (filters.storeTypeName) count += 1;
    if (filters.classificationName) count += 1;
    if (filters.priceType) count += 1;
    if (filters.paymentTerm) count += 1;
    if (filters.search.trim()) count += 1;
    return count;
  }, [filters]);

  const countLabel = (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">
        {formatNumber(resultCount)}
      </span>{" "}
      shown
    </span>
  );

  const resetButton = (
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
  );

  const activeBadge = activeCount > 0 && (
    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
      {activeCount}
    </span>
  );

  return (
    <>
      {/* Desktop: pinned, compact toolbar */}
      <Card className="hidden shrink-0 border-border shadow-none lg:block">
        <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
          <div className="flex items-center gap-1.5 border-r pr-2">
            <Filter className="size-4 text-muted-foreground" />
            {activeBadge}
          </div>

          <FilterFields {...props} />

          <div className="ml-auto flex items-center gap-2">
            {countLabel}
            {resetButton}
          </div>
        </CardContent>
      </Card>

      {/* Mobile: filter drawer so the map keeps the viewport */}
      <div className="flex shrink-0 items-center gap-2 lg:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className="h-10 min-w-0 flex-1 justify-between gap-2 text-sm font-normal"
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
              <SheetDescription>
                Narrow the customer map by dealer and location.
              </SheetDescription>
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
                  onClick={onReset}
                  disabled={disabled || activeCount === 0}
                  className="h-9"
                >
                  Reset
                </Button>
                <Button size="sm" className="h-9" onClick={() => setSheetOpen(false)}>
                  Show {formatNumber(resultCount)}
                </Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {countLabel}
        {resetButton}
      </div>
    </>
  );
}
