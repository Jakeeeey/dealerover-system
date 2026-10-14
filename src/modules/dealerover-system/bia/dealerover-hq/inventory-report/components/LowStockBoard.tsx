"use client";

import * as React from "react";
import { ArrowDownWideNarrow, ChevronLeft, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { getDealerColor } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/utils/dealer-colors";
import type { DealerStatus, LowStockState } from "../types";
import { SEVERITY_RANK, type ProductAggregate } from "../utils/aggregate";
import { CELL_WASH, STATE_LABEL, STRIP_BG, TONE_BY_STATE } from "../utils/severity-tone";

interface LowStockBoardProps {
  aggregates: ProductAggregate[];
  dealers: DealerStatus[];
  onSelect: (dealerId: string, productId: number) => void;
  title?: string;
  emptyHint?: string;
}

const GRID_CAP = 48;
const PAGE_SIZE = 10;

function matches(item: ProductAggregate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${item.productName} ${item.productCode} ${item.brand} ${item.category}`.toLowerCase().includes(q);
}

function unitNameOf(item: ProductAggregate): string {
  const unit = (item.unitName ?? "").trim();
  if (unit) return unit;
  return !item.unitCount || item.unitCount <= 1 ? "pcs" : "units";
}

function inUnits(pieces: number, item: ProductAggregate): string {
  if (!item.unitCount || item.unitCount <= 0) return `${formatNumber(pieces, "en-PH", 0)} ${unitNameOf(item)}`;
  const units = pieces / item.unitCount;
  const rounded = Math.round(units * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${unitNameOf(item)}`;
}

function coverLabel(daysOfCover: number | null): string {
  if (daysOfCover === null) return "—";
  const rounded = Math.round(daysOfCover * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}d`;
}

export function LowStockBoard({ aggregates, dealers, onSelect, title, emptyHint }: LowStockBoardProps) {
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [query, setQuery] = React.useState("");
  const [sortByValue, setSortByValue] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const onlineDealers = React.useMemo(() => dealers.filter((d) => d.online), [dealers]);
  const dealerIndex = React.useMemo(() => {
    const map = new Map<string, number>();
    dealers.forEach((d, i) => map.set(d.dealerId, i));
    return map;
  }, [dealers]);
  const dealerById = React.useMemo(() => new Map(dealers.map((d) => [d.dealerId, d])), [dealers]);

  const filtered = React.useMemo(() => {
    const list = aggregates.filter((a) => matches(a, query));
    list.sort((a, b) => {
      const rank = SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state];
      if (rank !== 0 && !sortByValue) return rank;
      const valueGap = b.value - a.value;
      if (sortByValue) return valueGap || rank;
      return rank || valueGap;
    });
    return list;
  }, [aggregates, query, sortByValue]);

  const presentStates = React.useMemo(() => {
    const seen = new Set<LowStockState>();
    for (const a of filtered) seen.add(a.state);
    return Array.from(seen).sort((x, y) => SEVERITY_RANK[x] - SEVERITY_RANK[y]);
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = React.useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const gridProducts = React.useMemo(() => filtered.slice(0, GRID_CAP), [filtered]);
  const productCodes = React.useMemo(() => {
    const seen = new Set<string>();
    for (const a of gridProducts) {
      const code = a.productCode || `id:${a.productId}`;
      if (!seen.has(code)) seen.add(code);
    }
    return Array.from(seen);
  }, [gridProducts]);
  const cellByDealerProduct = React.useMemo(() => {
    const map = new Map<string, ProductAggregate>();
    for (const a of aggregates) {
      const code = a.productCode || `id:${a.productId}`;
      map.set(`${a.dealerId}::${code}`, a);
    }
    return map;
  }, [aggregates]);

  return (
    <section aria-label={title ?? "Low-stock board"} className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-0.5 self-start rounded-lg border border-border p-0.5" role="group" aria-label="Board view">
          <Button
            variant={view === "grid" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs min-h-11 md:min-h-0"
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
          >
            <LayoutGrid className="size-3.5" />
            Grid
          </Button>
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs min-h-11 md:min-h-0"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <List className="size-3.5" />
            List
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Filter products…"
              className="h-8 pl-7 text-xs"
              aria-label="Filter board products"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setSortByValue((v) => !v);
              setPage(1);
            }}
            aria-pressed={sortByValue}
            title={sortByValue ? "Sort by severity" : "Sort by value at risk"}
          >
            <ArrowDownWideNarrow className="size-3.5" />
            {sortByValue ? "Value" : "Severity"}
          </Button>
        </div>
      </div>

      {presentStates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Severity legend">
          {presentStates.map((state) => (
            <span
              key={state}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                CELL_WASH[state],
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", STRIP_BG[state])} />
              {STATE_LABEL[state]}
            </span>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No products match this filter</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {emptyHint ?? "Clear the search or pick a different dealer set to see low-stock signals."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="bg-muted/60">
                <th className="sticky left-0 max-w-52 truncate bg-muted px-3 py-2 text-left font-medium">
                  Product
                </th>
                {onlineDealers.map((dealer) => (
                  <th key={dealer.dealerId} className="min-w-28 px-2 py-2 text-center font-medium">
                    <span className="inline-flex max-w-28 items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: getDealerColor(dealerIndex.get(dealer.dealerId) ?? 0) }}
                        aria-hidden
                      />
                      <span className="truncate" title={dealer.dealerName}>
                        {dealer.dealerName}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productCodes.map((code) => {
                const label = gridProducts.find((a) => (a.productCode || `id:${a.productId}`) === code);
                return (
                  <tr key={code} className="border-t">
                    <td className="sticky left-0 max-w-52 bg-background px-3 py-1.5">
                      <span className="block truncate font-medium" title={label?.productName}>
                        {label?.productName || code}
                      </span>
                      <span className="block truncate font-mono text-[10px] uppercase tabular-nums text-muted-foreground">
                        {code}
                      </span>
                    </td>
                    {onlineDealers.map((dealer) => {
                      const cell = cellByDealerProduct.get(`${dealer.dealerId}::${code}`);
                      if (!cell) return <td key={dealer.dealerId} className="px-2 py-1.5 text-center text-muted-foreground">—</td>;
                      const dealerName = dealerById.get(cell.dealerId)?.dealerName ?? cell.dealerName;
                      return (
                        <td key={dealer.dealerId} className="px-1 py-1 text-center">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => onSelect(cell.dealerId, cell.productId)}
                                  title={`${cell.productName} at ${dealerName}: ${formatNumber(cell.onHand, "en-PH", 0)} pcs on hand (${inUnits(cell.onHand, cell)}), ${cell.reason}, ${formatCurrency(cell.value)} at risk.`}
                                  className={cn(
                                    "w-full rounded-md px-2 py-1.5 text-[11px] font-medium tabular-nums transition-[transform,opacity,box-shadow] duration-150 hover:opacity-80 hover:ring-2 hover:ring-ring/40 focus-visible:outline-2 focus-visible:outline-ring",
                                    CELL_WASH[cell.state],
                                  )}
                                  aria-label={`${cell.productName} at ${dealerName}: ${STATE_LABEL[cell.state]}, ${cell.reason}`}
                                >
                                  {cell.state === "out" ? "OUT" : formatNumber(cell.onHand, "en-PH", 0)}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-56 text-xs">
                                {cell.productName} — {cell.reason}. Value at risk {formatCurrency(cell.value)}.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > GRID_CAP && (
            <p className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              Showing the {GRID_CAP} most urgent of {formatNumber(filtered.length, "en-PH", 0)} products — use List view or filter to narrow down.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <thead>
                <tr className="bg-muted/60 text-left">
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Dealer</th>
                  <th className="px-3 py-2 text-right font-medium">On hand</th>
                  <th className="px-3 py-2 text-right font-medium">Days cover</th>
                  <th className="px-3 py-2 text-right font-medium">Value at risk</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) => (
                  <tr
                    key={item.key}
                    className="cursor-pointer border-t transition-opacity duration-150 hover:bg-muted/50"
                    onClick={() => onSelect(item.dealerId, item.productId)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(item.dealerId, item.productId);
                    }}
                  >
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={TONE_BY_STATE[item.state]}>{STATE_LABEL[item.state]}</StatusBadge>
                    </td>
                    <td className="max-w-56 px-3 py-1.5">
                      <span className="block truncate font-medium" title={item.productName}>{item.productName}</span>
                      <span className="block truncate font-mono text-[10px] uppercase tabular-nums text-muted-foreground">{item.productCode}</span>
                    </td>
                    <td className="max-w-40 truncate px-3 py-1.5" title={item.dealerName}>{item.dealerName}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {inUnits(item.onHand, item)}
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {formatNumber(item.onHand, "en-PH", 0)} pcs
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{coverLabel(item.daysOfCover)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(item.value)}</td>
                    <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground" title={item.reason}>
                      {item.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs tabular-nums text-muted-foreground">
                Showing {formatNumber(rangeStart, "en-PH", 0)}–{formatNumber(rangeEnd, "en-PH", 0)} of{" "}
                {formatNumber(filtered.length, "en-PH", 0)} products
              </p>
              <nav aria-label="Low-stock list pages" className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPage((p) => Math.max(1, Math.min(p, totalPages) - 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground">
                  Page {formatNumber(safePage, "en-PH", 0)} of {formatNumber(totalPages, "en-PH", 0)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setPage((p) => Math.min(totalPages, Math.min(p, totalPages) + 1))}
                  disabled={safePage === totalPages}
                  aria-label="Next page"
                  title="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </nav>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
