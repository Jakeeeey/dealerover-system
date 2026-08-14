"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  startOfYear, endOfYear, startOfMonth, endOfMonth, format,
} from "date-fns";

export interface AnnualSalesFilters {
  dateFrom: string;
  dateTo: string;
  customerName: string;
  supplierName: string;
  dealerId: string;
  year: string;
  month: string;
}

interface AnnualSalesFilterContextValue {
  filters: AnnualSalesFilters;
  setFilter: (key: keyof AnnualSalesFilters, value: string) => void;
  resetFilters: () => void;
}

const AnnualSalesFilterContext =
  createContext<AnnualSalesFilterContextValue | null>(null);

export function AnnualSalesFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const paramsStr = searchParams.toString();

  const filters: AnnualSalesFilters = useMemo(() => {
    const sp = new URLSearchParams(paramsStr);
    const year = sp.get("year") ?? String(new Date().getFullYear());
    const month = sp.get("month") ?? "";
    const dealerId = sp.get("dealerId") ?? "";

    if (month) {
      const m = Number(month);
      const base = new Date(Number(year), m - 1, 1);
      return {
        dateFrom: sp.get("dateFrom") ?? format(startOfMonth(base), "yyyy-MM-dd"),
        dateTo: sp.get("dateTo") ?? format(endOfMonth(base), "yyyy-MM-dd"),
        customerName: sp.get("customerName") ?? "",
        supplierName: sp.get("supplierName") ?? "",
        dealerId,
        year,
        month,
      };
    }

    return {
      dateFrom:
        sp.get("dateFrom") ??
        format(startOfYear(new Date(Number(year), 0, 1)), "yyyy-MM-dd"),
      dateTo:
        sp.get("dateTo") ??
        format(endOfYear(new Date(Number(year), 11, 31)), "yyyy-MM-dd"),
      customerName: sp.get("customerName") ?? "",
      supplierName: sp.get("supplierName") ?? "",
      dealerId,
      year,
      month,
    };
  }, [paramsStr]);

  const setFilter = useCallback(
    (key: keyof AnnualSalesFilters, value: string) => {
      const params = new URLSearchParams(paramsStr);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, paramsStr],
  );

  const resetFilters = useCallback(() => {
    router.replace(window.location.pathname, { scroll: false });
  }, [router]);

  return (
    <AnnualSalesFilterContext.Provider
      value={{ filters, setFilter, resetFilters }}
    >
      {children}
    </AnnualSalesFilterContext.Provider>
  );
}

export function useAnnualSalesFilters(): AnnualSalesFilterContextValue {
  const ctx = useContext(AnnualSalesFilterContext);
  if (!ctx) {
    throw new Error(
      "useAnnualSalesFilters must be used within AnnualSalesFilterProvider",
    );
  }
  return ctx;
}
