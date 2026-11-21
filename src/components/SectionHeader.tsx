'use client';

import React from 'react';

export type SectionHeaderCountTone = 'default' | 'red' | 'brand';

export interface SectionHeaderProps {
  title: string;
  id?: string;
  count?: number;
  countTone?: SectionHeaderCountTone;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Uppercase 13/600 section label with optional count pill and right-side slot.
 */
export function SectionHeader({
  title,
  id,
  count,
  countTone = 'default',
  children,
  className = '',
}: SectionHeaderProps) {
  const toneClass =
    countTone === 'red'
      ? 'bg-red-100 text-red-700'
      : countTone === 'brand'
        ? 'bg-brand-soft text-brand-deep'
        : 'bg-line text-muted';

  return (
    <div
      className={`mb-3 flex items-center justify-between ${className}`.trim()}
    >
      <div className="flex items-center gap-2">
        <h2
          id={id}
          className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted"
        >
          {title}
        </h2>
        {count != null && count !== 0 ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold tnum ${toneClass}`}
          >
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default SectionHeader;
