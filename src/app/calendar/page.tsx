'use client';

import React from 'react';
import { Temporal } from 'temporal-polyfill';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  Camera,
  Check,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  SkipForward,
  Sparkles,
  Stethoscope,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { MonthCalendar } from '@/components/MonthCalendar';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import { autoPlanCalendarFromItems } from '@/lib/calendar/aiPlanClient';
import {
  CALENDAR_CATEGORIES,
  getCategoryMeta,
  inferCalendarCategory,
} from '@/lib/calendar/categories';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import {
  extractCalendarCandidatesFromText,
  type Candidate,
} from '@/lib/calendar/ocr';
import { REMINDER_LEADS } from '@/lib/calendar/reminders';
import {
  canKeepCandidate,
  candidateState,
  isDuplicateEvent,
  reviewCandidates,
} from '@/lib/calendar/snap';
import { viewMonth, viewToday, viewWeek } from '@/lib/calendar/views';
import {
  createDefaultSettings,
  type CalendarCategory,
  type CalendarEvent,
  type InboxItem,
  type ReminderLead,
  type Settings,
} from '@/lib/types';
import { admit } from '@/lib/vault/consent';
import type { Vault } from '@/lib/vault/schema';
import { setChannelToggle } from '@/lib/vault/settings';
import { createVault } from '@/lib/vault/store';

const ALLOWED_CALENDAR_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_CALENDAR_PHOTO_BYTES = 10 * 1024 * 1024;

type CalendarViewMode = 'Today' | 'This Week' | 'Month List';

const LEAD_LABELS: Record<ReminderLead, string> = {
  '15m': '15m (15 minutes before)',
  '30m': '30m (30 minutes before)',
  '1h': '1h (1 hour before)',
  '2h': '2h (2 hours before)',
  '1d': '1d (1 day before)',
};

function renderCategoryIcon(category: CalendarCategory): React.ReactNode {
  switch (category) {
    case 'Medical':
      return <Stethoscope size={20} />;
    case 'Family & Social':
      return <Users size={20} />;
    case 'Bills & Errands':
      return <Receipt size={20} />;
    case 'Daily Routine':
      return <Sun size={20} />;
  }
}

export async function applyCandidateDecisionWithPersistence(params: {
  candidate: Candidate;
  decision: 'keep' | 'skip' | 'keep-both';
  existingEvents: readonly CalendarEvent[];
  vault?: Pick<Vault, 'putEvent'>;
}): Promise<
  | { ok: true; nextEvents: CalendarEvent[]; statusMessage: string }
  | { ok: false; errorMessage: string }
> {
  const { candidate, decision, existingEvents, vault } = params;

  if (decision === 'skip') {
    return {
      ok: true,
      nextEvents: [...existingEvents],
      statusMessage: `Skipped "${candidate.title}".`,
    };
  }

  const reviewed = reviewCandidates({
    existing: existingEvents,
    pageConfidence: 0.9,
    candidates: [candidate],
    decisions: [
      {
        candidateId: candidate.id,
        decision,
        ...(candidate.dateConfirmed ? { confirmedDate: candidate.date } : {}),
      },
    ],
  });

  if (reviewed.lowConfidenceRejected) {
    return {
      ok: false,
      errorMessage:
        'Please confirm this date before keeping the event on your calendar.',
    };
  }

  const added = reviewed.events.slice(existingEvents.length);
  if (vault) {
    for (const ev of added) {
      const putRes = await vault.putEvent(ev);
      if (!putRes.ok) {
        return {
          ok: false,
          errorMessage: putRes.error.message,
        };
      }
    }
  }

  return {
    ok: true,
    nextEvents: reviewed.events,
    statusMessage: `Kept "${candidate.title}" on your calendar.`,
  };
}

export async function autoPickCalendarCategory(params: {
  title: string;
  location?: string;
  date: string;
  time?: string;
  todayIso: string;
  settings: Settings;
  vault?: Pick<Vault, 'appendAudit'>;
  fetchFn?: typeof fetch;
}): Promise<
  | {
      ok: true;
      category: CalendarCategory;
      checkedBy: 'ai' | 'device';
      message: string;
    }
  | { ok: false; message: string }
> {
  const trimmedTitle = params.title.trim();
  if (trimmedTitle.length === 0) {
    return {
      ok: false,
      message:
        'Please enter an event name first so we can suggest the best category.',
    };
  }

  const combinedText = `${trimmedTitle}${params.location?.trim() ? ` ${params.location.trim()}` : ''}`;
  const fallbackCategory = inferCalendarCategory(combinedText);

  if (!params.settings.allowAiReading) {
    return {
      ok: true,
      category: fallbackCategory,
      checkedBy: 'device',
      message: `Suggested "${fallbackCategory}" on this device for "${trimmedTitle}".`,
    };
  }

  const timePart = params.time?.trim() ? params.time.trim() : '12:00';
  const promptLine = `${params.date} ${timePart} ${trimmedTitle}${params.location?.trim() ? ` at ${params.location.trim()}` : ''}`;
  const planRes = await autoPlanCalendarFromItems({
    items: [{ text: promptLine }],
    existingEvents: [],
    todayIso: params.todayIso,
    settings: params.settings,
    vault: params.vault,
    fetchFn: params.fetchFn,
  });

  if (!planRes.ok) {
    return {
      ok: false,
      message: planRes.message,
    };
  }

  const suggested = planRes.candidates[0]?.category ?? fallbackCategory;
  return {
    ok: true,
    category: suggested,
    checkedBy: planRes.checkedBy,
    message:
      planRes.checkedBy === 'ai'
        ? `AI Helper suggested "${suggested}" for "${trimmedTitle}".`
        : `Suggested "${suggested}" on this device for "${trimmedTitle}".`,
  };
}

