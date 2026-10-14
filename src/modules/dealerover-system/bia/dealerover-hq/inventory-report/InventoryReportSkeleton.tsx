"use client";

import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder shaped like the header, KPI strip, board, and watchlist. */
export function InventoryReportSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[1600px] space-y-4 p-2 sm:p-6 md:p-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="hidden h-4 w-96 sm:block" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-xl" />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-8 w-44 rounded-lg" />
          <Skeleton className="h-8 w-64 rounded-md" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
