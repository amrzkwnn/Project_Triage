import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useDemo } from '../../context/DemoContext';
import { content } from '../../content';

/**
 * "Try the demo" stepper: 4 numbered steps, Previous / Next, Reset.
 * Arrow keys work too (wired in DemoShell).
 */
export default function DemoStepper() {
  const { step, goToStep, next, prev, reset } = useDemo();
  const activeLabel = step >= 0 ? content.steps[step].label : 'Try the demo';

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[12.5px] font-semibold text-ink">{activeLabel}</p>
      <div className="chrome flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous step"
          onClick={prev}
          disabled={step <= 0}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white/85 text-muted shadow-pill disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft size={16} strokeWidth={2.4} />
        </button>

        {content.steps.map((s, i) => (
          <button
            key={s.label}
            type="button"
            aria-label={`Step ${i + 1}: ${s.label}`}
            onClick={() => goToStep(i)}
            className={`pressable flex h-11 w-11 items-center justify-center rounded-full text-[14px] font-bold tnum transition-colors duration-150 ${
              step === i
                ? 'bg-brand text-white shadow-pill'
                : 'border border-line bg-white/85 text-muted'
            }`}
          >
            {i + 1}
          </button>
        ))}

        <button
          type="button"
          aria-label="Next step"
          onClick={next}
          disabled={step >= 3}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white/85 text-muted shadow-pill disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronRight size={16} strokeWidth={2.4} />
        </button>

        <span className="mx-1 h-6 w-px bg-ink/10" />

        <button
          type="button"
          onClick={reset}
          className="pressable flex h-11 items-center gap-1.5 rounded-full border border-line bg-white/85 px-3.5 text-[12.5px] font-semibold text-muted shadow-pill"
        >
          <RotateCcw size={13} strokeWidth={2.4} />
          Reset
        </button>
      </div>
    </div>
  );
}
