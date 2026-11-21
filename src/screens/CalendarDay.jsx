import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarCheck, ChevronLeft } from 'lucide-react';
import DayEventList from '../components/DayEventList';
import EmptyState from '../components/EmptyState';
import { appointments, dayOffset } from '../data/seed';
import { fmtLongDate, isoDate, parseIso } from '../lib/dates';

/**
 * "All events for a day" screen, reached from the Calendar's View all
 * button. Tab bar is hidden; back button returns to the Calendar with the
 * same date still selected (via calendarStore).
 */
export default function CalendarDay() {
  const { date: iso } = useParams();
  const date = useMemo(() => parseIso(iso), [iso]);

  const items = useMemo(
    () =>
      appointments
        .filter((ap) => isoDate(dayOffset(ap.day)) === iso)
        .sort((a, b) => a.at - b.at),
    [iso]
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas">
      <header className="chrome flex shrink-0 items-center gap-1 border-b border-line bg-white/90 px-3 py-2 backdrop-blur-md">
        <Link
          to="/calendar"
          aria-label="Back to calendar"
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold tracking-tight text-ink">
            {fmtLongDate(date)}
          </h1>
          <p className="text-[12px] font-medium text-muted">
            {items.length === 0
              ? 'Free day'
              : `${items.length} appointment${items.length > 1 ? 's' : ''}`}
          </p>
        </div>
      </header>

      <div className="app-scroll min-h-0 flex-1 px-5 py-4">
        {items.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing on this day"
            message="No appointments scheduled for this date."
          />
        ) : (
          <div className="anim-fade-up rounded-card border border-line bg-white p-4 shadow-card">
            <DayEventList items={items} date={date} />
          </div>
        )}
      </div>
    </div>
  );
}
