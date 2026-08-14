"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { RotateCcw, Filter } from "lucide-react";
import { useAnnualSalesFilters } from "../providers/AnnualSalesFilterProvider";
import type { DealerOption } from "../types/annual-sales.schema";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(2000, i, 1).toLocaleString("default", { month: "short" }),
}));

const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) =>
  String(new Date().getFullYear() - 2 + i),
);

interface AnnualSalesFiltersProps {
  dealers: DealerOption[];
  customers: string[];
  suppliers: string[];
}

export function AnnualSalesFilters({
  dealers,
  customers,
  suppliers,
}: AnnualSalesFiltersProps) {
  const { filters, setFilter, resetFilters } = useAnnualSalesFilters();

  const hasActiveFilters =
    filters.dealerId || filters.customerName || filters.supplierName || filters.month;
  const activeCount = [
    filters.dealerId,
    filters.customerName,
    filters.supplierName,
    filters.month,
  ].filter(Boolean).length;

  const dealerOptions = React.useMemo(
    () => dealers.map((d) => ({ label: d.dealerName, value: String(d.dealerId) })),
    [dealers],
  );
  const customerOptions = React.useMemo(
    () => customers.map((c) => ({ label: c, value: c })),
    [customers],
  );
  const supplierOptions = React.useMemo(
    () => suppliers.map((s) => ({ label: s, value: s })),
    [suppliers],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card">
      <div className="flex items-center gap-1.5 pr-2 border-r">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {activeCount > 0 && (
          <span className="flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
            {activeCount}
          </span>
        )}
      </div>

      <SearchableSelect
        placeholder="Dealer"
        options={dealerOptions}
        value={filters.dealerId}
        onValueChange={(v) => setFilter("dealerId", v)}
        className="w-44 h-8 text-xs"
      />

      <Select
        value={filters.year}
        onValueChange={(v) => setFilter("year", v)}
      >
        <SelectTrigger className="w-24 h-8 text-xs">
          <SelectValue placeholder="Year" />
        </SelectTrigger>
        <SelectContent>
          {YEAR_OPTIONS.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.month}
        onValueChange={(v) => setFilter("month", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue placeholder="All months" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All months</SelectItem>
          {MONTH_OPTIONS.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <SearchableSelect
        placeholder="Customer"
        options={customerOptions}
        value={filters.customerName}
        onValueChange={(v) => setFilter("customerName", v)}
        className="w-40 h-8 text-xs"
      />

      <SearchableSelect
        placeholder="Supplier"
        options={supplierOptions}
        value={filters.supplierName}
        onValueChange={(v) => setFilter("supplierName", v)}
        className="w-40 h-8 text-xs"
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={resetFilters}
        disabled={!hasActiveFilters}
        className="h-8 text-xs px-2 text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
