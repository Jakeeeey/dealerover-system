"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading shape for the card dashboard: hero band, toolbar, the "Most
 * urgent" card, the severity tier grid, and the dimension spotlight grid.
 * Takes no props — the page renders it bare under the emblem preloader.
 */
export function InventoryReportSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[1600px] space-y-6 p-2 sm:p-6 md:p-10">
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

      <Skeleton className="h-28 w-full rounded-2xl sm:h-32" />

      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
