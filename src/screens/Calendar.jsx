import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import DayEventList from '../components/DayEventList';
import EmptyState from '../components/EmptyState';
import MonthCalendar from '../components/MonthCalendar';
import Skeleton from '../components/Skeleton';
import { appointments, dayOffset, fmtDate } from '../data/seed';
import { calendarStore, fmtLongDate, isoDate, sameDay } from '../lib/dates';

const MAX_SHOWN = 5;

export default function Calendar() {
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => calendarStore.selectedDate);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const ap of appointments) {
      const iso = isoDate(dayOffset(ap.day));
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso).push(ap);
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at);
    return map;
  }, []);

  const iso = isoDate(selected);
  const dayEvents = eventsByDate.get(iso) || [];
  const isToday = sameDay(selected, new Date());

  const selectDate = (d) => {
    setSelected(d);
    calendarStore.selectedDate = d;
  };

  if (loading) {
    return (
      <div className="app-scroll absolute inset-0 bg-canvas px-5">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
        <Skeleton className="mt-4 h-[312px] w-full rounded-card" />
        <Skeleton className="mt-5 h-6 w-44" />
        <Skeleton className="mt-3 h-[52px] w-full rounded-chip" />
        <Skeleton className="mt-2 h-[52px] w-full rounded-chip" />
        <Skeleton className="mt-2 h-[52px] w-full rounded-chip" />
      </div>
    );
  }

  return (
    <div className="app-scroll absolute inset-0 bg-canvas px-5">
      {/* Plain title */}
      <div className="px-5 pt-5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Calendar</h1>
        <p className="mt-0.5 text-[13.5px] font-medium text-muted">{fmtDate(new Date())}</p>
      </div>

      {/* Month grid on a dark card — small inset from the screen edges */}
      <div className="mt-4 -mx-2">
        <MonthCalendar selected={selected} onSelect={selectDate} eventsByDate={eventsByDate} />
      </div>

      {/* White sheet with the selected day's events */}
      <div className="anim-fade-up mt-5 min-h-[240px] rounded-t-[20px] bg-white px-5 pb-8 pt-5 shadow-lift">
        <div className="mb-2 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-bold tracking-tight text-ink">
              {isToday ? 'Today' : fmtLongDate(selected)}
            </h2>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted">
              {dayEvents.length === 0
                ? 'Free day'
                : `${dayEvents.length} appointment${dayEvents.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {dayEvents.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing on this day"
            message="No appointments scheduled. Tap a dotted date to see its events."
            className="border-none shadow-none"
          />
        ) : (
          <>
            <DayEventList items={dayEvents} date={selected} limit={MAX_SHOWN} />
            {dayEvents.length > MAX_SHOWN && (
              <Link
                to={`/calendar/day/${iso}`}
                className="pressable mt-4 flex h-11 w-full items-center justify-center gap-1 rounded-full border border-brand-soft bg-brand-wash text-[13px] font-semibold text-brand"
              >
                View all {dayEvents.length} events
                <ChevronRight size={14} strokeWidth={2.4} />
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
