"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import * as React from "react";
import { CircleAlert, MapPin, MapPinOff, X } from "lucide-react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
} from "maplibre-gl";
import { formatNumber } from "@/lib/utils";
import type { CustomerMapRow, DealerStatus } from "../types";
import { MARKER_STROKE_COLOR } from "../utils/dealer-colors";

// Keyless raster basemap (Carto Positron) — no API token required.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const SOURCE_ID = "customer-points";
const LAYER_ID = "customer-points-circle";

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
}

const EMPTY_DATA: MappableData = { type: "FeatureCollection", features: [] };

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

export function CustomerMapView({
  customers,
  dealers,
  dealerStatuses,
  perDealerCounts,
}: CustomerMapViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [selected, setSelected] = React.useState<CustomerFeatureProps | null>(null);

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

  // MapLibre touches the DOM/WebGL, so it is imported only in the browser and
  // the map instance is created once for the component's lifetime.
  React.useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    const init = async () => {
      const mod = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      const maplibregl = mod.default;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [121.1, 15.9],
        zoom: 7,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-left");

      map.on("load", () => {
        const instance = mapRef.current;
        if (!instance) return;

        instance.addSource(SOURCE_ID, { type: "geojson", data: EMPTY_DATA });
        instance.addLayer({
          id: LAYER_ID,
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

        instance.on("click", LAYER_ID, (event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (feature?.properties) {
            setSelected(feature.properties as unknown as CustomerFeatureProps);
          }
        });
        instance.on("click", (event: MapMouseEvent) => {
          const hits = instance.queryRenderedFeatures(event.point, { layers: [LAYER_ID] });
          if (hits.length === 0) setSelected(null);
        });
        instance.on("mouseenter", LAYER_ID, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", LAYER_ID, () => {
          instance.getCanvas().style.cursor = "";
        });

        setMapReady(true);
      });
    };

    void init();

    return () => {
      cancelled = true;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  // Push the current (already filtered) point set into the map and refit bounds.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;

    source.setData(buildMappableData(customers, colors));
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
  }, [customers, colors, mapReady]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{formatNumber(customers.length)}</span>
          <span className="text-sm text-muted-foreground">customers plotted</span>
        </div>

        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {dealers.map((dealer) => {
            const status = dealerStatuses.find((entry) => entry.dealerId === dealer.id);
            const offline = status ? !status.online : false;
            return (
              <li key={dealer.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  className="size-3 shrink-0 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: dealer.color }}
                  aria-hidden
                />
                <span className="max-w-[180px] truncate" title={dealer.name}>
                  {dealer.name}
                </span>
                {offline ? (
                  <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-[11px] font-medium text-destructive">
                    offline
                  </span>
                ) : (
                  <span className="tabular-nums text-muted-foreground">
                    {formatNumber(perDealerCounts[dealer.id] ?? 0)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {offlineDealers.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            {offlineDealers.map((dealer) => dealer.dealerName).join(", ")}{" "}
            {offlineDealers.length === 1 ? "is" : "are"} offline — their customers are not shown.
          </span>
        </div>
      )}

      <div className="relative h-[60vh] min-h-[420px] w-full overflow-hidden rounded-2xl border bg-muted">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="region"
          aria-label="Customer location map"
        />

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
              <p className="text-xs text-muted-foreground">
                Adjust the filters above to widen the result set.
              </p>
            </div>
          </div>
        )}

        {selected && (
          <div className="absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:left-3 sm:max-w-sm">
            <div className="rounded-xl border bg-card p-4 shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: selected.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" title={selected.storeName || selected.customerName}>
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
    </div>
  );
}
