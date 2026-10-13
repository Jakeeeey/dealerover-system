"use client";

import * as React from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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

function toOptions(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

export function CustomerMapFilters({
  filters,
  onChange,
  onReset,
  dealers,
  provinceOptions,
  cityOptions,
  brgyOptions,
  storeTypeOptions,
  classificationOptions,
  priceTypeOptions,
  paymentTermOptions,
  resultCount,
  disabled = false,
}: CustomerMapFiltersProps) {
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

  return (
    <Card className="shadow-none border-border">
      <CardContent className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1.5 border-r pr-2">
          <Filter className="size-4 text-muted-foreground" />
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {activeCount}
            </span>
          )}
        </div>

        <DealerFilterCombobox
          dealers={dealers}
          selected={filters.dealerIds}
          onChange={(ids) => onChange({ dealerIds: ids })}
          disabled={disabled}
          className="w-44"
        />

        <FilterCombobox
          className="w-40"
          placeholder="Province"
          allLabel="All provinces"
          options={toOptions(provinceOptions)}
          value={filters.province}
          onChange={(value) => onChange({ province: value })}
          disabled={disabled}
        />

        <FilterCombobox
          className="w-40"
          placeholder="City"
          allLabel="All cities"
          options={toOptions(cityOptions)}
          value={filters.city}
          onChange={(value) => onChange({ city: value })}
          disabled={disabled || !filters.province}
        />

        <FilterCombobox
          className="w-40"
          placeholder="Barangay"
          allLabel="All barangays"
          options={toOptions(brgyOptions)}
          value={filters.brgy}
          onChange={(value) => onChange({ brgy: value })}
          disabled={disabled || !filters.city}
        />

        <FilterCombobox
          className="w-40"
          placeholder="Store type"
          allLabel="All store types"
          options={toOptions(storeTypeOptions)}
          value={filters.storeTypeName}
          onChange={(value) => onChange({ storeTypeName: value })}
          disabled={disabled}
        />

        <FilterCombobox
          className="w-40"
          placeholder="Classification"
          allLabel="All classifications"
          options={toOptions(classificationOptions)}
          value={filters.classificationName}
          onChange={(value) => onChange({ classificationName: value })}
          disabled={disabled}
        />

        <FilterCombobox
          className="w-36"
          placeholder="Price type"
          allLabel="All price types"
          options={toOptions(priceTypeOptions)}
          value={filters.priceType}
          onChange={(value) => onChange({ priceType: value })}
          disabled={disabled}
        />

        <FilterCombobox
          className="w-36"
          placeholder="Payment term"
          allLabel="All terms"
          options={toOptions(paymentTermOptions)}
          value={filters.paymentTerm}
          onChange={(value) => onChange({ paymentTerm: value })}
          disabled={disabled}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="Search name, code, store"
            className="h-8 w-56 pl-8 text-xs"
            aria-label="Search customers"
            disabled={disabled}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {resultCount} shown
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={disabled || activeCount === 0}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
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
