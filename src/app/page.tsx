'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  ChevronDown,
  Inbox,
  RefreshCw,
  ScanEye,
  ShieldAlert,
} from 'lucide-react';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { PrivacyPill } from '@/components/PrivacyPill';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import type { Confirmation } from '@/lib/actions/confirmation';
import {
  HOME_SECTION_CARDS,
  type HomeSectionCard,
  selectHomeDecisions,
} from '@/lib/home/decisions';
import {
  type InboxItem,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

export type HomeHubProps = {
  initialSettings?: Settings;
  initialItems?: InboxItem[];
  initialLoadError?: string;
  initialShowAll?: boolean;
  vault?: Vault;
  onNavigate?: (href: string) => void;
  onConfirmDecision?: (item: InboxItem, confirmation: Confirmation) => void;
  onDismissDecision?: (item: InboxItem) => void;
  onAskFamily?: (item: InboxItem) => void;
  onRetry?: () => void;
};

const SECTION_ICONS: Record<HomeSectionCard['id'], React.ReactNode> = {
  'scam-shield': <ShieldAlert size={28} />,
  'photo-helper': <Camera size={28} />,
  inbox: <Inbox size={28} />,
  'media-check': <ScanEye size={28} />,
  calendar: <Calendar size={28} />,
};

export function HomeHub({
  initialSettings,
  initialItems,
  initialLoadError,
  initialShowAll = false,
  vault,
  onNavigate,
  onConfirmDecision,
  onDismissDecision,
  onAskFamily,
  onRetry,
}: HomeHubProps) {
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [items, setItems] = useState<InboxItem[]>(initialItems ?? []);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [loadError, setLoadError] = useState<string | undefined>(
    initialLoadError
  );
  const [showAll, setShowAll] = useState<boolean>(initialShowAll);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadFromVault = useCallback(async () => {
    if (!resolvedVault) return;
    const [settingsRes, itemsRes] = await Promise.all([
      resolvedVault.getSettings(),
      resolvedVault.listItems(),
    ]);
    if (settingsRes.ok) {
      setSettings(settingsRes.value);
    }
    if (itemsRes.ok) {
      setItems(itemsRes.value);
      setLoadError(undefined);
    } else {
      setLoadError(itemsRes.error.message);
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined || initialItems === undefined) {
      void loadFromVault();
    }
  }, [initialSettings, initialItems, loadFromVault]);

  const activeItems = useMemo(
    () => items.filter((item) => !dismissedIds.has(item.id)),
    [items, dismissedIds]
  );

  const selection = useMemo(
    () => selectHomeDecisions(activeItems, showAll),
    [activeItems, showAll]
  );

  const handleLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(href);
    }
  };

  const handleRetry = () => {
    setStatusMessage('Trying to load your decisions again.');
    if (onRetry) {
      onRetry();
      return;
    }
    void loadFromVault();
  };

  const handleConfirm = (item: InboxItem, confirmation: Confirmation) => {
    onConfirmDecision?.(item, confirmation);
    setDismissedIds((prev) => new Set(prev).add(item.id));
    setStatusMessage('Your decision was confirmed.');
  };

  const handleDismiss = (item: InboxItem) => {
    onDismissDecision?.(item);
    setDismissedIds((prev) => new Set(prev).add(item.id));
    setStatusMessage('Item dismissed. Nothing was changed.');
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-[28px] font-bold leading-tight text-[#111827]">
          Welcome Home
        </h1>
        <div>
          <PrivacyPill
            settings={settings}
            onClick={(e) => handleLinkClick(e, '/my-data')}
          />
        </div>
      </section>

      <StatusLive message={statusMessage} />

      <section aria-labelledby="decisions-heading" className="space-y-4">
        <h2
          id="decisions-heading"
          className="text-[24px] font-bold text-[#111827]"
        >
          Today&apos;s Important Decisions
        </h2>

        {loadError ? (
          <div
            role="alert"
            data-card="true"
            className="rounded-2xl border-2 border-[#BE123C] bg-[#FFF1F2] p-5 space-y-4"
          >
            <div className="flex items-start gap-3 text-[18px] font-semibold text-[#881337]">
              <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
                <AlertTriangle size={22} />
              </span>
              <span>{loadError}</span>
            </div>
            <SeniorButton
              variant="primary"
              icon={<RefreshCw size={20} />}
              onClick={handleRetry}
            >
              Try Again
            </SeniorButton>
          </div>
        ) : selection.emptyMessage ? (
          <div
            data-card="true"
            className="rounded-2xl border-2 border-[#15803D] bg-[#F0FDF4] p-5 text-[20px] font-semibold text-[#14532D]"
          >
            {selection.emptyMessage}
          </div>
        ) : (
          <div className="space-y-4">
            {selection.visible.map((item) => {
              const summaryText =
                item.summary?.text ?? item.text.slice(0, 200);
              const titleText =
                item.summary?.whoSent ?? item.sender ?? 'Message awaiting review';
              const actionId = item.proposals?.[0]?.id ?? `decision-${item.id}`;
              const confirmLabel =
                item.proposals?.[0]?.label ?? 'Confirm';

              return (
                <DecisionConfirmCard
                  key={item.id}
                  actionId={actionId}
                  tier={item.tier}
                  title={titleText}
                  summary={summaryText}
                  source={item.source}
                  priority={item.priority}
                  confirmLabel={confirmLabel}
                  onConfirm={(confirmation) =>
                    handleConfirm(item, confirmation)
                  }
                  onDismiss={() => handleDismiss(item)}
                  showAskFamily={
                    item.tier === 3 && settings.caregiverShareEnabled
                  }
                  onAskFamily={
                    onAskFamily ? () => onAskFamily(item) : undefined
                  }
                />
              );
            })}

            {selection.hasMore ? (
              <div>
                <SeniorButton
                  variant="secondary"
                  icon={<ChevronDown size={20} />}
                  onClick={() => {
                    setShowAll(true);
                    setStatusMessage(
                      `Showing all ${selection.totalAwaiting} decisions.`
                    );
                  }}
                >
                  Show {selection.remainingCount} more decisions
                </SeniorButton>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="sections-heading" className="space-y-4">
        <h2
          id="sections-heading"
          className="text-[24px] font-bold text-[#111827]"
        >
          Your Helpers
        </h2>

        <div className="grid grid-cols-1 gap-4">
          {HOME_SECTION_CARDS.map((card) => (
            <a
              key={card.id}
              href={card.href}
              onClick={(e) => handleLinkClick(e, card.href)}
              data-card="true"
              className="flex min-h-[84px] items-start gap-4 rounded-2xl border-2 border-[#111827] bg-white p-5 text-[#111827] no-underline transition-colors hover:border-[#0F766E] hover:bg-[#F0FDFA] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E]"
            >
              <span
                aria-hidden="true"
                className="mt-1 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] text-[#0F766E]"
              >
                {SECTION_ICONS[card.id]}
              </span>
              <span className="space-y-1">
                <span className="block text-[22px] font-bold text-[#111827]">
                  {card.title}
                </span>
                <span className="block text-[18px] leading-snug text-[#111827]">
                  {card.description}
                </span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  return <HomeHub />;
}
