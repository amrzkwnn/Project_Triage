import { Activity, Briefcase, Image as ImageIcon, Printer, ScanLine, Smartphone, Sun, Users } from 'lucide-react';
import { useViewport } from '../../hooks/useViewport';
import { content } from '../../content';

// Vertical space reserved below the phone (small bottom margin only).
export const SHELL_RESERVED = 40;

const POINT_ICONS = { smartphone: Smartphone, image: ImageIcon, users: Users };
const FEATURE_ICONS = { sun: Sun, briefcase: Briefcase, scan: ScanLine, printer: Printer };

/**
 * Desktop presentation: story columns left and right, the live phone in the
 * center, stepper below it, footer strip at the bottom. Under 1100px only the
 * phone + stepper; under 500px (real phone) just the app.
 */
export default function DemoShell({ children }) {
  const { w } = useViewport();

  if (w !== 0 && w < 500) return children;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Background: warm neutral to faint teal, soft blurred shapes */}
      <div className="absolute inset-0 bg-gradient-to-br from-canvas via-[#EDF5F3] to-brand-wash" />
      <div className="pointer-events-none absolute -left-28 top-1/4 h-80 w-80 rounded-full bg-brand-soft/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-1/4 h-80 w-80 rounded-full bg-violet-100/70 blur-3xl" />

      {/* Columns */}
      <div className="relative flex h-full items-center justify-center gap-32 px-8">
        {/* Left — the problem */}
        <aside className="anim-col hidden w-[292px] shrink-0 flex-col justify-center gap-5 min-[1100px]:flex">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-chip bg-brand text-white shadow-pill">
              <Activity size={19} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <p className="text-[19px] font-bold tracking-tight text-ink">{content.brand.name}</p>
              <p className="truncate text-[11.5px] text-muted">{content.brand.tagline}</p>
            </div>
          </div>

          <div>
            <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
              {content.problem.heading}
            </h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
              {content.problem.copy}
            </p>
          </div>

          <ul className="flex flex-col gap-2.5">
            {content.problem.points.map((p) => {
              const Icon = POINT_ICONS[p.icon];
              return (
                <li
                  key={p.label}
                  className="flex items-center gap-3 rounded-card border border-white bg-white/70 px-3.5 py-3 shadow-card backdrop-blur-sm"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand">
                    {Icon && <Icon size={17} strokeWidth={2} />}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center — the live phone (demo runs on the phone itself) */}
        <div className="relative h-full w-[440px] shrink-0">{children}</div>

        {/* Right — the solution */}
        <aside
          className="anim-col hidden w-[292px] shrink-0 flex-col justify-center gap-5 min-[1100px]:flex"
          style={{ animationDelay: '0.12s' }}
        >
          <h2 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
            {content.solution.heading}
          </h2>

          <ul className="flex flex-col gap-2.5">
            {content.solution.features.map((f) => {
              const Icon = FEATURE_ICONS[f.icon];
              return (
                <li
                  key={f.label}
                  className="flex items-center gap-3 rounded-card border border-white bg-white/70 px-3.5 py-3 shadow-card backdrop-blur-sm"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand">
                    {Icon && <Icon size={17} strokeWidth={2} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug text-ink">{f.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted">{f.sub}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-center text-[11px] font-medium text-muted">
            {content.solution.note}
          </p>
        </aside>
      </div>

      {/* Footer strip removed per user request */}
    </div>
  );
}

