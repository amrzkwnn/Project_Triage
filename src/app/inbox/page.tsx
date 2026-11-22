'use client';

import React from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  Check,
  Eye,
  FolderPlus,
  HelpCircle,
  Inbox,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  ScanEye,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
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
import { inferCalendarCategory } from '@/lib/calendar/categories';
import { isDuplicateEvent } from '@/lib/calendar/snap';
import { availableForwardActions } from '@/lib/inbox/events';
import { saveItemToCategoryLocally } from '@/lib/inbox/itemActions';
import { extractEmailAddress, parseSenderDisplay } from '@/lib/inbox/sender';
import {
  clearEmailCheckStatus,
  readEmailCheckStatus,
  saveEmailCheckStatus,
  syncEmailsFromRelay,
  verifyCloudEmailConnection,
  type EmailCheckStatusSnapshot,
  type EmailProvider,
} from '@/lib/inbox/emailClient';
import {
  addInboxCategory,
  deleteInboxCategory,
  getVisibleInboxCategories,
  isProtectedInboxCategory,
} from '@/lib/inbox/categories';
import { filterByTab } from '@/lib/inbox/order';
import { normalizeSource, parseIngestQuery } from '@/lib/inbox/parse';
import { createPrescriptionItem } from '@/lib/inbox/prescription';
import {
  completeShortcutSetupLocally,
  dismissItemLocally,
  useAutoEmailCheck,
} from '@/lib/inbox/useAutoEmailCheck';
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
import type { OAuthTokenRecord, Vault } from '@/lib/vault/schema';
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

const GROUP_TAB_DOTS: Partial<Record<string, string>> = {
  Personal: 'bg-teal-500',
  Family: 'bg-violet-500',
  Others: 'bg-amber-500',
  Promotion: 'bg-slate-400',
};

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
          This lets you forward any WhatsApp, SMS, or Messenger note to Triage
          with two taps.
        </p>
      </div>
    ),
  },
  {
    id: 'shortcut-step-3',
    title: 'Open Triage with the shared message',
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
          Whenever you share a message, Triage shows a preview so you can
          confirm before saving it.
        </p>
      </div>
    ),
  },
] as const;

export function mergeInboxItemsById(
  prev: readonly InboxItem[],
  incoming: readonly InboxItem[]
): InboxItem[] {
  const seen = new Set(prev.map((item) => item.id));
  return [...prev, ...incoming.filter((item) => !seen.has(item.id))];
}

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

function findValidCloudAccount(
  records: readonly OAuthTokenRecord[]
): OAuthTokenRecord | undefined {
  return records.find(
    (rec) =>
      (rec.provider === 'Gmail' || rec.provider === 'Outlook') &&
      typeof rec.token === 'string' &&
      rec.token.trim().length > 0 &&
      rec.token.trim() !== 'readonly-session'
  );
}

function formatCheckedTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  try {
    return parsed.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
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
    ...(extractEmailAddress(draft.sender)
      ? { senderEmail: extractEmailAddress(draft.sender) }
      : {}),
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
          category:
            ev.category ??
            inferCalendarCategory(`${ev.title} ${params.item.text}`),
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

export const forwardEventToCalendar = confirmForwardToCalendarWithVault;

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
  const [settings, setSettings] = React.useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [items, setItems] = React.useState<InboxItem[]>(initialItems ?? []);
  const [existingEvents, setExistingEvents] = React.useState<CalendarEvent[]>(
    initialEvents ?? []
  );
  const [activeTab, setActiveTab] = React.useState<InboxFilterTab>('All');
  const [newCategoryName, setNewCategoryName] = React.useState<string>('');
  const [categoryError, setCategoryError] = React.useState<string | undefined>(
    undefined
  );
  const [showManualForm, setShowManualForm] = React.useState<boolean>(false);
  const [pasteSource, setPasteSource] = React.useState<Channel>('smsPaste');
  const [pasteSender, setPasteSender] = React.useState<string>('');
  const [pasteText, setPasteText] = React.useState<string>('');
  const [rxText, setRxText] = React.useState<string>('');
  const [expandedOriginalIds, setExpandedOriginalIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  const [pendingQueryDraft, setPendingQueryDraft] = React.useState<
    InboxItemDraft | undefined
  >(() => evaluateInitialQuery(initialQuery).draft);
  const [queryError, setQueryError] = React.useState<string | undefined>(
    () => evaluateInitialQuery(initialQuery).error
  );
  const [statusMessage, setStatusMessage] = React.useState<string>('');
  const [actionError, setActionError] = React.useState<string | undefined>(
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
  const [channelOffChannel, setChannelOffChannel] = React.useState<
    Channel | undefined
  >(initialChannelOffChannel);
  const [pendingCalendarForward, setPendingCalendarForward] = React.useState<
    { item: InboxItem; event: DetectedEvent; isDuplicate: boolean } | undefined
  >(initialPendingCalendarForward);
  const [savePickerItemId, setSavePickerItemId] = React.useState<
    string | undefined
  >(undefined);
  const [pendingFamilyItemId, setPendingFamilyItemId] = React.useState<
    string | undefined
  >(undefined);
  const [isCheckingEmails, setIsCheckingEmails] = React.useState<boolean>(false);
  const [reconnectMessage, setReconnectMessage] = React.useState<
    string | undefined
  >(initialReconnectMessage);
  const needsInitialLoad =
    initialSettings === undefined ||
    initialItems === undefined ||
    initialEvents === undefined;
  const [initialLoadDone, setInitialLoadDone] = React.useState<boolean>(
    !needsInitialLoad
  );
  const [emailAccount, setEmailAccount] = React.useState<
    OAuthTokenRecord | undefined
  >(undefined);
  const [lastCheckStatus, setLastCheckStatus] = React.useState<
    EmailCheckStatusSnapshot | undefined
  >(undefined);
  const [emailConnectionState, setEmailConnectionState] = React.useState<
    'disconnected' | 'connected' | 'expired' | 'error'
  >(initialReconnectMessage ? 'expired' : 'disconnected');
  const autoCheckedEmailRef = React.useRef<boolean>(false);

  const resolvedVault = React.useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const runEmailCheck = React.useCallback(
    async (
      currentSettings: Settings,
      options?: { silentOnError?: boolean }
    ) => {
      const gate = admit(currentSettings, { source: 'email' });
      if (!gate.admit) {
        if (!options?.silentOnError) {
          setChannelOffChannel('email');
          setActionError(gate.message);
          setStatusMessage(gate.message);
        }
        return;
      }

      if (!resolvedVault) {
        if (!options?.silentOnError) {
          setStatusMessage('Checked for new emails. You are all caught up.');
        }
        return;
      }

      setIsCheckingEmails(true);
      try {
        let activeAccount = emailAccount;
        if (
          !activeAccount &&
          typeof resolvedVault.listOAuthTokens === 'function'
        ) {
          const tokensRes = await resolvedVault.listOAuthTokens();
          if (tokensRes.ok) {
            activeAccount = findValidCloudAccount(tokensRes.value);
            setEmailAccount(activeAccount);
          }
        }

        const activeProvider: EmailProvider | undefined =
          activeAccount?.provider === 'Gmail' ||
          activeAccount?.provider === 'Outlook'
            ? activeAccount.provider
            : undefined;

        const res = await syncEmailsFromRelay({
          vault: resolvedVault,
          settings: currentSettings,
        });
        const nowIso = new Date().toISOString();

        if (!res.ok) {
          const snapshot: EmailCheckStatusSnapshot = {
            ...(activeAccount ? { account: activeAccount.account } : {}),
            ...(activeProvider ? { provider: activeProvider } : {}),
            checkedAtIso: nowIso,
            checkedCount: 0,
            newCount: 0,
            status: 'error',
            message: res.errorMessage,
          };
          saveEmailCheckStatus(snapshot);
          setLastCheckStatus(snapshot);
          if (activeAccount) {
            setEmailConnectionState('error');
          }
          if (!options?.silentOnError || Boolean(activeAccount)) {
            setActionError(res.errorMessage);
            setStatusMessage(res.errorMessage);
          }
          return;
        }

        if (res.reconnectRequired) {
          const nextReconnectMessage = res.reconnectMessage ?? res.message;
          const snapshot: EmailCheckStatusSnapshot = {
            ...(activeAccount ? { account: activeAccount.account } : {}),
            ...(activeProvider ? { provider: activeProvider } : {}),
            checkedAtIso: nowIso,
            checkedCount: res.checkedCount,
            newCount: 0,
            status: 'expired',
            message: nextReconnectMessage,
          };
          saveEmailCheckStatus(snapshot);
          setLastCheckStatus(snapshot);
          setEmailConnectionState('expired');
          setReconnectMessage(nextReconnectMessage);
          setStatusMessage(nextReconnectMessage);
          return;
        }

        setReconnectMessage(undefined);
        setActionError(undefined);
        setEmailConnectionState(activeAccount ? 'connected' : 'disconnected');

        const snapshot: EmailCheckStatusSnapshot = {
          ...(activeAccount ? { account: activeAccount.account } : {}),
          ...(activeProvider ? { provider: activeProvider } : {}),
          checkedAtIso: nowIso,
          checkedCount: res.checkedCount,
          newCount: res.stored.length,
          status: 'ok',
          message: res.message,
        };
        saveEmailCheckStatus(snapshot);
        setLastCheckStatus(snapshot);

        if (res.stored.length > 0) {
          const newIds = new Set(res.stored.map((item) => item.id));
          setItems((prev) => [
            ...res.stored,
            ...prev.filter((item) => !newIds.has(item.id)),
          ]);
        }
        if (!options?.silentOnError || res.stored.length > 0) {
          setStatusMessage(res.message);
        }
      } finally {
        setIsCheckingEmails(false);
      }
    },
    [resolvedVault, emailAccount]
  );

  const handleCheckNewEmails = async () => {
    setActionError(undefined);
    setChannelOffChannel(undefined);
    await runEmailCheck(settings, { silentOnError: false });
  };

  const loadData = React.useCallback(async () => {
    if (!resolvedVault) {
      setInitialLoadDone(true);
      return;
    }
    try {
      const [settingsRes, itemsRes, eventsRes, tokensRes] = await Promise.all([
        resolvedVault.getSettings(),
        resolvedVault.listItems(),
        resolvedVault.listEvents(),
        typeof resolvedVault.listOAuthTokens === 'function'
          ? resolvedVault.listOAuthTokens()
          : Promise.resolve({
              ok: true as const,
              value: [] as OAuthTokenRecord[],
            }),
      ]);
      if (settingsRes.ok) {
        setSettings(settingsRes.value);
      }
      if (itemsRes.ok) {
        setItems((prev) => mergeInboxItemsById(prev, itemsRes.value));
      }
      if (eventsRes.ok) {
        setExistingEvents(eventsRes.value);
      }
      if (tokensRes.ok) {
        let removedAnyStub = false;
        for (const rec of tokensRes.value) {
          const trimmed = typeof rec.token === 'string' ? rec.token.trim() : '';
          if (trimmed.length === 0 || trimmed === 'readonly-session') {
            await resolvedVault.deleteOAuthToken?.(rec.id);
            removedAnyStub = true;
          }
        }

        const validAccount = findValidCloudAccount(tokensRes.value);
        if (!validAccount) {
          if (removedAnyStub) {
            clearEmailCheckStatus();
          }
          setEmailAccount(undefined);
          setLastCheckStatus(undefined);
          setEmailConnectionState(
            initialReconnectMessage ? 'expired' : 'disconnected'
          );
        } else {
          setEmailAccount(validAccount);
          const hydratedStatus = readEmailCheckStatus();
          const matchingStatus =
            hydratedStatus &&
            (!hydratedStatus.account ||
              hydratedStatus.account === validAccount.account)
              ? hydratedStatus
              : undefined;

          const effectiveEmailOn = settingsRes.ok
            ? settingsRes.value.channels.email
            : (initialSettings?.channels.email ?? false);
          const willAutoCheck =
            initialItems === undefined &&
            effectiveEmailOn &&
            !autoCheckedEmailRef.current;

          if (willAutoCheck) {
            setLastCheckStatus(matchingStatus);
          } else {
            const verification = await verifyCloudEmailConnection({
              record: validAccount,
            });
            if (verification.status === 'connected') {
              setEmailConnectionState('connected');
              setReconnectMessage(undefined);
              setLastCheckStatus(matchingStatus);
            } else if (verification.status === 'expired') {
              setEmailConnectionState('expired');
              setReconnectMessage(verification.message);
              setLastCheckStatus(matchingStatus);
            } else if (verification.status === 'offline') {
              setEmailConnectionState('error');
              setLastCheckStatus(matchingStatus);
            } else {
              setEmailAccount(undefined);
              setLastCheckStatus(undefined);
              setEmailConnectionState('disconnected');
            }
          }
        }
      }
    } finally {
      setInitialLoadDone(true);
    }
  }, [resolvedVault, initialReconnectMessage, initialItems, initialSettings]);

  React.useEffect(() => {
    if (needsInitialLoad) {
      void loadData();
    } else {
      setInitialLoadDone(true);
    }
  }, [needsInitialLoad, loadData]);

  React.useEffect(() => {
    if (
      initialLoadDone &&
      initialItems === undefined &&
      settings.channels.email &&
      resolvedVault &&
      !autoCheckedEmailRef.current
    ) {
      autoCheckedEmailRef.current = true;
      void runEmailCheck(settings, { silentOnError: true });
    }
  }, [initialLoadDone, initialItems, settings, resolvedVault, runEmailCheck]);

  useAutoEmailCheck({
    enabled: Boolean(settings.channels.email && emailAccount && resolvedVault),
    onCheck: () => runEmailCheck(settings, { silentOnError: true }),
  });

  React.useEffect(() => {
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

  const visibleCategories = React.useMemo(
    () => getVisibleInboxCategories(settings),
    [settings]
  );

  const effectiveActiveTab: InboxFilterTab = visibleCategories.includes(
    activeTab
  )
    ? activeTab
    : 'All';

  const assignableCategories = React.useMemo(
    () => visibleCategories.filter((cat) => cat !== 'All'),
    [visibleCategories]
  );

  const categoryChipItems: ReadonlyArray<FilterChipItem<InboxFilterTab>> =
    React.useMemo(
      () =>
        visibleCategories.map((tab) => ({
          id: tab,
          label: tab,
          ...(tab === 'All'
            ? {}
            : { dot: GROUP_TAB_DOTS[tab] ?? 'bg-sky-500' }),
        })),
      [visibleCategories]
    );

  const visibleItems = React.useMemo(() => {
    const dismissed = new Set(settings.dismissedItemIds ?? []);
    const active =
      dismissed.size > 0
        ? items.filter((item) => !dismissed.has(item.id))
        : items;
    return filterByTab(active, effectiveActiveTab);
  }, [items, effectiveActiveTab, settings.dismissedItemIds]);

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

  const handleDismissItem = async (item: InboxItem) => {
    setActionError(undefined);
    setPendingCalendarForward((prev) =>
      prev?.item.id === item.id ? undefined : prev
    );
    setPendingFamilyItemId((prev) => (prev === item.id ? undefined : prev));

    const res = await dismissItemLocally({
      itemId: item.id,
      settings,
      vault: resolvedVault,
    });

    if (!res.ok) {
      setActionError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }

    setSettings((prev) => ({
      ...prev,
      ...res.settings,
      ...(prev.shortcutSetupCompleted || res.settings.shortcutSetupCompleted
        ? { shortcutSetupCompleted: true }
        : {}),
    }));
    setItems((prev) => prev.filter((existing) => existing.id !== item.id));
    setStatusMessage('Message dismissed and removed from this device.');
  };

  const mergeLatestVaultFlags = async (
    nextSettings: Settings
  ): Promise<Settings> => {
    if (!resolvedVault || typeof resolvedVault.getSettings !== 'function') {
      return nextSettings;
    }
    const latestRes = await resolvedVault.getSettings();
    if (!latestRes.ok) {
      return nextSettings;
    }
    const mergedDismissed = Array.from(
      new Set([
        ...(latestRes.value.dismissedItemIds ?? []),
        ...(nextSettings.dismissedItemIds ?? []),
      ])
    );
    return {
      ...nextSettings,
      ...(latestRes.value.shortcutSetupCompleted ||
      nextSettings.shortcutSetupCompleted
        ? { shortcutSetupCompleted: true }
        : {}),
      ...(mergedDismissed.length > 0
        ? { dismissedItemIds: mergedDismissed }
        : {}),
    };
  };

  const handleAddCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    setCategoryError(undefined);
    setActionError(undefined);

    const added = addInboxCategory(settings, newCategoryName);
    if (!added.ok) {
      setCategoryError(added.errorMessage);
      setStatusMessage(added.errorMessage);
      return;
    }

    const nextSettings = await mergeLatestVaultFlags(added.settings);
    if (resolvedVault) {
      const saveRes = await resolvedVault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        setCategoryError(saveRes.error.message);
        setActionError(saveRes.error.message);
        setStatusMessage(saveRes.error.message);
        return;
      }
    }

    setSettings(nextSettings);
    setNewCategoryName('');
    setStatusMessage(`Added category "${added.category}".`);
  };

  const handleDeleteCategory = async (categoryName: string) => {
    setCategoryError(undefined);
    setActionError(undefined);

    const deleted = deleteInboxCategory(settings, categoryName);
    if (!deleted.ok) {
      setCategoryError(deleted.errorMessage);
      setStatusMessage(deleted.errorMessage);
      return;
    }

    const nextSettings = await mergeLatestVaultFlags(deleted.settings);
    if (resolvedVault) {
      const saveRes = await resolvedVault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        setCategoryError(saveRes.error.message);
        setActionError(saveRes.error.message);
        setStatusMessage(saveRes.error.message);
        return;
      }
    }

    setSettings(nextSettings);
    if (
      effectiveActiveTab.trim().toLowerCase() ===
      categoryName.trim().toLowerCase()
    ) {
      setActiveTab('All');
    }
    setStatusMessage(`Deleted category "${categoryName}".`);
  };

  const handleMoveItemCategory = async (
    item: InboxItem,
    nextCategory: string
  ) => {
    if (nextCategory === item.group) {
      return;
    }
    setActionError(undefined);
    const res = await saveItemToCategoryLocally({
      item,
      category: nextCategory,
      vault: resolvedVault,
    });
    if (!res.ok) {
      setActionError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }
    const updatedItem = res.item;

    setItems((prev) =>
      prev.map((existing) => (existing.id === item.id ? updatedItem : existing))
    );
    setStatusMessage(`Moved message to ${updatedItem.group}.`);
  };

  const handleCompleteShortcutSetup = async () => {
    setSettings((prev) => ({
      ...prev,
      shortcutSetupCompleted: true,
    }));
    setStatusMessage('Phone shortcut guide completed.');
    const res = await completeShortcutSetupLocally({
      settings,
      vault: resolvedVault,
    });
    if (!res.ok) {
      setActionError(res.errorMessage);
      setStatusMessage(res.errorMessage);
      return;
    }
    setSettings((prev) => ({
      ...prev,
      ...res.settings,
      shortcutSetupCompleted: true,
    }));
  };

  return (
    <div className="space-y-7 pb-6">
      <section className="space-y-3">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          Unified Inbox
        </h1>
        <p className="text-[18px] leading-relaxed text-muted">
          All your chosen messages and prescription photos in one calm list with
          clear summaries.
        </p>

        {/* Always-visible manual paste / photo entry and email check buttons */}
        <div className="flex flex-wrap gap-3 pt-1">
          <SeniorButton
            variant="primary"
            icon={<Plus size={22} />}
            aria-expanded={showManualForm}
            onClick={() => setShowManualForm((prev) => !prev)}
          >
            + Paste Message or Pick Photo
          </SeniorButton>
          <SeniorButton
            variant="secondary"
            icon={
              <RefreshCw
                size={20}
                className={isCheckingEmails ? 'animate-spin' : undefined}
              />
            }
            disabled={isCheckingEmails}
            onClick={() => void handleCheckNewEmails()}
          >
            {isCheckingEmails ? 'Checking Emails...' : 'Check for New Emails'}
          </SeniorButton>
        </div>
      </section>

      <StatusLive message={statusMessage} />

      {/* Live Email Connection & Last-Checked Status Card */}
      {(() => {
        const displayAccount = emailAccount?.account ?? lastCheckStatus?.account;
        const displayProvider =
          emailAccount?.provider === 'Gmail' ||
          emailAccount?.provider === 'Outlook'
            ? emailAccount.provider
            : lastCheckStatus?.provider;

        return (
          <section
            aria-label="Email connection status"
            data-card="true"
            className="rounded-card border border-line bg-white p-4 shadow-card space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {isCheckingEmails ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-brand-soft bg-brand-wash px-3.5 py-1.5 text-[16px] font-bold text-brand-deep shadow-pill"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <RefreshCw size={16} className="animate-spin" />
                  </span>
                  <span>Checking Emails Now...</span>
                </span>
              ) : emailConnectionState === 'expired' ||
                Boolean(reconnectMessage) ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-[#D97706] bg-amber-50 px-3.5 py-1.5 text-[16px] font-bold text-[#92400E] shadow-pill"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <AlertTriangle size={16} />
                  </span>
                  <span>
                    {displayAccount && displayProvider
                      ? `Reconnect Needed (${displayProvider}): ${displayAccount}`
                      : 'Reconnect Needed'}
                  </span>
                </span>
              ) : emailConnectionState === 'connected' &&
                displayAccount &&
                displayProvider ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-[16px] font-bold text-emerald-800 shadow-pill"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <Check size={16} />
                  </span>
                  <span>
                    {`Connected (${displayProvider}): ${displayAccount}`}
                  </span>
                </span>
              ) : emailConnectionState === 'error' &&
                displayAccount &&
                displayProvider ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-[#BE123C] bg-red-50 px-3.5 py-1.5 text-[16px] font-bold text-[#881337] shadow-pill"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <AlertTriangle size={16} />
                  </span>
                  <span>
                    {`Could Not Check (${displayProvider}): ${displayAccount}`}
                  </span>
                </span>
              ) : (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-line bg-canvas px-3.5 py-1.5 text-[16px] font-bold text-muted shadow-pill"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <Mail size={16} />
                  </span>
                  <span>Email Not Connected</span>
                </span>
              )}
            </div>

            {lastCheckStatus &&
            (emailAccount || emailConnectionState !== 'disconnected') ? (
              <p className="text-[16px] text-muted tnum">
                Last checked: {formatCheckedTime(lastCheckStatus.checkedAtIso)}{' '}
                Ã¢â‚¬Â¢ {lastCheckStatus.checkedCount}{' '}
                {lastCheckStatus.checkedCount === 1 ? 'email' : 'emails'}{' '}
                checked, {lastCheckStatus.newCount} new
              </p>
            ) : (
              <p className="text-[16px] text-muted">
                {emailAccount
                  ? 'Tap Check for New Emails above whenever you want a fresh look.'
                  : 'Connect Gmail or Outlook in My Data to check emails automatically.'}
              </p>
            )}
          </section>
        );
      })()}

      {/* Email reconnect prompt when connection expired/revoked */}
      {reconnectMessage ? (
        <div
          role="alert"
          data-card="true"
          className="rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-card space-y-3"
        >
          <p className="flex items-start gap-2 text-[18px] font-semibold text-[#92400E]">
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{reconnectMessage}</span>
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

      {/* Category Filter Bar & Category Management (Cleanly Above Mail Scroll Layer) */}
      <div className="space-y-3">
        <nav
          aria-label="Inbox groups"
          className="-mx-5 border-y border-line bg-canvas px-5 py-3 max-w-none"
        >
          <FilterChips
            items={categoryChipItems}
            value={effectiveActiveTab}
            onChange={(tab) => setActiveTab(tab)}
          />
        </nav>

        <details className="rounded-card border border-line bg-white shadow-card">
          <summary className="pressable flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[18px] font-bold text-ink">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 text-brand"
              >
                <FolderPlus size={20} />
              </span>
              <span>Manage Categories</span>
            </span>
            <span className="text-[15px] font-semibold text-brand-deep">
              Add or Delete
            </span>
          </summary>

          <div className="space-y-4 border-t border-line px-4 py-4">
            <form
              aria-label="Add inbox category"
              onSubmit={(e) => void handleAddCategory(e)}
              className="space-y-3"
            >
              <label
                htmlFor="new-inbox-category-input"
                className="block text-[18px] font-semibold text-ink"
              >
                New category name
              </label>
              <div className="flex flex-wrap gap-3">
                <input
                  id="new-inbox-category-input"
                  type="text"
                  maxLength={24}
                  value={newCategoryName}
                  onChange={(e) => {
                    setNewCategoryName(e.target.value);
                    if (categoryError) setCategoryError(undefined);
                  }}
                  placeholder="For example: Bills or Health"
                  className="min-h-[56px] min-w-[200px] flex-1 rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
                />
                <SeniorButton
                  type="submit"
                  variant="primary"
                  icon={<Plus size={20} />}
                >
                  Add Category
                </SeniorButton>
              </div>
              {categoryError ? (
                <p
                  role="alert"
                  className="rounded-chip border-2 border-[#BE123C] bg-red-50 px-3.5 py-2.5 text-[16px] font-semibold text-[#881337]"
                >
                  {categoryError}
                </p>
              ) : null}
            </form>

            <div className="space-y-2 border-t border-line/70 pt-3">
              <p className="text-[16px] font-semibold text-muted">
                Your categories (Personal and All are always kept):
              </p>
              <ul className="space-y-2">
                {visibleCategories.map((category) => {
                  const isProtected = isProtectedInboxCategory(category);
                  return (
                    <li
                      key={category}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-chip border border-line bg-canvas px-3.5 py-2"
                    >
                      <span className="text-[18px] font-semibold text-ink">
                        {category}
                      </span>
                      {isProtected ? (
                        <span
                          data-badge="true"
                          className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand-soft bg-brand-wash px-3 py-1 text-[15px] font-semibold text-brand-deep"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex shrink-0"
                          >
                            <Lock size={14} />
                          </span>
                          <span>Always Kept</span>
                        </span>
                      ) : (
                        <SeniorButton
                          variant="secondary"
                          icon={<Trash2 size={18} />}
                          aria-label={`Delete ${category}`}
                          onClick={() => void handleDeleteCategory(category)}
                        >
                          {`Delete ${category}`}
                        </SeniorButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </details>
      </div>

      {/* Dedicated Scrollable Mail Layer (Zero navigation/section controls inside) */}
      <div
        data-mail-scroll-layer="true"
        role="region"
        aria-label={`${effectiveActiveTab} mail list`}
        className="max-h-[60vh] min-h-[280px] overflow-y-auto overscroll-contain rounded-card border border-line bg-canvas/60 p-3"
      >
        <section aria-labelledby="inbox-list-heading" className="space-y-4">
          <h2
            id="inbox-list-heading"
            className="text-[22px] font-bold tracking-tight text-ink tnum"
          >
            {effectiveActiveTab} Messages ({visibleItems.length})
          </h2>

          {visibleItems.length === 0 ? (
            <EmptyState
              icon={<Inbox size={24} />}
              title={`No messages in ${effectiveActiveTab} yet.`}
              message="Messages and prescription photos you add will appear here with clear summaries."
            />
          ) : (
            <div className="space-y-4">
              {visibleItems.map((item) => {
                const actions = availableForwardActions(
                  item,
                  item.detectedEvent
                );
                const showOriginal = expandedOriginalIds.has(item.id);
                const isPhotoItem =
                  item.source === 'photos' && item.attachments.length > 0;
                const isLowConfidenceRx = isPhotoItem && item.tier === 3;
                const cardCategoryOptions = Array.from(
                  new Map(
                    [...assignableCategories, item.group]
                      .filter((cat) => cat.trim().toLowerCase() !== 'all')
                      .map((cat) => [cat.trim().toLowerCase(), cat] as const)
                  ).values()
                );
                const senderDisplay = parseSenderDisplay(
                  item.sender,
                  item.summary?.whoSent,
                  item.senderEmail
                );

                return (
                  <article
                    key={item.id}
                    data-card="true"
                    className="rounded-card border border-line bg-white p-5 shadow-card anim-fade-up space-y-4"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <SourceBadge source={item.source} />
                      <PriorityPill priority={item.priority} />
                      {item.mediaCheck ? (
                        <span
                          data-badge="true"
                          className={
                            item.mediaCheck.result === 'AI signal found'
                              ? 'inline-flex items-center gap-2 rounded-full border-2 border-[#BE123C] bg-[#FFF1F2] px-3.5 py-1 text-[15px] font-bold text-[#881337]'
                              : item.mediaCheck.result === 'Camera signal found'
                                ? 'inline-flex items-center gap-2 rounded-full border-2 border-[#0F766E] bg-[#F0FDFA] px-3.5 py-1 text-[15px] font-bold text-[#115E59]'
                                : 'inline-flex items-center gap-2 rounded-full border-2 border-[#D97706] bg-[#FFFBEB] px-3.5 py-1 text-[15px] font-bold text-[#92400E]'
                          }
                        >
                          <span aria-hidden="true" className="inline-flex shrink-0">
                            {item.mediaCheck.result === 'AI signal found' ? (
                              <ShieldAlert size={16} />
                            ) : item.mediaCheck.result === 'Camera signal found' ? (
                              <Camera size={16} />
                            ) : (
                              <HelpCircle size={16} />
                            )}
                          </span>
                          <span>{item.mediaCheck.result}</span>
                        </span>
                      ) : null}
                    </div>

                    {item.mediaCheck ? (
                      <div className="rounded-chip border border-line bg-canvas px-4 py-3 text-[16px] leading-snug text-ink space-y-1">
                        {item.mediaCheck.signalName ? (
                          <p className="font-semibold text-brand-deep">
                            Photo check detail: {item.mediaCheck.signalName}
                          </p>
                        ) : null}
                        <p>{item.mediaCheck.note}</p>
                      </div>
                    ) : null}

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
                        {senderDisplay.displayName}
                      </p>
                      {senderDisplay.emailAddress ? (
                        <p
                          data-sender-email="true"
                          className="break-all text-[15px] font-medium text-muted"
                        >
                          From: {senderDisplay.emailAddress}
                        </p>
                      ) : null}
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

                    <SeniorButton
                      variant="secondary"
                      icon={<FolderPlus size={20} />}
                      aria-expanded={savePickerItemId === item.id}
                      aria-label="Save to category"
                      onClick={() =>
                        setSavePickerItemId((prev) =>
                          prev === item.id ? undefined : item.id
                        )
                      }
                    >
                      Save to
                    </SeniorButton>

                    {actions.includes('shareWithFamily') &&
                    item.tier === 3 &&
                    canShowAskFamily(settings) ? (
                      <SeniorButton
                        variant="secondary"
                        icon={<Users size={20} />}
                        onClick={() => setPendingFamilyItemId(item.id)}
                      >
                        Forward Summary to Family
                      </SeniorButton>
                    ) : null}

                    <SeniorButton
                      variant="secondary"
                      icon={<X size={20} />}
                      onClick={() => void handleDismissItem(item)}
                    >
                      Dismiss
                    </SeniorButton>
                  </div>

                  {savePickerItemId === item.id ? (
                    <div
                      role="region"
                      aria-label="Choose a category to save to"
                      className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-canvas p-4"
                    >
                      {cardCategoryOptions.map((cat) => (
                        <SeniorButton
                          key={cat}
                          variant="secondary"
                          aria-pressed={cat === item.group}
                          className={cat === item.group ? 'border-brand bg-brand-soft' : ''}
                          onClick={() => {
                            setSavePickerItemId(undefined);
                            void handleMoveItemCategory(item, cat);
                          }}
                        >
                          {cat}
                        </SeniorButton>
                      ))}
                      <SeniorButton
                        variant="secondary"
                        icon={<X size={20} />}
                        onClick={() => setSavePickerItemId(undefined)}
                      >
                        Cancel
                      </SeniorButton>
                    </div>
                  ) : null}

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
                          ? ` Ã¢â‚¬Â¢ Time: ${pendingCalendarForward.event.time}`
                          : ''}
                        {pendingCalendarForward.event.location
                          ? ` Ã¢â‚¬Â¢ Location: ${pendingCalendarForward.event.location}`
                          : ''}
                        {` Ã¢â‚¬Â¢ Category: ${
                          pendingCalendarForward.event.category ??
                          inferCalendarCategory(
                            `${pendingCalendarForward.event.title} ${pendingCalendarForward.item.text}`
                          )
                        }`}
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
      </div>

      {/* Apple Shortcut Setup Wizard */}
      {!settings.shortcutSetupCompleted ? (
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
            onComplete={() => void handleCompleteShortcutSetup()}
          />
        </section>
      ) : null}
    </div>
  );
}

export default UnifiedInboxPage;
