import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isoDate, sameDay } from '../lib/dates';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Dark-card month grid: month title + circular chevron nav, weekday row,
 * 7-column day cells. Selected day sits in a filled teal circle, today is
 * ringed, and days with events carry category-colored dots (teal = work,
 * violet = personal, max 3).
 */
export default function MonthCalendar({ selected, onSelect, eventsByDate }) {
  const [view, setView] = useState(() => ({
    y: selected.getFullYear(),
    m: selected.getMonth(),
  }));

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const prevMonthDays = new Date(view.y, view.m, 0).getDate();
    const out = [];

    for (let i = first.getDay() - 1; i >= 0; i--) {
      out.push({ date: new Date(view.y, view.m - 1, prevMonthDays - i), out: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(view.y, view.m, d), out: false });
    }
    let next = 1;
    while (out.length % 7 !== 0) {
      out.push({ date: new Date(view.y, view.m + 1, next++), out: true });
    }
    return out;
  }, [view]);

  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const today = new Date();

  return (
    <div className="overflow-hidden rounded-card bg-gradient-to-br from-ink to-brand-deep p-3 shadow-lift">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[17px] font-bold tracking-tight text-white">{monthLabel}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="pb-2 text-center text-[8.5px] font-bold uppercase tracking-[0.12em] text-white/45">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const iso = isoDate(cell.date);
          const events = eventsByDate.get(iso) || [];
          const isSel = sameDay(cell.date, selected);
          const isToday = sameDay(cell.date, today);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => {
                onSelect(cell.date);
                if (cell.out) {
                  setView({ y: cell.date.getFullYear(), m: cell.date.getMonth() });
                }
              }}
              className="pressable flex h-[46px] flex-col items-center justify-center"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold ${
                  isSel
                    ? 'bg-brand-bright font-bold text-white shadow-pill'
                    : cell.out
                      ? 'text-white/25'
                      : isToday
                        ? 'font-bold text-white ring-1 ring-white/40'
                        : 'text-white/85'
                }`}
              >
                {cell.date.getDate()}
              </span>
              <span className="mt-1 flex h-1 items-center gap-[3px]">
                {events.slice(0, 3).map((ap) => (
                  <span
                    key={ap.id}
                    className={`h-1 w-1 rounded-full ${
                      ap.category === 'work' ? 'bg-teal-300' : 'bg-violet-300'
                    }`}
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
