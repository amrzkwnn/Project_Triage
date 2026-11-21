'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Temporal } from 'temporal-polyfill';
import {
  AlertTriangle,
  Bell,
  Calendar as CalendarIcon,
  Camera,
  Check,
  Pencil,
  Plus,
  Receipt,
  SkipForward,
  Stethoscope,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { StatusLive } from '@/components/StatusLive';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import {
  CALENDAR_CATEGORIES,
  getCategoryMeta,
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
  type ReminderLead,
  type Settings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

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

export type CalendarPageProps = {
  initialSettings?: Settings;
  initialEvents?: CalendarEvent[];
  initialToday?: string;
  initialView?: CalendarViewMode;
  initialSnapCandidates?: Candidate[];
  vault?: Vault;
  onNavigate?: (href: string) => void;
};

export function CalendarPage({
  initialSettings,
  initialEvents,
  initialToday,
  initialView = 'Today',
  initialSnapCandidates = [],
  vault,
  onNavigate,
}: CalendarPageProps) {
  const todayDate = useMemo(() => {
    if (initialToday) {
      const parsed = parsePlainDate(initialToday);
      if (parsed.ok) return parsed.value;
    }
    return Temporal.Now.plainDateISO();
  }, [initialToday]);

  const [settings, setSettings] = useState<Settings>(
    initialSettings ?? createDefaultSettings()
  );
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents ?? []);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialView);

  // Add / Edit / Delete confirmation state
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(todayDate.toString());
  const [formTime, setFormTime] = useState<string>('09:00');
  const [formLocation, setFormLocation] = useState<string>('');
  const [formCategory, setFormCategory] =
    useState<CalendarCategory>('Medical');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [awaitingSaveConfirm, setAwaitingSaveConfirm] =
    useState<boolean>(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<
    CalendarEvent | undefined
  >(undefined);

  // Paper Calendar Snap 1-by-1 candidate review state
  const [snapInputText, setSnapInputText] = useState<string>('');
  const [snapError, setSnapError] = useState<string | undefined>(undefined);
  const [snapQueue, setSnapQueue] = useState<Candidate[]>(
    initialSnapCandidates
  );
  const [confirmDateInput, setConfirmDateInput] = useState<string>(
    initialSnapCandidates[0]?.date ?? ''
  );

  const [statusMessage, setStatusMessage] = useState<string>('');

  const resolvedVault = useMemo(
    () => vault ?? (typeof window !== 'undefined' ? createVault() : undefined),
    [vault]
  );

  const loadData = useCallback(async () => {
    if (!resolvedVault) return;
    const [settingsRes, eventsRes] = await Promise.all([
      resolvedVault.getSettings(),
      resolvedVault.listEvents(),
    ]);
    if (settingsRes.ok) {
      setSettings(settingsRes.value);
    }
    if (eventsRes.ok) {
      setEvents(eventsRes.value);
    }
  }, [resolvedVault]);

  useEffect(() => {
    if (initialSettings === undefined || initialEvents === undefined) {
      void loadData();
    }
  }, [initialSettings, initialEvents, loadData]);

  const handleBack = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate('/');
    }
  };

  const todayEvents = useMemo(
    () => viewToday(events, todayDate),
    [events, todayDate]
  );
  const weekGroups = useMemo(
    () => viewWeek(events, todayDate),
    [events, todayDate]
  );
  const monthGroups = useMemo(
    () =>
      viewMonth(
        events,
        Temporal.PlainYearMonth.from({
          year: todayDate.year,
          month: todayDate.month,
        })
      ),
    [events, todayDate]
  );

  const openAddForm = () => {
    setEditingId(undefined);
    setFormTitle('');
    setFormDate(todayDate.toString());
    setFormTime('09:00');
    setFormLocation('');
    setFormCategory('Medical');
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
    setFormError(undefined);
    setAwaitingSaveConfirm(false);
    setFormOpen(true);
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

  const handleParseSnapText = () => {
    setSnapError(undefined);
    const extracted = extractCalendarCandidatesFromText(snapInputText, 0.85);
    if (!extracted.ok) {
      setSnapError(extracted.error.message);
      setStatusMessage(extracted.error.message);
      return;
    }
    setSnapQueue(extracted.value);
    setConfirmDateInput(extracted.value[0]?.date ?? '');
    setStatusMessage(
      `Found ${extracted.value.length} calendar item(s) to review one by one.`
    );
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
      setSnapError(parsed.error.message);
      return;
    }
    setSnapError(undefined);
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
    setSnapError(undefined);

    const outcome = await applyCandidateDecisionWithPersistence({
      candidate: currentCandidate,
      decision,
      existingEvents: events,
      vault: resolvedVault,
    });

    if (!outcome.ok) {
      setSnapError(outcome.errorMessage);
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
        className={`rounded-2xl border-2 bg-white p-5 space-y-3 ${meta.borderClass}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            data-badge="true"
            className={`inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-[18px] font-bold ${meta.badgeClass}`}
          >
            <span aria-hidden="true" className="inline-flex shrink-0">
              {renderCategoryIcon(ev.category)}
            </span>
            <span>{meta.label}</span>
          </span>
          <p className="text-[18px] font-bold text-[#111827]">
            {ev.date}
            {ev.time ? ` • ${ev.time}` : ' • All day'}
          </p>
        </div>

        <h3 className="text-[20px] font-bold text-[#111827]">{ev.title}</h3>
        {ev.location ? (
          <p className="text-[18px] text-[#111827]">Location: {ev.location}</p>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-1">
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
    <div className="space-y-8">
      <BackToHome onClick={handleBack} />

      <section className="space-y-3">
        <h1 className="text-[28px] font-bold leading-tight text-[#111827]">
          Calendar
        </h1>
        <p className="text-[20px] leading-relaxed text-[#111827]">
          See your plans clearly by day, week, or month, and review paper
          calendar photos one event at a time.
        </p>

        <div className="flex flex-wrap gap-3 pt-1">
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
      <nav aria-label="Calendar views" className="flex flex-wrap gap-3">
        {(['Today', 'This Week', 'Month List'] as const).map((mode) => (
          <SeniorButton
            key={mode}
            variant={viewMode === mode ? 'primary' : 'secondary'}
            aria-pressed={viewMode === mode}
            icon={<CalendarIcon size={20} />}
            onClick={() => setViewMode(mode)}
          >
            {mode}
          </SeniorButton>
        ))}
      </nav>

      {/* Delete Confirmation */}
      {pendingDeleteEvent ? (
        <section
          role="region"
          aria-label="Confirm delete event"
          data-card="true"
          className="rounded-2xl border-2 border-[#BE123C] bg-[#FFF1F2] p-5 space-y-4"
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
          className="rounded-2xl border-2 border-[#0F766E] bg-white p-5 space-y-4"
        >
          <h2 className="text-[22px] font-bold text-[#111827]">
            {editingId ? 'Edit Event' : 'Add a New Event'}
          </h2>
          <form onSubmit={handleRequestSaveConfirm} className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="cal-title"
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Event Name
              </label>
              <input
                id="cal-title"
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="cal-date"
                  className="block text-[18px] font-semibold text-[#111827]"
                >
                  Date (YYYY-MM-DD)
                </label>
                <input
                  id="cal-date"
                  type="text"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="cal-time"
                  className="block text-[18px] font-semibold text-[#111827]"
                >
                  Time (HH:MM, optional)
                </label>
                <input
                  id="cal-time"
                  type="text"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="cal-category"
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Category
              </label>
              <select
                id="cal-category"
                value={formCategory}
                onChange={(e) =>
                  setFormCategory(e.target.value as CalendarCategory)
                }
                className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
              >
                {CALENDAR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="cal-location"
                className="block text-[18px] font-semibold text-[#111827]"
              >
                Location (optional)
              </label>
              <input
                id="cal-location"
                type="text"
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                className="min-h-[56px] w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
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
              <div className="rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4 space-y-3">
                <p className="text-[20px] font-bold text-[#111827]">
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

      {/* Active Calendar View */}
      <section aria-labelledby="calendar-view-heading" className="space-y-4">
        <h2
          id="calendar-view-heading"
          className="text-[24px] font-bold text-[#111827]"
        >
          {viewMode} ({todayDate.toString()})
        </h2>

        {viewMode === 'Today' ? (
          todayEvents.length === 0 ? (
            <div
              data-card="true"
              className="rounded-2xl border-2 border-[#111827] bg-white p-5 text-[20px] font-semibold text-[#111827]"
            >
              Nothing planned
            </div>
          ) : (
            <div className="space-y-4">{todayEvents.map(renderEventCard)}</div>
          )
        ) : null}

        {viewMode === 'This Week' ? (
          <div className="space-y-4">
            {weekGroups.map((group) => (
              <div
                key={group.dateStr}
                data-card="true"
                className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-3"
              >
                <h3 className="text-[20px] font-bold text-[#115E59]">
                  {group.dateStr}
                </h3>
                {group.events.length === 0 ? (
                  <p className="text-[18px] text-[#111827]">
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
            <div
              data-card="true"
              className="rounded-2xl border-2 border-[#111827] bg-white p-5 text-[20px] font-semibold text-[#111827]"
            >
              Nothing planned
            </div>
          ) : (
            <div className="space-y-4">
              {monthGroups.map((group) => (
                <div
                  key={group.dateStr}
                  data-card="true"
                  className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-3"
                >
                  <h3 className="text-[20px] font-bold text-[#115E59]">
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

      {/* Paper Calendar Snap (1-by-1 Candidate Review) */}
      <section
        aria-labelledby="snap-heading"
        data-card="true"
        className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-4"
      >
        <h2
          id="snap-heading"
          className="flex items-center gap-2 text-[24px] font-bold text-[#111827]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Camera size={24} />
          </span>
          <span>Paper Calendar Snap</span>
        </h2>

        {currentCandidate ? (
          <div className="rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[18px] font-bold text-[#115E59]">
                Reviewing 1 of {snapQueue.length} remaining
              </p>
              {currentCandidateNeedsCheck ? (
                <span
                  data-badge="true"
                  className="inline-flex items-center gap-2 rounded-lg border-2 border-[#D97706] bg-[#FFFBEB] px-3 py-1.5 text-[18px] font-bold text-[#92400E]"
                >
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    <AlertTriangle size={20} />
                  </span>
                  <span>Please check</span>
                </span>
              ) : null}
            </div>

            <p className="text-[20px] font-bold text-[#111827]">
              {currentCandidate.title}
            </p>
            <p className="text-[18px] text-[#111827]">
              Date: {currentCandidate.date}
              {currentCandidate.time ? ` • ${currentCandidate.time}` : ''} •{' '}
              {currentCandidate.category}
            </p>

            {currentCandidateNeedsCheck ? (
              <div className="space-y-3 rounded-xl border-2 border-[#D97706] bg-white p-4">
                <label
                  htmlFor="snap-confirm-date"
                  className="block text-[18px] font-semibold text-[#111827]"
                >
                  Please check and confirm this date (YYYY-MM-DD) before keeping:
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="snap-confirm-date"
                    type="text"
                    value={confirmDateInput}
                    onChange={(e) => setConfirmDateInput(e.target.value)}
                    className="min-h-[56px] rounded-xl border-2 border-[#111827] bg-[#FAF9F6] px-4 text-[18px] text-[#111827]"
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

            <div className="flex flex-wrap gap-3">
              {currentCandidateDuplicate ? (
                <SeniorButton
                  variant="warn"
                  disabled={!currentCandidateCanKeep}
                  icon={<Check size={20} />}
                  onClick={() => void handleCandidateDecision('keep-both')}
                >
                  Keep both
                </SeniorButton>
              ) : (
                <SeniorButton
                  variant="safe"
                  disabled={!currentCandidateCanKeep}
                  icon={<Check size={20} />}
                  onClick={() => void handleCandidateDecision('keep')}
                >
                  Keep
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
        ) : (
          <div className="space-y-3">
            <label
              htmlFor="snap-text-input"
              className="block text-[18px] font-semibold text-[#111827]"
            >
              Paste lines from your paper wall calendar (YYYY-MM-DD Title)
            </label>
            <textarea
              id="snap-text-input"
              rows={3}
              value={snapInputText}
              onChange={(e) => setSnapInputText(e.target.value)}
              placeholder="2026-07-18 10:00 Dentist Visit"
              className="w-full rounded-xl border-2 border-[#111827] bg-[#FAF9F6] p-4 text-[18px] text-[#111827]"
            />
            {snapError ? (
              <p role="alert" className="text-[18px] font-semibold text-[#881337]">
                {snapError}
              </p>
            ) : null}
            <SeniorButton
              variant="primary"
              icon={<Camera size={20} />}
              onClick={handleParseSnapText}
            >
              Review Paper Calendar Items
            </SeniorButton>
          </div>
        )}
      </section>

      {/* Reminder Lead-Time Picker */}
      <section
        aria-labelledby="reminder-heading"
        data-card="true"
        className="rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-4"
      >
        <h2
          id="reminder-heading"
          className="flex items-center gap-2 text-[24px] font-bold text-[#111827]"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            <Bell size={24} />
          </span>
          <span>Reminder Timing</span>
        </h2>
        <p className="text-[18px] text-[#111827]">
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
