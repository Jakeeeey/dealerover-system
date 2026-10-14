"use client";

import * as React from "react";
import type { LowStockBasis, LowStockPolicy } from "../types";

const STORAGE_KEY = "dealerover-hq.inventory-report.policy";

const DEFAULT_POLICY: LowStockPolicy = {
  basis: "policy",
  leadDays: 7,
  windowDays: 30,
  defaultMinCases: 0,
  categoryMin: {},
  overrides: {},
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function isValidPolicy(value: unknown): value is LowStockPolicy {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["basis"] !== "policy" && v["basis"] !== "maintain") return false;
  if (typeof v["leadDays"] !== "number" || typeof v["windowDays"] !== "number") return false;
  if (typeof v["defaultMinCases"] !== "number") return false;
  if (typeof v["categoryMin"] !== "object" || v["categoryMin"] === null) return false;
  if (typeof v["overrides"] !== "object" || v["overrides"] === null) return false;
  return true;
}

function readStored(): LowStockPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidPolicy(parsed)) return DEFAULT_POLICY;
    return {
      basis: parsed.basis,
      leadDays: clampInt(parsed.leadDays, 7, 1, 90),
      windowDays: clampInt(parsed.windowDays, 30, 7, 365),
      defaultMinCases: Math.max(0, Number(parsed.defaultMinCases) || 0),
      categoryMin: parsed.categoryMin,
      overrides: parsed.overrides,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

/**
 * Low-stock policy state, persisted to localStorage.
 * Overrides are keyed `dealerId:productId` and stored in pieces.
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

  const setBasis = React.useCallback(
    (basis: LowStockBasis) => persist({ ...policy, basis }),
    [persist, policy],
  );

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

  const setDefaultMinCases = React.useCallback(
    (defaultMinCases: number) =>
      persist({ ...policy, defaultMinCases: Math.max(0, Number(defaultMinCases) || 0) }),
    [persist, policy],
  );

  const setCategoryMin = React.useCallback(
    (category: string, cases: number) => {
      const next = { ...policy.categoryMin };
      if (!category.trim() || !(cases > 0)) {
        delete next[category];
      } else {
        next[category] = cases;
      }
      persist({ ...policy, categoryMin: next });
    },
    [persist, policy],
  );

  const setOverride = React.useCallback(
    (key: string, pieces: number) => {
      persist({ ...policy, overrides: { ...policy.overrides, [key]: Math.max(0, Math.round(pieces)) } });
    },
    [persist, policy],
  );

  const resetOverride = React.useCallback(
    (key: string) => {
      const next = { ...policy.overrides };
      delete next[key];
      persist({ ...policy, overrides: next });
    },
    [persist, policy],
  );

  return {
    policy,
    setBasis,
    setLeadDays,
    setWindowDays,
    setDefaultMinCases,
    setCategoryMin,
    setOverride,
    resetOverride,
  };
}