export type CalendarPageProps = {
  initialSettings?: Settings;
  initialEvents?: CalendarEvent[];
  initialInboxItems?: InboxItem[];
  initialToday?: string;
  initialView?: CalendarViewMode;
  initialFormOpen?: boolean;
  initialSnapCandidates?: Candidate[];
  initialPlanSource?: 'ai' | 'device';
  initialQueueError?: string;
  extractCalendarPhotoText?: (file: File) => Promise<string>;
  fetchFn?: typeof fetch;
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function CalendarPage({
  initialSettings,
  initialEvents,
  initialInboxItems,
  initialToday,
  initialView = 'Today',
  initialFormOpen = false,
  initialSnapCandidates = [],
  initialPlanSource,
  initialQueueError,
  extractCalendarPhotoText,
  fetchFn,
  vault,
  onNavigate,
}: CalendarPageProps) {
  const todayDate = React.useMemo(() => {
    if (initialToday) {
      const parsed = parsePlainDate(initialToday);
      if (parsed.ok) return parsed.value;
    }
    return Temporal.Now.plainDateISO();
  }, [initialToday]);

  const [settings, setSettings] = React.useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [events, setEvents] = React.useState<CalendarEvent[]>(
    initialEvents ?? []
  );
  const [inboxItems, setInboxItems] = React.useState<InboxItem[]>(
    initialInboxItems ?? []
  );
  const [viewMode, setViewMode] = React.useState<CalendarViewMode>(initialView);
  const [selectedIsoDate, setSelectedIsoDate] = React.useState<string>(() =>
    todayDate.toString()
  );

  // Automatic Plan from Messages & Emails state
  const [isAutoPlanning, setIsAutoPlanning] = React.useState<boolean>(false);
  const [autoPlanSource, setAutoPlanSource] = React.useState<
    'ai' | 'device' | undefined
  >(initialPlanSource);
  const [autoPlanMessage, setAutoPlanMessage] = React.useState<
    string | undefined
  >(undefined);
  const [autoPlanError, setAutoPlanError] = React.useState<string | undefined>(
    undefined
  );

  const selectedDate = React.useMemo(() => {
    const parsed = parsePlainDate(selectedIsoDate);
    return parsed.ok ? parsed.value : todayDate;
  }, [selectedIsoDate, todayDate]);

  // Add / Edit / Delete confirmation state
  const [formOpen, setFormOpen] = React.useState<boolean>(initialFormOpen);
  const [editingId, setEditingId] = React.useState<string | undefined>(
    undefined
  );
  const [formTitle, setFormTitle] = React.useState<string>('');
  const [formDate, setFormDate] = React.useState<string>(todayDate.toString());
  const [formTime, setFormTime] = React.useState<string>('09:00');
  const [formLocation, setFormLocation] = React.useState<string>('');
  const [formCategory, setFormCategory] =
    React.useState<CalendarCategory>('Daily Routine');
  const [categoryManuallyPicked, setCategoryManuallyPicked] =
    React.useState<boolean>(false);
  const [isPickingCategory, setIsPickingCategory] =
    React.useState<boolean>(false);
  const [formError, setFormError] = React.useState<string | undefined>(
    undefined
  );
  const [awaitingSaveConfirm, setAwaitingSaveConfirm] =
    React.useState<boolean>(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] = React.useState<
    CalendarEvent | undefined
  >(undefined);

  // Paper Calendar Snap 1-by-1 candidate review state
  const [snapPhotoName, setSnapPhotoName] = React.useState<string | undefined>(
    undefined
  );
  const [snapInputText, setSnapInputText] = React.useState<string>('');
  const [snapError, setSnapError] = React.useState<string | undefined>(
    undefined
  );
  const [queueError, setQueueError] = React.useState<string | undefined>(
    initialQueueError
  );
  const [snapQueue, setSnapQueue] = React.useState<Candidate[]>(
    initialSnapCandidates
  );
  const [confirmDateInput, setConfirmDateInput] = React.useState<string>(
    initialSnapCandidates[0]?.date ?? ''
  );

  const [statusMessage, setStatusMessage] = React.useState<string>('');

  const resolvedVault = React.useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadData = React.useCallback(async () => {
    if (!resolvedVault) return;
    const [settingsRes, eventsRes, itemsRes] = await Promise.all([
      resolvedVault.getSettings(),
      resolvedVault.listEvents(),
      resolvedVault.listItems(),
    ]);
    if (settingsRes.ok) {
      setSettings(settingsRes.value);
    }
    if (eventsRes.ok) {
      setEvents(eventsRes.value);
    }
    if (itemsRes.ok) {
      setInboxItems(itemsRes.value);
    }
  }, [resolvedVault]);

  React.useEffect(() => {
    if (
      initialSettings === undefined ||
      initialEvents === undefined ||
      initialInboxItems === undefined
    ) {
      void loadData();
    }
  }, [initialSettings, initialEvents, initialInboxItems, loadData]);

  const todayEvents = React.useMemo(
    () => viewToday(events, selectedDate),
    [events, selectedDate]
  );
  const weekGroups = React.useMemo(
    () => viewWeek(events, selectedDate),
    [events, selectedDate]
  );
  const monthGroups = React.useMemo(
    () =>
      viewMonth(
        events,
        Temporal.PlainYearMonth.from({
          year: selectedDate.year,
          month: selectedDate.month,
        })
      ),
    [events, selectedDate]
  );

  const handleSelectCalendarDate = (isoDate: string) => {
    setSelectedIsoDate(isoDate);
    setFormDate(isoDate);
  };

  const openAddForm = () => {
    setEditingId(undefined);
    setFormTitle('');
    setFormDate(selectedDate.toString());
    setFormTime('09:00');
    setFormLocation('');
    setFormCategory('Daily Routine');
    setCategoryManuallyPicked(false);
    setFormError(undefined);
    setAwaitingSaveConfirm(false);
    setFormOpen(true);
  };

  const openEditForm = (ev: CalendarEvent) => {
    setEditingId(ev.id);
    setFormTitle(ev.title);
    setFormDate(ev.date);
    setFormTime(ev.time ?? '');
    setFormLocation(ev.location ?? '');
    setFormCategory(ev.category);
    setCategoryManuallyPicked(true);
    setFormError(undefined);
    setAwaitingSaveConfirm(false);
    setFormOpen(true);
  };

  const handleTurnOnAiScanning = async () => {
    let baseSettings = settings;
    if (resolvedVault) {
      const latestRes = await resolvedVault.getSettings();
      if (latestRes.ok) {
        baseSettings = latestRes.value;
      }
    }
    const nextSettings: Settings = {
      ...baseSettings,
      allowAiReading: true,
    };
    if (resolvedVault) {
      const saveRes = await resolvedVault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        setAutoPlanError(saveRes.error.message);
        setStatusMessage(saveRes.error.message);
        return;
      }
    }
    setSettings(nextSettings);
    setAutoPlanError(undefined);
    setFormError(undefined);
    setStatusMessage(
      'AI scanning is now ON. You can auto-plan your calendar or auto-pick event categories with AI Helper.'
    );
  };

  const handleAutoPickCategory = async () => {
    setFormError(undefined);
    setIsPickingCategory(true);
    try {
      const pickRes = await autoPickCalendarCategory({
        title: formTitle,
        location: formLocation,
        date: formDate,
        time: formTime,
        todayIso: todayDate.toString(),
        settings,
        vault: resolvedVault,
        fetchFn,
      });
      if (!pickRes.ok) {
        setFormError(pickRes.message);
        setStatusMessage(pickRes.message);
        return;
      }
      setFormCategory(pickRes.category);
      setCategoryManuallyPicked(true);
      setStatusMessage(pickRes.message);
    } finally {
      setIsPickingCategory(false);
    }
  };

  const handleRequestSaveConfirm = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    if (formTitle.trim().length === 0) {
      setFormError('Please enter an event title.');
      return;
    }
    const parsedDate = parsePlainDate(formDate);
    if (!parsedDate.ok) {
      setFormError(parsedDate.error.message);
      return;
    }
    if (formTime.trim().length > 0) {
      const parsedTime = parsePlainTime(formTime.trim());
      if (!parsedTime.ok) {
        setFormError(parsedTime.error.message);
        return;
      }
    }
    setAwaitingSaveConfirm(true);
  };

  const handleConfirmSaveEvent = async () => {
    const actionId = editingId
      ? `calendar-edit-${editingId}`
      : `calendar-add-${Date.now()}`;
    const confirmation = confirmFromTap(actionId);

    const nextEvent: CalendarEvent = {
      id: editingId ?? `ev-${Date.now()}`,
      title: formTitle.trim(),
      date: formDate,
      ...(formTime.trim().length > 0 ? { time: formTime.trim() } : {}),
      ...(formLocation.trim().length > 0
        ? { location: formLocation.trim() }
        : {}),
      category: formCategory,
      createdAt: new Date().toISOString(),
    };

    const res = await execute(
      {
        actionId,
        kind: 'commitCalendarChange',
        payload: nextEvent,
      },
      confirmation,
      {
        saveCalendarEvent: async () => ({ ok: true, value: undefined }),
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => {
          if (resolvedVault) {
            const putRes = await resolvedVault.putEvent(nextEvent);
            if (!putRes.ok) {
              return { ok: false, error: putRes.error.message };
            }
          }
          return { ok: true, value: undefined };
        },
      }
    );

    if (!res.ok) {
      setFormError(res.error.message);
      return;
    }

    setEvents((prev) => {
      const without = prev.filter((item) => item.id !== nextEvent.id);
      return [...without, nextEvent];
    });
    setFormOpen(false);
    setAwaitingSaveConfirm(false);
    setStatusMessage(
      editingId
        ? `Updated "${nextEvent.title}" on your calendar.`
        : `Added "${nextEvent.title}" to your calendar.`
    );
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteEvent) return;
    const actionId = `calendar-delete-${pendingDeleteEvent.id}`;
    const confirmation = confirmFromTap(actionId);
    const target = pendingDeleteEvent;

    const res = await execute(
      {
        actionId,
        kind: 'commitCalendarChange',
        payload: { deleteId: target.id },
      },
      confirmation,
      {
        saveCalendarEvent: async () => ({ ok: true, value: undefined }),
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => {
          if (resolvedVault) {
            const delRes = await resolvedVault.deleteEvent(target.id);
            if (!delRes.ok) {
              return { ok: false, error: delRes.error.message };
            }
          }
          return { ok: true, value: undefined };
        },
      }
    );

    if (!res.ok) {
      setStatusMessage(res.error.message);
      return;
    }

    setEvents((prev) => prev.filter((ev) => ev.id !== target.id));
    setPendingDeleteEvent(undefined);
    setStatusMessage(`Removed "${target.title}" from your calendar.`);
  };

  const handleLeadChange = async (lead: ReminderLead) => {
    const nextSettings: Settings = { ...settings, reminderLead: lead };
    if (resolvedVault) {
      const res = await resolvedVault.saveSettings(nextSettings);
      if (!res.ok) {
        setStatusMessage(res.error.message);
        return;
      }
    }
    setSettings(nextSettings);
    setStatusMessage(`Reminder lead time set to ${LEAD_LABELS[lead]}.`);
  };

  const photosGate = admit(settings, { source: 'photos' });
  const photosAllowed = photosGate.admit;

  const handleTurnOnPhotos = async () => {
    setSnapError(undefined);
    if (!resolvedVault) {
      setSettings((prev) => ({
        ...prev,
        channels: { ...prev.channels, photos: true },
      }));
      setStatusMessage(
        'Photo access is now ON. You can snap a paper calendar photo now.'
      );
      return;
    }

    const res = await setChannelToggle(resolvedVault, settings, 'photos', true);
    if (!res.ok) {
      setSnapError(res.error.message);
      setStatusMessage(res.error.message);
      return;
    }

    setSettings(res.settings);
    setStatusMessage(
      'Photo access is now ON. You can snap a paper calendar photo now.'
    );
  };

  const detectedEventCount = React.useMemo(
    () =>
      inboxItems.filter(
        (item) =>
          item.detectedEvent !== undefined &&
          !isDuplicateEvent(
            {
              title: item.detectedEvent.title,
              date: item.detectedEvent.date,
            },
            events
          )
      ).length,
    [inboxItems, events]
  );

  const handleAutoPlanCalendar = async () => {
    setAutoPlanError(undefined);
    setAutoPlanMessage(undefined);
    setQueueError(undefined);

    if (inboxItems.length === 0) {
      const msg =
        'No saved messages or emails were found yet. Save messages in your Inbox first, then scan here.';
      setAutoPlanMessage(msg);
      setStatusMessage(msg);
      return;
    }

    const newestItems = [...inboxItems]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 15)
      .map((item) => ({
        id: item.id,
        text: item.text,
        sender: item.sender,
        receivedAt: item.receivedAt,
      }));

    setIsAutoPlanning(true);
    setStatusMessage('Scanning your messages and emails for upcoming plans...');

    try {
      const planRes = await autoPlanCalendarFromItems({
        items: newestItems,
        existingEvents: events,
        todayIso: todayDate.toString(),
        settings,
        vault: resolvedVault,
        fetchFn,
      });

      if (!planRes.ok) {
        setAutoPlanError(planRes.message);
        setStatusMessage(planRes.message);
        return;
      }

      setAutoPlanSource(planRes.checkedBy);
      setAutoPlanMessage(planRes.message);
      setStatusMessage(planRes.message);

      if (planRes.candidates.length > 0) {
        setSnapQueue(planRes.candidates);
        setConfirmDateInput(planRes.candidates[0]?.date ?? '');
      }
    } finally {
      setIsAutoPlanning(false);
    }
  };

  const handleExtractSnapCandidates = async (
    rawText: string,
    photoFileName?: string
  ) => {
    setSnapError(undefined);
    setQueueError(undefined);
    setAutoPlanError(undefined);
    setAutoPlanMessage(undefined);
    const gate = admit(settings, { source: 'photos' });
    if (!gate.admit) {
      setSnapError(gate.message);
      setStatusMessage(gate.message);
      return;
    }

    if (settings.allowAiReading && rawText.trim().length > 0) {
      setIsAutoPlanning(true);
      try {
        const aiRes = await autoPlanCalendarFromItems({
          items: [{ text: rawText }],
          existingEvents: events,
          todayIso: todayDate.toString(),
          settings,
          vault: resolvedVault,
          fetchFn,
        });
        if (aiRes.ok && aiRes.candidates.length > 0) {
          setSnapQueue(aiRes.candidates);
          setConfirmDateInput(aiRes.candidates[0]?.date ?? '');
          setAutoPlanSource(aiRes.checkedBy);
          setStatusMessage(
            photoFileName
              ? `Found ${aiRes.candidates.length} calendar item(s) from "${photoFileName}" to review one by one.`
              : aiRes.message
          );
          return;
        }
      } finally {
        setIsAutoPlanning(false);
      }
    }

    const extracted = extractCalendarCandidatesFromText(rawText, 0.85);
    if (!extracted.ok) {
      setSnapError(extracted.error.message);
      setStatusMessage(extracted.error.message);
      return;
    }
    setSnapQueue(extracted.value);
    setConfirmDateInput(extracted.value[0]?.date ?? '');
    setAutoPlanSource('device');
    setStatusMessage(
      photoFileName
        ? `Found ${extracted.value.length} calendar item(s) from "${photoFileName}" to review one by one.`
        : `Found ${extracted.value.length} calendar item(s) to review one by one.`
    );
  };

  const handleSnapPhotoPick = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setSnapError(undefined);
    const gate = admit(settings, { source: 'photos' });
    if (!gate.admit) {
      setSnapError(gate.message);
      setStatusMessage(gate.message);
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    if (
      !ALLOWED_CALENDAR_PHOTO_TYPES.has(file.type) ||
      file.size === 0 ||
      file.size > MAX_CALENDAR_PHOTO_BYTES
    ) {
      const msg =
        'Please choose a clear JPEG or PNG photo up to 10 MB of your paper calendar.';
      setSnapError(msg);
      setStatusMessage(msg);
      return;
    }

    setSnapPhotoName(file.name);

    if (extractCalendarPhotoText) {
      try {
        const extractedText = await extractCalendarPhotoText(file);
        setSnapInputText(extractedText);
        await handleExtractSnapCandidates(extractedText, file.name);
        return;
      } catch {
        const msg =
          'We could not read that calendar photo. Please try a clearer photo or type the lines below.';
        setSnapError(msg);
        setStatusMessage(msg);
        return;
      }
    }

    setStatusMessage(
      `Photo "${file.name}" selected. Paste or review the dates below, then tap Review Paper Calendar Items.`
    );
  };

  const handleParseSnapText = async () => {
    await handleExtractSnapCandidates(snapInputText);
  };

  const currentCandidate = snapQueue[0];
  const currentCandidateNeedsCheck = currentCandidate
    ? candidateState(currentCandidate) === 'please-check'
    : false;
  const currentCandidateDuplicate = currentCandidate
    ? isDuplicateEvent(currentCandidate, events)
    : false;
  const currentCandidateCanKeep = currentCandidate
    ? canKeepCandidate(currentCandidate)
    : false;

  const handleConfirmCandidateDate = () => {
    if (!currentCandidate) return;
    const parsed = parsePlainDate(confirmDateInput);
    if (!parsed.ok) {
      setQueueError(parsed.error.message);
      setStatusMessage(parsed.error.message);
      return;
    }
    setQueueError(undefined);
    setSnapQueue((prev) =>
      prev.map((c, idx) =>
        idx === 0 ? { ...c, date: confirmDateInput, dateConfirmed: true } : c
      )
    );
    setStatusMessage(
      `Date ${confirmDateInput} confirmed. You can now Keep or Skip this event.`
    );
  };

  const handleCandidateDecision = async (
    decision: 'keep' | 'skip' | 'keep-both'
  ) => {
    if (!currentCandidate) return;
    setQueueError(undefined);

    const outcome = await applyCandidateDecisionWithPersistence({
      candidate: currentCandidate,
      decision,
      existingEvents: events,
      vault: resolvedVault,
    });

    if (!outcome.ok) {
      setQueueError(outcome.errorMessage);
      setStatusMessage(outcome.errorMessage);
      return;
    }

    setEvents(outcome.nextEvents);
    setStatusMessage(outcome.statusMessage);
    const remaining = snapQueue.slice(1);
    setSnapQueue(remaining);
    setConfirmDateInput(remaining[0]?.date ?? '');
  };

  const renderEventCard = (ev: CalendarEvent) => {
    const meta = getCategoryMeta(ev.category);
    return (
      <article
        key={ev.id}
        data-card="true"
        className="rounded-card border border-line bg-white p-4 shadow-card space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="shrink-0 rounded-chip border border-brand-soft bg-brand-wash px-3 py-2 text-center">
              <p className="text-[16px] font-bold leading-none text-brand-deep tnum">
                {ev.time ?? 'All day'}
              </p>
              <p className="mt-1 text-[12px] font-semibold text-muted tnum">
                {ev.date}
              </p>
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-[20px] font-bold leading-snug text-ink">
                {ev.title}
              </h3>
              {ev.location ? (
                <p className="flex items-center gap-1.5 text-[16px] text-muted">
                  <span
                    aria-hidden="true"
                    className="inline-flex shrink-0 text-brand"
                  >
                    <MapPin size={16} />
                  </span>
                  <span>{ev.location}</span>
                </p>
              ) : null}
            </div>
          </div>

          <span
            data-badge="true"
            className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 text-[15px] font-bold ${meta.badgeClass}`}
          >
            <span aria-hidden="true" className="inline-flex shrink-0">
              {renderCategoryIcon(ev.category)}
            </span>
            <span>{meta.label}</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-line/70 pt-3">
          <SeniorButton
            variant="secondary"
            icon={<Pencil size={20} />}
            onClick={() => openEditForm(ev)}
          >
            Edit
          </SeniorButton>
          <SeniorButton
            variant="danger"
            icon={<Trash2 size={20} />}
            onClick={() => setPendingDeleteEvent(ev)}
          >
            Delete
          </SeniorButton>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6 pb-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
              Calendar
            </h1>
            <p className="mt-1 text-[16px] leading-relaxed text-muted">
              See your plans clearly by day, week, or month, and review paper
              calendar photos one event at a time.
            </p>
          </div>
          <SeniorButton
            variant="primary"
            icon={<Plus size={22} />}
            onClick={openAddForm}
          >
            Add Event
          </SeniorButton>
        </div>
      </section>

      <StatusLive message={statusMessage} />

      {/* View Switcher */}
      <SegmentedControl
        options={[
          { id: 'Today', label: 'Today' },
          { id: 'This Week', label: 'This Week' },
          { id: 'Month List', label: 'Month List' },
        ]}
        value={viewMode}
        onChange={setViewMode}
        ariaLabel="Calendar views"
      />

      {/* Dark Month Calendar Card */}
      <MonthCalendar
        selectedDate={selectedIsoDate}
        onSelectDate={handleSelectCalendarDate}
        events={events}
      />

      {/* Delete Confirmation */}
      {pendingDeleteEvent ? (
        <section
          role="region"
          aria-label="Confirm delete event"
          data-card="true"
          className="rounded-card border-2 border-red-200 bg-red-50/90 p-5 shadow-card space-y-4"
        >
          <p className="text-[20px] font-bold text-[#881337]">
            Remove &ldquo;{pendingDeleteEvent.title}&rdquo; on{' '}
            {pendingDeleteEvent.date}?
          </p>
          <div className="flex flex-wrap gap-4">
            <SeniorButton
              variant="danger"
              icon={<Trash2 size={20} />}
              onClick={() => void handleConfirmDelete()}
            >
              Confirm Delete
            </SeniorButton>
            <SeniorButton
              variant="secondary"
              icon={<X size={20} />}
              onClick={() => setPendingDeleteEvent(undefined)}
            >
              Cancel
            </SeniorButton>
          </div>
        </section>
      ) : null}

      {/* Add / Edit Event Form with Confirmation */}
      {formOpen ? (
        <section
          aria-label={editingId ? 'Edit calendar event' : 'Add calendar event'}
          data-card="true"
          className="rounded-card border-2 border-brand-soft bg-white p-5 shadow-card space-y-4"
        >
          <h2 className="text-[22px] font-bold text-ink">
            {editingId ? 'Edit Event' : 'Add a New Event'}
          </h2>
          <form onSubmit={handleRequestSaveConfirm} className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="cal-title"
                className="block text-[18px] font-semibold text-ink"
              >
                Event Name
              </label>
              <input
                id="cal-title"
                type="text"
                value={formTitle}
                onChange={(e) => {
                  const nextTitle = e.target.value;
                  setFormTitle(nextTitle);
                  if (!editingId && !categoryManuallyPicked) {
                    setFormCategory(
                      inferCalendarCategory(`${nextTitle} ${formLocation}`)
                    );
                  }
                }}
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="cal-date"
                  className="block text-[18px] font-semibold text-ink"
                >
                  Date (YYYY-MM-DD)
                </label>
                <input
                  id="cal-date"
                  type="text"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink tnum focus:border-brand"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="cal-time"
                  className="block text-[18px] font-semibold text-ink"
                >
                  Time (HH:MM, optional)
                </label>
                <input
                  id="cal-time"
                  type="text"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink tnum focus:border-brand"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="cal-category"
                className="block text-[18px] font-semibold text-ink"
              >
                Category
              </label>
              <select
                id="cal-category"
                value={formCategory}
                onChange={(e) => {
                  setCategoryManuallyPicked(true);
                  setFormCategory(e.target.value as CalendarCategory);
                }}
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              >
                {CALENDAR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-3 pt-1">
                <SeniorButton
                  variant="secondary"
                  icon={<Sparkles size={20} />}
                  disabled={isPickingCategory}
                  onClick={() => void handleAutoPickCategory()}
                >
                  {isPickingCategory
                    ? 'Picking Category...'
                    : 'Auto-Pick Category with AI'}
                </SeniorButton>
                {!settings.allowAiReading ? (
                  <SeniorButton
                    variant="secondary"
                    icon={<Sparkles size={20} />}
                    onClick={() => void handleTurnOnAiScanning()}
                  >
                    Turn On AI Scanning
                  </SeniorButton>
                ) : null}
              </div>
              {!settings.allowAiReading ? (
                <p className="text-[15px] leading-relaxed text-muted">
                  AI scanning is OFF, so categories are picked using built-in
                  on-device matching. Turn On AI Scanning to let AI Helper pick
                  categories for tricky event names.
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="cal-location"
                className="block text-[18px] font-semibold text-ink"
              >
                Location (optional)
              </label>
              <input
                id="cal-location"
                type="text"
                value={formLocation}
                onChange={(e) => {
                  const nextLocation = e.target.value;
                  setFormLocation(nextLocation);
                  if (!editingId && !categoryManuallyPicked) {
                    setFormCategory(
                      inferCalendarCategory(`${formTitle} ${nextLocation}`)
                    );
                  }
                }}
                className="min-h-[56px] w-full rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink focus:border-brand"
              />
            </div>

            {formError ? (
              <p role="alert" className="text-[18px] font-semibold text-[#881337]">
                {formError}
              </p>
            ) : null}

            {!awaitingSaveConfirm ? (
              <div className="flex flex-wrap gap-3">
                <SeniorButton
                  type="submit"
                  variant="primary"
                  icon={<Check size={20} />}
                >
                  Review Before Saving
                </SeniorButton>
                <SeniorButton
                  variant="secondary"
                  icon={<X size={20} />}
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </SeniorButton>
              </div>
            ) : (
              <div className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 space-y-3">
                <p className="text-[20px] font-bold text-ink">
                  Save &ldquo;{formTitle}&rdquo; on {formDate}
                  {formTime ? ` at ${formTime}` : ''}?
                </p>
                <div className="flex flex-wrap gap-3">
                  <SeniorButton
                    variant="safe"
                    icon={<Check size={20} />}
                    onClick={() => void handleConfirmSaveEvent()}
                  >
                    Confirm Save Event
                  </SeniorButton>
                  <SeniorButton
                    variant="secondary"
                    onClick={() => setAwaitingSaveConfirm(false)}
                  >
                    Go Back
                  </SeniorButton>
                </div>
              </div>
            )}
          </form>
        </section>
      ) : null}

      {/* Active Calendar View — Syed White Rounded Bottom Sheet */}
      <section
        aria-labelledby="calendar-view-heading"
        className="anim-fade-up space-y-4 rounded-t-[20px] border border-line bg-white px-5 pb-8 pt-5 shadow-lift"
      >
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line/70 pb-3">
          <div className="min-w-0">
            <h2
              id="calendar-view-heading"
              className="text-[22px] font-bold tracking-tight text-ink tnum"
            >
              {viewMode} ({selectedDate.toString()})
            </h2>
            <p className="mt-0.5 text-[14px] font-medium text-muted tnum">
              {viewMode === 'Today'
                ? todayEvents.length === 0
                  ? 'Free day'
                  : `${todayEvents.length} ${todayEvents.length === 1 ? 'event' : 'events'}`
                : viewMode === 'This Week'
                  ? '7-day schedule'
                  : `${monthGroups.reduce((acc, g) => acc + g.events.length, 0)} events this month`}
            </p>
          </div>
        </div>

        {viewMode === 'Today' ? (
          todayEvents.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={24} strokeWidth={2.2} />}
              title="Nothing planned"
              message="Tap a dotted date above or choose Add Event to save a plan."
              className="border-2 border-dashed border-brand-soft shadow-none"
            />
          ) : (
            <div className="space-y-3">{todayEvents.map(renderEventCard)}</div>
          )
        ) : null}

        {viewMode === 'This Week' ? (
          <div className="space-y-4">
            {weekGroups.map((group) => (
              <div
                key={group.dateStr}
                data-card="true"
                className="rounded-card border border-line bg-canvas/50 p-4 space-y-3"
              >
                <h3 className="text-[18px] font-bold text-brand-deep tnum">
                  {group.dateStr}
                </h3>
                {group.events.length === 0 ? (
                  <p className="text-[16px] text-muted">
                    {group.emptyLabel ?? 'Nothing planned'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {group.events.map(renderEventCard)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {viewMode === 'Month List' ? (
          monthGroups.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={24} strokeWidth={2.2} />}
              title="Nothing planned"
              message="No events saved for this month yet."
              className="border-2 border-dashed border-brand-soft shadow-none"
            />
          ) : (
            <div className="space-y-4">
              {monthGroups.map((group) => (
                <div
                  key={group.dateStr}
                  data-card="true"
                  className="rounded-card border border-line bg-canvas/50 p-4 space-y-3"
                >
                  <h3 className="text-[18px] font-bold text-brand-deep tnum">
                    {group.dateStr}
                  </h3>
                  <div className="space-y-3">
                    {group.events.map(renderEventCard)}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </section>

      {/* Automatic Plan from Messages & Emails */}
      <section
        aria-labelledby="auto-plan-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="auto-plan-heading"
            className="flex items-center gap-3 text-[22px] font-bold text-ink"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
            >
              <Sparkles size={22} />
            </span>
            <span>Automatic Plan from Messages &amp; Emails</span>
          </h2>

          {autoPlanSource ? (
            <span
              data-badge="true"
              className={
                autoPlanSource === 'ai'
                  ? 'inline-flex items-center gap-2 rounded-full border-2 border-brand bg-brand-wash px-3.5 py-1.5 text-[15px] font-bold text-brand-deep shadow-pill'
                  : 'inline-flex items-center gap-2 rounded-full border-2 border-line bg-canvas px-3.5 py-1.5 text-[15px] font-bold text-ink shadow-pill'
              }
            >
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 text-brand"
              >
                {autoPlanSource === 'ai' ? (
                  <Sparkles size={18} />
                ) : (
                  <CalendarCheck size={18} />
                )}
              </span>
              <span>
                {autoPlanSource === 'ai'
                  ? 'Planned with AI Helper'
                  : 'Found on This Device'}
              </span>
            </span>
          ) : null}
        </div>

        <p className="text-[16px] leading-relaxed text-muted">
          {inboxItems.length > 0
            ? `You have ${inboxItems.length} saved ${inboxItems.length === 1 ? 'message or email' : 'messages and emails'} ready to scan.${detectedEventCount > 0 ? ` ${detectedEventCount} possible ${detectedEventCount === 1 ? 'event is' : 'events are'} waiting for your review.` : ''} Every found plan asks for your approval first.`
            : 'Save emails or messages in your Inbox, then tap below to find appointments and review them one by one before adding to your calendar.'}
        </p>

        <div className="flex flex-wrap gap-3">
          <SeniorButton
            variant="primary"
            icon={<Sparkles size={20} />}
            disabled={isAutoPlanning}
            onClick={() => void handleAutoPlanCalendar()}
          >
            {isAutoPlanning
              ? 'Auto-Planning Calendar...'
              : 'Auto-Plan Calendar with AI'}
          </SeniorButton>
        </div>

        {!settings.allowAiReading ? (
          <div className="rounded-chip border border-line bg-canvas p-4 space-y-3">
            <p className="text-[16px] leading-relaxed text-muted">
              Built-in device scan is ready now. Turn on AI scanning to
              understand natural dates like &ldquo;next Tuesday at 3pm&rdquo;
              and pick event categories automatically. Every check is recorded
              in My Data, and you can turn it off anytime.
            </p>
            <SeniorButton
              variant="secondary"
              icon={<Sparkles size={20} />}
              onClick={() => void handleTurnOnAiScanning()}
            >
              Turn On AI Scanning
            </SeniorButton>
          </div>
        ) : null}

        {autoPlanError ? (
          <p role="alert" className="text-[18px] font-semibold text-[#881337]">
            {autoPlanError}
          </p>
        ) : null}

        {autoPlanMessage && !autoPlanError ? (
          <p role="status" className="text-[16px] font-semibold text-brand-deep">
            {autoPlanMessage}
          </p>
        ) : null}

        {/* Human-in-the-loop 1-by-1 confirmation queue */}
        {currentCandidate ? (
          <div
            role="region"
            aria-label="Review suggested calendar event"
            className="rounded-card border-2 border-brand-soft bg-brand-wash p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[18px] font-bold text-brand-deep tnum">
                Reviewing 1 of {snapQueue.length} remaining
              </p>
              {currentCandidateNeedsCheck ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-full border-2 border-[#D97706] bg-[#FFFBEB] px-3 py-1.5 text-[16px] font-bold text-[#92400E]"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <AlertTriangle size={18} />
                  </span>
                  <span>Please check</span>
                </span>
              ) : null}
            </div>

            <p className="text-[20px] font-bold text-ink">
              {currentCandidate.title}
            </p>
            <p className="text-[18px] text-muted tnum">
              Date: {currentCandidate.date}
              {currentCandidate.time ? ` • ${currentCandidate.time}` : ''} •{' '}
              {currentCandidate.category}
            </p>
            {currentCandidate.location ? (
              <p className="flex items-center gap-1.5 text-[16px] text-muted">
                <span
                  aria-hidden="true"
                  className="inline-flex shrink-0 text-brand"
                >
                  <MapPin size={16} />
                </span>
                <span>{currentCandidate.location}</span>
              </p>
            ) : null}

            {currentCandidateNeedsCheck ? (
              <div className="space-y-3 rounded-card border-2 border-amber-300 bg-white p-4">
                <label
                  htmlFor="snap-confirm-date"
                  className="block text-[18px] font-semibold text-ink"
                >
                  Please check and confirm this date (YYYY-MM-DD) before keeping:
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="snap-confirm-date"
                    type="text"
                    value={confirmDateInput}
                    onChange={(e) => setConfirmDateInput(e.target.value)}
                    className="min-h-[56px] rounded-chip border-2 border-line bg-canvas px-4 text-[18px] text-ink tnum focus:border-brand"
                  />
                  <SeniorButton
                    variant="primary"
                    icon={<Check size={20} />}
                    onClick={handleConfirmCandidateDate}
                  >
                    Confirm Date
                  </SeniorButton>
                </div>
              </div>
            ) : null}

            {currentCandidateDuplicate ? (
              <p className="text-[18px] font-semibold text-[#92400E]">
                A similar event already exists on {currentCandidate.date}. Would
                you like to keep both or skip?
              </p>
            ) : null}

            {queueError ? (
              <p
                role="alert"
                className="text-[18px] font-semibold text-[#881337]"
              >
                {queueError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {currentCandidateDuplicate ? (
                <SeniorButton
                  variant="warn"
                  disabled={!currentCandidateCanKeep}
                  icon={<Check size={20} />}
                  onClick={() => void handleCandidateDecision('keep-both')}
                >
                  Keep Both
                </SeniorButton>
              ) : (
                <SeniorButton
                  variant="safe"
                  disabled={!currentCandidateCanKeep}
                  icon={<Check size={20} />}
                  onClick={() => void handleCandidateDecision('keep')}
                >
                  Keep on Calendar
                </SeniorButton>
              )}
              <SeniorButton
                variant="secondary"
                icon={<SkipForward size={20} />}
                onClick={() => void handleCandidateDecision('skip')}
              >
                Skip
              </SeniorButton>
            </div>
          </div>
        ) : null}
      </section>

      {/* Paper Calendar Snap (1-by-1 Candidate Review) */}
      <section
        aria-labelledby="snap-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card space-y-4"
      >
        <h2
          id="snap-heading"
          className="flex items-center gap-3 text-[22px] font-bold text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <Camera size={22} />
          </span>
          <span>Paper Calendar Snap</span>
        </h2>

        {!photosAllowed ? (
          <div
            role="region"
            aria-label="Photos channel is off"
            className="rounded-card border-2 border-amber-200 bg-amber-50/70 p-4 space-y-4"
          >
            <span
              data-badge="true"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[#D97706] bg-white px-3 py-1.5 text-[16px] font-bold text-[#92400E]"
            >
              <span aria-hidden="true" className="inline-flex shrink-0">
                <Lock size={18} />
              </span>
              <span>Photo Access is OFF</span>
            </span>
            <p className="text-[18px] font-semibold text-ink">
              {photosGate.message}
            </p>
            <p className="text-[16px] text-muted">
              Turn on the Photos channel to snap a paper calendar photo and
              review appointments one by one.
            </p>
            <div className="flex flex-wrap gap-3">
              <SeniorButton
                variant="primary"
                icon={<Camera size={20} />}
                onClick={() => void handleTurnOnPhotos()}
              >
                Turn On Photos
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
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-6 text-center space-y-3">
              <label
                htmlFor="calendar-snap-photo-input"
                className="pressable inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-3 rounded-full border-2 border-brand bg-brand-wash px-5 py-3 text-[18px] font-semibold text-brand-deep shadow-pill hover:bg-brand-soft/60"
              >
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <Upload size={22} />
                </span>
                <span>Snap Paper Calendar Photo</span>
              </label>
              <input
                id="calendar-snap-photo-input"
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => void handleSnapPhotoPick(e)}
                className="sr-only"
              />
              <p className="text-[15px] text-muted">
                Choose a clear JPEG or PNG photo of your paper wall calendar.
              </p>
              {snapPhotoName ? (
                <p className="text-[16px] font-semibold text-brand-deep">
                  Selected calendar photo: {snapPhotoName}
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              <label
                htmlFor="snap-text-input"
                className="block text-[18px] font-semibold text-ink"
              >
                Paste lines from your paper wall calendar (YYYY-MM-DD Title)
              </label>
              <textarea
                id="snap-text-input"
                rows={3}
                value={snapInputText}
                onChange={(e) => setSnapInputText(e.target.value)}
                placeholder="2026-07-18 10:00 Dentist Visit"
                className="w-full rounded-chip border-2 border-line bg-canvas p-4 text-[18px] text-ink focus:border-brand"
              />
              {snapError ? (
                <p
                  role="alert"
                  className="text-[18px] font-semibold text-[#881337]"
                >
                  {snapError}
                </p>
              ) : null}
              <SeniorButton
                variant="primary"
                icon={<Camera size={20} />}
                disabled={isAutoPlanning}
                onClick={() => void handleParseSnapText()}
              >
                Review Paper Calendar Items
              </SeniorButton>
            </div>
          </div>
        )}
      </section>

      {/* Reminder Lead-Time Picker */}
      <section
        aria-labelledby="reminder-heading"
        data-card="true"
        className="rounded-card border border-line bg-white p-5 shadow-card space-y-4"
      >
        <h2
          id="reminder-heading"
          className="flex items-center gap-3 text-[22px] font-bold text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
          >
            <Bell size={22} />
          </span>
          <span>Reminder Timing</span>
        </h2>
        <p className="text-[16px] text-muted">
          Choose how early you would like a gentle reminder before each event:
        </p>

        <div className="flex flex-wrap gap-3">
          {REMINDER_LEADS.map((lead) => {
            const active = settings.reminderLead === lead;
            return (
              <SeniorButton
                key={lead}
                variant={active ? 'primary' : 'secondary'}
                aria-pressed={active}
                icon={<Bell size={20} />}
                onClick={() => void handleLeadChange(lead)}
              >
                {LEAD_LABELS[lead]}
              </SeniorButton>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default CalendarPage;
