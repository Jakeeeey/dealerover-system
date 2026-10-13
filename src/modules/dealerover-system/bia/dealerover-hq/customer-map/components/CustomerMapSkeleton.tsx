"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** Loading placeholder shaped like the filter bar + map surface that follows. */
export function CustomerMapSkeleton() {
  return (
    <div className="space-y-6 p-2 sm:p-6 md:p-10 pt-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Card className="shadow-none border-border">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-56" />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-32" />
      </div>

      <Skeleton className="h-[60vh] min-h-[420px] w-full rounded-2xl" />
    </div>
  );
}
