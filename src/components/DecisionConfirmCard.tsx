'use client';

import React from 'react';
import {
  AlertTriangle,
  Check,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import {
  type Confirmation,
  confirmFromTap,
} from '@/lib/actions/confirmation';
import type { Channel, DecisionTier, PriorityType } from '@/lib/types';
import { PriorityPill } from './PriorityPill';
import { SeniorButton } from './SeniorButton';
import { SourceBadge } from './SourceBadge';

export type DecisionConfirmCardProps = {
  actionId: string;
  tier: DecisionTier;
  title?: string;
  summary: string;
  source?: Channel;
  priority?: PriorityType;
  confirmLabel?: string;
  dismissLabel?: string;
  onConfirm: (confirmation: Confirmation) => void;
  onDismiss: () => void;
  showAskFamily?: boolean;
  askFamilyLabel?: string;
  onAskFamily?: () => void;
  showEnableSharingOffer?: boolean;
  onEnableSharing?: () => void;
  className?: string;
};

export function DecisionConfirmCard({
  actionId,
  tier,
  title,
  summary,
  source,
  priority,
  confirmLabel = 'Confirm',
  dismissLabel = 'Dismiss',
  onConfirm,
  onDismiss,
  showAskFamily = false,
  askFamilyLabel = 'Ask Family to Check',
  onAskFamily,
  showEnableSharingOffer = false,
  onEnableSharing,
  className = '',
}: DecisionConfirmCardProps) {
  const isTier3 = tier === 3;

  // Confirmation is minted ONLY inside the Confirm button's click handler.
  // Never mint on render, on Dismiss, or on any timer.
  const handleConfirmTap = () => {
    const confirmation = confirmFromTap(actionId);
    onConfirm(confirmation);
  };

  const handleDismissTap = () => {
    onDismiss();
  };

  return (
    <article
      data-card="true"
      data-tier={tier}
      className={`anim-fade-up relative overflow-hidden rounded-card border-2 p-5 shadow-card backdrop-blur-md ${
        isTier3
          ? 'border-red-200/90 bg-gradient-to-br from-red-50/90 via-white/85 to-red-50/40'
          : 'border-brand-soft bg-gradient-to-br from-brand-soft/75 via-brand-wash to-white'
      } ${className}`.trim()}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-2xl ${
          isTier3 ? 'bg-red-100/70' : 'bg-brand-soft/60'
        }`}
      />

      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-badge="true"
            className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 text-[14px] font-bold tracking-[0.04em] shadow-pill ${
              isTier3
                ? 'border-red-200 bg-white/90 text-red-700'
                : 'border-brand-soft bg-white/90 text-brand-deep'
            }`}
          >
            <span aria-hidden="true" className="inline-flex shrink-0 items-center">
              {isTier3 ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
            </span>
            <span>{isTier3 ? 'Needs Careful Check' : 'Needs Your Decision'}</span>
          </span>

          {source ? <SourceBadge source={source} /> : null}
          {priority ? <PriorityPill priority={priority} /> : null}
        </div>

        {title ? (
          <h3 className="text-[20px] font-bold text-ink">{title}</h3>
        ) : null}

        <p className="text-[20px] leading-relaxed text-ink">{summary}</p>

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <SeniorButton
            variant={isTier3 ? 'warn' : 'primary'}
            icon={<Check size={20} />}
            onClick={handleConfirmTap}
          >
            {confirmLabel}
          </SeniorButton>

          <SeniorButton
            variant="secondary"
            icon={<X size={20} />}
            onClick={handleDismissTap}
          >
            {dismissLabel}
          </SeniorButton>

          {showAskFamily && onAskFamily ? (
            <SeniorButton
              variant="danger"
              icon={<Users size={20} />}
              onClick={onAskFamily}
            >
              {askFamilyLabel}
            </SeniorButton>
          ) : null}

          {showEnableSharingOffer && onEnableSharing ? (
            <SeniorButton
              variant="secondary"
              icon={<Users size={20} />}
              onClick={onEnableSharing}
            >
              Turn On Family Sharing
            </SeniorButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
