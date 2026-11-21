'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  Eye,
  Mail,
  Plus,
  ScanEye,
  ShieldAlert,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { PriorityPill } from '@/components/PriorityPill';
import { SeniorButton } from '@/components/SeniorButton';
import { SourceBadge } from '@/components/SourceBadge';
import { StatusLive } from '@/components/StatusLive';
import { StepWizard } from '@/components/StepWizard';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import { canShowAskFamily, shareItemWithFamily } from '@/lib/actions/sharing';
import { analyze } from '@/lib/ai/engine';
import { availableForwardActions } from '@/lib/inbox/events';
import { filterByTab, filterPromotions } from '@/lib/inbox/order';
import { normalizeSource, parseIngestQuery } from '@/lib/inbox/parse';
import { createPrescriptionItem } from '@/lib/inbox/prescription';
import {
  createDefaultSettings,
  type CalendarEvent,
  type Channel,
  type GroupCategory,
  type InboxItem,
  type InboxItemDraft,
  type Settings,
} from '@/lib/types';
import { admit } from '@/lib/vault/consent';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

type InboxFilterTab = GroupCategory | 'All' | 'Promotion';

export type UnifiedInboxPageProps = {
  initialSettings?: Settings;
  initialItems?: InboxItem[];
  initialQuery?: string;
  initialReconnectMessage?: string;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

const GROUP_TABS: readonly InboxFilterTab[] = [
  'Personal',
  'Family',
  'Others',
  'All',
  'Promotion',
] as const;

const APPLE_SHORTCUT_STEPS = [
  {
    id: 'shortcut-step-1',
    title: 'Open the Shortcuts app on your iPhone',
    content: (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4">
          <span aria-hidden="true" className="inline-flex shrink-0 text-[#0F766E]">
            <Smartphone size={28} />
          </span>
          <span className="text-[18px] font-semibold text-[#115E59]">
            Visual Guide 1: Tap the blue and pink Shortcuts icon on your Home Screen.
          </span>
        </div>
        <p className="text-[18px] text-[#111827]">
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
        <div className="flex items-center gap-3 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4">
          <span aria-hidden="true" className="inline-flex shrink-0 text-[#0F766E]">
            <Mail size={28} />
          </span>
          <span className="text-[18px] font-semibold text-[#115E59]">
            Visual Guide 2: Turn on Show in Share Sheet for Text and Images.
          </span>
        </div>
        <p className="text-[18px] text-[#111827]">
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
        <div className="flex items-center gap-3 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4">
          <span aria-hidden="true" className="inline-flex shrink-0 text-[#0F766E]">
            <Check size={28} />
          </span>
          <span className="text-[18px] font-semibold text-[#115E59]">
            Visual Guide 3: Choose Open Web Address pointing to your Inbox.
          </span>
        </div>
        <p className="text-[18px] text-[#111827]">
          Whenever you share a message, My Daily Helper shows a preview so you
          can confirm before saving it.
        </p>
      </div>
    ),
  },
] as const;

export function UnifiedInboxPage({
  initialSettings,
  initialItems,
  initialQuery,
  initialReconnectMessage,
  vault,
  onNavigate,
}: UnifiedInboxPageProps) {
  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [items, setItems] = useState<InboxItem[]>(initialItems ?? []);
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
  >(() => {
    if (!initialQuery) return undefined;
    const parsed = parseIngestQuery(initialQuery);
    return parsed.ok ? parsed.value : undefined;
  });
  const [queryError, setQueryError] = useState<string | undefined>(() => {
    if (!initialQuery) return undefined;
    const parsed = parseIngestQuery(initialQuery);
    return parsed.ok ? undefined : parsed.error.message;
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pendingFamilyItemId, setPendingFamilyItemId] = useState<
    string | undefined
  >(undefined);

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadData = useCallback(async () => {
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
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined || initialItems === undefined) {
      void loadData();
    }
  }, [initialSettings, initialItems, loadData]);

  useEffect(() => {
    if (
      initialQuery === undefined &&
      typeof window !== 'undefined' &&
      window.location.search.length > 1
    ) {
      const parsed = parseIngestQuery(window.location.search);
      if (parsed.ok) {
        setPendingQueryDraft(parsed.value);
        setQueryError(undefined);
      } else {
        setPendingQueryDraft(undefined);
        setQueryError(parsed.error.message);
      }
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

  const ingestDraft = async (draft: InboxItemDraft) => {
    setActionError(undefined);
    const source = normalizeSource(draft.source);
    if (!source) {
      setActionError(
        'This message source could not be recognized. Please pick a supported source.'
      );
      return;
    }

    const decision = admit(settings, { source });
    if (!decision.admit) {
      setActionError(decision.message);
      setStatusMessage(decision.message);
      return;
    }

    const itemId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const auditVault = resolvedVault ?? {
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
      setActionError(analyzed.error.message);
      setStatusMessage(analyzed.error.message);
      return;
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
      ...(analysis.detectedEvent
        ? { detectedEvent: analysis.detectedEvent }
        : {}),
      ...(analysis.verdict ? { scamWarning: analysis.verdict } : {}),
      tier,
      confidence: analysis.confidence,
      status: 'ok',
      proposals: analysis.proposals,
    };

    if (resolvedVault) {
      const putRes = await resolvedVault.putItem(item);
      if (!putRes.ok) {
        setActionError(putRes.error.message);
        return;
      }
    }

    setItems((prev) => [item, ...prev]);
    setStatusMessage('Message added to your Unified Inbox.');
  };

  const handleConfirmQueryDraft = async () => {
    if (!pendingQueryDraft) return;
    await ingestDraft(pendingQueryDraft);
    setPendingQueryDraft(undefined);
  };

  const handleSaveManualPaste = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pasteText.trim().length === 0) {
      setActionError('Please paste a message before saving.');
      return;
    }
    await ingestDraft({
      source: pasteSource,
      sender: pasteSender.trim() || undefined,
      text: pasteText,
      attachments: [],
      receivedAt: new Date().toISOString(),
    });
    setPasteText('');
    setPasteSender('');
    setShowManualForm(false);
  };

  const handlePrescriptionPhotoPick = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setActionError(undefined);

    const targetVault = resolvedVault ?? {
      putItem: async () => ({ ok: true as const, value: undefined }),
    };

    const rxRes = await createPrescriptionItem({
      photo: {
        id: `rx-photo-${Date.now()}`,
        mime: file.type || 'image/jpeg',
        name: file.name,
        size: file.size,
      },
      extractedText: rxText,
      ocrConfidence: rxText.trim().length > 0 ? 0.85 : 0.3,
      vault: targetVault,
    });

    if (!rxRes.ok) {
      setActionError(rxRes.error.message);
      setStatusMessage(rxRes.error.message);
      return;
    }

    setItems((prev) => [rxRes.value.item, ...prev]);
    setRxText('');
    setShowManualForm(false);
    setStatusMessage(
      rxRes.value.needsRetake
        ? rxRes.value.retakeMessage ?? 'Prescription photo is hard to read.'
        : 'Prescription photo saved to Personal and Important.'
    );
  };

  const handleForwardToCalendar = async (item: InboxItem) => {
    if (!item.detectedEvent) return;
    const actionId = `inbox-cal-${item.id}`;
    const confirmation = confirmFromTap(actionId);

    const res = await execute(
      {
        actionId,
        kind: 'forwardToCalendar',
        event: item.detectedEvent,
        itemId: item.id,
      },
      confirmation,
      {
        saveCalendarEvent: async (ev, itemId) => {
          if (!resolvedVault) return { ok: true, value: undefined };
          const calEvent: CalendarEvent = {
            id: `ev-${itemId}`,
            title: ev.title,
            date: ev.date,
            time: ev.time,
            location: ev.location,
            category: 'Medical',
            sourceItemId: itemId,
            createdAt: new Date().toISOString(),
          };
          const putRes = await resolvedVault.putEvent(calEvent);
          return putRes.ok
            ? { ok: true, value: undefined }
            : { ok: false, error: putRes.error.message };
        },
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
      }
    );

    if (res.ok) {
      setStatusMessage(
        `Added "${item.detectedEvent.title}" to your Calendar.`
      );
    } else {
      setActionError(res.error.message);
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
    <div className="space-y-8">
      <BackToHome onClick={handleBack} />

      <section className="space-y-3">
        <h1 className="text-[28px] font-bold leading-tight text-[#111827]">
          Unified Inbox
        </h1>
        <p className="text-[20px] leading-relaxed text-[#111827]">
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
          className="rounded-2xl border-2 border-[#D97706] bg-[#FFFBEB] p-5 space-y-3"
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
          className="rounded-2xl border-2 border-[#BE123C] bg-[#FFF1F2] p-5 space-y-2"
        >
          <p className="flex items-start gap-2 text-[18px] font-semibold text-[#881337]">
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{queryError}</span>
          </p>
          <p className="text-[18px] text-[#111827]">
            You can still use the &ldquo;+ Paste Message or Pick Photo&rdquo;
            button above.
          </p>
        </div>
      ) : null}

      {pendingQueryDraft ? (
        <section
          aria-label="Shared message preview"
          data-card="true"
          className="rounded-2xl border-2 border-[#0F766E] bg-[#F0FDFA] p-5 space-y-4"
        >
          <h2 className="text-[22px] font-bold text-[#115E59]">
            Add This Shared Message?
          </h2>
          <p className="text-[20px] leading-relaxed text-[#111827] whitespace-pre-wrap">
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
          className="rounded-2xl border-2 border-[#BE123C] bg-[#FFF1F2] p-4 text-[18px] font-semibold text-[#881337]"
        >
          {actionError}
        </div>
      ) : null}

      {/* Manual Paste & Prescription Photo Form */}
      {showManualForm ? (
        <section
          aria-label="Paste message or pick prescription photo"
          data-card="true"
          className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-5"
        >
          <h2 className="text-[22px] font-bold text-[#111827]">
            Paste a Message
          </h2>
          <form
            onSubmit={(e) => void handleSaveManualPaste(e)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="inbox-source-select"
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Where did this message come from?
              </label>
              <select
                id="inbox-source-select"
                value={pasteSource}
                onChange={(e) => setPasteSource(e.target.value as Channel)}
                className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
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
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Who sent it? (optional)
              </label>
              <input
                id="inbox-sender-input"
                type="text"
                value={pasteSender}
                onChange={(e) => setPasteSender(e.target.value)}
                placeholder="For example: City Clinic or Mei Ling"
                className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="inbox-paste-textarea"
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Message text
              </label>
              <textarea
                id="inbox-paste-textarea"
                rows={4}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] p-4 text-[18px] text-[#111827]"
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

          <hr className="border-t-2 border-[#E5E7EB]" />

          <div className="space-y-3">
            <h3 className="text-[20px] font-bold text-[#111827]">
              Or Snap a Prescription Photo
            </h3>
            <label
              htmlFor="rx-notes-input"
              className="block text-[18px] font-semibold text-[#111827]"
            >
              Optional text read from medicine label
            </label>
            <input
              id="rx-notes-input"
              type="text"
              value={rxText}
              onChange={(e) => setRxText(e.target.value)}
              placeholder="For example: Blood pressure pill 2026-07-16 08:00"
              className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
            />
            <label
              htmlFor="rx-photo-input"
              className="inline-flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] px-5 py-3 text-[18px] font-semibold text-[#115E59]"
            >
              <span aria-hidden="true" className="inline-flex shrink-0">
                <Camera size={22} />
              </span>
              <span>Pick Prescription Photo</span>
            </label>
            <input
              id="rx-photo-input"
              type="file"
              accept="image/*"
              onChange={(e) => void handlePrescriptionPhotoPick(e)}
              className="sr-only"
            />
          </div>
        </section>
      ) : null}

      {/* Group Tabs + Promotion Filter */}
      <nav aria-label="Inbox groups" className="flex flex-wrap gap-3">
        {GROUP_TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <SeniorButton
              key={tab}
              variant={selected ? 'primary' : 'secondary'}
              aria-pressed={selected}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </SeniorButton>
          );
        })}
      </nav>

      {/* Inbox List */}
      <section aria-labelledby="inbox-list-heading" className="space-y-4">
        <h2
          id="inbox-list-heading"
          className="text-[24px] font-bold text-[#111827]"
        >
          {activeTab} Messages ({visibleItems.length})
        </h2>

        {visibleItems.length === 0 ? (
          <div
            data-card="true"
            className="rounded-2xl border-2 border-[#111827] bg-white p-5 text-[20px] font-semibold text-[#111827]"
          >
            No messages in {activeTab} yet.
          </div>
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
                  className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <SourceBadge source={item.source} />
                    <PriorityPill priority={item.priority} />
                  </div>

                  {/* Prescription original photo preview above extracted text */}
                  {isPhotoItem ? (
                    <div className="rounded-xl border-2 border-[#0F766E] bg-[#FAF9F6] p-4 space-y-2">
                      <p className="text-[18px] font-bold text-[#115E59]">
                        Original Photo: {item.attachments[0].name}
                      </p>
                      {item.attachments[0].dataBase64 ? (
                        <img
                          src={`data:${item.attachments[0].mime};base64,${item.attachments[0].dataBase64}`}
                          alt={`Original photo ${item.attachments[0].name}`}
                          className="max-h-48 rounded-lg border-2 border-[#111827] object-contain"
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

                  <div className="space-y-1">
                    <p className="text-[18px] font-bold text-[#115E59]">
                      {item.summary?.whoSent ?? item.sender ?? 'Unknown sender'}
                    </p>
                    <p className="text-[20px] leading-relaxed text-[#111827]">
                      {item.summary?.text ?? item.text}
                    </p>
                    {item.summary?.actionNeeded ? (
                      <p className="text-[18px] font-semibold text-[#111827]">
                        Next step: {item.summary.actionNeeded}
                      </p>
                    ) : null}
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
                      <pre className="whitespace-pre-wrap break-words rounded-xl border-2 border-[#111827] bg-[#FAF9F6] p-4 font-sans text-[18px] text-[#111827]">
                        {item.text}
                      </pre>
                    ) : null}
                  </div>

                  {/* Forward-To Actions */}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {actions.includes('forwardToCalendar') ? (
                      <SeniorButton
                        variant="primary"
                        icon={<Calendar size={20} />}
                        onClick={() => void handleForwardToCalendar(item)}
                      >
                        Forward to Calendar
                      </SeniorButton>
                    ) : null}

                    {actions.includes('checkScam') ? (
                      <SeniorButton
                        variant="warn"
                        href="/scam-shield"
                        icon={<ShieldAlert size={20} />}
                        onClick={
                          onNavigate
                            ? (e) => {
                                e.preventDefault();
                                onNavigate('/scam-shield');
                              }
                            : undefined
                        }
                      >
                        Forward to Scam Check
                      </SeniorButton>
                    ) : null}

                    {actions.includes('checkAiImage') ? (
                      <SeniorButton
                        variant="secondary"
                        href="/media-check"
                        icon={<ScanEye size={20} />}
                        onClick={
                          onNavigate
                            ? (e) => {
                                e.preventDefault();
                                onNavigate('/media-check');
                              }
                            : undefined
                        }
                      >
                        Forward to AI Image Check
                      </SeniorButton>
                    ) : null}

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

                  {pendingFamilyItemId === item.id ? (
                    <div
                      role="region"
                      aria-label="Confirm family summary share"
                      className="rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4 space-y-3"
                    >
                      {canShowAskFamily(settings) ? (
                        <>
                          <p className="text-[18px] font-semibold text-[#111827]">
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
                          <p className="text-[18px] font-semibold text-[#111827]">
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
          className="text-[24px] font-bold text-[#111827]"
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
