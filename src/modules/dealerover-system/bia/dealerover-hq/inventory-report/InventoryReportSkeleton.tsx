"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading shape for the three-layer dashboard: hero band, toolbar, the
 * layer-1 statement + urgent pair, then the layer-2 concentration block.
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-4 w-full rounded-lg" />
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="hidden h-8 w-28 rounded-lg sm:block" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>

      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    </div>
  );
}
