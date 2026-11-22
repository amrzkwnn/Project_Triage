'use client';

import React from 'react';
import { SeniorButton } from './SeniorButton';

export type BackToHomeProps = {
  href?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  className?: string;
};

export function BackToHome({
  href = '/',
  onClick,
  className = '',
}: BackToHomeProps) {
  return (
    <div className={`anim-fade-in mb-4 ${className}`.trim()}>
      <SeniorButton href={href} variant="secondary" onClick={onClick}>
        ← Back to Home
      </SeniorButton>
    </div>
  );
}
