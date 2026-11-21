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
      className={`rounded-2xl border-2 border-[#111827] bg-white p-5 space-y-4 ${className}`.trim()}
      aria-label={`Step ${activeIndex + 1} of ${steps.length}: ${step.title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          aria-current="step"
          className="inline-flex items-center rounded-lg border-2 border-[#0F766E] bg-[#F0FDFA] px-3 py-1 text-[18px] font-semibold text-[#115E59]"
        >
          Step {activeIndex + 1} of {steps.length}
        </p>
      </div>

      <Heading className="text-[22px] font-bold text-[#111827]">
        {step.title}
      </Heading>

      <div className="text-[18px] leading-relaxed text-[#111827]">
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
