"use client";

import * as React from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorPage } from "@/app/(dealerover-system)/dealerover-system/_components/ErrorPage";
import {
  EMPTY_CUSTOMER_MAP_FILTERS,
  type CustomerMapFilterState,
} from "./types";
import { useCustomerMap } from "./hooks/useCustomerMap";
import { CustomerMapFilters } from "./components/CustomerMapFilters";
import { CustomerMapSkeleton } from "./components/CustomerMapSkeleton";
import { CustomerMapView } from "./components/CustomerMapView";
import { getDealerColor } from "./utils/dealer-colors";

function uniqueSorted(values: string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export default function CustomerMapPage() {
  const { data, isLoading, error, refresh } = useCustomerMap();
  const [filters, setFilters] = React.useState<CustomerMapFilterState>({
    ...EMPTY_CUSTOMER_MAP_FILTERS,
  });

  // Only active customers (isActive === 1) are ever plotted or counted.
  const activeCustomers = React.useMemo(
    () => (data?.customers ?? []).filter((customer) => customer.isActive === 1),
    [data],
  );

  const dealers = React.useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string; code: string; color: string }[] = [];
    (data?.dealerStatuses ?? []).forEach((status) => {
      if (seen.has(status.dealerId)) return;
      seen.add(status.dealerId);
      list.push({
        id: status.dealerId,
        name: status.dealerName,
        code: status.dealerCode,
        color: getDealerColor(list.length),
      });
    });
    return list;
  }, [data]);

  const handleFilterChange = React.useCallback(
    (patch: Partial<CustomerMapFilterState>) => {
      setFilters((previous) => {
        const next: CustomerMapFilterState = { ...previous, ...patch };
        const provinceChanged = "province" in patch && patch.province !== previous.province;
        const cityChanged = "city" in patch && patch.city !== previous.city;
        if (provinceChanged) {
          next.city = "";
          next.brgy = "";
        } else if (cityChanged) {
          next.brgy = "";
        }

        // Changing the dealer scope can invalidate a deeper cascade selection.
        if ("dealerIds" in patch) {
          const scoped = next.dealerIds.length
            ? activeCustomers.filter((customer) => next.dealerIds.includes(customer.dealerId))
            : activeCustomers;
          const provinceValid = !next.province || scoped.some((c) => c.province === next.province);
          if (!provinceValid) {
            next.province = "";
            next.city = "";
            next.brgy = "";
          } else {
            const cityValid =
              !next.city ||
              scoped.some((c) => c.city === next.city && c.province === next.province);
            if (!cityValid) {
              next.city = "";
              next.brgy = "";
            } else {
              const brgyValid =
                !next.brgy || scoped.some((c) => c.brgy === next.brgy && c.city === next.city);
              if (!brgyValid) next.brgy = "";
            }
          }
        }

        return next;
      });
    },
    [activeCustomers],
  );

  const handleReset = React.useCallback(() => {
    setFilters({ ...EMPTY_CUSTOMER_MAP_FILTERS });
  }, []);

  const scopedCustomers = React.useMemo(
    () =>
      filters.dealerIds.length
        ? activeCustomers.filter((customer) => filters.dealerIds.includes(customer.dealerId))
        : activeCustomers,
    [activeCustomers, filters.dealerIds],
  );

  const provinceOptions = React.useMemo(
    () => uniqueSorted(scopedCustomers.map((customer) => customer.province)),
    [scopedCustomers],
  );
  const cityOptions = React.useMemo(
    () =>
      uniqueSorted(
        scopedCustomers
          .filter((customer) => !filters.province || customer.province === filters.province)
          .map((customer) => customer.city),
      ),
    [scopedCustomers, filters.province],
  );
  const brgyOptions = React.useMemo(
    () =>
      uniqueSorted(
        scopedCustomers
          .filter(
            (customer) =>
              (!filters.province || customer.province === filters.province) &&
              (!filters.city || customer.city === filters.city),
          )
          .map((customer) => customer.brgy),
      ),
    [scopedCustomers, filters.province, filters.city],
  );
  const storeTypeOptions = React.useMemo(
    () => uniqueSorted(scopedCustomers.map((customer) => customer.store_type_name)),
    [scopedCustomers],
  );
  const classificationOptions = React.useMemo(
    () => uniqueSorted(scopedCustomers.map((customer) => customer.classification_name)),
    [scopedCustomers],
  );
  const priceTypeOptions = React.useMemo(
    () => uniqueSorted(scopedCustomers.map((customer) => customer.price_type)),
    [scopedCustomers],
  );
  const paymentTermOptions = React.useMemo(
    () => uniqueSorted(scopedCustomers.map((customer) => customer.payment_term)),
    [scopedCustomers],
  );

  const filteredCustomers = React.useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return activeCustomers.filter((customer) => {
      if (filters.dealerIds.length && !filters.dealerIds.includes(customer.dealerId)) return false;
      if (filters.province && customer.province !== filters.province) return false;
      if (filters.city && customer.city !== filters.city) return false;
      if (filters.brgy && customer.brgy !== filters.brgy) return false;
      if (filters.storeTypeName && customer.store_type_name !== filters.storeTypeName) return false;
      if (filters.classificationName && customer.classification_name !== filters.classificationName) {
        return false;
      }
      if (filters.priceType && customer.price_type !== filters.priceType) return false;
      if (filters.paymentTerm && customer.payment_term !== filters.paymentTerm) return false;
      if (query) {
        const haystack = `${customer.customer_name} ${customer.customer_code} ${customer.store_name}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [activeCustomers, filters]);

  const perDealerCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    dealers.forEach((dealer) => {
      counts[dealer.id] = 0;
    });
    filteredCustomers.forEach((customer) => {
      counts[customer.dealerId] = (counts[customer.dealerId] ?? 0) + 1;
    });
    return counts;
  }, [dealers, filteredCustomers]);

  if (isLoading && !data) return <CustomerMapSkeleton />;
  if (error) return <ErrorPage message={error} onRefresh={refresh} />;
  if (data && !data.success) {
    return <ErrorPage message={data.error ?? "Failed to load the customer map"} onRefresh={refresh} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-4 lg:p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-xl bg-primary/10 p-2">
            <MapPinned className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
              Customer Map
            </h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              Active customer locations across every dealer under HQ, coloured by dealer.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
          className="h-9 shrink-0 gap-2"
          title="Refresh data"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <CustomerMapFilters
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleReset}
        dealers={dealers}
        provinceOptions={provinceOptions}
        cityOptions={cityOptions}
        brgyOptions={brgyOptions}
        storeTypeOptions={storeTypeOptions}
        classificationOptions={classificationOptions}
        priceTypeOptions={priceTypeOptions}
        paymentTermOptions={paymentTermOptions}
        resultCount={filteredCustomers.length}
        disabled={isLoading}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <CustomerMapView
          customers={filteredCustomers}
          dealers={dealers}
          dealerStatuses={data?.dealerStatuses ?? []}
          perDealerCounts={perDealerCounts}
        />
      </div>
    </div>
  );
}
