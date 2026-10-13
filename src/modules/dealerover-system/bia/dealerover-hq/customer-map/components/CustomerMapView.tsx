"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as React from "react";
import { CircleAlert, MapPin, MapPinOff, X } from "lucide-react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
} from "maplibre-gl";
import { formatNumber } from "@/lib/utils";
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
const GLOW_MID_ID = "boundary-glow-mid";
const GLOW_NEAR_ID = "boundary-glow-near";
const LINE_ID = "boundary-line";
const CORE_ID = "boundary-core";
const BOUNDARY_LAYER_IDS = [
  DIM_ID,
  TINT_ID,
  GLOW_FAR_ID,
  GLOW_MID_ID,
  GLOW_NEAR_ID,
  LINE_ID,
  CORE_ID,
];
const BOUNDARY_SOURCE_IDS = [BOUNDARY_SOURCE_ID, DIM_SOURCE_ID];

/** Chaikin corner-cutting passes applied to the highlight rings (0 = off).
 * The detailed boundaries carry dense vertices, so a single light pass only
 * takes the residual angular edge off without visibly pulling the outline in. */
const BOUNDARY_SMOOTHING_ITERATIONS = 1;

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

interface CustomerMapViewProps {
  customers: CustomerMapRow[];
  dealers: DealerLegendItem[];
  dealerStatuses: DealerStatus[];
  perDealerCounts: Record<string, number>;
  markerStyle: CustomerMapMarkerStyle;
  basemap: CustomerMapBasemap;
  /** Selected boundary highlight (null = none). Drives the dim/tint/glow layers. */
  boundaryHighlight?: BoundaryHighlight | null;
}

