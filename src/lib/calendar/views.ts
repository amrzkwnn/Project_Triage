import { Temporal } from 'temporal-polyfill';
import { formatPlainDate, parsePlainDate } from '@/lib/calendar/dates';
import type { CalendarEvent } from '@/lib/types';

export type WeekDayGroup = {
  day: Temporal.PlainDate;
  dateStr: string;
  events: CalendarEvent[];
  emptyLabel?: 'Nothing planned';
};

export type MonthDayGroup = {
  day: Temporal.PlainDate;
  dateStr: string;
  events: CalendarEvent[];
};

const ALL_DAY_SORT_TIME = '23:59';

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  const timeA = a.time ?? ALL_DAY_SORT_TIME;
  const timeB = b.time ?? ALL_DAY_SORT_TIME;
  if (timeA < timeB) return -1;
  if (timeA > timeB) return 1;

  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;

  return 0;
}

export function renderEventDateAndTime(
  e: Pick<CalendarEvent, 'date' | 'time'>,
  _deviceTimeZone?: string
): { date: string; time?: string } {
  if (e.time !== undefined) {
    return { date: e.date, time: e.time };
  }
  return { date: e.date };
}

export function viewToday(
  events: readonly CalendarEvent[],
  today: Temporal.PlainDate
): CalendarEvent[] {
  const todayStr = formatPlainDate(today);
  return events
    .filter((event) => event.date === todayStr)
    .sort(compareCalendarEvents);
}

export function viewWeek(
  events: readonly CalendarEvent[],
  today: Temporal.PlainDate
): WeekDayGroup[] {
  const groups: WeekDayGroup[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const day = today.add({ days: offset });
    const dateStr = formatPlainDate(day);
    const dayEvents = events
      .filter((event) => event.date === dateStr)
      .sort(compareCalendarEvents);

    if (dayEvents.length === 0) {
      groups.push({
        day,
        dateStr,
        events: dayEvents,
        emptyLabel: 'Nothing planned',
      });
    } else {
      groups.push({
        day,
        dateStr,
        events: dayEvents,
      });
    }
  }

  return groups;
}

export function viewMonth(
  events: readonly CalendarEvent[],
  ym: Temporal.PlainYearMonth
): MonthDayGroup[] {
  const byDate = new Map<
    string,
    { day: Temporal.PlainDate; dateStr: string; events: CalendarEvent[] }
  >();

  for (const event of events) {
    const parsed = parsePlainDate(event.date);
    if (!parsed.ok) continue;
    if (parsed.value.year !== ym.year || parsed.value.month !== ym.month) {
      continue;
    }

    const dateStr = formatPlainDate(parsed.value);
    const existing = byDate.get(dateStr);
    if (existing) {
      existing.events.push(event);
    } else {
      byDate.set(dateStr, {
        day: parsed.value,
        dateStr,
        events: [event],
      });
    }
  }

  return Array.from(byDate.values())
    .sort((a, b) => Temporal.PlainDate.compare(a.day, b.day))
    .map((group) => ({
      day: group.day,
      dateStr: group.dateStr,
      events: group.events.sort(compareCalendarEvents),
    }));
}
