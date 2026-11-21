import React from 'react';

export type StatusLiveProps = {
  message?: string;
  className?: string;
  visuallyHidden?: boolean;
  id?: string;
};

export function StatusLive({
  message = '',
  className = '',
  visuallyHidden = false,
  id,
}: StatusLiveProps) {
  const baseClass = visuallyHidden
    ? 'sr-only'
    : message
      ? 'rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] px-4 py-3 text-[18px] font-medium text-[#111827]'
      : '';

  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`${baseClass} ${className}`.trim()}
    >
      {message}
    </div>
  );
}
