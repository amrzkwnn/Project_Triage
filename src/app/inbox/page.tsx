'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  Eye,
  Inbox,
  Mail,
  Plus,
  ScanEye,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips, type FilterChipItem } from '@/components/FilterChips';
import { PriorityPill } from '@/components/PriorityPill';
import { SeniorButton } from '@/components/SeniorButton';
import { SourceBadge } from '@/components/SourceBadge';
import { StatusLive } from '@/components/StatusLive';
import { StepWizard } from '@/components/StepWizard';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import { canShowAskFamily, shareItemWithFamily } from '@/lib/actions/sharing';
import { analyze } from '@/lib/ai/engine';
import { isDuplicateEvent } from '@/lib/calendar/snap';
import { availableForwardActions } from '@/lib/inbox/events';
import { filterByTab, filterPromotions } from '@/lib/inbox/order';
import { normalizeSource, parseIngestQuery } from '@/lib/inbox/parse';
import { createPrescriptionItem } from '@/lib/inbox/prescription';
import {
  createDefaultSettings,
  type Attachment,
  type CalendarEvent,
  type Channel,
  type DetectedEvent,
  type GroupCategory,
  type InboxItem,
  type InboxItemDraft,
  type Settings,
} from '@/lib/types';
import { CHANNEL_LABELS, admit } from '@/lib/vault/consent';
import type { Vault } from '@/lib/vault/schema';
import { setChannelToggle } from '@/lib/vault/settings';
import { createVault } from '@/lib/vault/store';

export const FORWARDED_MEDIA_STORAGE_KEY = 'sdc_forwarded_media_image';

type InboxFilterTab = GroupCategory | 'All' | 'Promotion';

export type UnifiedInboxPageProps = {
  initialSettings?: Settings;
  initialItems?: InboxItem[];
  initialEvents?: CalendarEvent[];
  initialQuery?: string;
  initialReconnectMessage?: string;
  initialPendingCalendarForward?: {
    item: InboxItem;
    event: DetectedEvent;
    isDuplicate: boolean;
  };
  initialChannelOffChannel?: Channel;
  vault?: Vault;
  onNavigate?: (href: string) => void;
  onForwardToScamCheck?: (text: string) => void;
  onForwardToAiImageCheck?: (attachment: Attachment) => void;
};

const GROUP_TABS: readonly InboxFilterTab[] = [
  'Personal',
  'Family',
  'Others',
  'All',
  'Promotion',
] as const;

const GROUP_TAB_DOTS: Partial<Record<InboxFilterTab, string>> = {
  Personal: 'bg-teal-500',
  Family: 'bg-violet-500',
  Others: 'bg-amber-500',
  Promotion: 'bg-slate-400',
};

const GROUP_CHIP_ITEMS: ReadonlyArray<FilterChipItem<InboxFilterTab>> =
  GROUP_TABS.map((tab) => ({
    id: tab,
    label: tab,
    ...(GROUP_TAB_DOTS[tab] ? { dot: GROUP_TAB_DOTS[tab] } : {}),
  }));

const APPLE_SHORTCUT_STEPS = [
  {
    id: 'shortcut-step-1',
    title: 'Open the Shortcuts app on your iPhone',
    content: (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-card border border-brand-soft bg-brand-wash p-4">
          <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-card">
            <Smartphone size={22} />
          </span>
          <span className="text-[18px] font-semibold text-brand-deep">
            Visual Guide 1: Tap the blue and pink Shortcuts icon on your Home Screen.
          </span>
        </div>
        <p className="text-[18px] text-ink">
          Tap the plus button at the top right to create a new helper shortcut.
        </p>
      </div>
    ),
  },
  {
    id: 'shortcut-step-2',
    title: 'Add Share Sheet support for text and photos',
    content: (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-card border border-brand-soft bg-brand-wash p-4">
          <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-card">
            <Mail size={22} />
          </span>
          <span className="text-[18px] font-semibold text-brand-deep">
            Visual Guide 2: Turn on Show in Share Sheet for Text and Images.
          </span>
        </div>
        <p className="text-[18px] text-ink">
          This lets you forward any WhatsApp, SMS, or Messenger note to My Daily
          Helper with two taps.
        </p>
      </div>
    ),
  },
  {
    id: 'shortcut-step-3',
    title: 'Open My Daily Helper with the shared message',
    content: (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-card border border-brand-soft bg-brand-wash p-4">
          <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-card">
            <Check size={22} />
          </span>
          <span className="text-[18px] font-semibold text-brand-deep">
            Visual Guide 3: Choose Open Web Address pointing to your Inbox.
          </span>
        </div>
        <p className="text-[18px] text-ink">
          Whenever you share a message, My Daily Helper shows a preview so you
          can confirm before saving it.
        </p>
      </div>
    ),
  },
] as const;

