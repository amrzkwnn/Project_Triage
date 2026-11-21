'use client';

import React from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Verdict, VerdictValue } from '@/lib/types';
import { SeniorButton } from './SeniorButton';

export type TrafficLightCardProps = {
  verdict: Verdict & { instruction?: string; showAskFamily?: boolean };
  instruction?: string;
  showAskFamily?: boolean;
  onAskFamily?: () => void;
  askFamilyHref?: string;
  className?: string;
};

type VerdictStyle = {
  label: string;
  containerClass: string;
  headingClass: string;
  badgeClass: string;
  icon: React.ReactNode;
};

const VERDICT_STYLES: Record<VerdictValue, VerdictStyle> = {
  safe: {
    label: 'Looks Safe',
    containerClass: 'border-[#15803D] bg-[#F0FDF4]',
    headingClass: 'text-[#14532D]',
    badgeClass: 'border-[#15803D] bg-white text-[#14532D]',
    icon: <ShieldCheck size={28} />,
  },
  caution: {
    label: 'Be Careful — Verify First',
    containerClass: 'border-[#D97706] bg-[#FFFBEB]',
    headingClass: 'text-[#92400E]',
    badgeClass: 'border-[#D97706] bg-white text-[#92400E]',
    icon: <AlertTriangle size={28} />,
  },
  danger: {
    label: 'Likely Scam — Do Not Click or Pay',
    containerClass: 'border-[#BE123C] bg-[#FFF1F2]',
    headingClass: 'text-[#881337]',
    badgeClass: 'border-[#BE123C] bg-white text-[#881337]',
    icon: <ShieldAlert size={28} />,
  },
};

export function TrafficLightCard({
  verdict,
  instruction,
  showAskFamily,
  onAskFamily,
  askFamilyHref,
  className = '',
}: TrafficLightCardProps) {
  const style = VERDICT_STYLES[verdict.value];
  const reasons = verdict.reasons.slice(0, 3);
  const resolvedInstruction = instruction ?? verdict.instruction;
  const shouldShowAskFamily =
    showAskFamily !== undefined
      ? showAskFamily
      : Boolean(verdict.showAskFamily || onAskFamily || askFamilyHref);

  return (
    <section
      data-card="true"
      data-verdict={verdict.value}
      className={`rounded-2xl border-2 p-5 space-y-4 ${style.containerClass} ${className}`.trim()}
      aria-label={style.label}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          data-badge="true"
          className={`inline-flex items-center gap-3 rounded-xl border-2 px-4 py-2 text-[20px] font-bold ${style.badgeClass}`}
        >
          <span aria-hidden="true" className="inline-flex shrink-0 items-center">
            {style.icon}
          </span>
          <span>{style.label}</span>
        </span>
      </div>

      {reasons.length > 0 ? (
        <ul className="list-disc pl-6 space-y-2 text-[18px] leading-relaxed text-[#111827]">
          {reasons.map((reason, idx) => (
            <li key={`${idx}-${reason}`}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {resolvedInstruction ? (
        <p className={`text-[20px] font-bold leading-snug ${style.headingClass}`}>
          {resolvedInstruction}
        </p>
      ) : null}

      {shouldShowAskFamily ? (
        <div className="pt-2">
          <SeniorButton
            variant={verdict.value === 'danger' ? 'danger' : 'warn'}
            href={askFamilyHref}
            onClick={onAskFamily}
            icon={<Users size={22} />}
          >
            Ask Family to Check
          </SeniorButton>
        </div>
      ) : null}
    </section>
  );
}
