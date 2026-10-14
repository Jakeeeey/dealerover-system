"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as React from "react";
import { ChevronDown, ChevronUp, CircleAlert, MapPin, MapPinOff, X } from "lucide-react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
} from "maplibre-gl";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PopoverStageContent } from "./PopoverStageContent";
import { cn, formatNumber } from "@/lib/utils";
import type {
  CustomerMapBasemap,
  CustomerMapMarkerStyle,
  CustomerMapRow,
  DealerStatus,
} from "../types";
import { MARKER_STROKE_COLOR } from "../utils/dealer-colors";

const SOURCE_ID = "customer-points";
const HEAT_ID = "customer-heat";
const CIRCLE_ID = "customer-points-circle";

// Same-spot stack badges (dots view): customers within ~10 m share a grid
// cell; exactly one anchor per cell of 2+ renders a white ring + "N" badge
// above the dots so co-location is visible without switching to Clusters.
const STACK_GRID_DEG = 0.00003; // ~3 m: only (near-)identical spots group
const STACK_JITTER_RADIUS_DEG = 0.000045; // ~5 m fan-out radius for stacks

// Clustered copy of the same point set (a second source — never `cluster:true`
// on the dots source, or dots mode would break). Fed the same FeatureCollection
// whenever the filtered set changes.
const CLUSTER_SOURCE_ID = "customer-points-cluster";
const CLUSTER_CIRCLE_ID = "customer-cluster-circles";
const CLUSTER_COUNT_ID = "customer-cluster-count";
const CLUSTER_POINT_ID = "customer-cluster-points";

// Boundary highlight (selected province/city/barangay): a dark dim mask with
// the selection cut out as holes, an accent tint over the selection, and a
// multi-pass neon glow border (blurred halo stack + bright white core).
// Geometry is corner-cut (Chaikin) so the generalized source polygons read as
// smooth curves instead of angular segments. Rebuilt in `applyLayers` so
// basemap swaps keep them.
const BOUNDARY_SOURCE_ID = "boundary-highlight";
const DIM_SOURCE_ID = "boundary-dim-mask";
const DIM_ID = "boundary-dim";
const TINT_ID = "boundary-tint";
const GLOW_FAR_ID = "boundary-glow-far";
const GLOW_NEAR_ID = "boundary-glow-near";
/** Legacy id from the retired 3-pass halo — removed if still on the map. */
const GLOW_MID_LEGACY_ID = "boundary-glow-mid";
const LINE_ID = "boundary-line";
const CORE_ID = "boundary-core";
const BOUNDARY_LAYER_IDS = [
  DIM_ID,
  TINT_ID,
  GLOW_FAR_ID,
  GLOW_NEAR_ID,
  GLOW_MID_LEGACY_ID,
  LINE_ID,
  CORE_ID,
];
const BOUNDARY_SOURCE_IDS = [BOUNDARY_SOURCE_ID, DIM_SOURCE_ID];

/** Chaikin corner-cutting passes applied to the highlight rings (0 = off).
 * The detailed boundaries carry dense vertices, so a single light pass only
 * takes the residual angular edge off without visibly pulling the outline in. */
const BOUNDARY_SMOOTHING_ITERATIONS = 1;

/** Rings smaller than this absolute signed area (deg²) are dropped from the
 * highlight + dim mask, so tiny coastal islets/inlets no longer spray glow. */
const MIN_HIGHLIGHT_RING_AREA = 2e-6;

/** Loose GeoJSON boundary payload served by the boundary API route. */
export interface BoundaryHighlightGeometry {
  type: string;
  coordinates: unknown;
}

export interface BoundaryHighlightFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: BoundaryHighlightGeometry | null;
}

export interface BoundaryHighlight {
  type: "FeatureCollection";
  features: BoundaryHighlightFeature[];
}

// Basemaps from OpenFreeMap: keyless, no request caps, commercial use allowed,
// OpenMapTiles schema (a drop-in for MapLibre). Attribution is auto-added.
const BASEMAP_STYLES: Record<CustomerMapBasemap, string> = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  bright: "https://tiles.openfreemap.org/styles/bright",
  fiord: "https://tiles.openfreemap.org/styles/fiord",
};

type MappableData = Parameters<GeoJSONSource["setData"]>[0];

export interface DealerLegendItem {
  id: string;
  name: string;
  code: string;
  color: string;
}

interface CustomerFeatureProps {
  key: string;
  dealerId: string;
  dealerName: string;
  dealerCode: string;
  color: string;
  storeName: string;
  customerName: string;
  customerCode: string;
  storeType: string;
  classification: string;
  city: string;
  province: string;
  brgy: string;
  priceType: string;
  paymentTerm: string;
  isActive: number;
}

