import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Image as ImageIcon, Sparkles } from 'lucide-react';
import { useScreenPortal } from '../components/PhoneFrame';
import { sampleUploadSvg } from '../data/documents';
import { addSessionRecord, uploadResultRecord } from '../data/seed';

const STEPS = [
  { label: 'Enhancing image…', ms: 850 },
  { label: 'Extracting text…', ms: 850 },
  { label: 'Summarizing…', ms: 850 },
];

/**
 * Simulated screenshot-to-record flow. Nothing is processed or uploaded:
 * "Process" runs a stepped animation and opens the pre-made result record.
 * `?demo=1` auto-loads the sample screenshot and runs hands-free (used by
 * the presentation stepper).
 */
export default function Upload() {
  const navigate = useNavigate();
  const screen = useScreenPortal();
  const [params] = useSearchParams();
  const fileRef = useRef(null);

  const [image, setImage] = useState(null); // {kind:'sample'} | {kind:'file', url, name}
  const [step, setStep] = useState(-1); // -1 idle, 0..2 processing steps

  const runProcessing = () => {
    setStep(0);
    setTimeout(() => setStep(1), STEPS[0].ms);
    setTimeout(() => setStep(2), STEPS[0].ms + STEPS[1].ms);
    setTimeout(() => {
      addSessionRecord(uploadResultRecord);
      navigate('/records/rec-uploaded');
    }, STEPS[0].ms + STEPS[1].ms + STEPS[2].ms);
  };

  // Demo auto mode — sample image pre-loaded, processing starts on its own.
  useEffect(() => {
    if (params.get('demo') !== '1') return;
    setImage({ kind: 'sample' });
    const t = setTimeout(runProcessing, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage({ kind: 'file', url: URL.createObjectURL(file), name: file.name });
  };

  const processing = step >= 0;

  return (
    <div className="app-scroll absolute inset-0 bg-canvas px-5">
      <div className="pt-5">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">
          Add record
        </h1>
        <p className="mt-0.5 text-[13px] font-medium text-muted">
          Turn a screenshot into a clean, readable record
        </p>
      </div>

      {!image ? (
        /* Dashed drop area */
        <div className="anim-fade-up mt-5 rounded-card border-2 border-dashed border-brand-soft bg-white/70 px-6 py-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-wash text-brand">
            <Camera size={24} strokeWidth={1.9} />
          </span>
          <h2 className="mt-4 text-[16px] font-semibold text-ink">Add a screenshot</h2>
          <p className="mx-auto mt-1.5 max-w-[250px] text-[13px] leading-relaxed text-muted">
            Pick a prescription or lab report from your gallery — Triage cleans it up and pulls
            out the details.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="pressable mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[13.5px] font-semibold text-white shadow-pill"
          >
            <ImageIcon size={16} strokeWidth={2.2} />
            Choose image
          </button>
          <button
            type="button"
            onClick={() => setImage({ kind: 'sample' })}
            className="pressable mt-3 inline-flex h-11 items-center rounded-full px-4 text-[12.5px] font-semibold text-brand"
          >
            or use a sample screenshot
          </button>
        </div>
      ) : (
        /* Preview + choices */
        <div className="anim-pop mt-5">
          <div className="rounded-card border border-line bg-white p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-ink">Selected screenshot</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="pressable inline-flex h-11 items-center rounded-full px-3 text-[12px] font-semibold text-brand"
              >
                Replace
              </button>
            </div>
            <div className="mt-3 flex justify-center rounded-chip border border-line bg-canvas p-3">
              {image.kind === 'sample' ? (
                <div
                  className="doc-svg w-[200px]"
                  dangerouslySetInnerHTML={{ __html: sampleUploadSvg }}
                />
              ) : (
                <img
                  src={image.url}
                  alt="Selected screenshot"
                  className="max-h-[240px] w-auto rounded-chip object-contain"
                />
              )}
            </div>
            <p className="mt-2 text-center text-[11.5px] text-muted">
              {image.kind === 'sample'
                ? 'Sample screenshot · lab report'
                : image.name}
            </p>
          </div>

          <button
            type="button"
            onClick={runProcessing}
            className="pressable mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-[14px] font-semibold text-white shadow-lift"
          >
            <Sparkles size={16} strokeWidth={2.2} />
            Process record
          </button>
          <p className="mt-2.5 pb-8 text-center text-[11px] text-muted">
            Nothing is uploaded — this demo simulates the result.
          </p>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {/* Processing overlay — covers the whole phone screen */}
      {processing &&
        screen &&
        createPortal(
          <div className="anim-fade-in chrome absolute inset-0 z-[60] flex items-center justify-center bg-canvas/85 backdrop-blur-md">
            <div className="anim-pop w-[272px] rounded-card bg-white p-6 text-center shadow-lift">
              <span className="relative mx-auto flex h-14 w-14">
                <span className="absolute inset-0 rounded-full border-[3px] border-brand-soft" />
                <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand" />
              </span>
              <p className="mt-5 text-[15px] font-bold text-ink">{STEPS[step].label}</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-700 ease-out"
                  style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                />
              </div>
              <div className="mt-4 flex items-center justify-center gap-1.5">
                {STEPS.map((s, i) => (
                  <span
                    key={s.label}
                    className={`h-[6px] rounded-full transition-all duration-200 ${
                      i <= step ? 'w-4 bg-brand' : 'w-[6px] bg-line'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-4 text-[11px] text-muted">Simulated processing · demo</p>
            </div>
          </div>,
          screen
        )}
    </div>
  );
}
