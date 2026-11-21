import { Temporal } from 'temporal-polyfill';
import type { CalendarEvent, ReminderLead } from '@/lib/types';

export const LEAD_MS: Record<ReminderLead, number> = {
  '15m': 15 * 60e3,
  '30m': 30 * 60e3,
  '1h': 60 * 60e3,
  '2h': 120 * 60e3,
  '1d': 24 * 60 * 60e3,
};

export const REMINDER_LEADS: readonly ReminderLead[] = [
  '15m',
  '30m',
  '1h',
  '2h',
  '1d',
] as const;

const DEFAULT_ALL_DAY_TIME = '09:00';
const MAX_NOTIFICATION_TITLE_LENGTH = 60;

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type ReminderPlan =
  | {
      action: 'schedule';
      fireAt: Temporal.Instant;
      notificationText: string;
    }
  | {
      action: 'skip-past';
    };

export type ScheduledReminder = {
  eventId: string;
  fireAt: Temporal.Instant;
  notificationText: string;
  lead: ReminderLead;
  timeZone: string;
};

export function reminderTime(
  e: Pick<CalendarEvent, 'date' | 'time'>,
  lead: ReminderLead,
  timeZone: string
): Temporal.Instant {
  const plainDate = Temporal.PlainDate.from(e.date);
  const plainTime = Temporal.PlainTime.from(e.time ?? DEFAULT_ALL_DAY_TIME);
  const plainDateTime = plainDate.toPlainDateTime(plainTime);
  const zoned = plainDateTime.toZonedDateTime(timeZone);
  return zoned.toInstant().subtract({ milliseconds: LEAD_MS[lead] });
}

function formatTimeForNotification(
  timeStr: string | undefined,
  timeFormat: '12h' | '24h'
): string {
  const plainTime = Temporal.PlainTime.from(timeStr ?? DEFAULT_ALL_DAY_TIME);
  const minute = String(plainTime.minute).padStart(2, '0');

  if (timeFormat === '24h') {
    const hour24 = String(plainTime.hour).padStart(2, '0');
    return `${hour24}:${minute}`;
  }

  const period = plainTime.hour >= 12 ? 'PM' : 'AM';
  const hour12 = plainTime.hour % 12 === 0 ? 12 : plainTime.hour % 12;
  return `${hour12}:${minute} ${period}`;
}

export function planReminder(
  e: Pick<CalendarEvent, 'id' | 'title' | 'date' | 'time'>,
  lead: ReminderLead,
  now: Temporal.Instant,
  timeZone: string,
  timeFormat: '12h' | '24h' = '12h'
): ReminderPlan {
  const fireAt = reminderTime(e, lead, timeZone);

  if (Temporal.Instant.compare(fireAt, now) <= 0) {
    return { action: 'skip-past' };
  }

  const plainDate = Temporal.PlainDate.from(e.date);
  const weekday = WEEKDAY_NAMES[plainDate.dayOfWeek - 1];
  const shortTitle = e.title.slice(0, MAX_NOTIFICATION_TITLE_LENGTH);
  const formattedTime = formatTimeForNotification(e.time, timeFormat);

  const notificationText = `${shortTitle} — ${weekday}, ${e.date} at ${formattedTime}`;

  return {
    action: 'schedule',
    fireAt,
    notificationText,
  };
}

export class ReminderScheduler {
  private readonly pending = new Map<string, ScheduledReminder>();
  private readonly cancelled: ScheduledReminder[] = [];

  schedule(
    e: Pick<CalendarEvent, 'id' | 'title' | 'date' | 'time'>,
    lead: ReminderLead,
    now: Temporal.Instant,
    timeZone: string,
    timeFormat: '12h' | '24h' = '12h'
  ): ReminderPlan {
    const plan = planReminder(e, lead, now, timeZone, timeFormat);
    if (plan.action === 'skip-past') {
      return plan;
    }

    this.pending.set(e.id, {
      eventId: e.id,
      fireAt: plan.fireAt,
      notificationText: plan.notificationText,
      lead,
      timeZone,
    });
    return plan;
  }

  reschedule(
    e: Pick<CalendarEvent, 'id' | 'title' | 'date' | 'time'>,
    lead: ReminderLead,
    now: Temporal.Instant,
    timeZone: string,
    timeFormat: '12h' | '24h' = '12h'
  ): ReminderPlan & { cancelledPrevious: boolean } {
    const cancelledPrevious = this.cancel(e.id);
    const plan = this.schedule(e, lead, now, timeZone, timeFormat);
    return { ...plan, cancelledPrevious };
  }

  cancel(eventId: string): boolean {
    const existing = this.pending.get(eventId);
    if (!existing) {
      return false;
    }
    this.pending.delete(eventId);
    this.cancelled.push(existing);
    return true;
  }

  get(eventId: string): ScheduledReminder | undefined {
    return this.pending.get(eventId);
  }

  has(eventId: string): boolean {
    return this.pending.has(eventId);
  }

  list(): ScheduledReminder[] {
    return Array.from(this.pending.values());
  }

  getCancelled(): readonly ScheduledReminder[] {
    return [...this.cancelled];
  }

  get size(): number {
    return this.pending.size;
  }
}
