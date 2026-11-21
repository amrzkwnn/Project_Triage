'use client';

import React from 'react';

export interface FilterChipItem<T extends string> {
  id: T;
  label: string;
  dot?: string;
}

export interface FilterChipsProps<T extends string> {
  items: ReadonlyArray<FilterChipItem<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Animated chip row used for filters and toggles with 56px senior tap targets.
 */
export function FilterChips<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = '',
}: FilterChipsProps<T>) {
  return (
    <div
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      className={`no-scrollbar chrome flex gap-2 overflow-x-auto ${className}`.trim()}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={`pressable inline-flex min-h-[56px] min-w-[56px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-chip px-4 text-[15px] font-semibold transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E] ${
              active
                ? 'border-2 border-brand bg-brand text-white shadow-pill'
                : 'border-2 border-line bg-white text-ink hover:border-brand'
            }`}
          >
            {item.dot && !active ? (
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dot}`}
              />
            ) : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default FilterChips;
