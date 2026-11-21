'use client';

import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  className?: string;
}

/**
 * Designed empty state — never plain text.
 */
export function EmptyState({
  icon,
  title,
  message,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`anim-fade-up flex flex-col items-center rounded-card border border-dashed border-line bg-white px-6 py-8 text-center ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand"
      >
        {icon}
      </span>
      <p className="text-[18px] font-semibold text-ink">{title}</p>
      {message ? (
        <p className="mt-1 max-w-[280px] text-[16px] leading-relaxed text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export default EmptyState;
