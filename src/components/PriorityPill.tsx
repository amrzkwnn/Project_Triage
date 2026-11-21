import React from 'react';
import { AlertCircle, Tag, Users } from 'lucide-react';
import type { PriorityType } from '@/lib/types';

export type PriorityPillProps = {
  priority: PriorityType;
  className?: string;
};

type PriorityMeta = {
  label: PriorityType;
  classes: string;
  icon: React.ReactNode;
};

const PRIORITY_META: Record<PriorityType, PriorityMeta> = {
  Important: {
    label: 'Important',
    classes: 'border-[#BE123C] bg-[#FFF1F2] text-[#881337]',
    icon: <AlertCircle size={20} />,
  },
  Social: {
    label: 'Social',
    classes: 'border-[#0F766E] bg-[#F0FDFA] text-[#115E59]',
    icon: <Users size={20} />,
  },
  Promotion: {
    label: 'Promotion',
    classes: 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]',
    icon: <Tag size={20} />,
  },
};

export function PriorityPill({ priority, className = '' }: PriorityPillProps) {
  const meta = PRIORITY_META[priority];

  return (
    <span
      data-badge="true"
      className={`inline-flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-[18px] font-semibold ${meta.classes} ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
