import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Printer,
  Share2,
  Sparkles,
  ZoomIn,
} from 'lucide-react';
import Card from '../components/Card';
import ImageZoom from '../components/ImageZoom';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import SourceBadge from '../components/SourceBadge';
import { useToast } from '../components/Toast';
import { useDemo } from '../context/DemoContext';
import { documentSvg } from '../data/documents';
import { personById, recordById, sourceMeta } from '../data/seed';

const VIEW_TABS = [
  { id: 'enhanced', label: 'Enhanced' },
  { id: 'original', label: 'Original' },
];

const fmtDocDate = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RecordDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { exportPulse } = useDemo();
  const [view, setView] = useState('enhanced');
  const [zoom, setZoom] = useState(false);

  const record = recordById(id);
  const person = record ? personById(record.personId) : null;

  const svgs = useMemo(
    () =>
      record && person
        ? {
            enhanced: documentSvg(record, person.name, 'enhanced'),
            original: documentSvg(record, person.name, 'original'),
          }
        : null,
    [record, person]
  );

  if (!record || !person || !svgs) {
    return <Navigate to="/records" replace />;
  }

  const abnormalCount = record.details.filter((d) => d.abnormal).length;
  const typeLabel = record.type === 'lab' ? 'Lab report' : 'Prescription';

  const share = () =>
    toast({
      title: 'Share record',
      message:
        record.category === 'work'
          ? 'Work records would be shared with colleagues or the patient. Demo only.'
          : 'Personal records would be shared with family only. Demo only.',
    });

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas">
      {/* Header */}
      <header className="chrome flex shrink-0 items-center gap-1 border-b border-line bg-white/90 px-3 py-2 backdrop-blur-md">
        <button
          type="button"
          aria-label="Back to records"
          onClick={() => navigate('/records')}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16.5px] font-bold tracking-tight text-ink">
            {record.title}
          </h1>
          <p className="truncate text-[12px] font-medium text-muted">
            {person.name} · {typeLabel}
          </p>
        </div>
        <SourceBadge source={record.source} className="mr-1" />
      </header>

      <div className="app-scroll min-h-0 flex-1 px-5 pb-6">
        {/* AI summary */}
        <div className="anim-fade-up relative mt-4 overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft/80 via-brand-wash to-white p-4 shadow-card">
          <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-brand-soft/50 blur-2xl" />
          <div className="relative">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-deep">
              <Sparkles size={12} strokeWidth={2.4} />
              AI summary
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{record.summary}</p>
          </div>
        </div>

        {/* Document image with Enhanced / Original toggle */}
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <SectionHeader title="Document" className="mb-0 flex-1" />
            <SegmentedControl options={VIEW_TABS} value={view} onChange={setView} className="w-[168px]" />
          </div>
          <div className="relative mt-3 overflow-hidden rounded-card border border-line bg-white shadow-card">
            <div
              className="doc-svg cursor-zoom-in"
              onClick={() => setZoom(true)}
              role="button"
              aria-label="Open fullscreen zoom"
            >
              <div
                className={`absolute inset-0 p-4 transition-opacity duration-200 ${
                  view === 'original' ? 'opacity-100' : 'opacity-0'
                }`}
                dangerouslySetInnerHTML={{ __html: svgs.original }}
              />
              <div
                className={`relative p-4 transition-opacity duration-200 ${
                  view === 'enhanced' ? 'opacity-100' : 'opacity-0'
                }`}
                dangerouslySetInnerHTML={{ __html: svgs.enhanced }}
              />
            </div>
            <span className="pointer-events-none absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-white">
              <ZoomIn size={15} strokeWidth={2.2} />
            </span>
          </div>
          <p className="mt-2 text-center text-[11.5px] text-muted">
            Tap the image to zoom · the original is always one tap away
          </p>
        </section>

        {/* Extracted details */}
        <section className="mt-6">
          <SectionHeader title="Extracted details" count={record.details.length}>
            {abnormalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-red-600">
                {abnormalCount} abnormal
              </span>
            )}
          </SectionHeader>
          <Card className="px-4 py-1">
            {record.details.map((d) => (
              <div
                key={d.label}
                className="flex items-center justify-between gap-3 border-b border-line/70 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{d.label}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted">
                    {record.type === 'lab' ? `Range ${d.range}` : d.range}
                  </p>
                </div>
                {d.abnormal ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[13px] font-bold text-red-600 tnum">
                    {d.direction === 'low' ? (
                      <ArrowDown size={12} strokeWidth={2.6} />
                    ) : (
                      <ArrowUp size={12} strokeWidth={2.6} />
                    )}
                    {d.value}
                    {d.unit ? ` ${d.unit}` : ''}
                  </span>
                ) : (
                  <span className="shrink-0 text-[14px] font-semibold text-ink tnum">
                    {d.value}
                    {d.unit ? ` ${d.unit}` : ''}
                  </span>
                )}
              </div>
            ))}
          </Card>
        </section>
      </div>

      {/* Sticky action bar */}
      <div
        className="chrome z-30 flex shrink-0 items-center gap-2.5 border-t border-line bg-white/90 px-4 pt-3 backdrop-blur-xl"
        style={{ paddingBottom: 24 }}
      >
        <button
          type="button"
          onClick={share}
          className="pressable flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-line bg-white text-[13.5px] font-semibold text-ink shadow-pill"
        >
          <Share2 size={16} strokeWidth={2.2} />
          Share
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className={`pressable flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-full bg-brand text-[13.5px] font-semibold text-white shadow-pill ${
            exportPulse ? 'pulse-ring' : ''
          }`}
        >
          <Printer size={16} strokeWidth={2.2} />
          Export as PDF
        </button>
      </div>

      {zoom && (
        <ImageZoom svg={svgs[view]} onClose={() => setZoom(false)} />
      )}

      {createPortal(
        <PrintDoc record={record} person={person} typeLabel={typeLabel} />,
        document.body
      )}
    </div>
  );
}

/**
 * Clean A4 print sheet, rendered outside the phone frame. Only visible to
 * the printer — window.print() outputs just this document.
 */
function PrintDoc({ record, person, typeLabel }) {
  const isLab = record.type === 'lab';
  return (
    <div className="print-doc">
      <h1>{record.title}</h1>
      <p className="print-meta">
        {person.name} · {typeLabel} · {fmtDocDate(record.date)} · Source:{' '}
        {sourceMeta[record.source].label} · {record.category === 'work' ? 'Work' : 'Personal'}
      </p>

      <div className="print-summary">
        <strong>Summary</strong>
        <br />
        {record.summary}
      </div>

      <table>
        <thead>
          <tr>
            <th>{isLab ? 'Component' : 'Medication'}</th>
            <th>{isLab ? 'Result' : 'Dose'}</th>
            <th>{isLab ? 'Reference range' : 'Directions'}</th>
          </tr>
        </thead>
        <tbody>
          {record.details.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td className={d.abnormal ? 'abnormal' : ''}>
                {d.value} {d.unit}
                {d.abnormal ? (d.direction === 'low' ? ' (LOW)' : ' (HIGH)') : ''}
              </td>
              <td>{d.range}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="print-footer">
        Generated by Triage · Demo with dummy data — the original document is the source of truth.
      </p>
    </div>
  );
}
