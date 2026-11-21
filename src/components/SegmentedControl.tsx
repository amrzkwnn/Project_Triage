'use client';

import React from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Segmented control with a sliding pill indicator and 56px senior tap targets.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value)
  );
  const pct = options.length > 0 ? 100 / options.length : 0;

  return (
    <div
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      className={`chrome relative flex rounded-full border border-line bg-white p-1 shadow-pill ${className}`.trim()}
    >
      {options.length > 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-1 rounded-full bg-brand transition-all duration-200 ease-out"
          style={{
            width: `calc(${pct}% - 4px)`,
            left: `calc(${activeIndex * pct}% + 2px)`,
          }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`pressable relative z-10 flex min-h-[56px] min-w-[56px] flex-1 cursor-pointer items-center justify-center rounded-full px-2 text-[14px] font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E] ${
              active ? 'text-white' : 'text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
