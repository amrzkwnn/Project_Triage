import { Check, MapPin } from 'lucide-react';
import Badge from './Badge';
import PersonChip from './PersonChip';
import { fmtTime } from '../data/seed';
import { sameDay } from '../lib/dates';

/**
 * Event rows for one day, ordered: upcoming first (time ascending), then
 * past/completed events (dimmed, tagged). On days other than today nothing
 * is "past". Optional `limit` caps the rows shown.
 */
export default function DayEventList({ items, date, limit }) {
  if (!items || items.length === 0) return null;

  const now = new Date();
  const isToday = sameDay(now, date);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const upcoming = items.filter((ap) => !isToday || ap.at > nowMinutes);
  const past = items.filter((ap) => isToday && ap.at <= nowMinutes);
  const ordered = [...upcoming, ...past].slice(0, limit ?? items.length);

  return (
    <div className="flex flex-col">
      {ordered.map((ap) => {
        const isPast = isToday && ap.at <= nowMinutes;
        const [hm, ampm] = fmtTime(ap.at).split(' ');
        return (
          <div
            key={ap.id}
            className={`flex items-center gap-3 border-b border-line/70 py-3 last:border-b-0 ${
              isPast ? 'opacity-55' : ''
            }`}
          >
            <div className="w-[52px] shrink-0 text-right">
              <p className="text-[13px] font-bold leading-none text-ink tnum">{hm}</p>
              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
                {ampm}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[14px] font-semibold text-ink">{ap.title}</p>
                {isPast && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-line px-2 py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] text-muted">
                    <Check size={9} strokeWidth={3.2} />
                    Completed
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[12px] text-muted">
                <MapPin size={11} className="shrink-0" strokeWidth={2} />
                {ap.location}
              </p>
            </div>
            <PersonChip personId={ap.personId} size="sm" showName={false} />
            <Badge category={ap.category} />
          </div>
        );
      })}
    </div>
  );
}
