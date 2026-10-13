"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface FilterComboboxOption {
  value: string;
  label: string;
}

interface FilterComboboxProps {
  options: FilterComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  allLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Single-select searchable combobox (Popover + Command) for DB-sourced lists.
 * The popover is sized to its trigger via the Tailwind v4 paren form.
 */
export function FilterCombobox({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  allLabel = "All",
  disabled = false,
  className,
}: FilterComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selectedLabel = React.useMemo(
    () => options.find((option) => option.value === value)?.label || value,
    [options, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-8 w-full justify-between text-xs font-normal", className)}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `Search ${placeholder.toLowerCase()}...`} />
          <CommandList
            className="max-h-64 overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__all__ ${allLabel}`}
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{allLabel}</span>
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  title={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export interface DealerFilterOption {
  id: string;
  name: string;
  code: string;
  color: string;
}

interface DealerFilterComboboxProps {
  dealers: DealerFilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Multi-select dealer combobox with a per-dealer colour chip, matching the map
 * legend so the filter and the plotted points read as one system.
 */
export function DealerFilterCombobox({
  dealers,
  selected,
  onChange,
  disabled = false,
  className,
}: DealerFilterComboboxProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDealers = React.useMemo(
    () => dealers.filter((dealer) => selected.includes(dealer.id)),
    [dealers, selected],
  );

  const triggerLabel =
    selectedDealers.length === 0
      ? "All dealers"
      : selectedDealers.length === 1
        ? selectedDealers[0].name
        : `${selectedDealers.length} dealers`;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-8 w-full justify-between text-xs font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedDealers.length > 0 && (
              <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                {selectedDealers.slice(0, 4).map((dealer) => (
                  <span
                    key={dealer.id}
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: dealer.color }}
                  />
                ))}
              </span>
            )}
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search dealers..." />
          <CommandList
            className="max-h-64 overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandEmpty>No dealers found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__ all dealers"
                onSelect={() => onChange([])}
              >
                <Check className={cn("mr-2 h-4 w-4", selected.length === 0 ? "opacity-100" : "opacity-0")} />
                <span className="truncate">All dealers</span>
              </CommandItem>
              {dealers.map((dealer) => {
                const isSelected = selected.includes(dealer.id);
                return (
                  <CommandItem
                    key={dealer.id}
                    value={dealer.name}
                    title={dealer.name}
                    onSelect={() => toggle(dealer.id)}
                  >
                    <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: dealer.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{dealer.name}</span>
                    {dealer.code && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {dealer.code}
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
