"use client";

import type * as React from "react";
import type { StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { LowStockState } from "../types";
import { PILL_OVERRIDE, STATE_LABEL, TONE_BY_STATE, TONE_PILL } from "../utils/severity-tone";

const PILL_BASE =
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium";

/**
 * Module-local status pill.
 *
 * The house `StatusBadge` cannot carry a tone in this app: shadcn's `Badge`
 * defaults to the `default` variant, whose `bg-primary text-primary-foreground`
 * utilities outrank globals.css `.badge-*` component classes, so every tone
 * renders primary blue. House files are protected from module edits, so this
 * renders the same pill from utilities only — one tone contract, real colours.
 */
export function TonePill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn(PILL_BASE, TONE_PILL[tone], className)}>{children}</span>;
}

/**
 * A severity state rendered as a tone-correct pill, honouring the per-state
 * overrides that keep the grey family distinguishable.
 */
export function SeverityPill({
  state,
  className,
}: {
  state: LowStockState;
  className?: string;
}) {
  return (
    <span className={cn(PILL_BASE, PILL_OVERRIDE[state] ?? TONE_PILL[TONE_BY_STATE[state]], className)}>
      {STATE_LABEL[state]}
    </span>
  );
}
