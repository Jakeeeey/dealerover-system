"use client";

import { useEffect, useState } from "react";
import type { BoundaryHighlight } from "../components/CustomerMapView";
import { getBoundaryFeature } from "../providers/boundary-provider";

export type BoundaryLevel = "province" | "city" | "barangay";

export interface BoundarySelection {
  level: BoundaryLevel;
  name: string;
  /** Parent city — disambiguates duplicate barangay names. */
  city?: string;
  /** Parent province — disambiguates duplicate city/barangay names. */
  province?: string;
}

interface BoundaryState {
  key: string;
  data: BoundaryHighlight | null;
  isLoading: boolean;
}

/**
 * Loads the GeoJSON boundary for the active geo filter (province/city/brgy).
 * Returns null until a selection exists or when the boundary has no geometry.
 * @param {BoundarySelection | null} selection - Active boundary (null = none).
 * @returns {{ data: BoundaryHighlight | null; isLoading: boolean }} Boundary + status.
 */
export function useBoundaryFeature(selection: BoundarySelection | null) {
  const level = selection?.level ?? null;
  const name = selection?.name ?? "";
  const city = selection?.city ?? "";
  const province = selection?.province ?? "";

  // Empty key = no selection. The state resets during render (the sanctioned
  // "adjust state during render" pattern) so no effect-time setState is needed.
  const key =
    level && name.trim()
      ? `${level}|${name.trim()}|${city.trim()}|${province.trim()}`
      : "";
  const [state, setState] = useState<BoundaryState>({ key, data: null, isLoading: key !== "" });
  if (state.key !== key) {
    setState({ key, data: null, isLoading: key !== "" });
  }

  useEffect(() => {
    if (!key || !level || !name.trim()) return;
    const controller = new AbortController();
    const args: BoundarySelection = { level, name: name.trim() };
    if (city.trim()) args.city = city.trim();
    if (province.trim()) args.province = province.trim();

    getBoundaryFeature(args, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        setState({ key, data: payload, isLoading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[CustomerMap] Failed to load boundary highlight:", error);
        setState({ key, data: null, isLoading: false });
      });

    return () => controller.abort();
  }, [key, level, name, city, province]);

  return { data: state.key === key ? state.data : null, isLoading: state.key === key && state.isLoading };
}
