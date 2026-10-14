"use client";

import * as React from "react";
import { GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";
import type { InventoryRow, LowStockState } from "../types";
import { computeSeverity, daysOfCover, inventoryValue } from "../utils/low-stock";
import type { ProductAggregate } from "../utils/aggregate";
import { ThresholdCell } from "./ThresholdCell";

const TONE_BY_STATE: Record<LowStockState, StatusTone> = {
  out: "destructive",
  critical: "destructive",
  low: "warning",
  watch: "info",
  healthy: "success",
  overstock: "neutral",
  dead: "neutral",
};

export interface ItemDrawerSelection {
  dealerId: string;
  productId: number;
}

interface ItemDrawerProps {
  selection: ItemDrawerSelection | null;
  aggregate: ProductAggregate | null;
  branchRows: InventoryRow[];
  network: ProductAggregate[];
  windowDays: number;
  leadDays: number;
  onCommit: (key: string, pieces: number) => void;
  onReset: (key: string) => void;
  onClose: () => void;
  onSelect: (dealerId: string, productId: number) => void;
}

function resolveUnit(unitName: string | undefined, unitCount: number): string {
  const unit = (unitName ?? "").trim();
  if (unit) return unit;
  return !unitCount || unitCount <= 1 ? "pcs" : "units";
}

function displayUnitsText(pieces: number, unitCount: number, unitName?: string): string {
  const unit = resolveUnit(unitName, unitCount);
  if (!unitCount || unitCount <= 0) return `${formatNumber(pieces, "en-PH", 0)} ${unit}`;
  const units = pieces / unitCount;
  const rounded = Math.round(units * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} ${unit} (${formatNumber(pieces, "en-PH", 0)} pcs)`;
}

function formatCutoff(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return formatDateTime(d);
}

/** Item drawer: detail, per-branch table, threshold editor, network compare. */
export function ItemDrawer({
  selection,
  aggregate,
  branchRows,
  network,
  windowDays,
  leadDays,
  onCommit,
  onReset,
  onClose,
  onSelect,
}: ItemDrawerProps) {
  const [showNetwork, setShowNetwork] = React.useState(false);

  React.useEffect(() => {
    setShowNetwork(false);
  }, [selection?.dealerId, selection?.productId]);

  const open = selection !== null && aggregate !== null;
  const firstRow = branchRows[0];
  const overrideKey = aggregate ? `${aggregate.dealerId}:${aggregate.productId}` : "";

  const branchView = React.useMemo(
    () =>
      branchRows.map((row) => {
        const doc = daysOfCover(row.onHand, row.demandQty, windowDays);
        const severity = computeSeverity({
          onHand: row.onHand,
          demandQty: row.demandQty,
          windowDays,
          movementAfter: row.movementAfter,
          effectiveMin: 0,
          unitCount: row.unitCount,
          leadDays,
          peerMedian: null,
          unitName: row.unitName,
        });
        return { row, doc, severity };
      }),
    [branchRows, leadDays, windowDays],
  );

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {aggregate && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="pr-8 text-base leading-tight">{aggregate.productName}</SheetTitle>
              <SheetDescription className="text-xs">
                {aggregate.productCode} · {aggregate.dealerName}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2 px-4">
              <StatusBadge tone={TONE_BY_STATE[aggregate.state]}>{aggregate.state}</StatusBadge>
              <span className="text-xs text-muted-foreground">{aggregate.reason}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 text-xs">
              <div><dt className="text-muted-foreground">Barcode</dt><dd className="truncate font-medium tabular-nums">{firstRow?.productBarcode || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Brand</dt><dd className="truncate font-medium">{aggregate.brand || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Category</dt><dd className="truncate font-medium">{aggregate.category || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Unit</dt><dd className="font-medium">{aggregate.unitName || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Pack size</dt><dd className="font-medium tabular-nums">{aggregate.unitCount > 0 ? `${formatNumber(aggregate.unitCount, "en-PH", 0)} pcs/${resolveUnit(aggregate.unitName, aggregate.unitCount)}` : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Supplier</dt><dd className="truncate font-medium">{firstRow?.supplierShortcut || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Cost / {resolveUnit(aggregate.unitName, aggregate.unitCount)}</dt><dd className="font-medium tabular-nums">{formatCurrency(aggregate.costPerUnit)}</dd></div>
              <div><dt className="text-muted-foreground">Total value</dt><dd className="font-medium tabular-nums">{formatCurrency(aggregate.value)}</dd></div>
            </dl>

            <div className="space-y-1 px-4">
              <p className="text-xs font-semibold">Reorder minimum</p>
              <ThresholdCell
                overrideKey={overrideKey}
                minPieces={aggregate.effectiveMin}
                source={aggregate.minSource}
                unitCount={aggregate.unitCount}
                unitName={aggregate.unitName}
                onCommit={onCommit}
                onReset={onReset}
              />
              <p className="text-[11px] text-muted-foreground">
                On hand {displayUnitsText(aggregate.onHand, aggregate.unitCount, aggregate.unitName)} across {aggregate.branchCount}{" "}
                {aggregate.branchCount === 1 ? "branch" : "branches"}.
              </p>
            </div>

            <div className="space-y-1.5 px-4">
              <p className="text-xs font-semibold">Per-branch stock</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[520px] border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-muted/60 text-left">
                      <th className="px-2 py-1.5 font-medium">Branch</th>
                      <th className="px-2 py-1.5 text-right font-medium">On hand</th>
                      <th className="px-2 py-1.5 text-right font-medium">Moved</th>
                      <th className="px-2 py-1.5 text-right font-medium">DoC</th>
                      <th className="px-2 py-1.5 font-medium">State</th>
                      <th className="px-2 py-1.5 text-right font-medium">Value</th>
                      <th className="px-2 py-1.5 font-medium">Last count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchView.map(({ row, doc, severity }) => (
                      <tr key={row.key} className="border-t">
                        <td className="max-w-28 truncate px-2 py-1.5 font-medium" title={row.branchName}>{row.branchName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatNumber(row.onHand, "en-PH", 0)}
                          <span className="block text-[10px] text-muted-foreground">
                            {row.unitCount > 0 ? `${(Math.round((row.onHand / row.unitCount) * 10) / 10).toFixed(1)} ${resolveUnit(row.unitName, row.unitCount)}` : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(row.movementAfter, "en-PH", 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{doc === null ? "—" : `${Math.round(doc * 10) / 10}d`}</td>
                        <td className="px-2 py-1.5">
                          <StatusBadge tone={TONE_BY_STATE[severity.state]}>{severity.state}</StatusBadge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCurrency(inventoryValue(row.onHand, row.unitCount, row.costPerUnit))}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {formatNumber(row.lastCount, "en-PH", 0)} · {formatCutoff(row.lastCutoff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-1.5 px-4 pb-4">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 text-xs"
                onClick={() => setShowNetwork((v) => !v)}
                aria-expanded={showNetwork}
              >
                <GitCompareArrows className="size-3.5" />
                {showNetwork ? "Hide network comparison" : "Compare across dealers"}
              </Button>
              {showNetwork && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[440px] border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-muted/60 text-left">
                        <th className="px-2 py-1.5 font-medium">Dealer</th>
                        <th className="px-2 py-1.5 text-right font-medium">On hand</th>
                        <th className="px-2 py-1.5 font-medium">State</th>
                        <th className="px-2 py-1.5 text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {network.map((peer) => (
                        <tr
                          key={peer.key}
                          className="cursor-pointer border-t hover:bg-muted/50"
                          onClick={() => onSelect(peer.dealerId, peer.productId)}
                        >
                          <td className="max-w-32 truncate px-2 py-1.5 font-medium" title={peer.dealerName}>
                            {peer.dealerName}
                            {peer.dealerId === aggregate.dealerId && (
                              <span className="text-muted-foreground"> (this)</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(peer.onHand, "en-PH", 0)}</td>
                          <td className="px-2 py-1.5">
                            <StatusBadge tone={TONE_BY_STATE[peer.state]}>{peer.state}</StatusBadge>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(peer.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
