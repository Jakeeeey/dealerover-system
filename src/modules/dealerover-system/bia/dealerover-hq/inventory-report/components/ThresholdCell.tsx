"use client";

import * as React from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ThresholdCellProps {
  overrideKey: string;
  minPieces: number;
  source: "maintain" | "override" | "category" | "policy";
  unitCount: number;
  unitName?: string;
  onCommit: (key: string, pieces: number) => void;
  onReset: (key: string) => void;
}

const SOURCE_LABEL: Record<ThresholdCellProps["source"], string> = {
  maintain: "Product maintain quantity",
  override: "Custom override (this item)",
  category: "Policy category minimum",
  policy: "Policy default minimum",
};

function resolveUnit(unitName: string | undefined, unitCount: number): string {
  const unit = (unitName ?? "").trim();
  if (unit) return unit;
  return !unitCount || unitCount <= 1 ? "pcs" : "units";
}

function toDisplayUnits(pieces: number, unitCount: number, unit: string): string {
  if (!unitCount || unitCount <= 0) return `${Math.round(pieces)} ${unit}`;
  const units = pieces / unitCount;
  const rounded = Math.round(units * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${unit}`;
}

/**
 * Effective-minimum cell: shows the threshold in display units (pieces on hover),
 * click-to-edit a display-unit quantity, Enter commits a pieces override, Esc cancels.
 */
export function ThresholdCell({ overrideKey, minPieces, source, unitCount, unitName, onCommit, onReset }: ThresholdCellProps) {
  const [editing, setEditing] = React.useState(false);
  const pack = unitCount > 0 ? unitCount : 0;
  const unit = resolveUnit(unitName, unitCount);
  const initialUnits = pack > 0 ? minPieces / pack : 0;
  const [draft, setDraft] = React.useState(String(Math.round(initialUnits * 100) / 100));

  React.useEffect(() => {
    if (editing) return;
    setDraft(String(Math.round(initialUnits * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minPieces, pack]);

  const commit = React.useCallback(() => {
    const units = Number(draft);
    if (!Number.isFinite(units) || units < 0) {
      setEditing(false);
      return;
    }
    onCommit(overrideKey, Math.round(units * (pack > 0 ? pack : 1)));
    setEditing(false);
  }, [draft, onCommit, overrideKey, pack]);

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <Input
          autoFocus
          type="number"
          min={0}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
          className="h-7 w-20 text-xs tabular-nums"
          aria-label={`Minimum ${unit}`}
        />
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs tabular-nums">
              {toDisplayUnits(minPieces, pack, unit)}
              <span className="text-muted-foreground"> · {Math.round(minPieces)} pcs</span>
            </span>
            {source === "override" && (
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                custom
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={() => {
                setDraft(String(Math.round(initialUnits * 100) / 100));
                setEditing(true);
              }}
              aria-label={`Edit minimum (${unit})`}
              title={`Edit minimum (${unit})`}
            >
              <Pencil className="size-3" />
            </Button>
            {source === "override" && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => onReset(overrideKey)}
                aria-label="Reset to inherited minimum"
                title="Reset to inherited minimum"
              >
                <RotateCcw className="size-3" />
              </Button>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className={cn("max-w-60 text-xs")}>
          {SOURCE_LABEL[source]} — {toDisplayUnits(minPieces, pack, unit)} ({Math.round(minPieces)} pcs).
          {source === "override" ? " Reset returns to the inherited value." : " Click the pencil to set a custom override."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
