"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatNumber } from "@/lib/utils";
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
  /** Dealer whose assigned territory (scope) is outlined. "" = none. */
  scopeDealerId: string;
  onScopeDealerChange: (dealerId: string) => void;
  /** Scope entries that could not be matched to a boundary — surfaced, never silent. */
  scopeUnresolved?: string[];
  /** Customers outside the active territory, and the total drawn. */
  scopeOutside?: number;
  scopeTotal?: number;
  provinceOptions: string[];
  cityOptions: string[];
  brgyOptions: string[];
  storeTypeOptions: string[];
  classificationOptions: string[];
  resultCount: number;
  disabled?: boolean;
}

interface FilterFieldsProps extends CustomerMapFilterProps {
  /** Stack controls vertically (mobile drawer / sidebar) instead of a wrapping row. */
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
  if (filters.search.trim()) count += 1;
  return count;
}

/**
 * Whether Reset has anything to do. The dealer scope is deliberately NOT a
 * filter — it never narrows the rows, so it stays out of the count above — but
 * Reset does clear it. This keeps the button honest: without it the control
 * reads inert whenever a scope is the only thing set, while pressing it would
 * in fact clear the territory.
 */
export function hasResetableState(
  filters: CustomerMapFilterState,
  scopeDealerId: string,
): boolean {
  return countActiveFilters(filters) > 0 || scopeDealerId !== "";
}

interface FieldProps {
  filters: CustomerMapFilterState;
  onChange: (patch: Partial<CustomerMapFilterState>) => void;
  dealers: DealerFilterOption[];
  /** Dealer whose assigned territory (scope) is outlined. "" = none. */
  scopeDealerId: string;
  onScopeDealerChange: (dealerId: string) => void;
  scopeUnresolved?: string[];
  /** Customers outside the active territory, and the total drawn. */
  scopeOutside?: number;
  scopeTotal?: number;
  provinceOptions: string[];
  cityOptions: string[];
  brgyOptions: string[];
  storeTypeOptions: string[];
  classificationOptions: string[];
  disabled: boolean;
  stacked: boolean;
}

function labelClass(stacked: boolean): string {
  return stacked ? "mb-1 block text-xs font-medium text-muted-foreground" : "sr-only";
}

function width(stacked: boolean, inline: string): string {
  return stacked ? "w-full" : inline;
}

function DealerField({ filters, onChange, dealers, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Dealer</label>
      <DealerFilterCombobox
        dealers={dealers}
        selected={filters.dealerIds}
        onChange={(ids) => onChange({ dealerIds: ids })}
        disabled={disabled}
        className={width(stacked, "w-44")}
      />
    </div>
  );
}

/**
 * The dealer's assigned territory (their `dealer_scope` rows) drawn on the map.
 * Deliberately NOT part of `filters`: it does not narrow the customer set, it
 * outlines where that dealer is meant to sell — so it clears from its own
 * "No scope" row and survives Reset, which only clears filters.
 */
