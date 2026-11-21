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
    classes: 'border-red-200 bg-red-50 text-red-600',
    icon: <AlertCircle size={18} />,
  },
  Social: {
    label: 'Social',
    classes: 'border-teal-200 bg-brand-wash text-brand-deep',
    icon: <Users size={18} />,
  },
  Promotion: {
    label: 'Promotion',
    classes: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: <Tag size={18} />,
  },
};

export function PriorityPill({ priority, className = '' }: PriorityPillProps) {
  const meta = PRIORITY_META[priority];

  return (
    <span
      data-badge="true"
      className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 text-[14px] font-bold tracking-[0.04em] shadow-pill ${meta.classes} ${className}`.trim()}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
