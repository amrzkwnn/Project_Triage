'use client';

import React from 'react';
import {
  Activity,
  CalendarDays,
  Inbox,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useViewport } from '@/hooks/useViewport';
import {
  presentationContent,
  type ProblemPointIcon,
  type SolutionFeatureIcon,
} from '@/lib/presentation/content';

// Vertical space reserved below the phone (small bottom margin only).
export const SHELL_RESERVED = 40;

const POINT_ICONS: Record<ProblemPointIcon, LucideIcon> = {
  smartphone: Smartphone,
  shield: Shield,
  calendar: CalendarDays,
};

const FEATURE_ICONS: Record<SolutionFeatureIcon, LucideIcon> = {
  sun: Sun,
  inbox: Inbox,
  shieldCheck: ShieldCheck,
  sparkles: Sparkles,
};

export interface DemoShellProps {
  children: React.ReactNode;
}

/**
 * Desktop presentation: story columns left and right, live phone in the
 * center. Under 1100px only the phone; under 500px (real phone) just the app.
 */
export function DemoShell({ children }: DemoShellProps) {
  const { w } = useViewport();

  if (w !== 0 && w < 500) {
    return <>{children}</>;
  }

  return (
    <div className="relative h-full min-h-screen w-full overflow-hidden">
      {/* Background: warm neutral to faint teal, soft blurred shapes */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-canvas via-[#EDF5F3] to-brand-wash"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 top-1/4 h-80 w-80 rounded-full bg-brand-soft/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-28 bottom-1/4 h-80 w-80 rounded-full bg-violet-100/70 blur-3xl"
      />

      {/* Columns */}
      <div className="relative flex h-full min-h-screen items-center justify-center gap-12 px-8 xl:gap-20 2xl:gap-32">
        {/* Left — the problem */}
        <aside className="anim-col hidden w-[292px] shrink-0 flex-col justify-center gap-5 min-[1100px]:flex">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-chip bg-brand text-white shadow-pill"
            >
              <Activity size={19} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <p className="text-[19px] font-bold tracking-tight text-ink">
                {presentationContent.brand.name}
              </p>
              <p className="truncate text-[11.5px] text-muted">
                {presentationContent.brand.tagline}
              </p>
            </div>
          </div>

          <div>
            <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
              {presentationContent.problem.heading}
            </h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
              {presentationContent.problem.copy}
            </p>
          </div>

          <ul className="flex flex-col gap-2.5">
            {presentationContent.problem.points.map((point) => {
              const Icon = POINT_ICONS[point.icon];
              return (
                <li
                  key={point.label}
                  className="flex items-center gap-3 rounded-card border border-white bg-white/70 px-3.5 py-3 shadow-card backdrop-blur-sm"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
                  >
                    <Icon size={17} strokeWidth={2} />
                  </span>
                  <span className="text-[13px] font-semibold text-ink">
                    {point.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center — the live phone */}
        <div className="relative h-full w-[440px] shrink-0">{children}</div>

        {/* Right — the solution */}
        <aside
          className="anim-col hidden w-[292px] shrink-0 flex-col justify-center gap-5 min-[1100px]:flex"
          style={{ animationDelay: '0.12s' }}
        >
          <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
            {presentationContent.solution.heading}
          </h2>

          <ul className="flex flex-col gap-2.5">
            {presentationContent.solution.features.map((feature) => {
              const Icon = FEATURE_ICONS[feature.icon];
              return (
                <li
                  key={feature.label}
                  className="flex items-center gap-3 rounded-card border border-white bg-white/70 px-3.5 py-3 shadow-card backdrop-blur-sm"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand"
                  >
                    <Icon size={17} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug text-ink">
                      {feature.label}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {feature.sub}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-center text-[11px] font-medium text-muted">
            {presentationContent.solution.note}
          </p>
        </aside>
      </div>
    </div>
  );
}

export default DemoShell;
