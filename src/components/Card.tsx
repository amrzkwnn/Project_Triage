'use client';

import React from 'react';

export interface CardProps {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

/**
 * Base white card. Pass `onClick` to make it a pressable tap target.
 */
export function Card({ className = '', children, onClick }: CardProps) {
  return (
    <div
      data-card="true"
      onClick={onClick}
      className={`rounded-card border border-line bg-white shadow-card ${
        onClick ? 'pressable cursor-pointer' : ''
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export default Card;