export function evaluateInitialQuery(query: string | undefined): {
  draft?: InboxItemDraft;
  error?: string;
} {
  if (!query || query.trim().length === 0 || query === '?') {
    return {};
  }
  const parsed = parseIngestQuery(query);
  if (parsed.ok) {
    return { draft: parsed.value };
  }
  return { error: parsed.error.message };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

export async function ingestInboxDraftWithConsent(params: {
  draft: InboxItemDraft;
  settings: Settings;
  vault?: Pick<Vault, 'putItem' | 'appendAudit'>;
}): Promise<
  | { ok: true; item: InboxItem }
  | { ok: false; errorMessage: string }
> {
  const { draft, settings, vault } = params;
  const source = normalizeSource(draft.source);
  if (!source) {
    return {
      ok: false,
      errorMessage:
        'This message source could not be recognized. Please pick a supported source.',
    };
  }

  const decision = admit(settings, { source });
  if (!decision.admit) {
    return {
      ok: false,
      errorMessage: decision.message,
    };
  }

  const itemId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const auditVault = vault ?? {
    appendAudit: async () => ({ ok: true as const, value: undefined }),
  };

  const analyzed = await analyze(
    { ...draft, id: itemId, source },
    settings,
    {
      vault: auditVault,
      ruleCtx: { familyMembers: settings.familyMembers },
    }
  );

  if (!analyzed.ok) {
    return {
      ok: false,
      errorMessage: analyzed.error.message,
    };
  }

  const { analysis, tier } = analyzed.value;
  const item: InboxItem = {
    id: itemId,
    source,
    ...(draft.sender ? { sender: draft.sender } : {}),
    text: draft.text,
    attachments: draft.attachments,
    receivedAt: draft.receivedAt,
    group: analysis.group,
    priority: analysis.priority,
    summary: analysis.summary,
    ...(analysis.detectedEvent ? { detectedEvent: analysis.detectedEvent } : {}),
    ...(analysis.verdict ? { scamWarning: analysis.verdict } : {}),
    tier,
    confidence: analysis.confidence,
    status: 'ok',
    proposals: analysis.proposals,
  };

  if (vault) {
    const putRes = await vault.putItem(item);
    if (!putRes.ok) {
      return {
        ok: false,
        errorMessage: putRes.error.message,
      };
    }
  }

  return { ok: true, item };
}

export async function processPrescriptionPhotoWithConsent(params: {
  settings: Settings;
  photo: Attachment;
  extractedText: string;
  ocrConfidence: number;
  vault?: Pick<Vault, 'putItem'>;
}): Promise<
  | {
      ok: true;
      item: InboxItem;
      needsRetake: boolean;
      retakeMessage?: string;
    }
  | { ok: false; channelOff?: Channel; errorMessage: string }
> {
  const gate = admit(params.settings, { source: 'photos' });
  if (!gate.admit) {
    return {
      ok: false,
      channelOff: 'photos',
      errorMessage: gate.message,
    };
  }

  const targetVault = params.vault ?? {
    putItem: async () => ({ ok: true as const, value: undefined }),
  };

  const rxRes = await createPrescriptionItem({
    photo: params.photo,
    extractedText: params.extractedText,
    ocrConfidence: params.ocrConfidence,
    vault: targetVault,
  });

  if (!rxRes.ok) {
    return {
      ok: false,
      errorMessage: rxRes.error.message,
    };
  }

  return {
    ok: true,
    item: rxRes.value.item,
    needsRetake: rxRes.value.needsRetake,
    retakeMessage: rxRes.value.retakeMessage,
  };
}

export function prepareCalendarForward(
  item: InboxItem,
  existingEvents: readonly CalendarEvent[]
):
  | { item: InboxItem; event: DetectedEvent; isDuplicate: boolean }
  | undefined {
  if (!item.detectedEvent) return undefined;
  return {
    item,
    event: item.detectedEvent,
    isDuplicate: isDuplicateEvent(item.detectedEvent, existingEvents),
  };
}

export async function confirmForwardToCalendarWithVault(params: {
  item: InboxItem;
  event: DetectedEvent;
  vault?: Pick<Vault, 'putEvent'>;
}): Promise<
  | { ok: true; createdEvent: CalendarEvent }
  | { ok: false; errorMessage: string }
> {
  const actionId = `inbox-cal-${params.item.id}`;
  const confirmation = confirmFromTap(actionId);
  let createdEvent: CalendarEvent | undefined;

  const res = await execute(
    {
      actionId,
      kind: 'forwardToCalendar',
      event: params.event,
      itemId: params.item.id,
    },
    confirmation,
    {
      saveCalendarEvent: async (ev, itemId) => {
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
        createdEvent = calEvent;
        if (!params.vault) return { ok: true, value: undefined };
        const putRes = await params.vault.putEvent(calEvent);
        return putRes.ok
          ? { ok: true, value: undefined }
          : { ok: false, error: putRes.error.message };
      },
      sendFamilyShare: async () => ({ ok: true, value: undefined }),
      runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
      runEraseAll: async () => ({ ok: true, value: undefined }),
    }
  );

  if (!res.ok) {
    return { ok: false, errorMessage: res.error.message };
  }

  return { ok: true, createdEvent: createdEvent! };
}

export function UnifiedInboxPage({
  initialSettings,
  initialItems,
  initialEvents,
  initialQuery,
  initialReconnectMessage,
  initialPendingCalendarForward,
  initialChannelOffChannel,
  vault,
  onNavigate,
  onForwardToScamCheck,
  onForwardToAiImageCheck,
}: UnifiedInboxPageProps) {
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [items, setItems] = useState<InboxItem[]>(initialItems ?? []);
  const [existingEvents, setExistingEvents] = useState<CalendarEvent[]>(
    initialEvents ?? []
  );
  const [activeTab, setActiveTab] = useState<InboxFilterTab>('All');
  const [showManualForm, setShowManualForm] = useState<boolean>(false);
  const [pasteSource, setPasteSource] = useState<Channel>('smsPaste');
  const [pasteSender, setPasteSender] = useState<string>('');
  const [pasteText, setPasteText] = useState<string>('');
  const [rxText, setRxText] = useState<string>('');
  const [expandedOriginalIds, setExpandedOriginalIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [pendingQueryDraft, setPendingQueryDraft] = useState<
    InboxItemDraft | undefined
  >(() => evaluateInitialQuery(initialQuery).draft);
  const [queryError, setQueryError] = useState<string | undefined>(
    () => evaluateInitialQuery(initialQuery).error
  );
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [actionError, setActionError] = useState<string | undefined>(
    initialChannelOffChannel
      ? admit(initialSettings ?? createDefaultSettings(), {
          source: initialChannelOffChannel,
        }).admit
        ? undefined
        : (
            admit(initialSettings ?? createDefaultSettings(), {
              source: initialChannelOffChannel,
            }) as { admit: false; message: string }
          ).message
      : undefined
  );
  const [channelOffChannel, setChannelOffChannel] = useState<
    Channel | undefined
  >(initialChannelOffChannel);
  const [pendingCalendarForward, setPendingCalendarForward] = useState<
    { item: InboxItem; event: DetectedEvent; isDuplicate: boolean } | undefined
  >(initialPendingCalendarForward);
  const [pendingFamilyItemId, setPendingFamilyItemId] = useState<
    string | undefined
  >(undefined);

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadData = useCallback(async () => {
    if (!resolvedVault) return;
    const [settingsRes, itemsRes, eventsRes] = await Promise.all([
      resolvedVault.getSettings(),
      resolvedVault.listItems(),
      resolvedVault.listEvents(),
    ]);
    if (settingsRes.ok) {
      setSettings(settingsRes.value);
    }
    if (itemsRes.ok) {
      setItems(itemsRes.value);
    }
    if (eventsRes.ok) {
      setExistingEvents(eventsRes.value);
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (
      initialSettings === undefined ||
      initialItems === undefined ||
      initialEvents === undefined
    ) {
      void loadData();
    }
  }, [initialSettings, initialItems, initialEvents, loadData]);

  useEffect(() => {
    if (initialQuery !== undefined) {
      const evaluated = evaluateInitialQuery(initialQuery);
      setPendingQueryDraft(evaluated.draft);
      setQueryError(evaluated.error);
      return;
    }
    if (typeof window !== 'undefined') {
      const evaluated = evaluateInitialQuery(window.location.search);
      setPendingQueryDraft(evaluated.draft);
      setQueryError(evaluated.error);
    }
  }, [initialQuery]);

  const handleBack = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const visibleItems = useMemo(() => {
    if (activeTab === 'Promotion') {
      return filterPromotions(items);
    }
    return filterByTab(items, activeTab);
  }, [items, activeTab]);

  const ingestDraft = async (draft: InboxItemDraft): Promise<boolean> => {
    setActionError(undefined);
    setChannelOffChannel(undefined);
    const normalized = normalizeSource(draft.source);
    if (normalized) {
      const gate = admit(settings, { source: normalized });
      if (!gate.admit) {
        setChannelOffChannel(normalized);
        setActionError(gate.message);
        setStatusMessage(gate.message);
        return false;
      }
    }

    const result = await ingestInboxDraftWithConsent({
      draft,
      settings,
      vault: resolvedVault,
    });

    if (!result.ok) {
      setActionError(result.errorMessage);
      setStatusMessage(result.errorMessage);
      return false;
    }

    setItems((prev) => [result.item, ...prev]);
    setStatusMessage('Message added to your Unified Inbox.');
    return true;
  };

  const handleTurnOnChannel = async (channel: Channel) => {
    setActionError(undefined);
    if (!resolvedVault) {
      setSettings((prev) => ({
        ...prev,
        channels: { ...prev.channels, [channel]: true },
      }));
      setChannelOffChannel(undefined);
      setStatusMessage(`${CHANNEL_LABELS[channel]} is now ON.`);
      return;
    }
    const res = await setChannelToggle(resolvedVault, settings, channel, true);
    if (!res.ok) {
      setActionError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }
    setSettings(res.settings);
    setChannelOffChannel(undefined);
    setStatusMessage(`${CHANNEL_LABELS[channel]} is now ON. You can try again now.`);
  };

  const handleConfirmQueryDraft = async () => {
    if (!pendingQueryDraft) return;
    const ok = await ingestDraft(pendingQueryDraft);
    if (ok) {
      setPendingQueryDraft(undefined);
    }
  };

  const handleSaveManualPaste = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pasteText.trim().length === 0) {
      setActionError('Please paste a message before saving.');
      return;
    }
    const ok = await ingestDraft({
      source: pasteSource,
      sender: pasteSender.trim() || undefined,
      text: pasteText,
      attachments: [],
      receivedAt: new Date().toISOString(),
    });
    if (ok) {
      setPasteText('');
      setPasteSender('');
      setShowManualForm(false);
    }
  };

  const handlePrescriptionPhotoPick = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setActionError(undefined);
    setChannelOffChannel(undefined);

    const gate = admit(settings, { source: 'photos' });
    if (!gate.admit) {
      setChannelOffChannel('photos');
      setActionError(gate.message);
      setStatusMessage(gate.message);
      return;
    }

    let dataBase64: string | undefined;
    try {
      const buf = await file.arrayBuffer();
      const encoded = bytesToBase64(new Uint8Array(buf));
      if (encoded.length > 0) {
        dataBase64 = encoded;
      }
    } catch {
      dataBase64 = undefined;
    }

    const rxRes = await processPrescriptionPhotoWithConsent({
      settings,
      photo: {
        id: `rx-photo-${Date.now()}`,
        mime: file.type || 'image/jpeg',
        name: file.name,
        size: file.size,
        ...(dataBase64 ? { dataBase64 } : {}),
      },
      extractedText: rxText,
      ocrConfidence: rxText.trim().length > 0 ? 0.85 : 0.3,
      vault: resolvedVault,
    });

    if (!rxRes.ok) {
      if (rxRes.channelOff) {
        setChannelOffChannel(rxRes.channelOff);
      }
      setActionError(rxRes.errorMessage);
      setStatusMessage(rxRes.errorMessage);
      return;
    }

    setItems((prev) => [rxRes.item, ...prev]);
    setRxText('');
    setShowManualForm(false);
    setStatusMessage(
      rxRes.needsRetake
        ? rxRes.retakeMessage ?? 'Prescription photo is hard to read.'
        : 'Prescription photo saved to Personal and Important.'
    );
  };

  const handleRequestForwardToCalendar = async (item: InboxItem) => {
    if (!item.detectedEvent) return;
    setActionError(undefined);
    let currentEvents = existingEvents;
    if (resolvedVault) {
      const listRes = await resolvedVault.listEvents();
      if (listRes.ok) {
        currentEvents = listRes.value;
        setExistingEvents(listRes.value);
      }
    }
    const prepared = prepareCalendarForward(item, currentEvents);
    if (prepared) {
      setPendingCalendarForward(prepared);
    }
  };

  const handleConfirmForwardToCalendar = async () => {
    if (!pendingCalendarForward) return;
    const { item, event: detectedEvent } = pendingCalendarForward;

    const res = await confirmForwardToCalendarWithVault({
      item,
      event: detectedEvent,
      vault: resolvedVault,
    });

    if (res.ok) {
      setExistingEvents((prev) => [...prev, res.createdEvent]);
      setPendingCalendarForward(undefined);
      setStatusMessage(`Added "${detectedEvent.title}" to your Calendar.`);
    } else {
      setActionError(res.errorMessage);
    }
  };

  const handleConfirmForwardToFamily = async (item: InboxItem) => {
    const actionId = `inbox-share-${item.id}`;
    const confirmation = confirmFromTap(actionId);
    const recipient = settings.familyMembers[0]?.name ?? 'Trusted Family';
    const auditVault = resolvedVault ?? {
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
      setActionError(shareRes.error.message);
      setStatusMessage(shareRes.error.message);
      return;
    }

    setPendingFamilyItemId(undefined);
    setStatusMessage(`Shared summary with ${recipient}.`);
  };

  const toggleOriginal = (id: string) => {
    setExpandedOriginalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-7 pb-6">
      <BackToHome onClick={handleBack} />

      <section className="space-y-3">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          Unified Inbox
        </h1>
        <p className="text-[18px] leading-relaxed text-muted">
          All your chosen messages and prescription photos in one calm list with
          clear summaries.
        </p>

        {/* Always-visible manual paste / photo entry button */}
        <div className="pt-1">
          <SeniorButton
            variant="primary"
            icon={<Plus size={22} />}
            aria-expanded={showManualForm}
            onClick={() => setShowManualForm((prev) => !prev)}
          >
            + Paste Message or Pick Photo
          </SeniorButton>
        </div>
      </section>

      <StatusLive message={statusMessage} />

      {/* Email reconnect prompt when connection expired/revoked */}
      {initialReconnectMessage ? (
        <div
          role="alert"
          data-card="true"
          className="rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-card space-y-3"
        >
          <p className="flex items-start gap-2 text-[18px] font-semibold text-[#92400E]">
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{initialReconnectMessage}</span>
          </p>
          <SeniorButton
            variant="primary"
            href="/my-data"
            onClick={
              onNavigate
                ? (e) => {
                    e.preventDefault();
                    onNavigate('/my-data');
                  }
                : undefined
            }
          >
            Reconnect Email in My Data
          </SeniorButton>
        </div>
      ) : null}

      {/* Shared Link Preview (/inbox?source=...&text=...) */}
      {queryError ? (
        <div
          role="alert"
          data-card="true"
          className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-5 shadow-card space-y-2"
        >
          <p className="flex items-start gap-2 text-[18px] font-semibold text-[#881337]">
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{queryError}</span>
          </p>
          <p className="text-[18px] text-ink">
            You can still use the &ldquo;+ Paste Message or Pick Photo&rdquo;
            button above.
          </p>
        </div>
      ) : null}

      {pendingQueryDraft ? (
        <section
          aria-label="Shared message preview"
          data-card="true"
          className="rounded-card border-2 border-brand-soft bg-brand-wash p-5 shadow-card space-y-4"
        >
          <h2 className="text-[22px] font-bold text-brand-deep">
            Add This Shared Message?
          </h2>
          <p className="text-[20px] leading-relaxed text-ink whitespace-pre-wrap">
            {pendingQueryDraft.text}
          </p>
          <div className="flex flex-wrap gap-4">
            <SeniorButton
              variant="primary"
              icon={<Check size={20} />}
              onClick={() => void handleConfirmQueryDraft()}
            >
              Confirm
            </SeniorButton>
            <SeniorButton
              variant="secondary"
              icon={<X size={20} />}
              onClick={() => {
                setPendingQueryDraft(undefined);
                setStatusMessage('Shared message cancelled.');
              }}
            >
              Cancel
            </SeniorButton>
          </div>
        </section>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          data-card="true"
          className="rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-4 shadow-card space-y-3 text-[18px] font-semibold text-[#881337]"
        >
          <p>{actionError}</p>
          {channelOffChannel ? (
            <div className="flex flex-wrap gap-3">
              <SeniorButton
                variant="primary"
                icon={<Check size={20} />}
                onClick={() => void handleTurnOnChannel(channelOffChannel)}
              >
                Turn On {CHANNEL_LABELS[channelOffChannel]}
              </SeniorButton>
              <SeniorButton
                variant="secondary"
                href="/my-data"
                onClick={
                  onNavigate
                    ? (e) => {
                        e.preventDefault();
                        onNavigate('/my-data');
                      }
                    : undefined
                }
              >
                Open My Data
              </SeniorButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Manual Paste & Prescription Photo Form */}
      {showManualForm ? (
        <section
          aria-label="Paste message or pick prescription photo"
          data-card="true"
          className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-5"
        >
          <h2 className="text-[22px] font-bold tracking-tight text-ink">
            Paste a Message
          </h2>
          <form
            onSubmit={(e) => void handleSaveManualPaste(e)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="inbox-source-select"
                className="block text-[18px] font-semibold text-ink"
              >
                Where did this message come from?
              </label>
              <select
                id="inbox-source-select"
                value={pasteSource}
                onChange={(e) => setPasteSource(e.target.value as Channel)}
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              >
                <option value="smsPaste">SMS</option>
                <option value="whatsappForward">WhatsApp</option>
                <option value="messengerPaste">Messenger</option>
                <option value="email">Email</option>
              </select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="inbox-sender-input"
                className="block text-[18px] font-semibold text-ink"
              >
                Who sent it? (optional)
              </label>
              <input
                id="inbox-sender-input"
                type="text"
                value={pasteSender}
                onChange={(e) => setPasteSender(e.target.value)}
                placeholder="For example: City Clinic or Mei Ling"
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="inbox-paste-textarea"
                className="block text-[18px] font-semibold text-ink"
              >
                Message text
              </label>
              <textarea
                id="inbox-paste-textarea"
                rows={4}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="w-full rounded-chip border-2 border-line bg-canvas p-4 text-[18px] text-ink focus:border-brand"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <SeniorButton
                type="submit"
                variant="primary"
                icon={<Check size={20} />}
              >
                Save Message
              </SeniorButton>
              <SeniorButton
                variant="secondary"
                icon={<X size={20} />}
                onClick={() => setShowManualForm(false)}
              >
                Close
              </SeniorButton>
            </div>
          </form>

          <hr className="border-t border-line" />

          <div className="space-y-3">
            <h3 className="text-[20px] font-bold text-ink">
              Or Snap a Prescription Photo
            </h3>
            <label
              htmlFor="rx-notes-input"
              className="block text-[18px] font-semibold text-ink"
            >
              Optional text read from medicine label
            </label>
            <input
              id="rx-notes-input"
              type="text"
              value={rxText}
              onChange={(e) => setRxText(e.target.value)}
              placeholder="For example: Blood pressure pill 2026-07-16 08:00"
              className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
            />
            <div className="rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-4 text-center space-y-3">
              <span
                aria-hidden="true"
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand"
              >
                <Camera size={22} />
              </span>
              <div>
                <label
                  htmlFor="rx-photo-input"
                  className="pressable inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-full border-2 border-brand bg-brand px-5 py-3 text-[18px] font-semibold text-white shadow-pill transition-colors hover:bg-brand-deep"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <Camera size={20} />
                  </span>
                  <span>Pick Prescription Photo</span>
                </label>
              </div>
              <input
                id="rx-photo-input"
                type="file"
                accept="image/*"
                onChange={(e) => void handlePrescriptionPhotoPick(e)}
                className="sr-only"
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* Sticky Frosted Group Filter Bar */}
      <nav
        aria-label="Inbox groups"
        className="sticky top-0 z-20 -mx-5 bg-canvas/95 px-5 py-3 backdrop-blur-md"
      >
        <FilterChips
          items={GROUP_CHIP_ITEMS}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Message groups"
        />
      </nav>

      {/* Inbox List */}
      <section aria-labelledby="inbox-list-heading" className="space-y-4">
        <h2
          id="inbox-list-heading"
          className="text-[22px] font-bold tracking-tight text-ink tnum"
        >
          {activeTab} Messages ({visibleItems.length})
        </h2>

        {visibleItems.length === 0 ? (
          <EmptyState
            icon={<Inbox size={24} />}
            title={`No messages in ${activeTab} yet.`}
            message="Messages and prescription photos you add will appear here with clear summaries."
          />
        ) : (
          <div className="space-y-4">
            {visibleItems.map((item) => {
              const actions = availableForwardActions(item, item.detectedEvent);
              const showOriginal = expandedOriginalIds.has(item.id);
              const isPhotoItem =
                item.source === 'photos' && item.attachments.length > 0;
              const isLowConfidenceRx = isPhotoItem && item.tier === 3;

              return (
                <article
                  key={item.id}
                  data-card="true"
                  className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <SourceBadge source={item.source} />
                    <PriorityPill priority={item.priority} />
                  </div>

                  {/* Prescription original photo preview above extracted text */}
                  {isPhotoItem ? (
                    <div className="rounded-card border border-brand-soft bg-canvas p-4 space-y-2">
                      <p className="text-[18px] font-bold text-brand-deep">
                        Original Photo: {item.attachments[0].name}
                      </p>
                      {item.attachments[0].dataBase64 ? (
                        <img
                          src={`data:${item.attachments[0].mime};base64,${item.attachments[0].dataBase64}`}
                          alt={`Original photo ${item.attachments[0].name}`}
                          className="max-h-48 rounded-chip border border-line bg-white object-contain"
                        />
                      ) : null}
                      {isLowConfidenceRx ? (
                        <div className="space-y-2 pt-2">
                          <p className="text-[18px] font-semibold text-[#881337]">
                            This photo is hard to read. Please retake it in
                            brighter light.
                          </p>
                          <SeniorButton
                            variant="warn"
                            icon={<Camera size={20} />}
                            onClick={() => setShowManualForm(true)}
                          >
                            Retake Photo
                          </SeniorButton>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Syed RecordDetail AI Summary Gradient Card */}
                  <div className="relative overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft/80 via-brand-wash to-white p-4 shadow-card">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-soft/50 blur-2xl"
                    />
                    <div className="relative space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-brand-deep">
                        <span aria-hidden="true" className="inline-flex shrink-0">
                          <Sparkles size={14} strokeWidth={2.4} />
                        </span>
                        <span>AI summary</span>
                      </p>
                      <p className="text-[18px] font-bold text-brand-deep">
                        {item.summary?.whoSent ?? item.sender ?? 'Unknown sender'}
                      </p>
                      <p className="text-[20px] leading-relaxed text-ink">
                        {item.summary?.text ?? item.text}
                      </p>
                      {item.summary?.actionNeeded ? (
                        <p className="text-[18px] font-semibold text-ink">
                          Next step: {item.summary.actionNeeded}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Safe literal original message viewer (zero HTML execution) */}
                  <div className="space-y-2">
                    <SeniorButton
                      variant="secondary"
                      icon={<Eye size={20} />}
                      aria-expanded={showOriginal}
                      onClick={() => toggleOriginal(item.id)}
                    >
                      {showOriginal
                        ? 'Hide Original Message'
                        : 'Read Original Message'}
                    </SeniorButton>

                    {showOriginal ? (
                      <pre className="whitespace-pre-wrap break-words rounded-chip border border-line bg-canvas p-4 font-sans text-[18px] text-ink">
                        {item.text}
                      </pre>
                    ) : null}
                  </div>

                  {/* Forward-To Actions */}
                  <div className="flex flex-wrap gap-3 border-t border-line/70 pt-3">
                    {actions.includes('forwardToCalendar') ? (
                      <SeniorButton
                        variant="primary"
                        icon={<Calendar size={20} />}
                        onClick={() =>
                          void handleRequestForwardToCalendar(item)
                        }
                      >
                        Forward to Calendar
                      </SeniorButton>
                    ) : null}

                    {actions.includes('checkScam')
                      ? (() => {
                          const scamHref = `/scam-shield?text=${encodeURIComponent(item.text)}`;
                          return (
                            <SeniorButton
                              variant="warn"
                              href={scamHref}
                              icon={<ShieldAlert size={20} />}
                              onClick={
                                onForwardToScamCheck || onNavigate
                                  ? (e) => {
                                      e.preventDefault();
                                      if (onForwardToScamCheck) {
                                        onForwardToScamCheck(item.text);
                                      } else if (onNavigate) {
                                        onNavigate(scamHref);
                                      }
                                    }
                                  : undefined
                              }
                            >
                              Forward to Scam Check
                            </SeniorButton>
                          );
                        })()
                      : null}

                    {actions.includes('checkAiImage')
                      ? (() => {
                          const firstImage = item.attachments.find((a) =>
                            a.mime.toLowerCase().startsWith('image/')
                          );
                          const mediaHref = firstImage
                            ? `/media-check?image=${encodeURIComponent(firstImage.name)}`
                            : '/media-check';
                          return (
                            <SeniorButton
                              variant="secondary"
                              href={mediaHref}
                              icon={<ScanEye size={20} />}
                              onClick={(e) => {
                                if (firstImage && typeof window !== 'undefined') {
                                  try {
                                    window.sessionStorage.setItem(
                                      FORWARDED_MEDIA_STORAGE_KEY,
                                      JSON.stringify({
                                        name: firstImage.name,
                                        mime: firstImage.mime,
                                        dataBase64: firstImage.dataBase64,
                                      })
                                    );
                                  } catch {
                                    // ignore storage quota failures
                                  }
                                }
                                if (onForwardToAiImageCheck && firstImage) {
                                  e.preventDefault();
                                  onForwardToAiImageCheck(firstImage);
                                } else if (onNavigate) {
                                  e.preventDefault();
                                  onNavigate(mediaHref);
                                }
                              }}
                            >
                              Forward to AI Image Check
                            </SeniorButton>
                          );
                        })()
                      : null}

                    {actions.includes('shareWithFamily') ? (
                      <SeniorButton
                        variant="secondary"
                        icon={<Users size={20} />}
                        onClick={() => setPendingFamilyItemId(item.id)}
                      >
                        Forward Summary to Family
                      </SeniorButton>
                    ) : null}
                  </div>

                  {pendingCalendarForward?.item.id === item.id ? (
                    <div
                      role="region"
                      aria-label="Confirm forward to calendar"
                      className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 shadow-card space-y-3"
                    >
                      <p className="text-[20px] font-bold text-brand-deep">
                        Add to Calendar?
                      </p>
                      <p className="text-[18px] font-semibold text-ink">
                        {pendingCalendarForward.event.title}
                      </p>
                      <p className="text-[18px] text-ink tnum">
                        Date: {pendingCalendarForward.event.date}
                        {pendingCalendarForward.event.time
                          ? ` • Time: ${pendingCalendarForward.event.time}`
                          : ''}
                        {pendingCalendarForward.event.location
                          ? ` • Location: ${pendingCalendarForward.event.location}`
                          : ''}
                      </p>
                      {pendingCalendarForward.isDuplicate ? (
                        <p
                          role="alert"
                          className="rounded-chip border-2 border-[#D97706] bg-amber-50 p-3 text-[18px] font-semibold text-[#92400E]"
                        >
                          A similar event already exists on{' '}
                          {pendingCalendarForward.event.date}. Confirm to add
                          this one too, or cancel.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        <SeniorButton
                          variant="safe"
                          icon={<Check size={20} />}
                          onClick={() => void handleConfirmForwardToCalendar()}
                        >
                          Confirm
                        </SeniorButton>
                        <SeniorButton
                          variant="secondary"
                          icon={<X size={20} />}
                          onClick={() => {
                            setPendingCalendarForward(undefined);
                            setStatusMessage('Calendar addition cancelled.');
                          }}
                        >
                          Cancel
                        </SeniorButton>
                      </div>
                    </div>
                  ) : null}

                  {pendingFamilyItemId === item.id ? (
                    <div
                      role="region"
                      aria-label="Confirm family summary share"
                      className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 shadow-card space-y-3"
                    >
                      {canShowAskFamily(settings) ? (
                        <>
                          <p className="text-[18px] font-semibold text-ink">
                            Confirm sending a summary of this single item to
                            your family?
                          </p>
                          <div className="flex flex-wrap gap-3">
                            <SeniorButton
                              variant="primary"
                              icon={<Check size={20} />}
                              onClick={() =>
                                void handleConfirmForwardToFamily(item)
                              }
                            >
                              Confirm Send Summary
                            </SeniorButton>
                            <SeniorButton
                              variant="secondary"
                              onClick={() => setPendingFamilyItemId(undefined)}
                            >
                              Cancel
                            </SeniorButton>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[18px] font-semibold text-ink">
                            Family Sharing is currently OFF. Turn it on in My
                            Data first.
                          </p>
                          <SeniorButton
                            variant="primary"
                            href="/my-data"
                            onClick={
                              onNavigate
                                ? (e) => {
                                    e.preventDefault();
                                    onNavigate('/my-data');
                                  }
                                : undefined
                            }
                          >
                            Open My Data
                          </SeniorButton>
                        </>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Apple Shortcut Setup Wizard */}
      <section aria-labelledby="shortcut-wizard-heading" className="space-y-4">
        <h2
          id="shortcut-wizard-heading"
          className="text-[22px] font-bold tracking-tight text-ink"
        >
          Easy Phone Shortcut Setup
        </h2>
        <StepWizard
          steps={APPLE_SHORTCUT_STEPS}
          completeLabel="Finish Setup"
          onComplete={() =>
            setStatusMessage('Phone shortcut guide completed.')
          }
        />
      </section>
    </div>
  );
}

export default UnifiedInboxPage;
