"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CustomerMapFilterState } from "../types";
import {
  DealerFilterCombobox,
  FilterCombobox,
  type DealerFilterOption,
} from "./FilterCombobox";

export interface CustomerMapFilterProps {
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

interface FilterFieldsProps extends CustomerMapFilterProps {
  /** Stack controls vertically (mobile drawer / sidebar) instead of a wrapping row (toolbar). */
  stacked?: boolean;
}

export function toOptions(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

/** Number of filter facets currently constrained (dealer counts as one). */
export function countActiveFilters(filters: CustomerMapFilterState): number {
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
}

/**
 * The filter controls themselves, rendered either as a wrapping row
 * (`stacked={false}`) or a full-width vertical stack (`stacked`). Shared by the
 * desktop toolbar, the desktop sidebar, and the mobile drawer.
 */
export function FilterFields({
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
        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
          Province, city &amp; barangay are derived from the map location.
        </p>
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
