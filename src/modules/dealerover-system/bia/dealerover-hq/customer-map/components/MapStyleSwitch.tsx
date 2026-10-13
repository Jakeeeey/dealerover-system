"use client";

import * as React from "react";
import {
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Map presentation controls: how points are drawn (dots / heatmap) and which
 * basemap style to use. Both are persisted user preferences.
 */
export function MapStyleSwitch({
  markerStyle,
  onMarkerStyleChange,
  basemap,
  onBasemapChange,
}: MapStyleSwitchProps) {
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" title="Basemap style">
            <Layers className="size-4" />
            {currentBasemap.label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {BASEMAP_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onBasemapChange(option.value)}
                className="gap-2 text-xs"
              >
                <Icon className="size-3.5" />
                {option.label}
                {basemap === option.value && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
