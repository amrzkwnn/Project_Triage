'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Inbox,
  RefreshCw,
  ScanEye,
  ShieldAlert,
  X,
} from 'lucide-react';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { PrivacyPill } from '@/components/PrivacyPill';
import { SectionHeader } from '@/components/SectionHeader';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import {
  type Confirmation,
  confirmFromTap,
} from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import {
  shareItemWithFamily,
  shouldOfferEnableSharing,
} from '@/lib/actions/sharing';
import {
  HOME_SECTION_CARDS,
  type HomeSectionCard,
  countEnabledChannels,
  selectHomeDecisions,
} from '@/lib/home/decisions';
import {
  type CalendarEvent,
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
  'scam-shield': <ShieldAlert size={24} strokeWidth={2} />,
  'photo-helper': <Camera size={24} strokeWidth={2} />,
  inbox: <Inbox size={24} strokeWidth={2} />,
  'media-check': <ScanEye size={24} strokeWidth={2} />,
  calendar: <Calendar size={24} strokeWidth={2} />,
};

const SECTION_ACCENTS: Record<HomeSectionCard['id'], string> = {
  'scam-shield': 'from-teal-400 to-teal-300',
  'photo-helper': 'from-violet-400 to-violet-300',
  inbox: 'from-teal-400 to-teal-300',
  'media-check': 'from-violet-400 to-violet-300',
  calendar: 'from-teal-400 to-teal-300',
};

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export async function executeHomeDefaultConfirm(params: {
  item: InboxItem;
  confirmation: Confirmation;
  settings: Settings;
  vault?: Pick<Vault, 'putEvent' | 'appendAudit'>;
  onNavigate?: (href: string) => void;
}): Promise<
  | { ok: true; statusMessage: string }
  | { ok: false; errorMessage: string }
> {
  const { item, confirmation, settings, vault, onNavigate } = params;
  const primary = item.proposals?.[0];
  const actionId = primary?.id ?? `decision-${item.id}`;
  const targetEvent = primary?.event ?? item.detectedEvent;

  if (primary?.kind === 'forwardToCalendar' && targetEvent) {
    const execRes = await execute(
      {
        actionId,
        kind: 'forwardToCalendar',
        event: targetEvent,
        itemId: item.id,
      },
      confirmation,
      {
        saveCalendarEvent: async (ev, itemId) => {
          if (!vault) return { ok: true, value: undefined };
          const calEvent: CalendarEvent = {
            id: `ev-${itemId}`,
            title: ev.title,
            date: ev.date,
            time: ev.time,
            ...(ev.location ? { location: ev.location } : {}),
            category: 'Medical',
            sourceItemId: itemId,
            createdAt: new Date().toISOString(),
          };
          const putRes = await vault.putEvent(calEvent);
          return putRes.ok
            ? { ok: true, value: undefined }
            : { ok: false, error: putRes.error.message };
        },
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
      }
    );

    if (!execRes.ok) {
      return { ok: false, errorMessage: execRes.error.message };
    }

    return {
      ok: true,
      statusMessage: `Added "${targetEvent.title}" to your calendar.`,
    };
  }

  if (primary?.kind === 'shareWithFamily') {
    if (!settings.caregiverShareEnabled) {
      return {
        ok: false,
        errorMessage:
          'Family Sharing is currently turned off. Turn on Family Sharing first.',
      };
    }
    const recipient = settings.familyMembers[0]?.name ?? 'Trusted Family';
    const auditVault = vault ?? {
      appendAudit: async () => ({ ok: true as const, value: undefined }),
    };
    const shareRes = await shareItemWithFamily({
      item,
      recipient,
      settings,
      confirmation,
      actionId,
      vault: auditVault,
      sendTransport: async () => ({ ok: true, value: undefined }),
    });
    if (!shareRes.ok) {
      return { ok: false, errorMessage: shareRes.error.message };
    }
    return { ok: true, statusMessage: `Shared summary with ${recipient}.` };
  }

  if (primary?.kind === 'checkScam') {
    const target = `/scam-shield?text=${encodeURIComponent(item.text)}`;
    if (onNavigate) {
      onNavigate(target);
    } else if (typeof window !== 'undefined') {
      window.location.assign(target);
    }
    return {
      ok: true,
      statusMessage: 'Opening Scam Shield with this message.',
    };
  }

  if (primary?.kind === 'checkAiImage') {
    const firstImg = item.attachments.find((a) =>
      a.mime.toLowerCase().startsWith('image/')
    );
    const target = firstImg
      ? `/media-check?image=${encodeURIComponent(firstImg.name)}`
      : '/media-check';
    if (onNavigate) {
      onNavigate(target);
    } else if (typeof window !== 'undefined') {
      window.location.assign(target);
    }
    return { ok: true, statusMessage: 'Opening AI Media Check.' };
  }

  return { ok: true, statusMessage: 'Your decision was confirmed.' };
}

