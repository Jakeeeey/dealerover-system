"use client";

import * as React from "react";
import {
  Boxes,
  Check,
  CircleDot,
  Droplet,
  Flame,
  Layers,
  Map as MapIcon,
  Moon,
  Palette,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PopoverStageContent } from "./PopoverStageContent";
import { cn } from "@/lib/utils";
import type { CustomerMapBasemap, CustomerMapMarkerStyle } from "../types";

interface MarkerOption {
  value: CustomerMapMarkerStyle;
  label: string;
  icon: LucideIcon;
}

interface BasemapOption {
  value: CustomerMapBasemap;
  label: string;
  icon: LucideIcon;
}

const MARKER_OPTIONS: MarkerOption[] = [
  { value: "dots", label: "Dots", icon: CircleDot },
  { value: "heatmap", label: "Heatmap", icon: Flame },
  { value: "clusters", label: "Clusters", icon: Boxes },
];

// Liberty first — it is the default selection.
const BASEMAP_OPTIONS: BasemapOption[] = [
  { value: "liberty", label: "Liberty", icon: Palette },
  { value: "positron", label: "Positron", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "bright", label: "Bright", icon: MapIcon },
  { value: "fiord", label: "Fiord", icon: Droplet },
];

interface MapStyleSwitchProps {
  markerStyle: CustomerMapMarkerStyle;
  onMarkerStyleChange: (style: CustomerMapMarkerStyle) => void;
  basemap: CustomerMapBasemap;
  onBasemapChange: (basemap: CustomerMapBasemap) => void;
}

/**
 * Map presentation controls: how points are drawn (dots / heatmap / clusters) and which
 * basemap style to use. Both are persisted user preferences.
 */
export function MapStyleSwitch({
  markerStyle,
  onMarkerStyleChange,
  basemap,
  onBasemapChange,
}: MapStyleSwitchProps) {
  const [basemapOpen, setBasemapOpen] = React.useState(false);
  const currentBasemap = BASEMAP_OPTIONS.find((option) => option.value === basemap) ?? BASEMAP_OPTIONS[0];

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-0.5 rounded-lg border border-border p-0.5"
        role="group"
        aria-label="Map style"
      >
        {MARKER_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = markerStyle === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onMarkerStyleChange(option.value)}
              aria-pressed={active}
              title={`${option.label} map`}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>

      <Popover open={basemapOpen} onOpenChange={setBasemapOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" title="Basemap style">
            <Layers className="size-4" />
            {currentBasemap.label}
          </Button>
        </PopoverTrigger>
        <PopoverStageContent align="end" className="w-40 p-1">
          <ul className="flex flex-col gap-0.5">
            {BASEMAP_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = basemap === option.value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onBasemapChange(option.value);
                      setBasemapOpen(false);
                    }}
                    aria-pressed={active}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="size-3.5" />
                    <span className="flex-1 text-left">{option.label}</span>
                    {active && <Check className="ml-auto size-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverStageContent>
      </Popover>
    </div>
  );
}
