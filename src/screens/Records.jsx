import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, Plus } from 'lucide-react';
import Badge from '../components/Badge';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import FilterChips from '../components/FilterChips';
import SegmentedControl from '../components/SegmentedControl';
import Skeleton from '../components/Skeleton';
import SourceBadge from '../components/SourceBadge';
import { documentSvg } from '../data/documents';
import { personById, records, sessionRecords } from '../data/seed';

const TYPE_TABS = [
  { id: 'lab', label: 'Lab Reports' },
  { id: 'rx', label: 'Prescriptions' },
];

const TYPE_EMPTY = {
  lab: { title: 'No lab reports here', message: 'Lab reports you add or receive will appear in this list.' },
  rx: { title: 'No prescriptions here', message: 'Prescriptions you add or receive will appear in this list.' },
};

const PERSON_CHIPS = [
  { id: 'all', label: 'Everyone' },
  { id: 'me', label: 'Me' },
  { id: 'wife', label: 'Wife' },
  { id: 'child1', label: 'Child 1' },
  { id: 'child2', label: 'Child 2' },
  { id: 'patients', label: 'Patients' },
];

const fmtDocDate = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Records() {
  const navigate = useNavigate();
  const [type, setType] = useState('lab');
  const [person, setPerson] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  const matchesPerson = (r) => {
    if (person === 'all') return true;
    if (person === 'patients') return personById(r.personId)?.relation === 'patient';
    return r.personId === person;
  };

  const allRecords = useMemo(() => [...records, ...sessionRecords], []);

  const visible = useMemo(
    () =>
      allRecords
        .filter((r) => r.type === type && matchesPerson(r))
        .sort((a, b) => b.date - a.date),
    [allRecords, type, person]
  );

  if (loading) {
    return (
      <div className="app-scroll absolute inset-0 bg-canvas px-5">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="mt-4 h-12 w-full rounded-full" />
        <Skeleton className="mt-3 h-11 w-full rounded-chip" />
        <Skeleton className="mt-5 h-[114px] w-full rounded-card" />
        <Skeleton className="mt-3 h-[114px] w-full rounded-card" />
        <Skeleton className="mt-3 h-[114px] w-full rounded-card" />
        <Skeleton className="mt-3 h-[114px] w-full rounded-card" />
      </div>
    );
  }

  return (
    <div className="app-scroll absolute inset-0 bg-canvas px-5">
      {/* Title + Add */}
      <div className="flex items-center justify-between gap-3 pt-5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Records</h1>
        <button
          type="button"
          onClick={() => navigate('/upload')}
          className="pressable flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-[13px] font-semibold text-white shadow-pill"
        >
          <Plus size={16} strokeWidth={2.6} />
          Add
        </button>
      </div>

      {/* Type segmented control */}
      <SegmentedControl options={TYPE_TABS} value={type} onChange={setType} className="mt-4" />

      {/* Person filter */}
      <FilterChips
        items={PERSON_CHIPS}
        value={person}
        onChange={setPerson}
        compact
        className="mt-3"
      />

      {/* List */}
      <div className="mt-5 flex flex-col gap-3 pb-8">
        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={TYPE_EMPTY[type].title}
            message={TYPE_EMPTY[type].message}
          />
        ) : (
          visible.map((r) => {
            const who = personById(r.personId);
            const abnormal = r.details.some((d) => d.abnormal);
            return (
              <Card
                key={r.id}
                onClick={() => navigate(`/records/${r.id}`)}
                className="anim-fade-up pressable flex items-stretch gap-3.5 overflow-hidden p-3"
              >
                <div
                  className="doc-svg h-[92px] w-[70px] shrink-0 overflow-hidden rounded-chip border border-line bg-white"
                  dangerouslySetInnerHTML={{ __html: documentSvg(r, who?.name ?? '', 'enhanced') }}
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-[15px] font-semibold text-ink">
                      {r.title}
                    </h3>
                    {abnormal && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-red-600">
                        <AlertTriangle size={9} strokeWidth={2.6} />
                        Flagged
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[12.5px] text-muted">
                    {who?.name} · {fmtDocDate(r.date)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <SourceBadge source={r.source} />
                    <Badge category={r.category} />
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