/** Map selection: one customer (detail card) or several stacked at one spot (list). */
type CustomerSelection =
  | { kind: "single"; customer: CustomerFeatureProps }
  | { kind: "list"; customers: CustomerFeatureProps[] };

/** Type guard for a rendered cluster feature (carries point_count/cluster_id). */
function isClusterFeature(properties: Record<string, unknown>): boolean {
  return properties.cluster_id !== undefined && properties.cluster_id !== null;
}

/** Dedupes rendered hits by `properties.key` — a feature can repeat across tiles. */
function dedupeHits(hits: { properties?: Record<string, unknown> | null }[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const hit of hits) {
    const props = hit.properties;
    if (!props) continue;
    // Cluster aggregates carry no customer key — keep them (deduped by cluster_id).
    const key = typeof props.key === "string" ? props.key : `cluster:${String(props.cluster_id)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(props);
  }
  return unique;
}

interface CustomerMapViewProps {
  customers: CustomerMapRow[];
  dealers: DealerLegendItem[];
  dealerStatuses: DealerStatus[];
  perDealerCounts: Record<string, number>;
  markerStyle: CustomerMapMarkerStyle;
  basemap: CustomerMapBasemap;
  /** Selected boundary highlight (null = none). Drives the dim/tint/glow layers. */
  boundaryHighlight?: BoundaryHighlight | null;
  /** Dealer ids in the filter (empty = all). Drives legend chip toggle state. */
  selectedDealerIds: string[];
  /** Flips one dealer's membership in the filter (empty array = all). */
  onToggleDealer: (dealerId: string) => void;
}

/**
 * Builds the render FeatureCollection. When `jitter` is true, customers that
 * share the same ~10 m grid cell are fanned around their spot on a small ring
 * (~15 m) so a stack reads as several distinct dots — sub-pixel when zoomed out
 * (so it never clutters) and a visible rosette as you zoom in. Cluster/heat
 * sources pass `jitter:false` so their aggregation uses the true positions.
 */
function buildMappableData(
  customers: CustomerMapRow[],
  colors: Record<string, string>,
  jitter = false,
): MappableData {
  const groups = new Map<string, number[]>();
  customers.forEach((customer, index) => {
    const gridKey = `${Math.floor(customer.lng / STACK_GRID_DEG)}:${Math.floor(customer.lat / STACK_GRID_DEG)}`;
    const members = groups.get(gridKey);
    if (members) members.push(index);
    else groups.set(gridKey, [index]);
  });

  const latOffset = new Array<number>(customers.length).fill(0);
  const lngOffset = new Array<number>(customers.length).fill(0);
  if (jitter) {
    for (const members of groups.values()) {
      const count = members.length;
      if (count < 2) continue;
      for (let j = 0; j < count; j += 1) {
        const index = members[j];
        const angle = (2 * Math.PI * j) / count;
        latOffset[index] = Math.sin(angle) * STACK_JITTER_RADIUS_DEG;
        const cosLat = Math.cos((customers[index].lat * Math.PI) / 180) || 1;
        lngOffset[index] = (Math.cos(angle) * STACK_JITTER_RADIUS_DEG) / cosLat;
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: customers.map((customer, index) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [customer.lng + lngOffset[index], customer.lat + latOffset[index]],
      },
      properties: {
        key: customer.key,
        dealerId: customer.dealerId,
        dealerName: customer.dealerName,
        dealerCode: customer.dealerCode,
        color: colors[customer.dealerId] ?? MARKER_STROKE_COLOR,
        storeName: customer.store_name,
        customerName: customer.customer_name,
        customerCode: customer.customer_code,
        storeType: customer.store_type_name,
        classification: customer.classification_name,
        city: customer.city,
        province: customer.province,
        brgy: customer.brgy,
        priceType: customer.price_type,
        paymentTerm: customer.payment_term,
        isActive: customer.isActive,
      },
    })),
  } as MappableData;
}

type LngLatBounds = [[number, number], [number, number]];

/** Bounding box of a boundary FeatureCollection's coordinates, or null. */
function boundsOfHighlight(highlight: BoundaryHighlight | null | undefined): LngLatBounds | null {
  if (!highlight || !Array.isArray(highlight.features) || highlight.features.length === 0) {
    return null;
  }
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const lng = coords[0] as number;
      const lat = coords[1] as number;
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      return;
    }
    for (const child of coords) visit(child);
  };
  for (const feature of highlight.features) {
    visit(feature.geometry?.coordinates);
  }
  return Number.isFinite(minLng) &&
    Number.isFinite(minLat) &&
    Number.isFinite(maxLng) &&
    Number.isFinite(maxLat)
    ? [
        [minLng, minLat],
        [maxLng, maxLat],
      ]
    : null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 whitespace-normal break-words">{value}</span>
    </div>
  );
}

type Ring = Array<[number, number]>;

function isRing(value: unknown): value is Ring {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    )
  );
}

/** Signed ring area: positive = counter-clockwise, negative = clockwise. */
function signedRingArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

function forceWinding(ring: Ring, clockwise: boolean): Ring {
  const isClockwise = signedRingArea(ring) < 0;
  if (isClockwise === clockwise) return ring;
  return [...ring].reverse() as Ring;
}

/**
 * Collects every exterior ring of the highlight (Polygon + MultiPolygon).
 * Interior holes of the selection itself are ignored — the mask only cuts
 * the selection's outer shape out of the world wash.
 */
function exteriorRings(highlight: BoundaryHighlight): Ring[] {
  const rings: Ring[] = [];
  for (const feature of highlight.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      const exterior: unknown = (geometry.coordinates as unknown[])[0];
      if (isRing(exterior)) rings.push(exterior);
    } else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      for (const polygon of geometry.coordinates as unknown[]) {
        const exterior: unknown = Array.isArray(polygon) ? polygon[0] : null;
        if (isRing(exterior)) rings.push(exterior);
      }
    }
  }
  return rings;
}

/** Chaikin corner-cutting on a closed ring — softens the angular, generalized
 * source boundaries into smooth curves. Two passes is a good visual balance. */
function chaikinClosed(ring: Ring, iterations: number): Ring {
  let pts = ring.slice();
  if (
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  ) {
    pts.pop();
  }
  for (let pass = 0; pass < iterations && pts.length >= 3; pass += 1) {
    const out: Ring = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25]);
      out.push([a[0] + (b[0] - a[0]) * 0.75, a[1] + (b[1] - a[1]) * 0.75]);
    }
    pts = out;
  }
  pts.push(pts[0]); // re-close the ring
  return pts;
}

/** Smoothed exterior rings of the selection (Polygon + MultiPolygon).
 * Negligible rings (tiny islets/inlets) are dropped so they never reach the
 * tint/glow layers or the dim-mask holes. */
function smoothedExteriorRings(highlight: BoundaryHighlight): Ring[] {
  const rings: Ring[] = [];
  for (const ring of exteriorRings(highlight)) {
    if (Math.abs(signedRingArea(ring)) < MIN_HIGHLIGHT_RING_AREA) continue;
    rings.push(
      BOUNDARY_SMOOTHING_ITERATIONS > 0
        ? chaikinClosed(ring, BOUNDARY_SMOOTHING_ITERATIONS)
        : ring,
    );
  }
  return rings;
}

/** Rebuilds the selection as smoothed polygons for the tint + glow layers. */
function buildSmoothedHighlight(highlight: BoundaryHighlight): MappableData | null {
  const rings = smoothedExteriorRings(highlight);
  if (rings.length === 0) return null;
  return {
    type: "FeatureCollection",
    features: rings.map((ring) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    })),
  } as unknown as MappableData;
}

/**
 * Builds the dim mask: a world-sized exterior with the (smoothed) selection
 * exterior rings cut out as clockwise holes, so everything OUTSIDE the
 * selection is washed while the selection itself stays bright.
 */
function buildDimMask(highlight: BoundaryHighlight): MappableData | null {
  const holes = smoothedExteriorRings(highlight);
  if (holes.length === 0) return null;
  const world: Ring = [
    [-180, -90],
    [180, -90],
    [180, 90],
    [-180, 90],
    [-180, -90],
  ];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [forceWinding(world, false), ...holes.map((ring) => forceWinding(ring, true))],
    },
    properties: {},
  } as unknown as MappableData;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(1, Math.max(0, s / 100));
  const light = Math.min(1, Math.max(0, l / 100));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const sector = ((Math.round(h) % 360) + 360) % 360;
  if (sector < 60) {
    r = c;
    g = x;
  } else if (sector < 120) {
    r = x;
    g = c;
  } else if (sector < 180) {
    g = c;
    b = x;
  } else if (sector < 240) {
    g = x;
    b = c;
  } else if (sector < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Reads the theme accent at runtime so the glow border matches light/dark.
 * NOTE: MapLibre paints live on a WebGL canvas, which cannot consume CSS
 * theme tokens (same reason the dealer palette uses explicit values) — the
 * theme value is resolved to a concrete colour here, with a hex fallback.
 * @returns {string} A MapLibre-compatible colour string.
 */
function resolveAccentColor(): string {
  const FALLBACK = "#1D4ED8";
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    if (!raw) return FALLBACK;
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^rgba?\(/.test(raw) || /^hsla?\(/.test(raw)) return raw;
    const triplet = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (triplet) {
      return hslToHex(Number(triplet[1]), Number(triplet[2]), Number(triplet[3]));
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * (Re)builds the boundary highlight layers: a dark dim mask (world wash with
 * the smoothed selection cut out), an accent tint over the selection, and a
 * multi-pass neon border (blurred halo stack + bright white core). Removes
 * everything when the highlight is null/empty. Layer order is enforced
 * bottom-to-top so the dim wash never covers the customer points.
 * @param {MapLibreMap} map - Live MapLibre instance.
 * @param {BoundaryHighlight | null} highlight - Selected boundary, if any.
 */
function applyBoundaryLayers(map: MapLibreMap, highlight: BoundaryHighlight | null): void {
  const hasSelection = Boolean(highlight && highlight.features.length > 0);
  const boundaryData = hasSelection && highlight ? buildSmoothedHighlight(highlight) : null;
  const mask = hasSelection && highlight ? buildDimMask(highlight) : null;

  if (!boundaryData || !mask) {
    for (const id of BOUNDARY_LAYER_IDS) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
      } catch {
        // Layer already gone with a style swap — nothing to do.
      }
    }
    for (const source of BOUNDARY_SOURCE_IDS) {
      try {
        if (map.getSource(source)) map.removeSource(source);
      } catch {
        // Source already gone with a style swap — nothing to do.
      }
    }
    return;
  }

  const existingBoundary = map.getSource(BOUNDARY_SOURCE_ID) as GeoJSONSource | undefined;
  if (!existingBoundary) map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: boundaryData });
  else existingBoundary.setData(boundaryData);

  const existingDim = map.getSource(DIM_SOURCE_ID) as GeoJSONSource | undefined;
  if (!existingDim) map.addSource(DIM_SOURCE_ID, { type: "geojson", data: mask });
  else existingDim.setData(mask);

  // Canvas paints (see resolveAccentColor) — re-read every apply so a
  // light/dark flip re-tones the glow without a basemap swap.
  const accent = resolveAccentColor();

  if (!map.getLayer(DIM_ID)) {
    map.addLayer({
      id: DIM_ID,
      type: "fill",
      source: DIM_SOURCE_ID,
      // Near-black wash so everything outside the selection is heavily darkened.
      paint: { "fill-color": "#000000", "fill-opacity": 0.85 },
    });
  }
  if (!map.getLayer(TINT_ID)) {
    map.addLayer({
      id: TINT_ID,
      type: "fill",
      source: BOUNDARY_SOURCE_ID,
      paint: { "fill-color": accent, "fill-opacity": 0.1 },
    });
  }
  if (map.getLayer(TINT_ID)) map.setPaintProperty(TINT_ID, "fill-color", accent);

  const glow = (id: string, width: number, blur: number, opacity: number) => {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: "line",
        source: BOUNDARY_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": accent,
          "line-width": width,
          "line-blur": blur,
          "line-opacity": opacity,
        },
      });
      return;
    }
    map.setPaintProperty(id, "line-color", accent);
    map.setPaintProperty(id, "line-width", width);
    map.setPaintProperty(id, "line-blur", blur);
    map.setPaintProperty(id, "line-opacity", opacity);
  };

  // Tight two-pass neon halo: small blurs keep coastlines crisp instead of
  // smearing a fuzzy fringe over every islet and inlet.
  glow(GLOW_FAR_ID, 18, 6, 0.5);
  glow(GLOW_NEAR_ID, 9, 2.5, 0.9);

  // Retired middle halo pass — left behind by older sessions/HMR.
  try {
    if (map.getLayer(GLOW_MID_LEGACY_ID)) map.removeLayer(GLOW_MID_LEGACY_ID);
  } catch {
    // Already gone — nothing to do.
  }

  if (!map.getLayer(LINE_ID)) {
    map.addLayer({
      id: LINE_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": accent, "line-width": 4.5, "line-opacity": 1 },
    });
  } else {
    map.setPaintProperty(LINE_ID, "line-color", accent);
  }

  // White-hot core — the neon tube.
  if (!map.getLayer(CORE_ID)) {
    map.addLayer({
      id: CORE_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 1.8,
        "line-blur": 0.3,
        "line-opacity": 0.95,
      },
    });
  }

  // Enforce bottom-to-top stacking: dim + tint wash the base map, then the border
  // (glow + line + core), then heat + customer points ON TOP so the border never
  // covers a data layer.
  for (const id of [
    DIM_ID,
    TINT_ID,
    GLOW_FAR_ID,
    GLOW_NEAR_ID,
    LINE_ID,
    CORE_ID,
    HEAT_ID,
    CIRCLE_ID,
    CLUSTER_CIRCLE_ID,
    CLUSTER_COUNT_ID,
    CLUSTER_POINT_ID,
  ]) {
    try {
      if (map.getLayer(id)) map.moveLayer(id);
    } catch {
      // Transient style race — recovered on the next apply.
    }
  }
}

/** Max dealer chips rendered inline in the legend pill — anything beyond
 * this lives in the "+N" popover, so the pill stays contained at 375px. */
const MAX_INLINE_DEALER_CHIPS = 4;

interface DealerToggleProps {
  dealer: DealerLegendItem;
  count: number;
  offline: boolean;
  active: boolean;
  onToggle: () => void;
}

function DealerDot({ color }: { color: string }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/** Inline pill chip — a filter toggle (colour dot + name + count). */
function DealerLegendChip({ dealer, count, offline, active, onToggle }: DealerToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={`${dealer.name} — ${active ? "click to hide" : "click to show"}`}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
        !active && "opacity-50",
      )}
    >
      <DealerDot color={dealer.color} />
      <span className="max-w-[110px] truncate" title={dealer.name}>
        {dealer.name}
      </span>
      {offline ? (
        <span className="font-medium text-destructive">offline</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">{formatNumber(count)}</span>
      )}
    </button>
  );
}

/** Full-width row inside the "+N" popover — same toggle, room for long names. */
function DealerLegendRow({ dealer, count, offline, active, onToggle }: DealerToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={`${dealer.name} — ${active ? "click to hide" : "click to show"}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
        !active && "opacity-50",
      )}
    >
      <DealerDot color={dealer.color} />
      <span className="min-w-0 flex-1 truncate text-left" title={dealer.name}>
        {dealer.name}
      </span>
      {offline ? (
        <span className="shrink-0 font-medium text-destructive">offline</span>
      ) : (
        <span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(count)}</span>
      )}
    </button>
  );
}