function buildMappableData(
  customers: CustomerMapRow[],
  colors: Record<string, string>,
): MappableData {
  return {
    type: "FeatureCollection",
    features: customers.map((customer) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [customer.lng, customer.lat] },
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

/** Smoothed exterior rings of the selection (Polygon + MultiPolygon). */
function smoothedExteriorRings(highlight: BoundaryHighlight): Ring[] {
  return exteriorRings(highlight).map((ring) =>
    BOUNDARY_SMOOTHING_ITERATIONS > 0
      ? chaikinClosed(ring, BOUNDARY_SMOOTHING_ITERATIONS)
      : ring,
  );
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

  // Neon halo: far → near, growing brightness.
  glow(GLOW_FAR_ID, 34, 20, 0.45);
  glow(GLOW_MID_ID, 20, 12, 0.65);
  glow(GLOW_NEAR_ID, 11, 5, 0.9);

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

  // Enforce bottom-to-top stacking: dim + tint under the points, glow above.
  for (const id of [
    DIM_ID,
    TINT_ID,
    HEAT_ID,
    CIRCLE_ID,
    GLOW_FAR_ID,
    GLOW_MID_ID,
    GLOW_NEAR_ID,
    LINE_ID,
    CORE_ID,
  ]) {
    try {
      if (map.getLayer(id)) map.moveLayer(id);
    } catch {
      // Transient style race — recovered on the next apply.
    }
  }
}

export function CustomerMapView({
  customers,
  dealers,
  dealerStatuses,
  perDealerCounts,
  markerStyle,
  basemap,
  boundaryHighlight = null,
}: CustomerMapViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const appliedBasemapRef = React.useRef<CustomerMapBasemap | null>(null);
  const initialBasemapRef = React.useRef(basemap);
  const [mapReady, setMapReady] = React.useState(false);
  const [selected, setSelected] = React.useState<CustomerFeatureProps | null>(null);
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
      const data = buildMappableData(state.customers, state.colors);
      const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!existing) map.addSource(SOURCE_ID, { type: "geojson", data });
      else existing.setData(data);

      if (!map.getLayer(HEAT_ID)) {
        map.addLayer({
          id: HEAT_ID,
          type: "heatmap",
          source: SOURCE_ID,
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 12, 2.5],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 14, 12, 30],
            "heatmap-opacity": 0.85,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(37,99,235,0)",
              0.2, "rgba(37,99,235,0.55)",
              0.4, "#22c55e",
              0.6, "#eab308",
              0.8, "#f97316",
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

      const show = (id: string, visible: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      };
      const isHeat = state.markerStyle === "heatmap";
      show(HEAT_ID, isHeat);
      show(CIRCLE_ID, !isHeat);

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

      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      instance.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-left");

      // Generic handlers survive style swaps (layer-bound handlers do not).
      const hitLayers = (): string[] => [CIRCLE_ID].filter((id) => instance.getLayer(id));
      instance.on("click", (event: MapMouseEvent) => {
        const layers = hitLayers();
        const hits = layers.length ? instance.queryRenderedFeatures(event.point, { layers }) : [];
        setSelected(hits.length ? (hits[0].properties as unknown as CustomerFeatureProps) : null);
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
    setSelected((previous) =>
      previous && customers.some((customer) => customer.key === previous.key) ? previous : null,
    );
    if (customers.length > 0) {
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
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 56, maxZoom: 12, duration: 500 },
      );
    }
  }, [customers, mapReady]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {offlineDealers.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate" title={offlineDealers.map((d) => d.dealerName).join(", ")}>
            {offlineDealers.map((dealer) => dealer.dealerName).join(", ")}{" "}
            {offlineDealers.length === 1 ? "is" : "are"} offline — their customers are hidden.
          </span>
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-muted">
        {/* Maplibre adds `.maplibregl-map` (position: relative) to its container, which would
            override `absolute`; wrap it so an inset-0 shell gives the map a definite height. */}
        <div className="absolute inset-0">
          <div
            ref={containerRef}
            className="h-full w-full"
            role="region"
            aria-label="Customer location map"
          />
        </div>

        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <span className="text-sm text-muted-foreground">Loading map…</span>
          </div>
        )}

        {mapReady && customers.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border bg-card/95 px-6 py-6 text-center shadow-sm">
              <MapPinOff className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No customers match the current filters.</p>
              <p className="text-xs text-muted-foreground">Adjust the filters to widen the result set.</p>
            </div>
          </div>
        )}

        {selected && (
          <div className="absolute left-3 top-3 z-10 w-[min(20rem,calc(100%-1.5rem))]">
            <div className="rounded-xl border bg-card p-4 shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: selected.color }} />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      title={selected.storeName || selected.customerName}
                    >
                      {selected.storeName || selected.customerName || "Customer"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={selected.customerCode}>
                      {selected.customerName}
                      {selected.customerCode ? ` · ${selected.customerCode}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Close customer details"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3 space-y-1.5 border-t pt-3">
                <DetailRow label="Dealer" value={selected.dealerName} />
                <DetailRow label="Store type" value={selected.storeType} />
                <DetailRow label="Class" value={selected.classification} />
                <DetailRow
                  label="City"
                  value={[selected.city, selected.province].filter(Boolean).join(", ")}
                />
                <DetailRow label="Barangay" value={selected.brgy} />
                <DetailRow label="Price type" value={selected.priceType} />
                <DetailRow label="Payment term" value={selected.paymentTerm} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dealer legend banner — scrolls horizontally so many dealers never wrap or eat map height. */}
      <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-t bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          className="shrink-0 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={legendOpen ? "Hide legend" : "Show legend"}
        >
          <span className="font-semibold tabular-nums text-foreground">
            {formatNumber(customers.length)}
          </span>{" "}
          plotted
        </button>

        {legendOpen && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
            <ul className="flex items-center gap-2">
              {dealers.map((dealer) => {
                const status = dealerStatuses.find((entry) => entry.dealerId === dealer.id);
                const offline = status ? !status.online : false;
                return (
                  <li
                    key={dealer.id}
                    className="flex shrink-0 items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                      style={{ backgroundColor: dealer.color }}
                      aria-hidden
                    />
                    <span className="max-w-[160px] truncate" title={dealer.name}>
                      {dealer.name}
                    </span>
                    {offline ? (
                      <span className="font-medium text-destructive">offline</span>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(perDealerCounts[dealer.id] ?? 0)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
