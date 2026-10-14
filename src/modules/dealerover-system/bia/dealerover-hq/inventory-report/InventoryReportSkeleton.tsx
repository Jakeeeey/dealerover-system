"use client";

import { Skeleton } from "@/components/ui/skeleton";

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

      <div className="grid gap-2 sm:gap-3 md:grid-cols-3">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
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