export function CustomerMapView({
  customers,
  dealers,
  dealerStatuses,
  perDealerCounts,
  markerStyle,
  basemap,
  boundaryHighlight = null,
  selectedDealerIds,
  onToggleDealer,
}: CustomerMapViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const appliedBasemapRef = React.useRef<CustomerMapBasemap | null>(null);
  const initialBasemapRef = React.useRef(basemap);
  const [mapReady, setMapReady] = React.useState(false);
  const [selected, setSelected] = React.useState<CustomerSelection | null>(null);
  const [legendOpen, setLegendOpen] = React.useState(true);

  const colors = React.useMemo(() => {
    const map: Record<string, string> = {};
    dealers.forEach((dealer) => {
      map[dealer.id] = dealer.color;
    });
    return map;
  }, [dealers]);

  const offlineDealers = React.useMemo(
    () => dealerStatuses.filter((status) => !status.online),
    [dealerStatuses],
  );

  const offlineDealerIds = React.useMemo(
    () => new Set(offlineDealers.map((status) => status.dealerId)),
    [offlineDealers],
  );
  // Empty selection = all dealers shown, so every chip reads active.
  const isDealerActive = (dealerId: string) =>
    selectedDealerIds.length === 0 || selectedDealerIds.includes(dealerId);
  const inlineDealers = dealers.slice(0, MAX_INLINE_DEALER_CHIPS);
  const overflowCount = dealers.length - inlineDealers.length;

  // Latest render values for the map's style/event callbacks (which outlive renders).
  const latest = React.useRef({
    customers,
    colors,
    markerStyle,
    boundaryHighlight,
  });
  latest.current = { customers, colors, markerStyle, boundaryHighlight };

  // (Re)builds the source + layers and applies visibility. Called on the initial
  // style load, after every basemap style swap, and on data/style changes. No
  // `isStyleLoaded` gate: during `style.load` that can read false and would skip
  // the re-add (leaving the map blank until the next render) — try/catch instead.
  const applyLayers = React.useCallback((map: MapLibreMap) => {
    const state = latest.current;
    try {
      // Dots fan stacked customers out (jitter); clusters keep true positions.
      const data = buildMappableData(state.customers, state.colors, true);
      const clusterData = buildMappableData(state.customers, state.colors, false);
      const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!existing) map.addSource(SOURCE_ID, { type: "geojson", data });
      else existing.setData(data);

      // Clustered twin of the dots source — MapLibre aggregates nearby points
      // into point_count clusters, using the TRUE positions (no jitter). Kept as
      // a separate source so the dots source stays unclustered for dots/heatmap.
      const existingCluster = map.getSource(CLUSTER_SOURCE_ID) as GeoJSONSource | undefined;
      if (!existingCluster) {
        map.addSource(CLUSTER_SOURCE_ID, {
          type: "geojson",
          data: clusterData,
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 14,
        });
      } else {
        existingCluster.setData(clusterData);
      }

      if (!map.getLayer(HEAT_ID)) {
        map.addLayer({
          id: HEAT_ID,
          type: "heatmap",
          source: SOURCE_ID,
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 1.1],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 18, 12, 34],
            "heatmap-opacity": 0.85,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(37,99,235,0)",
              0.28, "rgba(37,99,235,0.55)",
              0.5, "#22c55e",
              0.7, "#eab308",
              0.88, "#f97316",
              1, "#ef4444",
            ],
          },
        });
      }

      if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
          id: CIRCLE_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 5, 12, 7, 16, 10],
            "circle-stroke-color": MARKER_STROKE_COLOR,
            "circle-stroke-width": 1,
            "circle-opacity": 0.9,
          },
        });
      }

      if (!map.getLayer(CLUSTER_CIRCLE_ID)) {
        map.addLayer({
          id: CLUSTER_CIRCLE_ID,
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            // Canvas paints (see resolveAccentColor) — explicit Okabe–Ito-ish
            // steps by cluster size; theme tokens cannot reach WebGL.
            "circle-color": ["step", ["get", "point_count"], "#0072B2", 10, "#E69F00", 50, "#D55E00"],
            "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 26],
            "circle-opacity": 0.85,
            "circle-stroke-color": MARKER_STROKE_COLOR,
            "circle-stroke-width": 1.5,
          },
        });
      }

      if (!map.getLayer(CLUSTER_COUNT_ID)) {
        map.addLayer({
          id: CLUSTER_COUNT_ID,
          type: "symbol",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
          },
          // No text-font: the OpenFreeMap styles supply the glyphs and MapLibre
          // falls back to the style default — an invented stack would break labels.
          paint: { "text-color": "#ffffff" },
        });
      }

      if (!map.getLayer(CLUSTER_POINT_ID)) {
        map.addLayer({
          id: CLUSTER_POINT_ID,
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 5, 12, 7, 16, 10],
            "circle-stroke-color": MARKER_STROKE_COLOR,
            "circle-stroke-width": 1,
            "circle-opacity": 0.9,
          },
        });
      }

      const show = (id: string, visible: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      };
      const isHeat = state.markerStyle === "heatmap";
      const isClusters = state.markerStyle === "clusters";
      const isDots = !isHeat && !isClusters;
      show(HEAT_ID, isHeat);
      show(CIRCLE_ID, isDots);
      show(CLUSTER_CIRCLE_ID, isClusters);
      show(CLUSTER_COUNT_ID, isClusters);
      show(CLUSTER_POINT_ID, isClusters);

      applyBoundaryLayers(map, state.boundaryHighlight);
    } catch {
      // Transient style races are recovered on the next style.load / idle / render.
    }
  }, []);

  // MapLibre touches the DOM/WebGL, so it is imported only in the browser and
  // the map instance is created once for the component's lifetime.
  React.useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    const init = async () => {
      const mod = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      const maplibregl = mod.default;

      const instance = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLES[initialBasemapRef.current],
        center: [121.1, 15.9],
        zoom: 7,
        attributionControl: { compact: true },
      });
      map = instance;
      mapRef.current = instance;
      appliedBasemapRef.current = initialBasemapRef.current;

      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      instance.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-left");

      // Generic handlers survive style swaps (layer-bound handlers do not).
      // Hit layers follow the active style: dots read the plain circle layer,
      // clusters read the cluster aggregates + unclustered points, heatmap has
      // no clickable features.
      const hitLayers = (): string[] => {
        const style = latest.current.markerStyle;
        if (style === "heatmap") return [];
        const ids =
          style === "clusters" ? [CLUSTER_CIRCLE_ID, CLUSTER_POINT_ID] : [CIRCLE_ID];
        return ids.filter((id) => {
          try {
            return Boolean(instance.getLayer(id));
          } catch {
            return false;
          }
        });
      };
      instance.on("click", (event: MapMouseEvent) => {
        void (async () => {
          const layers = hitLayers();
          if (layers.length === 0) {
            setSelected(null);
            return;
          }
          const hits = instance.queryRenderedFeatures(event.point, { layers });
          const unique = dedupeHits(hits);
          if (unique.length === 0) {
            setSelected(null);
            return;
          }
          // A cluster aggregate expands to its leaf customers via the source.
          const clusterHit = unique.find((props) => isClusterFeature(props));
          if (clusterHit) {
            const clusterId = Number(clusterHit.cluster_id);
            try {
              const source = instance.getSource(CLUSTER_SOURCE_ID) as
                | GeoJSONSource
                | undefined;
              const leaves =
                source && typeof source.getClusterLeaves === "function"
                  ? await source.getClusterLeaves(clusterId, Infinity, 0)
                  : [];
              const leafProps = dedupeHits(
                leaves.map((leaf) => ({
                  properties: (leaf.properties ?? {}) as Record<string, unknown>,
                })),
              );
              const leafCustomers = leafProps.filter(
                (props) => typeof props.key === "string",
              ) as unknown as CustomerFeatureProps[];
              if (leafCustomers.length > 1) {
                setSelected({ kind: "list", customers: leafCustomers });
                return;
              }
              if (leafCustomers.length === 1) {
                setSelected({ kind: "single", customer: leafCustomers[0] });
                return;
              }
            } catch {
              // Cluster expansion failed — fall through to the point hits below.
            }
          }
          const points = unique.filter(
            (props) => typeof props.key === "string",
          ) as unknown as CustomerFeatureProps[];
          if (points.length > 1) setSelected({ kind: "list", customers: points });
          else if (points.length === 1) setSelected({ kind: "single", customer: points[0] });
          else setSelected(null);
        })();
      });
      instance.on("mousemove", (event: MapMouseEvent) => {
        const layers = hitLayers();
        const hits = layers.length ? instance.queryRenderedFeatures(event.point, { layers }) : [];
        instance.getCanvas().style.cursor = hits.length ? "pointer" : "";
      });

      // Fires on the initial load and after every setStyle — re-adds the layers.
      instance.on("style.load", () => {
        applyLayers(instance);
      });

      instance.on("load", () => {
        setMapReady(true);
      });
    };

    void init();

    return () => {
      cancelled = true;
      mapRef.current = null;
      map?.remove();
    };
  }, [applyLayers]);

  // Swap the basemap when the user changes it. Re-adds layers on style.load, with
  // an `idle` fallback so the data layers never stay blank after a theme switch.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    map.setStyle(BASEMAP_STYLES[basemap]);
    const onIdle = () => applyLayers(map);
    map.once("idle", onIdle);
  }, [basemap, mapReady, applyLayers]);

  // Refresh the data + layer visibility when the filtered set or style changes.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyLayers(map);
  }, [customers, colors, markerStyle, boundaryHighlight, mapReady, applyLayers]);

  // Re-tone the glow when light/dark flips (next-themes toggles the class on
  // <html> without reloading the map style, so applyLayers would not re-run).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const observer = new MutationObserver(() => {
      const live = mapRef.current;
      if (live) applyLayers(live);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [mapReady, applyLayers]);

  // Refit bounds and drop a now-hidden selection when the filtered set changes.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSelected((previous) => {
      if (!previous) return previous;
      if (previous.kind === "single") {
        return customers.some((customer) => customer.key === previous.customer.key)
          ? previous
          : null;
      }
      const remaining = previous.customers.filter((choice) =>
        customers.some((customer) => customer.key === choice.key),
      );
      if (remaining.length === 0) return null;
      return remaining.length === previous.customers.length
        ? previous
        : { kind: "list", customers: remaining };
    });
    // Prefer the selected boundary's extent (a Location filter) so the whole
    // province / city / barangay is framed; fall back to the customers' extent
    // for attribute-only filters.
    let bounds = boundsOfHighlight(boundaryHighlight);
    if (!bounds && customers.length > 0) {
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const customer of customers) {
        minLng = Math.min(minLng, customer.lng);
        maxLng = Math.max(maxLng, customer.lng);
        minLat = Math.min(minLat, customer.lat);
        maxLat = Math.max(maxLat, customer.lat);
      }
      bounds = [
        [minLng, minLat],
        [maxLng, maxLat],
      ];
    }
    if (bounds) {
      // The zoom ceiling is high so small cities / barangays still fill the view
      // (vector tiles overzoom crisply); the left padding keeps the region clear
      // of the floating sidebar on desktop.
      const sidebarInset =
        typeof window !== "undefined" && window.innerWidth >= 1024 ? 336 : 0;
      map.fitBounds(bounds, {
        padding: { top: 72, bottom: 72, left: 56 + sidebarInset, right: 56 },
        maxZoom: 18,
        duration: 600,
      });
    }
  }, [customers, boundaryHighlight, mapReady]);

  // Full-bleed stage: the map is the base layer (z-0) and every strip is a
  // floating glass overlay — offline pill top-center (z-10), legend pill
  // bottom-center (z-10), empty/loading centered (z-10), detail card offset
  // below the top-right toolbar (z-30). The page owns the higher zones
  // (sidebar + toolbar at z-20).
  return (
    <div className="absolute inset-0 bg-muted">
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="region"
          aria-label="Customer location map"
        />
      </div>

      {offlineDealers.length > 0 && (
        <div className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-destructive/30 bg-card/85 py-1.5 pl-3 pr-3 text-xs text-destructive shadow-lg backdrop-blur-md">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate" title={offlineDealers.map((d) => d.dealerName).join(", ")}>
            {offlineDealers.map((dealer) => dealer.dealerName).join(", ")}{" "}
            {offlineDealers.length === 1 ? "is" : "are"} offline — their customers are hidden.
          </span>
        </div>
      )}

      {!mapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
          <span className="text-sm text-muted-foreground">Loading map…</span>
        </div>
      )}

      {mapReady && customers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/85 px-6 py-6 text-center shadow-lg backdrop-blur-md">
            <MapPinOff className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No customers match the current filters.</p>
            <p className="text-xs text-muted-foreground">Adjust the filters to widen the result set.</p>
          </div>
        </div>
      )}

      {selected?.kind === "single" && (
        <div className="absolute right-3 top-[4.5rem] z-30 w-[min(20rem,calc(100%-1.5rem))]">
          <div className="rounded-xl border border-border/60 bg-card/85 p-4 shadow-lg backdrop-blur-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: selected.customer.color }} />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      title={selected.customer.storeName || selected.customer.customerName}
                    >
                      {selected.customer.storeName || selected.customer.customerName || "Customer"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={selected.customer.customerCode}>
                      {selected.customer.customerName}
                      {selected.customer.customerCode ? ` · ${selected.customer.customerCode}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Close customer details"
                  title="Close customer details"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 space-y-1.5 border-t pt-3">
                <DetailRow label="Dealer" value={selected.customer.dealerName} />
                <DetailRow label="Store type" value={selected.customer.storeType} />
                <DetailRow label="Class" value={selected.customer.classification} />
                <DetailRow
                  label="City"
                  value={[selected.customer.city, selected.customer.province].filter(Boolean).join(", ")}
                />
                <DetailRow label="Barangay" value={selected.customer.brgy} />
                <DetailRow label="Price type" value={selected.customer.priceType} />
                <DetailRow label="Payment term" value={selected.customer.paymentTerm} />
              </div>
            </div>
          </div>
        )}

      {/* Stacked-spot list: every customer rendered at the clicked point or
          inside the clicked cluster. Picking a row opens that customer's card. */}
      {selected?.kind === "list" && (
        <div className="absolute right-3 top-[4.5rem] z-30 w-[min(20rem,calc(100%-1.5rem))]">
          <div className="rounded-xl border border-border/60 bg-card/85 p-4 shadow-lg backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={`${selected.customers.length} customers at this location`}>
                  <span className="tabular-nums">{formatNumber(selected.customers.length)}</span>{" "}
                  customers at this location
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Select one to see details
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close customer list"
                title="Close customer list"
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto border-t pt-3">
              {selected.customers.map((customer) => (
                <li key={customer.key}>
                  <button
                    type="button"
                    onClick={() => setSelected({ kind: "single", customer })}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                    aria-label={`Show details for ${customer.storeName || customer.customerName}`}
                    title={customer.storeName || customer.customerName}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                      style={{ backgroundColor: customer.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-xs font-medium"
                        title={customer.storeName || customer.customerName}
                      >
                        {customer.storeName || customer.customerName || "Customer"}
                      </span>
                      <span
                        className="block truncate text-xs tabular-nums text-muted-foreground"
                        title={[customer.customerName, customer.customerCode].filter(Boolean).join(" · ")}
                      >
                        {customer.customerName}
                        {customer.customerCode ? ` · ${customer.customerCode}` : ""}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground" title={customer.dealerName}>
                        {customer.dealerName}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Dealer legend pill — floats bottom-center. The total is plain text;
          each chip is a filter toggle (colour dot + name + count). At most 4
          chips render inline; the rest live in a "+N" popover, so the pill
          stays contained instead of scrolling endlessly. */}
      <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/85 px-3 py-2 shadow-lg backdrop-blur-md">
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {formatNumber(customers.length)}
          </span>{" "}
          plotted
        </span>

        {dealers.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setLegendOpen((open) => !open)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={legendOpen ? "Hide dealer legend" : "Show dealer legend"}
              title={legendOpen ? "Hide dealer legend" : "Show dealer legend"}
              aria-expanded={legendOpen}
            >
              {legendOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {legendOpen && (
              <>
                <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
                <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                  {inlineDealers.map((dealer) => (
                    <li key={dealer.id} className="shrink-0">
                      <DealerLegendChip
                        dealer={dealer}
                        count={perDealerCounts[dealer.id] ?? 0}
                        offline={offlineDealerIds.has(dealer.id)}
                        active={isDealerActive(dealer.id)}
                        onToggle={() => onToggleDealer(dealer.id)}
                      />
                    </li>
                  ))}
                </ul>
                {overflowCount > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={`Show ${overflowCount} more dealers`}
                        title={`Show ${overflowCount} more dealers`}
                      >
                        +{overflowCount}
                      </button>
                    </PopoverTrigger>
                    <PopoverStageContent side="top" align="center" className="w-[260px] p-1">
                      <ul className="max-h-64 overflow-y-auto overscroll-contain">
                        {dealers.map((dealer) => (
                          <li key={dealer.id}>
                            <DealerLegendRow
                              dealer={dealer}
                              count={perDealerCounts[dealer.id] ?? 0}
                              offline={offlineDealerIds.has(dealer.id)}
                              active={isDealerActive(dealer.id)}
                              onToggle={() => onToggleDealer(dealer.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    </PopoverStageContent>
                  </Popover>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
