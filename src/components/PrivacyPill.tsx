'use client';

import React from 'react';
import { Shield } from 'lucide-react';
import { countEnabledChannels } from '@/lib/home/decisions';
import type { Settings } from '@/lib/types';

export type PrivacyPillProps = {
  settings?: Settings;
  enabledCount?: number;
  allowAiReading?: boolean;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  className?: string;
};

export function PrivacyPill({
  settings,
  enabledCount,
  allowAiReading,
  href = '/my-data',
  onClick,
  className = '',
}: PrivacyPillProps) {
  const count =
    enabledCount !== undefined
      ? enabledCount
      : settings
        ? countEnabledChannels(settings)
        : 0;
  const aiOn =
    allowAiReading !== undefined
      ? allowAiReading
      : Boolean(settings?.allowAiReading);

  const label = `My Data: ${count} Sources On • AI ${aiOn ? 'On' : 'Off'}`;

  return (
    <a
      href={href}
      onClick={onClick}
      data-badge="true"
      className={`pressable inline-flex items-center gap-3 min-h-[56px] min-w-[56px] rounded-full border-2 border-brand-soft bg-white/90 px-5 py-3 text-[18px] font-semibold text-brand-deep shadow-pill backdrop-blur-md no-underline hover:bg-brand-wash focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E] ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        <Shield size={22} />
      </span>
      <span>{label}</span>
    </a>
  );
}
