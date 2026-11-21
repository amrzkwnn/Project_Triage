'use client';

import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { SeniorButton } from './SeniorButton';

export type WizardStep = {
  id?: string;
  title: string;
  content: React.ReactNode;
};

export type StepWizardProps = {
  steps: readonly WizardStep[];
  currentStep?: number;
  initialStep?: number;
  onStepChange?: (nextIndex: number) => void;
  onComplete?: () => void;
  completeLabel?: string;
  headingLevel?: 'h2' | 'h3';
  className?: string;
};

export function StepWizard({
  steps,
  currentStep,
  initialStep = 0,
  onStepChange,
  onComplete,
  completeLabel = 'Done',
  headingLevel = 'h3',
  className = '',
}: StepWizardProps) {
  const [internalStep, setInternalStep] = useState(initialStep);

  if (steps.length === 0) {
    return null;
  }

  const rawIndex = currentStep ?? internalStep;
  const activeIndex = Math.max(0, Math.min(rawIndex, steps.length - 1));
  const step = steps[activeIndex];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === steps.length - 1;

  const goTo = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, steps.length - 1));
    if (currentStep === undefined) {
      setInternalStep(clamped);
    }
    onStepChange?.(clamped);
  };

  const Heading = headingLevel;

  return (
    <section
      data-card="true"
      className={`anim-fade-up rounded-card border-2 border-line bg-white p-5 shadow-card space-y-4 ${className}`.trim()}
      aria-label={`Step ${activeIndex + 1} of ${steps.length}: ${step.title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          aria-current="step"
          className="tnum inline-flex items-center rounded-full border-2 border-brand-soft bg-brand-wash px-3.5 py-1 text-[18px] font-semibold text-brand-deep"
        >
          Step {activeIndex + 1} of {steps.length}
        </p>

        <div aria-hidden="true" className="flex items-center gap-1.5">
          {steps.map((s, idx) => (
            <span
              key={s.id ?? `${idx}-${s.title}`}
              className={`h-[6px] rounded-full transition-all duration-200 ${
                idx === activeIndex ? 'w-5 bg-brand' : 'w-[6px] bg-line'
              }`}
            />
          ))}
        </div>
      </div>

      <Heading className="text-[22px] font-bold text-ink">
        {step.title}
      </Heading>

      <div className="text-[18px] leading-relaxed text-ink">
        {step.content}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <SeniorButton
          variant="secondary"
          disabled={isFirst}
          icon={<ArrowLeft size={20} />}
          onClick={() => goTo(activeIndex - 1)}
        >
          Back
        </SeniorButton>

        {isLast ? (
          <SeniorButton
            variant="safe"
            icon={<Check size={20} />}
            onClick={() => onComplete?.()}
          >
            {completeLabel}
          </SeniorButton>
        ) : (
          <SeniorButton
            variant="primary"
            icon={<ArrowRight size={20} />}
            onClick={() => goTo(activeIndex + 1)}
          >
            Next
          </SeniorButton>
        )}
      </div>
    </section>
  );
}
