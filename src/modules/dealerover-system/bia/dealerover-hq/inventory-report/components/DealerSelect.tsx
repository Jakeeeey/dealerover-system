"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { getDealerColor } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/utils/dealer-colors";
import type { DealerRosterEntry } from "../types";

interface DealerSelectProps {
  dealers: DealerRosterEntry[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Single-select dealer combobox (shadcn Popover + Command). One dealer at a
 * time — the dashboard below is always scoped to the picked dealer. Full
 * keyboard access comes from the Command list (arrows + Enter + type-ahead);
 * the trigger is a real button with combobox semantics.
 */
export function DealerSelect({ dealers, value, onChange, disabled = false }: DealerSelectProps) {
  const [open, setOpen] = React.useState(false);

  const selectedIndex = dealers.findIndex((dealer) => dealer.dealerId === value);
  const selected = selectedIndex >= 0 ? dealers[selectedIndex] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={selected ? `Dealer: ${selected.dealerName}` : "Select dealer"}
          disabled={disabled}
          className="h-8 w-full justify-between text-xs font-normal min-h-11 md:min-h-0"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected && (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getDealerColor(selectedIndex) }}
                aria-hidden
              />
            )}
            <span className="truncate">
              {selected ? selected.dealerName : dealers.length === 0 ? "No dealers" : "Select dealer…"}
            </span>
            {selected?.dealerCode && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {selected.dealerCode}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search dealers..." aria-label="Search dealers" />
          <CommandList className="max-h-64 overscroll-contain" onWheel={(event) => event.stopPropagation()}>
            <CommandEmpty>No dealers found.</CommandEmpty>
            <CommandGroup>
              {dealers.map((dealer, index) => {
                const isSelected = dealer.dealerId === value;
                const label = dealer.dealerCode
                  ? `${dealer.dealerName} ${dealer.dealerCode}`
                  : dealer.dealerName;
                return (
                  <CommandItem
                    key={dealer.dealerId}
                    value={label}
                    title={dealer.dealerName}
                    onSelect={() => {
                      onChange(dealer.dealerId);
                      setOpen(false);
                    }}
                    aria-selected={isSelected}
                  >
                    <Check
                      className={cn("size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: getDealerColor(index) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{dealer.dealerName}</span>
                    {dealer.dealerCode && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {dealer.dealerCode}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