export async function executeHomeDefaultAskFamily(params: {
  item: InboxItem;
  settings: Settings;
  vault?: Pick<Vault, 'appendAudit'>;
}): Promise<
  | { ok: true; statusMessage: string }
  | { ok: false; errorMessage: string }
> {
  const { item, settings, vault } = params;
  const actionId = `home-share-${item.id}`;
  const confirmation = confirmFromTap(actionId);
  const recipient = settings.familyMembers[0]?.name ?? 'Trusted Family';
  const auditVault = vault ?? {
    appendAudit: async () => ({ ok: true as const, value: undefined }),
  };

  const shareRes = await shareItemWithFamily({
    item,
    recipient,
    settings,
    confirmation,
    actionId,
    vault: auditVault,
    sendTransport: async () => ({ ok: true, value: undefined }),
  });

  if (!shareRes.ok) {
    return { ok: false, errorMessage: shareRes.error.message };
  }

  return { ok: true, statusMessage: `Shared summary with ${recipient}.` };
}

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
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pendingFamilyItem, setPendingFamilyItem] = useState<
    InboxItem | undefined
  >(undefined);

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

  const handleConfirm = async (
    item: InboxItem,
    confirmation: Confirmation
  ) => {
    setActionError(undefined);
    if (onConfirmDecision) {
      onConfirmDecision(item, confirmation);
      setDismissedIds((prev) => new Set(prev).add(item.id));
      setStatusMessage('Your decision was confirmed.');
      return;
    }

    const res = await executeHomeDefaultConfirm({
      item,
      confirmation,
      settings,
      vault: resolvedVault,
      onNavigate,
    });

    if (!res.ok) {
      setActionError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }

    setDismissedIds((prev) => new Set(prev).add(item.id));
    setStatusMessage(res.statusMessage);
  };

  const handleDismiss = (item: InboxItem) => {
    setActionError(undefined);
    onDismissDecision?.(item);
    setPendingFamilyItem((prev) => (prev?.id === item.id ? undefined : prev));
    setDismissedIds((prev) => new Set(prev).add(item.id));
    setStatusMessage('Item dismissed. Nothing was changed.');
  };

  const handleEnableFamilySharing = async () => {
    setActionError(undefined);
    const nextSettings: Settings = {
      ...settings,
      caregiverShareEnabled: true,
    };
    if (resolvedVault) {
      const res = await resolvedVault.saveSettings(nextSettings);
      if (!res.ok) {
        setActionError(res.error.message);
        setStatusMessage(res.error.message);
        return;
      }
    }
    setSettings(nextSettings);
    setStatusMessage(
      'Family Sharing is now ON. You can now ask a family member to check.'
    );
  };

  const handleConfirmAskFamily = async (item: InboxItem) => {
    setActionError(undefined);
    const res = await executeHomeDefaultAskFamily({
      item,
      settings,
      vault: resolvedVault,
    });

    if (!res.ok) {
      setActionError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }

    setPendingFamilyItem(undefined);
    setStatusMessage(res.statusMessage);
  };

  const enabledChannelCount = useMemo(
    () => countEnabledChannels(settings),
    [settings]
  );

  return (
    <div className="space-y-7 pb-6">
      {/* Hero Header Card + Tucked Stats Panel */}
      <div className="relative">
        <header className="anim-fade-up relative z-10 overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft via-brand-wash to-white p-5 pb-6 shadow-lift">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-soft/60 blur-2xl"
          />
          <div className="relative">
            <p className="text-[15px] font-medium text-muted">
              {getTimeOfDayGreeting()}
            </p>
            <h1 className="mt-0.5 text-[28px] font-bold leading-tight tracking-tight text-ink">
              Welcome Home
            </h1>
            <div className="mt-3">
              <PrivacyPill
                settings={settings}
                onClick={(e) => handleLinkClick(e, '/my-data')}
              />
            </div>
          </div>
        </header>

        <div className="anim-fade-up relative z-0 -mt-3 mx-3 rounded-card border border-line bg-white px-3.5 pb-2.5 pt-3.5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 text-[13px] font-semibold text-red-600 tnum">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-red-500"
              />
              {selection.totalAwaiting} need action
            </span>
            <span className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 text-[13px] font-semibold text-brand-deep tnum">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-brand"
              />
              {enabledChannelCount} sources on
            </span>
            <span className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 text-[13px] font-semibold text-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-violet-400"
              />
              AI {settings.allowAiReading ? 'On' : 'Off'}
            </span>
          </div>
        </div>
      </div>

      <StatusLive message={statusMessage} />

      {actionError ? (
        <div
          role="alert"
          data-card="true"
          className="rounded-card border-2 border-red-200 bg-red-50/90 p-4 text-[18px] font-semibold text-[#881337] shadow-card"
        >
          {actionError}
        </div>
      ) : null}

      <section aria-labelledby="decisions-heading" className="space-y-4">
        <SectionHeader
          id="decisions-heading"
          title="Today's Important Decisions"
          count={selection.totalAwaiting}
          countTone="red"
        />

        {loadError ? (
          <div
            role="alert"
            data-card="true"
            className="rounded-card border-2 border-red-200 bg-gradient-to-br from-red-50/90 via-white/85 to-red-50/50 p-5 shadow-card space-y-4"
          >
            <div className="flex items-start gap-3 text-[18px] font-semibold text-[#881337]">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600"
              >
                <AlertTriangle size={20} />
              </span>
              <span className="pt-1">{loadError}</span>
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
            className="anim-fade-up flex flex-col items-center rounded-card border-2 border-dashed border-brand-soft bg-white px-6 py-7 text-center shadow-card"
          >
            <span
              aria-hidden="true"
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand"
            >
              <Check size={24} strokeWidth={2.4} />
            </span>
            <p className="text-[20px] font-semibold text-ink">
              {selection.emptyMessage}
            </p>
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
              const offerEnableSharing = shouldOfferEnableSharing(
                settings,
                item.tier
              );

              return (
                <div key={item.id} className="space-y-3">
                  <DecisionConfirmCard
                    actionId={actionId}
                    tier={item.tier}
                    title={titleText}
                    summary={summaryText}
                    source={item.source}
                    priority={item.priority}
                    confirmLabel={confirmLabel}
                    onConfirm={(confirmation) =>
                      void handleConfirm(item, confirmation)
                    }
                    onDismiss={() => handleDismiss(item)}
                    showAskFamily={
                      item.tier === 3 && settings.caregiverShareEnabled
                    }
                    onAskFamily={
                      onAskFamily
                        ? () => onAskFamily(item)
                        : () => setPendingFamilyItem(item)
                    }
                    showEnableSharingOffer={offerEnableSharing}
                    onEnableSharing={() => void handleEnableFamilySharing()}
                  />

                  {pendingFamilyItem?.id === item.id ? (
                    <div
                      role="region"
                      aria-label="Confirm ask family to check"
                      data-card="true"
                      className="rounded-card border-2 border-brand-soft bg-brand-wash p-5 shadow-card space-y-4"
                    >
                      <p className="text-[18px] font-semibold text-ink">
                        Send a short summary of this single item to{' '}
                        {settings.familyMembers[0]?.name ?? 'Trusted Family'}?
                        Your family code word is never included.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <SeniorButton
                          variant="primary"
                          icon={<Check size={20} />}
                          onClick={() => void handleConfirmAskFamily(item)}
                        >
                          Confirm Share with Family
                        </SeniorButton>
                        <SeniorButton
                          variant="secondary"
                          icon={<X size={20} />}
                          onClick={() => setPendingFamilyItem(undefined)}
                        >
                          Cancel
                        </SeniorButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Syed carousel dot indicator bar */}
            <div
              aria-hidden="true"
              className="mt-2 flex items-center justify-center gap-1.5"
            >
              {selection.visible.map((item, idx) => (
                <span
                  key={item.id}
                  className={`h-[6px] rounded-full transition-all duration-200 ${
                    idx === 0 ? 'w-5 bg-red-500' : 'w-[6px] bg-line'
                  }`}
                />
              ))}
            </div>

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

      <section aria-labelledby="sections-heading" className="space-y-3">
        <SectionHeader
          id="sections-heading"
          title="Your Helpers"
          count={HOME_SECTION_CARDS.length}
          countTone="brand"
        />

        <div className="grid grid-cols-1 gap-3.5">
          {HOME_SECTION_CARDS.map((card) => (
            <a
              key={card.id}
              href={card.href}
              onClick={(e) => handleLinkClick(e, card.href)}
              data-card="true"
              className="pressable anim-fade-up block overflow-hidden rounded-card border border-line bg-white shadow-card no-underline transition-colors hover:border-brand-soft focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#0F766E]"
            >
              <span
                aria-hidden="true"
                className={`block h-1.5 w-full bg-gradient-to-r ${SECTION_ACCENTS[card.id]}`}
              />
              <span className="flex min-h-[84px] items-start gap-4 p-4">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
                >
                  {SECTION_ICONS[card.id]}
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-[20px] font-bold leading-snug text-ink">
                    {card.title}
                  </span>
                  <span className="block text-[16px] leading-snug text-muted">
                    {card.description}
                  </span>
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
