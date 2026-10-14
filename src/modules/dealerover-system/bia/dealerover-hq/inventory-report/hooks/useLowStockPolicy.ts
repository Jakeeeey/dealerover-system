"use client";

import * as React from "react";
import type { LowStockPolicy } from "../types";

const STORAGE_KEY = "dealerover-hq.inventory-report.policy";

const DEFAULT_POLICY: LowStockPolicy = {
  leadDays: 7,
  windowDays: 30,
  lookbackDays: 90,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function isValidPolicy(value: unknown): value is LowStockPolicy {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["leadDays"] !== "number") return false;
  if (typeof v["windowDays"] !== "number") return false;
  if (typeof v["lookbackDays"] !== "number") return false;
  return true;
}

function readStored(): LowStockPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPolicy(parsed)) return DEFAULT_POLICY;
    return {
      leadDays: clampInt(parsed.leadDays, 7, 1, 90),
      windowDays: clampInt(parsed.windowDays, 30, 7, 365),
      lookbackDays: clampInt(parsed.lookbackDays, 90, 30, 365),
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

/**
 * Analytics parameters, persisted to localStorage. There are deliberately
 * no configured minimums: a product's state comes from its own sales
 * history, never from a hand-set threshold.
 */
export function useLowStockPolicy() {
  const [policy, setPolicy] = React.useState<LowStockPolicy>(DEFAULT_POLICY);

  React.useEffect(() => {
    setPolicy(readStored());
  }, []);

  const persist = React.useCallback((next: LowStockPolicy) => {
    setPolicy(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const setLeadDays = React.useCallback(
    (leadDays: number) =>
      persist({ ...policy, leadDays: clampInt(leadDays, policy.leadDays, 1, 90) }),
    [persist, policy],
  );

  const setWindowDays = React.useCallback(
    (windowDays: number) =>
      persist({ ...policy, windowDays: clampInt(windowDays, policy.windowDays, 7, 365) }),
    [persist, policy],
  );

  const setLookbackDays = React.useCallback(
    (lookbackDays: number) =>
      persist({ ...policy, lookbackDays: clampInt(lookbackDays, policy.lookbackDays, 30, 365) }),
    [persist, policy],
  );

  return {
    policy,
    setLeadDays,
    setWindowDays,
    setLookbackDays,
  };
}