function ScopeField({
  dealers,
  scopeDealerId,
  onScopeDealerChange,
  scopeUnresolved,
  scopeOutside,
  scopeTotal,
  disabled,
  stacked,
}: FieldProps) {
  const options = dealers.map((dealer) => ({ value: dealer.id, label: dealer.name }));
  const missing = scopeUnresolved ?? [];
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Scope</label>
      <FilterCombobox
        className={width(stacked, "w-44")}
        placeholder="Scope"
        allLabel="No scope"
        options={options}
        value={scopeDealerId}
        onChange={onScopeDealerChange}
        disabled={disabled}
      />
      {missing.length > 0 ? (
        <p className="mt-1 text-[11px] leading-tight text-warning">
          {formatNumber(missing.length)} scope area{missing.length === 1 ? "" : "s"} not found in the
          boundary data: {missing.join(", ")}
        </p>
      ) : scopeDealerId && scopeOutside !== undefined && scopeTotal !== undefined ? (
        <p
          className={cn(
            "mt-1 text-[11px] leading-tight",
            scopeOutside > 0 ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {scopeOutside > 0
            ? `${formatNumber(scopeOutside)} of ${formatNumber(scopeTotal)} customers outside this territory`
            : `All ${formatNumber(scopeTotal)} customers inside this territory`}
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
          A dealer&apos;s territory and its customers.
        </p>
      )}
    </div>
  );
}

function ProvinceField({ filters, onChange, provinceOptions, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Province</label>
      <FilterCombobox
        className={width(stacked, "w-40")}
        placeholder="Province"
        allLabel="All provinces"
        options={toOptions(provinceOptions)}
        value={filters.province}
        onChange={(value) => onChange({ province: value })}
        disabled={disabled}
      />
    </div>
  );
}

function CityField({ filters, onChange, cityOptions, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>City</label>
      <FilterCombobox
        className={width(stacked, "w-40")}
        placeholder="City"
        allLabel="All cities"
        options={toOptions(cityOptions)}
        value={filters.city}
        onChange={(value) => onChange({ city: value })}
        disabled={disabled || !filters.province}
      />
    </div>
  );
}

function BrgyField({ filters, onChange, brgyOptions, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Barangay</label>
      <FilterCombobox
        className={width(stacked, "w-40")}
        placeholder="Barangay"
        allLabel="All barangays"
        options={toOptions(brgyOptions)}
        value={filters.brgy}
        onChange={(value) => onChange({ brgy: value })}
        disabled={disabled || !filters.city}
      />
    </div>
  );
}

function StoreTypeField({ filters, onChange, storeTypeOptions, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Store type</label>
      <FilterCombobox
        className={width(stacked, "w-40")}
        placeholder="Store type"
        allLabel="All store types"
        options={toOptions(storeTypeOptions)}
        value={filters.storeTypeName}
        onChange={(value) => onChange({ storeTypeName: value })}
        disabled={disabled}
      />
    </div>
  );
}

function ClassificationField({
  filters,
  onChange,
  classificationOptions,
  disabled,
  stacked,
}: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Classification</label>
      <FilterCombobox
        className={width(stacked, "w-40")}
        placeholder="Classification"
        allLabel="All classifications"
        options={toOptions(classificationOptions)}
        value={filters.classificationName}
        onChange={(value) => onChange({ classificationName: value })}
        disabled={disabled}
      />
    </div>
  );
}

function SearchField({ filters, onChange, disabled, stacked }: FieldProps) {
  return (
    <div className={stacked ? "w-full" : undefined}>
      <label className={labelClass(stacked)}>Search</label>
      {/* The relative wrapper covers ONLY the input, so the icon centers on the
          field — not on the label + input together. */}
      <div className="relative">
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
    </div>
  );
}

/**
 * The filter controls themselves, rendered either as a wrapping row
 * (`stacked={false}`) or a full-width vertical stack (`stacked`). Shared by
 * the desktop sidebar and the mobile drawer.
 */
export function FilterFields(props: FilterFieldsProps) {
  const { disabled = false, stacked = false } = props;
  const fieldProps: FieldProps = { ...props, disabled, stacked };
  return (
    <>
      <ScopeField {...fieldProps} />
      <DealerField {...fieldProps} />
      <ProvinceField {...fieldProps} />
      <CityField {...fieldProps} />
      <BrgyField {...fieldProps} />
      <StoreTypeField {...fieldProps} />
      <ClassificationField {...fieldProps} />
      <SearchField {...fieldProps} />
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * Grouped variant for the floating sidebar: geographic fields (dealer →
 * barangay, with the map-location hint) and attribute fields each sit under
 * their own heading with a subtle divider between the groups.
 */
export function GroupedFilterFields(props: CustomerMapFilterProps) {
  const { disabled = false } = props;
  const fieldProps: FieldProps = { ...props, disabled, stacked: true };
  return (
    <>
      <section aria-label="Location filters" className="flex flex-col gap-3">
        <SectionHeading>Location</SectionHeading>
        <ScopeField {...fieldProps} />
        <DealerField {...fieldProps} />
        <ProvinceField {...fieldProps} />
        <CityField {...fieldProps} />
        <BrgyField {...fieldProps} />
      </section>

      <div className="border-t border-border/60" role="separator" aria-orientation="horizontal" />

      <section aria-label="Attribute filters" className="flex flex-col gap-3">
        <SectionHeading>Attributes</SectionHeading>
        <StoreTypeField {...fieldProps} />
        <ClassificationField {...fieldProps} />
      </section>

      <SearchField {...fieldProps} />
    </>
  );
}
