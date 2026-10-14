"use client";

import * as React from "react";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorPage } from "@/app/(dealerover-system)/dealerover-system/_components/ErrorPage";
import {
  CUSTOMER_MAP_BASEMAPS,
  DEFAULT_CUSTOMER_MAP_BASEMAP,
  DEFAULT_CUSTOMER_MAP_MARKER_STYLE,
  EMPTY_CUSTOMER_MAP_FILTERS,
  type CustomerMapBasemap,
  type CustomerMapFilterState,
  type CustomerMapMarkerStyle,
} from "./types";
import { useCustomerMap } from "./hooks/useCustomerMap";
import { useBoundaryFeature, type BoundarySelection } from "./hooks/useBoundaryFeature";
import { useFullscreen } from "./hooks/useFullscreen";
import { CustomerMapFilters } from "./components/CustomerMapFilters";
import { CustomerMapSidebar } from "./components/CustomerMapSidebar";
import { MapStyleSwitch } from "./components/MapStyleSwitch";
import { CustomerMapSkeleton } from "./components/CustomerMapSkeleton";
import { CustomerMapView } from "./components/CustomerMapView";
import { MapStageContext } from "./components/MapStageContext";
import { getDealerColor } from "./utils/dealer-colors";

const MARKER_STORAGE_KEY = "hq-customer-map-marker";
const BASEMAP_STORAGE_KEY = "hq-customer-map-basemap";

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
  const [stageEl, setStageEl] = React.useState<HTMLDivElement | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen<HTMLDivElement>(stageEl);
  const [filters, setFilters] = React.useState<CustomerMapFilterState>({
    ...EMPTY_CUSTOMER_MAP_FILTERS,
  });

  // Map presentation preferences: marker style + basemap theme (both persisted).
  const [markerStyle, setMarkerStyle] = React.useState<CustomerMapMarkerStyle>(
    DEFAULT_CUSTOMER_MAP_MARKER_STYLE,
  );
  const [basemap, setBasemap] = React.useState<CustomerMapBasemap>(DEFAULT_CUSTOMER_MAP_BASEMAP);
  React.useEffect(() => {
    try {
      const storedMarker = localStorage.getItem(MARKER_STORAGE_KEY);
      if (storedMarker === "dots" || storedMarker === "heatmap" || storedMarker === "clusters") {
        setMarkerStyle(storedMarker);
      }
      const storedBasemap = localStorage.getItem(BASEMAP_STORAGE_KEY);
      if (storedBasemap && (CUSTOMER_MAP_BASEMAPS as string[]).includes(storedBasemap)) {
        setBasemap(storedBasemap as CustomerMapBasemap);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);
  const changeMarkerStyle = React.useCallback((next: CustomerMapMarkerStyle) => {
    setMarkerStyle(next);
    try {
      localStorage.setItem(MARKER_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);
  const changeBasemap = React.useCallback((next: CustomerMapBasemap) => {
    setBasemap(next);
    try {
      localStorage.setItem(BASEMAP_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);

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

  // Legend chip toggle: flips one dealer's membership (empty array = all).
  const handleToggleDealer = React.useCallback(
    (dealerId: string) => {
      const next = filters.dealerIds.includes(dealerId)
        ? filters.dealerIds.filter((id) => id !== dealerId)
        : [...filters.dealerIds, dealerId];
      handleFilterChange({ dealerIds: next });
    },
    [filters.dealerIds, handleFilterChange],
  );

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

  // Deepest geo filter wins the highlight; the barangay name travels with its
  // parent city + province so duplicate barangay names resolve to the right polygon.
  const boundarySelection = React.useMemo<BoundarySelection | null>(() => {
    if (filters.brgy && filters.city) {
      const selection: BoundarySelection = {
        level: "barangay",
        name: filters.brgy,
        city: filters.city,
      };
      if (filters.province) selection.province = filters.province;
      return selection;
    }
    if (filters.city) {
      const selection: BoundarySelection = { level: "city", name: filters.city };
      if (filters.province) selection.province = filters.province;
      return selection;
    }
    if (filters.province) return { level: "province", name: filters.province };
    return null;
  }, [filters.brgy, filters.city, filters.province]);
  const { data: boundaryHighlight } = useBoundaryFeature(boundarySelection);

  if (isLoading && !data) return <CustomerMapSkeleton />;
  if (error) return <ErrorPage message={error} onRefresh={refresh} />;
  if (data && !data.success) {
    return <ErrorPage message={data.error ?? "Failed to load the customer map"} onRefresh={refresh} />;
  }

  const filterProps = {
    filters,
    onChange: handleFilterChange,
    onReset: handleReset,
    dealers,
    provinceOptions,
    cityOptions,
    brgyOptions,
    storeTypeOptions,
    classificationOptions,
    priceTypeOptions,
    paymentTermOptions,
    resultCount: filteredCustomers.length,
    disabled: isLoading,
  };

  // Full-bleed map stage: the map fills the view edge-to-edge and every
  // control floats over it (z-zones: map 0 · legend/offline/empty 10 ·
  // sidebar+toolbar 20 · detail card 30). The route breadcrumb already labels
  // this view, so only an sr-only heading remains for assistive tech.
  return (
    <div ref={setStageEl} className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <MapStageContext.Provider value={stageEl}>
      <h1 className="sr-only">Customer Map</h1>

      <CustomerMapView
        customers={filteredCustomers}
        dealers={dealers}
        dealerStatuses={data?.dealerStatuses ?? []}
        perDealerCounts={perDealerCounts}
        markerStyle={markerStyle}
        basemap={basemap}
        boundaryHighlight={boundaryHighlight}
        selectedDealerIds={filters.dealerIds}
        onToggleDealer={handleToggleDealer}
      />

      {/* Floating top-right toolbar: map style + refresh (all widths). */}
      <div className="absolute right-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2 overflow-x-auto rounded-xl border border-border/60 bg-card/85 px-2 py-1.5 shadow-lg backdrop-blur-md">
        <MapStyleSwitch
          markerStyle={markerStyle}
          onMarkerStyleChange={changeMarkerStyle}
          basemap={basemap}
          onBasemapChange={changeBasemap}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
          className="h-9 shrink-0 gap-2"
          title="Refresh data"
          aria-label="Refresh data"
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={toggleFullscreen}
          className="size-9 shrink-0"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>

      {/* Floating filter panel overlaid inside the map (desktop). */}
      <div className="absolute bottom-3 left-3 top-3 z-20 hidden lg:block">
        <CustomerMapSidebar {...filterProps} />
      </div>

      {/* Mobile filter drawer trigger as a floating pill beneath the toolbar,
          so the two never collide even at 375px wide. */}
      <div className="absolute left-3 top-[4.75rem] z-20 lg:hidden">
        <CustomerMapFilters {...filterProps} />
      </div>
      </MapStageContext.Provider>
    </div>
  );
}
