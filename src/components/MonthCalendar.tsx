'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Temporal } from 'temporal-polyfill';
import type { CalendarCategory, CalendarEvent } from '@/lib/types';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface MonthCalendarProps {
  selectedDate: string;
  onSelectDate: (isoDate: string) => void;
  events: readonly CalendarEvent[];
}

function parsePlainDateOrToday(isoDate: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(isoDate);
  } catch {
    return Temporal.Now.plainDateISO();
  }
}

function dotClassForCategory(category: CalendarCategory): string {
  return category === 'Medical' || category === 'Daily Routine'
    ? 'bg-teal-300'
    : 'bg-violet-300';
}

interface CalendarCell {
  date: Temporal.PlainDate;
  out: boolean;
}

/**
 * Dark-card month grid: month title + circular chevron nav, weekday row,
 * 7-column day cells. Selected day sits in a filled teal circle, today is
 * ringed, and days with events carry category-colored dots (max 3).
 */
export function MonthCalendar({
  selectedDate,
  onSelectDate,
  events,
}: MonthCalendarProps) {
  const selectedPlain = parsePlainDateOrToday(selectedDate);
  const selectedIso = selectedPlain.toString();
  const todayIso = Temporal.Now.plainDateISO().toString();

  const [view, setView] = useState<{ year: number; month: number }>(() => ({
    year: selectedPlain.year,
    month: selectedPlain.month,
  }));

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date);
      if (list) {
        list.push(ev);
      } else {
        map.set(ev.date, [ev]);
      }
    }
    return map;
  }, [events]);

  const cells = useMemo<CalendarCell[]>(() => {
    const firstOfMonth = Temporal.PlainDate.from({
      year: view.year,
      month: view.month,
      day: 1,
    });
    const leadingCount = firstOfMonth.dayOfWeek % 7;
    const daysInMonth = firstOfMonth.daysInMonth;
    const out: CalendarCell[] = [];

    for (let i = leadingCount; i >= 1; i--) {
      out.push({ date: firstOfMonth.subtract({ days: i }), out: true });
    }
    for (let d = 0; d < daysInMonth; d++) {
      out.push({ date: firstOfMonth.add({ days: d }), out: false });
    }
    const nextMonthFirst = firstOfMonth.add({ months: 1 });
    let trailingOffset = 0;
    while (out.length % 7 !== 0) {
      out.push({
        date: nextMonthFirst.add({ days: trailingOffset++ }),
        out: true,
      });
    }
    return out;
  }, [view]);

  const monthLabel = `${MONTH_NAMES[view.month - 1]} ${view.year}`;

  const shiftMonth = (delta: number) => {
    setView((prev) => {
      const shifted = Temporal.PlainDate.from({
        year: prev.year,
        month: prev.month,
        day: 1,
      }).add({ months: delta });
      return { year: shifted.year, month: shifted.month };
    });
  };

  return (
    <div className="overflow-hidden rounded-card bg-gradient-to-br from-ink to-brand-deep p-4 shadow-lift">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[17px] font-bold tracking-tight text-white">
          {monthLabel}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="pressable inline-flex min-h-[56px] min-w-[56px] cursor-pointer items-center justify-center rounded-full bg-white/10 px-3 text-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-white"
          >
            <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.4} />
            <span className="sr-only">Previous month</span>
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="pressable inline-flex min-h-[56px] min-w-[56px] cursor-pointer items-center justify-center rounded-full bg-white/10 px-3 text-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-white"
          >
            <ChevronRight aria-hidden="true" size={18} strokeWidth={2.4} />
            <span className="sr-only">Next month</span>
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="pb-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white/60"
          >
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const iso = cell.date.toString();
          const dayEvents = eventsByDate.get(iso) ?? [];
          const isSel = iso === selectedIso;
          const isToday = iso === todayIso;
          const dayAriaLabel = `${MONTH_NAMES[cell.date.month - 1]} ${cell.date.day}, ${cell.date.year}${
            dayEvents.length > 0
              ? `, ${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`
              : ''
          }`;

          return (
            <button
              key={iso}
              type="button"
              aria-label={dayAriaLabel}
              aria-pressed={isSel}
              onClick={() => {
                onSelectDate(iso);
                if (cell.out) {
                  setView({ year: cell.date.year, month: cell.date.month });
                }
              }}
              className="pressable flex min-h-[56px] cursor-pointer flex-col items-center justify-center focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-white"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold ${
                  isSel
                    ? 'bg-brand-bright font-bold text-white shadow-pill'
                    : cell.out
                      ? 'text-white/25'
                      : isToday
                        ? 'font-bold text-white ring-1 ring-white/40'
                        : 'text-white/85'
                }`}
              >
                {cell.date.day}
              </span>
              <span
                aria-hidden="true"
                className="mt-1 flex h-1.5 items-center gap-[3px]"
              >
                {dayEvents.slice(0, 3).map((ev) => (
                  <span
                    key={ev.id}
                    className={`h-1.5 w-1.5 rounded-full ${dotClassForCategory(ev.category)}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MonthCalendar;
