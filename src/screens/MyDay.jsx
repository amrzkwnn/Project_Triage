import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import FilterChips from '../components/FilterChips';
import PersonChip from '../components/PersonChip';
import SectionHeader from '../components/SectionHeader';
import Skeleton from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { CATEGORY_CHIPS, PERSON_CHIPS, personLabel, useFilters } from '../lib/filters';
import { useDemo } from '../context/DemoContext';
import { appointments, fmtDate, fmtTime, tasks } from '../data/seed';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function MyDay() {
  const toast = useToast();
  const { category, setCategory, person, setPerson, matches } = useFilters();
  const { categoryIntent, clearCategoryIntent } = useDemo();
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [doneIds, setDoneIds] = useState(() => new Set());
  const [taskIndex, setTaskIndex] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  // Demo stepper intent: land on My Day with the Personal filter selected.
  useEffect(() => {
    if (!categoryIntent) return;
    setCategory(categoryIntent);
    clearCategoryIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIntent]);

  const pendingTasks = tasks.filter((t) => !doneIds.has(t.id));
  const todayItems = useMemo(
    () => appointments.filter((a) => a.day === 0).sort((a, b) => a.at - b.at),
    []
  );
  const weekItems = useMemo(
    () => appointments.filter((a) => a.day > 0).sort((a, b) => a.day - b.day || a.at - b.at),
    []
  );

  const visibleTasks = pendingTasks.filter(matches);
  const task = visibleTasks[taskIndex];

  // Keep the carousel index inside bounds when tasks are filtered or completed.
  useEffect(() => {
    setTaskIndex((i) => Math.max(0, Math.min(i, visibleTasks.length - 1)));
  }, [visibleTasks.length]);

  const markDone = (id) => {
    if (doneIds.has(id) || checked[id]) return;
    setChecked((c) => ({ ...c, [id]: true }));
    setTimeout(() => setCollapsed((c) => ({ ...c, [id]: true })), 420);
    setTimeout(() => {
      setDoneIds((ids) => new Set(ids).add(id));
      setCollapsed((c) => ({ ...c, [id]: false }));
      setTaskIndex((i) => Math.max(0, Math.min(i, visibleTasks.length - 2)));
    }, 740);
  };

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const upNext = todayItems.filter(matches).filter((a) => a.at > nowMinutes).slice(0, 3);

  const who = personLabel(person);
  const catLabel = category === 'all' ? '' : category;

  const fireTestReminder = () =>
    toast({
      title: "Reminder — Maya's cardiology check-up",
      message: 'Today at 11:00 AM · Lakeview Heart Center',
    });

  if (loading) {
    return (
      <div className="app-scroll absolute inset-0 bg-canvas px-5">
        <Skeleton className="h-[128px] w-full rounded-card" />
        <Skeleton className="-mt-3 ml-3 h-[60px] w-[calc(100%-24px)] rounded-card" />
        <Skeleton className="mt-4 h-11 w-full rounded-chip" />
        <Skeleton className="mt-2 h-11 w-3/4 rounded-chip" />
        <Skeleton className="mt-7 h-4 w-44" />
        <Skeleton className="mt-3 h-[196px] w-full rounded-card" />
        <Skeleton className="mt-7 h-4 w-28" />
        <Skeleton className="mt-3 h-[152px] w-[172px] rounded-card" />
      </div>
    );
  }

  return (
    <div className="app-scroll absolute inset-0 bg-canvas px-5">
      {/* Header card with a stats panel tucked behind its bottom edge */}
      <div className="relative">
        <header className="anim-fade-up relative z-10 overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft via-brand-wash to-white p-5 pb-6 shadow-lift">
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-soft/60 blur-2xl" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-muted">{greeting()}</p>
                <h1 className="mt-0.5 text-[28px] font-bold leading-tight tracking-tight text-ink">
                  Doctor
                </h1>
                <p className="mt-1 text-[12.5px] font-medium text-muted">{fmtDate(new Date())}</p>
              </div>
              <button
                type="button"
                onClick={fireTestReminder}
                aria-label="Test reminder"
                className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-soft/70 bg-white/80 text-brand shadow-pill backdrop-blur-md"
              >
                <Bell size={17} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </header>

        {/* Secondary stats panel — sits behind the card, plain-text stats in one row */}
        <div className="anim-fade-up relative z-0 -mt-3 mx-3 rounded-card border border-line bg-white px-3 pb-2.5 pt-3.5 shadow-card">
          <div className="flex items-center justify-between gap-1.5">
            <span className="inline-flex h-11 shrink-0 items-center gap-1.5 text-[12px] font-semibold text-red-600">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {pendingTasks.length} need action
            </span>
            <Link
              to="/calendar"
              className="pressable inline-flex h-11 shrink-0 items-center gap-1.5 text-[12px] font-semibold text-brand-deep"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {todayItems.length} today
            </Link>
            <Link
              to="/calendar"
              className="pressable inline-flex h-11 shrink-0 items-center gap-1.5 text-[12px] font-semibold text-muted"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              {weekItems.length} this week
            </Link>
          </div>
        </div>
      </div>

      {/* Sticky filters */}
      <div className="sticky top-0 z-20 -mx-5 mt-4 bg-canvas/95 px-5 py-3 backdrop-blur-md">
        <FilterChips items={CATEGORY_CHIPS} value={category} onChange={setCategory} />
        {category === 'personal' && (
          <FilterChips
            items={PERSON_CHIPS}
            value={person}
            onChange={setPerson}
            compact
            className="mt-2"
          />
        )}
      </div>

      <div className="pb-8">
        {/* Needs action now — one glass card at a time, arrows to page */}
        <section className="mt-1">
          <SectionHeader title="Needs action now" count={visibleTasks.length} countTone="red">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous task"
                disabled={taskIndex === 0}
                onClick={() => setTaskIndex((i) => Math.max(0, i - 1))}
                className="pressable flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted shadow-pill disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronLeft size={16} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                aria-label="Next task"
                disabled={taskIndex >= visibleTasks.length - 1}
                onClick={() => setTaskIndex((i) => Math.min(visibleTasks.length - 1, i + 1))}
                className="pressable flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-muted shadow-pill disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronRight size={16} strokeWidth={2.4} />
              </button>
            </div>
          </SectionHeader>
          {visibleTasks.length === 0 || !task ? (
            <EmptyState
              icon={Check}
              title="All clear"
              message={`Nothing urgent${
                catLabel ? ` under ${catLabel}` : ''
              } for ${who}. New items land here the moment they arrive.`}
            />
          ) : (
            <>
              <div
                key={task.id}
                className={`relative overflow-hidden rounded-card border border-red-100/80 bg-gradient-to-br from-red-50/90 via-white/80 to-red-50/40 p-4 shadow-card backdrop-blur-md ${
                  collapsed[task.id] ? 'anim-collapse' : 'anim-fade-up'
                }`}
              >
                <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-red-100/70 blur-2xl" />
                <div className="relative">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50/80 text-red-600">
                      <AlertTriangle size={18} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[16px] font-semibold leading-snug text-ink">
                        {task.title}
                      </h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{task.note}</p>
                      <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11.5px] font-semibold text-red-600">
                        <Clock size={11} strokeWidth={2.6} />
                        {task.due}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <PersonChip personId={task.personId} size="sm" />
                      <Badge category={task.category} />
                    </div>
                    <button
                      type="button"
                      onClick={() => markDone(task.id)}
                      className={`pressable flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white shadow-pill transition-colors duration-150 ${
                        checked[task.id] ? 'bg-brand' : 'bg-ink/90'
                      }`}
                    >
                      <Check
                        size={15}
                        strokeWidth={2.6}
                        className={checked[task.id] ? 'anim-check' : ''}
                      />
                      {checked[task.id] ? 'Done' : 'Mark done'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Dot indicators */}
              <div className="mt-3 flex items-center justify-center gap-1.5">
                {visibleTasks.map((t, i) => (
                  <span
                    key={t.id}
                    className={`h-[6px] rounded-full transition-all duration-200 ${
                      i === taskIndex ? 'w-5 bg-red-500' : 'w-[6px] bg-line'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Up next */}
        <section className="mt-7">
          <SectionHeader title="Up next" count={upNext.length}>
            <Link
              to="/calendar"
              className="pressable flex h-11 items-center gap-0.5 pr-2 text-[12.5px] font-semibold text-brand"
            >
              View calendar
              <ChevronRight size={14} strokeWidth={2.4} />
            </Link>
          </SectionHeader>
          <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5">
            {upNext.length === 0 ? (
              <div className="w-full rounded-card border border-dashed border-line bg-white px-4 py-5 text-center">
                <p className="flex items-center justify-center gap-2 text-[13.5px] font-semibold text-muted">
                  <CalendarCheck size={16} className="text-brand" />
                  All done for today — nothing else ahead
                  {catLabel ? ` under ${catLabel}` : ''} for {who}.
                </p>
              </div>
            ) : (
              upNext.map((ap) => (
                <Link
                  key={ap.id}
                  to="/calendar"
                  className="pressable anim-fade-up w-[172px] shrink-0 overflow-hidden rounded-card border border-line bg-white shadow-card"
                >
                  <div
                    className={`h-1 w-full ${
                      ap.category === 'work'
                        ? 'bg-gradient-to-r from-teal-400 to-teal-300'
                        : 'bg-gradient-to-r from-violet-400 to-violet-300'
                    }`}
                  />
                  <div className="p-3.5">
                    <p className="text-[15px] font-bold text-ink tnum">{fmtTime(ap.at)}</p>
                    <p className="mt-1 line-clamp-2 min-h-[36px] text-[13.5px] font-semibold leading-snug text-ink">
                      {ap.title}
                    </p>
                    <p className="mt-1.5 flex min-w-0 items-center gap-1 truncate text-[11.5px] text-muted">
                      <MapPin size={11} className="shrink-0" strokeWidth={2} />
                      {ap.location}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
