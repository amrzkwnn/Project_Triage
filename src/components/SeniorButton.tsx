'use client';

import React from 'react';

export type SeniorButtonVariant =
  | 'primary'
  | 'secondary'
  | 'safe'
  | 'warn'
  | 'danger';

export type SeniorButtonProps = {
  variant?: SeniorButtonVariant;
  href?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-current'?: 'page' | 'step' | 'location' | 'date' | 'time' | boolean;
  'data-testid'?: string;
};

const VARIANT_CLASSES: Record<SeniorButtonVariant, string> = {
  primary:
    'bg-[#0F766E] text-white border-[#0F766E] hover:bg-[#115E59] active:bg-[#134E4A]',
  secondary:
    'bg-white text-[#111827] border-[#111827] hover:bg-[#F3F4F6] active:bg-[#E5E7EB]',
  safe: 'bg-[#15803D] text-white border-[#15803D] hover:bg-[#166534] active:bg-[#14532D]',
  warn: 'bg-[#B45309] text-white border-[#92400E] hover:bg-[#92400E] active:bg-[#78350F]',
  danger:
    'bg-[#BE123C] text-white border-[#BE123C] hover:bg-[#9F1239] active:bg-[#881337]',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-3 min-h-[56px] min-w-[56px] px-5 py-3 rounded-xl border-2 text-[18px] font-semibold leading-snug no-underline transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E]';

export function SeniorButton({
  variant = 'primary',
  href,
  icon,
  children,
  type = 'button',
  disabled = false,
  onClick,
  className = '',
  id,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  'aria-current': ariaCurrent,
  'data-testid': dataTestId,
}: SeniorButtonProps) {
  const classes = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`.trim();

  const content = (
    <>
      {icon !== undefined && icon !== null ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </>
  );

  if (href !== undefined && !disabled) {
    return (
      <a
        id={id}
        href={href}
        onClick={onClick as React.MouseEventHandler<HTMLAnchorElement>}
        className={classes}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
        data-testid={dataTestId}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      id={id}
      type={type}
      disabled={disabled}
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
      className={classes}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-current={ariaCurrent}
      data-testid={dataTestId}
    >
      {content}
    </button>
  );
}
