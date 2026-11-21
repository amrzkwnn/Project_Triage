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
      ? 'anim-fade-in rounded-card shadow-card border-2 border-brand-soft bg-brand-wash px-4 py-3 text-[18px] font-medium text-ink'
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
