"use client";

import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder shaped like the command bar + filter strip + map surface that follows. */
export function CustomerMapSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-4 lg:p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="hidden h-3.5 w-72 sm:block" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <Skeleton className="h-11 w-full shrink-0 rounded-xl" />

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border">
        <Skeleton className="absolute inset-0 rounded-2xl" />
      </div>
    </div>
  );
}
