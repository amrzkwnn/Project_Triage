# Syed Visual Design Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the complete visual design language, design tokens, `PhoneFrame` iPhone bezel, 3-column `DemoShell` presentation layout, frosted `TabBar`, and card/calendar/document aesthetics from `Project_Triage-Syed` across all 7 screens and 9 core components of the Senior Digital Companion app while preserving 100% of existing vault, consent, AI tiering, security, and accessibility guarantees.

**Architecture:** We extend `tailwind.config.js` and `src/app/globals.css` with Syed's exact color tokens (`canvas`, `surface`, `ink`, `muted`, `faint`, `line`, `brand.*`), radii (`rounded-card: 16px`, `rounded-chip: 12px`), elevation shadows (`shadow-card`, `shadow-lift`, `shadow-pill`, `shadow-phone`), and keyframe utilities (`anim-fade-up`, `anim-pop`, `anim-collapse`, `anim-check`, `pulse-ring`). We port Syed's presentation shell (`useViewport`, `PhoneFrame`, `DemoShell`, `TabBar`, `Toast`, `Card`, `SectionHeader`, `EmptyState`, `FilterChips`, `SegmentedControl`, `MonthCalendar`) into TypeScript and restyle `AppShell`, all 9 shared senior components, and all 7 functional screens (`HomeHub`, `UnifiedInboxPage`, `CalendarPage`, `ScamShieldPage`, `AiMediaCheckPage`, `PhotoHelperPage`, `MyDataPage`) to match Syed's visual design while keeping all 103 existing tests green.

**Tech Stack:** TypeScript 5, React 19, Vite 5, Tailwind CSS 3.4, Lucide React, `temporal-polyfill`, Vitest + `fast-check`.

**Spec:**
- Visual Reference: `C:\Users\Amir\Projects\Build_Bersama\Project_Triage-Syed` (`tailwind.config.js`, `src/index.css`, `src/components/**`, `src/screens/**`)
- Functional Spec: `C:\Users\Amir\Projects\Build_Bersama\.kiro\specs\senior-digital-companion\{requirements.md,design.md,tasks.md}`

## Global Constraints

- **Color Tokens (`tailwind.config.js` & `src/app/globals.css`):** `canvas: '#F7F8FA'`, `surface: '#FFFFFF'`, `ink: '#0F172A'`, `muted: '#64748B'`, `faint: '#94A3B8'`, `line: '#E7EAF0'`, `brand: { DEFAULT: '#0F766E', deep: '#115E59', bright: '#0D9488', soft: '#CCFBF1', wash: '#F0FDFA' }`, `--urgent: #dc2626`.
- **Shape & Shadow Tokens:** `borderRadius.card = '16px'`, `borderRadius.chip = '12px'`, `shadow-card = '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)'`, `shadow-lift = '0 2px 4px rgba(15,23,42,0.05), 0 12px 28px rgba(15,23,42,0.10)'`, `shadow-pill = '0 1px 3px rgba(15,23,42,0.10)'`, `shadow-phone = '0 10px 24px rgba(15,23,42,0.14), inset 0 0 0 1px rgba(255,255,255,0.06)'`.
- **Touch Target & Button Invariant:** Every `<button>` rendered anywhere inside the 7 screens MUST include `min-h-[56px]` and a non-empty visible text label (`stripHtml(buttonHtml).length > 0`) so `tests/a11y/accessibilityAndCopy.test.tsx` passes without exception.
- **Dual-Modality Badge Invariant:** Every element with `data-badge="true"` MUST contain both an icon wrapper with `aria-hidden="true"` and visible text (`stripHtml(badgeHtml).length > 0`), plus `border-2` where asserted by `tests/unit/uiComponentsAndScreens.test.tsx`.
- **Plain-Language Copy Invariant:** No user-facing text in any screen, component, or `DemoShell` column may match `/\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i`.
- **Navigation Invariant:** Every non-home screen (`/inbox`, `/calendar`, `/scam-shield`, `/media-check`, `/photo-helper`, `/my-data`) MUST render `<BackToHome />` (`"← Back to Home"` with `min-h-[56px]` and `href="/"`), and `HomeHub` (`/`) MUST NOT render `<BackToHome />`.
- **Shell & Test Runner Commands (Windows PowerShell 5.1):** Use `;` (never `&&`) and run `.\node_modules\.bin\tsc.cmd --noEmit`, `.\node_modules\.bin\vitest.cmd --run`, and `.\node_modules\.bin\vite.cmd build` in `C:\Users\Amir\Projects\Project_Triage`.

## Review Focus

1. **SSR / `renderToStaticMarkup` viewport measurement (`window` undefined):** `useViewport()`, `PhoneFrame`, `DemoShell`, and `ToastProvider` must render cleanly when `window` is undefined (initial `{ w: 0, h: 0 }`) so all server-rendered Vitest tests render the full app tree inside the desktop frame without throwing or hiding children. (Pinned in Task 2 test `renders DemoShell, PhoneFrame, and TabBar safely under SSR renderToStaticMarkup`).
2. **Icon-only pagination/calendar buttons breaking the global `<button>` accessibility audit:** In `Project_Triage-Syed`, month-nav chevrons lack visible text labels and use `h-11` (`44px`). In our app, every `<button>` inside the 7 screens is audited for `min-h-[56px]` and `stripHtml(btn).length > 0`. All interactive `<button>` controls in `MonthCalendar`, `SegmentedControl`, and `FilterChips` must include `min-h-[56px]` and visible or `<span className="sr-only">` text labels. (Pinned in Task 3 test `MonthCalendar, SegmentedControl, and FilterChips buttons all carry min-h-[56px] and non-empty text labels`).
3. **Invalid or out-of-range ISO dates passed to `MonthCalendar`:** If `selectedDate` is an invalid string or leap-year boundary date, `MonthCalendar` must fall back safely to `Temporal.Now.plainDateISO()` instead of throwing `RangeError`. (Pinned in Task 3 test `MonthCalendar falls back to today when given an invalid ISO date string`).
4. **Banned technical jargon leaking from `DemoShell` presentation copy into `AppShell` static markup:** `AppShell` is tested against `BANNED_JARGON` in `tests/unit/uiComponentsAndScreens.test.tsx`. All `DemoShell` problem/solution copy in `src/lib/presentation/content.ts` must be verified against `BANNED_JARGON`. (Pinned in Task 2 test `DemoShell presentation copy contains zero banned technical jargon`).
5. **Confirm token minting regression when restyling `DecisionConfirmCard` to Syed's glassmorphism urgent card:** Restyling `DecisionConfirmCard` to Syed's red/teal glass card must preserve `text-[20px]` on the summary paragraph and must mint `Confirmation` ONLY inside the Confirm button's `onClick` handler. (Pinned in Task 1 test `restyled DecisionConfirmCard preserves Syed glass classes, text-[20px], and click-only confirmation minting`).

---

## File Structure

- **Modify:** `tailwind.config.js` — Add Syed's `fontFamily.sans`, `colors` (`canvas`, `surface`, `ink`, `muted`, `faint`, `line`, `brand`), `borderRadius` (`card`, `chip`), and `boxShadow` (`card`, `lift`, `pill`, `phone`).
- **Modify:** `src/app/globals.css` — Add Syed's CSS variables (`--canvas`, `--ink`, `--ink-soft`, `--brand`, `--urgent`), `.tnum`, `.app-scroll`, `.no-scrollbar`, `.chrome`, `.pressable`, `.phone-body`, keyframe animations (`fade-up`, `fade-in`, `pop-in`, `toast-in`, `collapse`, `check-pop`, `shimmer`, `pulse-ring`, `col-in`), `.print-doc` print rules, and `@media (prefers-reduced-motion: reduce)` while keeping `.skip-link`, `:focus-visible`, and `@media (forced-colors: active)`.
- **Modify:** `src/components/{SeniorButton,SourceBadge,PriorityPill,DecisionConfirmCard,TrafficLightCard,StepWizard,PrivacyPill,BackToHome,StatusLive}.tsx` — Restyle all 9 existing components to Syed's visual design tokens while preserving all existing props, DOM attributes, `border-2`, `min-h-[56px]`, and `data-badge="true"` / `data-card="true"` contracts.
- **Create:** `src/hooks/useViewport.ts` — SSR-safe viewport size hook `{ w: number; h: number }`.
- **Create:** `src/lib/presentation/content.ts` — Senior Digital Companion presentation copy for Syed's 3-column `DemoShell` (brand, problem points, solution features) with zero banned jargon.
- **Create:** `src/components/PhoneFrame.tsx` — Syed's iPhone bezel (`390x844` inner screen, `414x868` outer body, Dynamic Island, simulated status bar, side buttons, home indicator, viewport height scaling, `<500px` fullscreen safe-area fallback, and `ScreenPortalContext`).
- **Create:** `src/components/presentation/DemoShell.tsx` — Syed's 3-column desktop presentation layout (`>=1100px` problem + phone + solution columns, `<1100px` centered phone, `<500px` direct fullscreen app).
- **Create:** `src/components/TabBar.tsx` — Syed's frosted glass bottom navigation bar (`Home`, `Inbox`, `Calendar`, `Safety`, `My Data`) using anchor links with `onNavigate` support.
- **Create:** `src/components/Toast.tsx` — Syed's in-screen dark glass toast portal (`ToastProvider` + `useToast`).
- **Modify:** `src/app/layout.tsx` & `src/main.tsx` — Integrate `DemoShell`, `PhoneFrame`, `ToastProvider`, frosted header, `.app-scroll` container, and `TabBar` into `AppShell` while preserving all landmarks (`<header>`, `<nav aria-label="Primary">`, `<main id="main-content">`, skip link, offline & store error banners).
- **Create:** `src/components/{Card,SectionHeader,EmptyState,FilterChips,SegmentedControl,MonthCalendar}.tsx` — TypeScript ports of Syed's shared UI components adapted for `min-h-[56px]` accessible buttons and `CalendarEvent` data.
- **Modify:** `src/app/page.tsx` (`HomeHub`), `src/app/inbox/page.tsx` (`UnifiedInboxPage`), `src/app/calendar/page.tsx` (`CalendarPage`), `src/app/scam-shield/page.tsx` (`ScamShieldPage`), `src/app/media-check/page.tsx` (`AiMediaCheckPage`), `src/app/photo-helper/page.tsx` (`PhotoHelperPage`), `src/app/my-data/page.tsx` (`MyDataPage`) — Restyle all 7 screens to Syed's visual design.
- **Create:** `tests/unit/syedVisualDesign.test.tsx` — Unit and static-markup tests verifying Syed's design tokens, `PhoneFrame`, `DemoShell`, `TabBar`, `MonthCalendar`, `SegmentedControl`, `FilterChips`, and restyled screens.

---

### Task 1: Syed Design Tokens, Motion CSS & Restyled Core Senior Components

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/app/globals.css`
- Modify: `src/components/SeniorButton.tsx`
- Modify: `src/components/SourceBadge.tsx`
- Modify: `src/components/PriorityPill.tsx`
- Modify: `src/components/DecisionConfirmCard.tsx`
- Modify: `src/components/TrafficLightCard.tsx`
- Modify: `src/components/StepWizard.tsx`
- Modify: `src/components/PrivacyPill.tsx`
- Modify: `src/components/BackToHome.tsx`
- Modify: `src/components/StatusLive.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: `@/lib/types` (`Channel`, `PriorityType`, `DecisionTier`, `Verdict`, `Settings`), `@/lib/actions/confirmation` (`Confirmation`, `confirmFromTap`).
- Produces:
  - Tailwind classes: `bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `bg-brand`, `bg-brand-deep`, `bg-brand-bright`, `bg-brand-soft`, `bg-brand-wash`, `rounded-card`, `rounded-chip`, `shadow-card`, `shadow-lift`, `shadow-pill`, `shadow-phone`.
  - CSS utility classes: `.tnum`, `.app-scroll`, `.no-scrollbar`, `.chrome`, `.pressable`, `.phone-body`, `.anim-fade-up`, `.anim-fade-in`, `.anim-pop`, `.anim-toast`, `.anim-collapse`, `.anim-check`, `.skeleton`, `.pulse-ring`, `.anim-col`.
  - Unchanged component props on `SeniorButton`, `SourceBadge`, `PriorityPill`, `DecisionConfirmCard`, `TrafficLightCard`, `StepWizard`, `PrivacyPill`, `BackToHome`, `StatusLive`.

- [ ] **Step 1: Write the failing test in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import { SeniorButton } from '@/components/SeniorButton';
import { SourceBadge } from '@/components/SourceBadge';
import { PriorityPill } from '@/components/PriorityPill';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { TrafficLightCard } from '@/components/TrafficLightCard';
import { StepWizard } from '@/components/StepWizard';
import { PrivacyPill } from '@/components/PrivacyPill';
import { isValidConfirmation, type Confirmation } from '@/lib/actions/confirmation';
import { createDefaultSettings } from '@/lib/types';

describe('Task 1: Syed Design Tokens and Core Components', () => {
  it('configures exact Syed color, radius, and shadow tokens in tailwind.config.js', () => {
    const extend = tailwindConfig.theme?.extend as Record<string, any>;
    expect(extend.colors.canvas).toBe('#F7F8FA');
    expect(extend.colors.surface).toBe('#FFFFFF');
    expect(extend.colors.ink).toBe('#0F172A');
    expect(extend.colors.muted).toBe('#64748B');
    expect(extend.colors.faint).toBe('#94A3B8');
    expect(extend.colors.line).toBe('#E7EAF0');
    expect(extend.colors.brand).toEqual({
      DEFAULT: '#0F766E',
      deep: '#115E59',
      bright: '#0D9488',
      soft: '#CCFBF1',
      wash: '#F0FDFA',
    });
    expect(extend.borderRadius.card).toBe('16px');
    expect(extend.borderRadius.chip).toBe('12px');
    expect(extend.boxShadow.card).toContain('rgba(15,23,42,0.06)');
    expect(extend.boxShadow.lift).toContain('rgba(15,23,42,0.10)');
    expect(extend.boxShadow.pill).toContain('rgba(15,23,42,0.10)');
    expect(extend.boxShadow.phone).toContain('rgba(15,23,42,0.14)');
  });

  it('restyled DecisionConfirmCard preserves Syed glass classes, text-[20px], and click-only confirmation minting', () => {
    const confirmed: Confirmation[] = [];
    const onConfirm = vi.fn((c: Confirmation) => confirmed.push(c));
    const onDismiss = vi.fn();

    const tier3Html = renderToStaticMarkup(
      <DecisionConfirmCard
        actionId="act-99"
        tier={3}
        title="Critical alert"
        summary="Suspicious bank transfer message requires check."
        source="whatsappForward"
        priority="Important"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
    expect(tier3Html).toContain('rounded-card');
    expect(tier3Html).toContain('bg-gradient-to-br');
    expect(tier3Html).toContain('shadow-card');
    expect(tier3Html).toContain('text-[20px]');
    expect(onConfirm).not.toHaveBeenCalled();

    const buttonHtml = renderToStaticMarkup(
      <SeniorButton variant="primary">Confirm Action</SeniorButton>
    );
    expect(buttonHtml).toContain('pressable');
    expect(buttonHtml).toContain('rounded-full');
    expect(buttonHtml).toContain('shadow-pill');
    expect(buttonHtml).toContain('min-h-[56px]');
    expect(buttonHtml).toContain('border-2');

    const waBadge = renderToStaticMarkup(<SourceBadge source="whatsappForward" />);
    expect(waBadge).toContain('bg-green-50');
    expect(waBadge).toContain('text-green-700');
    expect(waBadge).toContain('border-2');
    expect(waBadge).toContain('From WhatsApp');

    const emailBadge = renderToStaticMarkup(<SourceBadge source="email" />);
    expect(emailBadge).toContain('bg-blue-50');
    expect(emailBadge).toContain('text-blue-700');
    expect(emailBadge).toContain('From Email');

    const pillHtml = renderToStaticMarkup(
      <PrivacyPill settings={createDefaultSettings()} />
    );
    expect(pillHtml).toContain('shadow-pill');
    expect(pillHtml).toContain('My Data: 0 Sources On • AI Off');

    const wizardHtml = renderToStaticMarkup(
      <StepWizard
        steps={[
          { title: 'Step A', content: <p>First</p> },
          { title: 'Step B', content: <p>Second</p> },
        ]}
      />
    );
    expect(wizardHtml).toContain('rounded-card');
    expect(wizardHtml).toContain('shadow-card');
    expect(wizardHtml).toContain('Step 1 of 2');

    const trafficHtml = renderToStaticMarkup(
      <TrafficLightCard
        verdict={{ value: 'danger', reasons: ['Urgent payment demand'], flags: ['urgency'] }}
      />
    );
    expect(trafficHtml).toContain('rounded-card');
    expect(trafficHtml).toContain('shadow-card');
    expect(trafficHtml).toContain('Likely Scam — Do Not Click or Pay');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `Cannot read properties of undefined (reading 'canvas')`

- [ ] **Step 3: Update `tailwind.config.js`, `src/app/globals.css`, and the 9 components in `src/components/*.tsx`**

1. In `tailwind.config.js`, copy Syed's exact `theme.extend` (`fontFamily.sans`, `colors.canvas/surface/ink/muted/faint/line/brand`, `borderRadius.card/chip`, `boxShadow.card/lift/pill/phone`) with `content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}']`.
2. In `src/app/globals.css`, merge Syed's CSS tokens and utility classes (`.tnum`, `.app-scroll`, `.no-scrollbar`, `.chrome`, `.pressable`, `.phone-body`, `@keyframes fade-up/fade-in/pop-in/toast-in/collapse/check-pop/shimmer/pulse-ring/col-in`, `.anim-*`, `.skeleton`, `.pulse-ring`, `.doc-svg svg`, `.print-doc`, `@media print`, `@media (prefers-reduced-motion: reduce)`) with our accessibility rules (`text-wrap: balance` on `h1, h2, h3`, `.skip-link`, `:focus-visible`, `:user-invalid`, `@media (forced-colors: active)`).
3. Update the 9 components in `src/components/`:
   - `SeniorButton.tsx`: Add `pressable rounded-full shadow-pill` to `BASE_CLASSES` (keeping `min-h-[56px] min-w-[56px] px-5 py-3 border-2 text-[18px] font-semibold`). Update `primary` to `bg-brand text-white border-brand hover:bg-brand-deep active:bg-[#134E4A]`, `secondary` to `bg-white text-ink border-line hover:border-brand hover:bg-brand-wash active:bg-brand-soft/40`.
   - `SourceBadge.tsx`: Style per channel using Syed's `sourceMeta` palette with `border-2 rounded-full px-3 py-1 text-[14px] font-bold tracking-[0.04em] shadow-pill` (`whatsappForward`: `border-green-200 bg-green-50 text-green-700`, `email`: `border-blue-200 bg-blue-50 text-blue-700`, `smsPaste`: `border-slate-300 bg-slate-100 text-slate-700`, `messengerPaste`: `border-violet-200 bg-violet-100 text-violet-700`, `photos`: `border-teal-200 bg-teal-50 text-teal-700`). Keep `data-badge="true"`, `aria-hidden="true"`, and exact text labels (`From Email`, `From WhatsApp`, `From SMS`, `From Messenger`, `From Photo`).
   - `PriorityPill.tsx`: Style with `rounded-full border-2 px-3 py-1 text-[14px] font-bold tracking-[0.04em] shadow-pill` (`Important`: `border-red-200 bg-red-50 text-red-600`, `Social`: `border-teal-200 bg-brand-wash text-brand-deep`, `Promotion`: `border-amber-200 bg-amber-50 text-amber-800`).
   - `DecisionConfirmCard.tsx`: Style after Syed's `MyDay.jsx` glassmorphism card (`anim-fade-up relative overflow-hidden rounded-card border-2 p-5 shadow-card backdrop-blur-md`, Tier 3: `border-red-200/90 bg-gradient-to-br from-red-50/90 via-white/85 to-red-50/40` with blurred orb `pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-red-100/70 blur-2xl`; Tier 2: `border-brand-soft bg-gradient-to-br from-brand-soft/75 via-brand-wash to-white` with blurred orb `bg-brand-soft/60 blur-2xl`). Keep `text-[20px]` on summary `<p>` and click-only `confirmFromTap(actionId)`.
   - `TrafficLightCard.tsx`: Add `anim-fade-up relative overflow-hidden rounded-card border-2 p-5 shadow-card backdrop-blur-md` and gradient washes (`safe`: `border-[#15803D] bg-gradient-to-br from-green-50/90 via-white to-green-50/40`, `caution`: `border-[#D97706] bg-gradient-to-br from-amber-50/90 via-white to-amber-50/40`, `danger`: `border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40`).
   - `StepWizard.tsx`: Style with `anim-fade-up rounded-card border-2 border-line bg-white p-5 shadow-card space-y-4` and add Syed's dot indicators (`h-[6px] rounded-full transition-all duration-200`, active `w-5 bg-brand`, inactive `w-[6px] bg-line`).
   - `PrivacyPill.tsx`: Add `pressable shadow-pill backdrop-blur-md border-2 border-brand-soft bg-white/90 text-brand-deep hover:bg-brand-wash`.
   - `BackToHome.tsx` & `StatusLive.tsx`: Use `rounded-card shadow-card border-2 border-brand-soft bg-brand-wash text-ink` on `StatusLive`.

- [ ] **Step 4: Run tests to verify Task 1 and existing tests pass**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx tests/unit/uiComponentsAndScreens.test.tsx tests/a11y/accessibilityAndCopy.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add tailwind.config.js src/app/globals.css src/components/ tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(ui): adopt Syed design tokens, animations, and glass component styling"
```

---

### Task 2: Syed PhoneFrame, DemoShell Presentation Layout, Frosted TabBar & AppShell

**Files:**
- Create: `src/hooks/useViewport.ts`
- Create: `src/lib/presentation/content.ts`
- Create: `src/components/PhoneFrame.tsx`
- Create: `src/components/presentation/DemoShell.tsx`
- Create: `src/components/TabBar.tsx`
- Create: `src/components/Toast.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/main.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: Task 1 tokens & CSS classes (`.phone-body`, `.chrome`, `.pressable`, `.app-scroll`, `.anim-col`, `.anim-toast`, `shadow-phone`, `shadow-card`, `shadow-pill`, `bg-canvas`, `bg-brand`, `bg-brand-wash`, `bg-brand-soft`).
- Produces:
  - `useViewport(): { w: number; h: number }` in `src/hooks/useViewport.ts`
  - `presentationContent` in `src/lib/presentation/content.ts`
  - `PhoneFrame({ children, reserved?: number })` & `useScreenPortal(): HTMLElement | null` in `src/components/PhoneFrame.tsx`
  - `DemoShell({ children })` & `SHELL_RESERVED` in `src/components/presentation/DemoShell.tsx`
  - `TabBar({ activePath?: string; onNavigate?: (href: string) => void })` in `src/components/TabBar.tsx`
  - `ToastProvider({ children })` & `useToast()` in `src/components/Toast.tsx`
  - Updated `AppShell` in `src/app/layout.tsx` accepting optional `activePath?: string` alongside existing `AppShellProps`.

- [ ] **Step 1: Write the failing tests for `PhoneFrame`, `DemoShell`, `TabBar`, `ToastProvider`, and `AppShell` in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import { PhoneFrame } from '@/components/PhoneFrame';
import { DemoShell } from '@/components/presentation/DemoShell';
import { TabBar } from '@/components/TabBar';
import { ToastProvider } from '@/components/Toast';
import { presentationContent } from '@/lib/presentation/content';
import { AppShell } from '@/app/layout';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

describe('Task 2: Syed PhoneFrame, DemoShell, TabBar, and AppShell', () => {
  it('DemoShell presentation copy contains zero banned technical jargon', () => {
    const blob = JSON.stringify(presentationContent);
    expect(blob).not.toMatch(BANNED_JARGON);
  });

  it('renders DemoShell, PhoneFrame, and TabBar safely under SSR renderToStaticMarkup', () => {
    const html = renderToStaticMarkup(
      <DemoShell>
        <PhoneFrame>
          <ToastProvider>
            <div>Inside Phone Screen</div>
            <TabBar activePath="/calendar" />
          </ToastProvider>
        </PhoneFrame>
      </DemoShell>
    );
    expect(html).toContain('phone-body');
    expect(html).toContain('Inside Phone Screen');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('href="/calendar"');
    expect(html).toContain('href="/scam-shield"');
    expect(html).toContain('href="/my-data"');
    expect(html).toContain(presentationContent.brand.name);
    expect(html).toContain(presentationContent.problem.heading);
    expect(html).toContain(presentationContent.solution.heading);
  });

  it('AppShell wraps children in Syed DemoShell + PhoneFrame + TabBar while preserving landmarks and zero banned jargon', () => {
    const html = renderToStaticMarkup(
      <AppShell isOffline storeUnavailable activePath="/">
        <p>Senior companion content</p>
      </AppShell>
    );
    expect(html).toContain('Skip to main content');
    expect(html).toContain('phone-body');
    expect(html).toContain('<header');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('<main');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Senior companion content');
    const visible = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(BANNED_JARGON);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/PhoneFrame"`

- [ ] **Step 3: Implement `useViewport.ts`, `content.ts`, `PhoneFrame.tsx`, `DemoShell.tsx`, `TabBar.tsx`, `Toast.tsx`, `layout.tsx`, and `main.tsx`**

1. Create `src/hooks/useViewport.ts` porting Syed's `useViewport.js` (`{ w: 0, h: 0 }` initial state, `window.innerWidth`/`innerHeight` listener in `useEffect`).
2. Create `src/lib/presentation/content.ts` with plain-language copy for the 3-column desktop presentation shell:
   - `brand`: `{ name: 'Triage Companion', tagline: 'Calm daily helper for messages, safety, photos, and plans.' }`
   - `problem`: `{ heading: 'Daily phone life can feel overwhelming.', copy: 'Important clinic dates, family notes, prescriptions, and suspicious links arrive scattered across WhatsApp, SMS, email, and paper calendars.', points: [{ icon: 'smartphone', label: 'Messages scattered across apps' }, { icon: 'shield', label: 'Hard-to-spot scam & AI tricks' }, { icon: 'calendar', label: 'Paper dates & photos easy to miss' }] }`
   - `solution`: `{ heading: 'One calm place. You stay in charge.', features: [{ icon: 'sun', label: 'Today at a glance', sub: 'Important decisions and upcoming plans' }, { icon: 'inbox', label: 'Unified Inbox & summaries', sub: 'Clear source badges and 1-tap actions' }, { icon: 'shieldCheck', label: 'Scam Shield & AI Media Check', sub: 'Traffic-light safety checks before you act' }, { icon: 'sparkles', label: '1-Tap Photo & Calendar Helpers', sub: 'Originals stay safe; nothing saved without Confirm' }], note: 'Designed for seniors · Private on your device · You confirm every action' }`
3. Create `src/components/PhoneFrame.tsx` porting Syed's `PhoneFrame.jsx` verbatim in TypeScript (`DEVICE_W = 390`, `DEVICE_H = 844`, `BEZEL = 12`, `OUTER_W = 414`, `OUTER_H = 868`, `STATUS_H = 56`, `StatusBar`, `DynamicIsland`, `HomeIndicator`, side buttons, `.phone-body` with `borderRadius: 48`, inner screen with `borderRadius: 36`, fullscreen `<500px` branch with safe-area insets, and `ScreenPortalContext` / `useScreenPortal`). Ensure `scale` defaults to `1` when `h === 0` (SSR) so dimensions are never negative or NaN.
4. Create `src/components/presentation/DemoShell.tsx` porting Syed's 3-column `DemoShell.jsx` (`bg-gradient-to-br from-canvas via-[#EDF5F3] to-brand-wash`, blurred orbs `bg-brand-soft/40` & `bg-violet-100/70`, left problem `aside`, center `w-[440px]` phone slot, right solution `aside`, and `<500px` pass-through).
5. Create `src/components/TabBar.tsx` porting Syed's frosted `TabBar.jsx` (`chrome relative z-20 shrink-0 border-t border-line bg-white/80 backdrop-blur-xl`, `paddingBottom: 18`) with 5 anchor links (`/` `"My Day"`, `/inbox` `"Inbox"`, `/calendar` `"Calendar"`, `/scam-shield` `"Safety"`, `/my-data` `"My Data"`), each `min-h-[56px]`, active state highlighted in `text-brand`, inactive in `text-muted`, calling `onNavigate` when provided.
6. Create `src/components/Toast.tsx` porting Syed's `Toast.jsx` (`ToastProvider` + `useToast()`).
7. Update `src/app/layout.tsx` (`AppShell`) to wrap the app in `<DemoShell><PhoneFrame><ToastProvider>...</ToastProvider></PhoneFrame></DemoShell>` with a frosted top header (`border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur-md` containing the `"My Daily Helper"` brand link and `<nav aria-label="Primary">` with `"Home"` and `"My Data"` links), an `.app-scroll` scrollable middle container (`bg-canvas px-5 pb-6 pt-3`) containing the offline/store-error banners and `<main id="main-content">{children}</main>`, and `<TabBar activePath={activePath} onNavigate={onNavigate} />` at the bottom of the phone screen.
8. Update `src/main.tsx` to pass `activePath={locationState.pathname}` to `<AppShell>`.

- [ ] **Step 4: Run tests to verify Task 2 and existing tests pass**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx tests/unit/uiComponentsAndScreens.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/useViewport.ts src/lib/presentation/content.ts src/components/PhoneFrame.tsx src/components/presentation/DemoShell.tsx src/components/TabBar.tsx src/components/Toast.tsx src/app/layout.tsx src/main.tsx tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(shell): wrap app in Syed DemoShell, PhoneFrame bezel, and frosted TabBar"
```

---

### Task 3: Syed Shared UI Primitives (`Card`, `SectionHeader`, `EmptyState`, `FilterChips`, `SegmentedControl`, `MonthCalendar`)

**Files:**
- Create: `src/components/Card.tsx`
- Create: `src/components/SectionHeader.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/FilterChips.tsx`
- Create: `src/components/SegmentedControl.tsx`
- Create: `src/components/MonthCalendar.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: `Temporal` from `'temporal-polyfill'`, `@/lib/types` (`CalendarEvent`, `CalendarCategory`).
- Produces:
  - `Card({ className?: string; children: React.ReactNode; onClick?: () => void })` in `src/components/Card.tsx`
  - `SectionHeader({ title: string; id?: string; count?: number; countTone?: 'default' | 'red' | 'brand'; children?: React.ReactNode; className?: string })` in `src/components/SectionHeader.tsx`
  - `EmptyState({ icon?: React.ReactNode; title: string; message?: string; className?: string })` in `src/components/EmptyState.tsx`
  - `FilterChips<T extends string>({ items: ReadonlyArray<{ id: T; label: string; dot?: string }>; value: T; onChange: (id: T) => void; ariaLabel?: string; className?: string })` in `src/components/FilterChips.tsx`
  - `SegmentedControl<T extends string>({ options: ReadonlyArray<{ id: T; label: string }>; value: T; onChange: (id: T) => void; ariaLabel?: string; className?: string })` in `src/components/SegmentedControl.tsx`
  - `MonthCalendar({ selectedDate: string; onSelectDate: (isoDate: string) => void; events: readonly CalendarEvent[] })` in `src/components/MonthCalendar.tsx`

- [ ] **Step 1: Write the failing tests for Syed shared primitives in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips } from '@/components/FilterChips';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MonthCalendar } from '@/components/MonthCalendar';

function extractButtons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
}

function stripTags(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Task 3: Syed Shared UI Primitives', () => {
  it('MonthCalendar, SegmentedControl, and FilterChips buttons all carry min-h-[56px] and non-empty text labels', () => {
    const html = renderToStaticMarkup(
      <div>
        <FilterChips
          items={[
            { id: 'Personal', label: 'Personal', dot: 'bg-teal-500' },
            { id: 'Family', label: 'Family', dot: 'bg-violet-500' },
          ]}
          value="Personal"
          onChange={() => {}}
        />
        <SegmentedControl
          options={[
            { id: 'Today', label: 'Today' },
            { id: 'This Week', label: 'This Week' },
            { id: 'Month List', label: 'Month List' },
          ]}
          value="Today"
          onChange={() => {}}
        />
        <MonthCalendar
          selectedDate="2026-07-15"
          onSelectDate={() => {}}
          events={[
            {
              id: 'ev-1',
              title: 'Doctor Visit',
              date: '2026-07-15',
              time: '10:30',
              category: 'Medical',
              createdAt: '2026-07-10T08:00:00.000Z',
            },
          ]}
        />
      </div>
    );

    expect(html).toContain('from-ink to-brand-deep');
    expect(html).toContain('July 2026');

    const buttons = extractButtons(html);
    expect(buttons.length).toBeGreaterThan(30);
    for (const btn of buttons) {
      expect(btn).toContain('min-h-[56px]');
      expect(stripTags(btn).length).toBeGreaterThan(0);
    }
  });

  it('MonthCalendar falls back to today when given an invalid ISO date string', () => {
    const html = renderToStaticMarkup(
      <MonthCalendar
        selectedDate="not-a-valid-date"
        onSelectDate={() => {}}
        events={[]}
      />
    );
    expect(html).toContain('from-ink to-brand-deep');
  });

  it('Card, SectionHeader, and EmptyState render Syed tokens', () => {
    const html = renderToStaticMarkup(
      <div>
        <SectionHeader title="Needs action now" count={3} countTone="red" />
        <Card>Card Body</Card>
        <EmptyState title="All clear" message="Nothing urgent today." />
      </div>
    );
    expect(html).toContain('rounded-card');
    expect(html).toContain('shadow-card');
    expect(html).toContain('bg-red-100 text-red-700');
    expect(html).toContain('All clear');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `Failed to resolve import "@/components/Card"`

- [ ] **Step 3: Implement `Card.tsx`, `SectionHeader.tsx`, `EmptyState.tsx`, `FilterChips.tsx`, `SegmentedControl.tsx`, and `MonthCalendar.tsx`**

1. `src/components/Card.tsx`: Base white card (`data-card="true"`, `rounded-card border border-line bg-white shadow-card`, adds `pressable` when `onClick` is defined).
2. `src/components/SectionHeader.tsx`: Port Syed's `SectionHeader.jsx` with optional `id` on the `<h2>` (`text-[13px] font-semibold uppercase tracking-[0.08em] text-muted`), count badge (`bg-red-100 text-red-700` for `'red'`, `bg-brand-soft text-brand-deep` for `'brand'`, `bg-line text-muted` for `'default'`), and right-side `children` slot.
3. `src/components/EmptyState.tsx`: Port Syed's `EmptyState.jsx` (`anim-fade-up flex flex-col items-center rounded-card border border-dashed border-line bg-white px-6 py-8 text-center`, `h-12 w-12 rounded-full bg-brand-wash text-brand` icon circle, `text-[18px] font-semibold text-ink` title, `text-[16px] leading-relaxed text-muted` message).
4. `src/components/FilterChips.tsx`: Port Syed's `FilterChips.jsx` with `min-h-[56px] min-w-[56px]` buttons, `aria-pressed={active}`, active `border-2 border-brand bg-brand text-white shadow-pill`, inactive `border-2 border-line bg-white text-ink hover:border-brand`.
5. `src/components/SegmentedControl.tsx`: Port Syed's `SegmentedControl.jsx` with sliding `bg-brand` pill background and `min-h-[56px]` buttons (`aria-pressed={o.id === value}`, active `text-white`, inactive `text-ink`).
6. `src/components/MonthCalendar.tsx`: Port Syed's `MonthCalendar.jsx` using `Temporal.PlainDate` (falling back to `Temporal.Now.plainDateISO()` when `selectedDate` fails `Temporal.PlainDate.from`):
   - Outer card: `overflow-hidden rounded-card bg-gradient-to-br from-ink to-brand-deep p-4 shadow-lift`.
   - Previous/Next month buttons: `pressable inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-full bg-white/10 px-3 text-white` with `<span className="sr-only">Previous month</span>` / `<span className="sr-only">Next month</span>` alongside the `ChevronLeft` / `ChevronRight` icons (so `stripHtml(btn)` is non-empty!).
   - Day cell buttons: `pressable flex min-h-[56px] flex-col items-center justify-center` with day number inside `flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold` (selected: `bg-brand-bright font-bold text-white shadow-pill`, today: `font-bold text-white ring-1 ring-white/40`, out-of-month: `text-white/25`, normal: `text-white/85`) and up to 3 event dots (`bg-teal-300` for `Medical`/`Daily Routine`, `bg-violet-300` for `Family & Social`/`Bills & Errands`).

- [ ] **Step 4: Run tests to verify Task 3 passes**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/components/Card.tsx src/components/SectionHeader.tsx src/components/EmptyState.tsx src/components/FilterChips.tsx src/components/SegmentedControl.tsx src/components/MonthCalendar.tsx tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(components): port Syed Card, SectionHeader, EmptyState, FilterChips, SegmentedControl, and MonthCalendar"
```

---

### Task 4: Restyle HomeHub (`src/app/page.tsx`) & CalendarPage (`src/app/calendar/page.tsx`) to Syed's `MyDay` & `Calendar` Designs

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/calendar/page.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: Task 3 components (`Card`, `SectionHeader`, `EmptyState`, `SegmentedControl`, `MonthCalendar`), existing `HomeHubProps`, `executeHomeDefaultConfirm`, `executeHomeDefaultAskFamily`, `CalendarPageProps`, `applyCandidateDecisionWithPersistence`.
- Produces: Restyled `HomeHub` and `CalendarPage` keeping all existing exported functions, props, and user-facing copy strings asserted by tests.

- [ ] **Step 1: Write the failing test for restyled `HomeHub` and `CalendarPage` in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import { HomeHub } from '@/app/page';
import { CalendarPage } from '@/app/calendar/page';

describe('Task 4: Syed Visual Design on HomeHub and CalendarPage', () => {
  it('HomeHub renders Syed gradient hero card, tucked stats panel (-mt-3 mx-3), and helper cards with category accent strips', () => {
    const html = renderToStaticMarkup(
      <HomeHub initialSettings={createDefaultSettings()} initialItems={[]} />
    );
    expect(html).toContain('from-brand-soft via-brand-wash to-white');
    expect(html).toContain('-mt-3 mx-3');
    expect(html).toContain('need action');
    expect(html).toContain('Welcome Home');
    expect(html).toContain("Today&#x27;s Important Decisions");
    expect(html).toContain('Nothing needs your attention today');
    expect(html).toContain('from-teal-400 to-teal-300');
  });

  it('CalendarPage renders Syed dark MonthCalendar card, SegmentedControl view switcher, and rounded-t-[20px] white day sheet', () => {
    const html = renderToStaticMarkup(
      <CalendarPage
        initialSettings={createDefaultSettings()}
        initialEvents={[]}
        initialToday="2026-07-15"
      />
    );
    expect(html).toContain('from-ink to-brand-deep');
    expect(html).toContain('July 2026');
    expect(html).toContain('rounded-t-[20px]');
    expect(html).toContain('Nothing planned');
    expect(html).toContain('Paper Calendar Snap');
    expect(html).toContain('Reminder Timing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `expected ... to contain 'from-brand-soft via-brand-wash to-white'`

- [ ] **Step 3: Restyle `src/app/page.tsx` and `src/app/calendar/page.tsx` to Syed's visual design**

1. In `src/app/page.tsx` (`HomeHub`):
   - **Hero Header Card + Tucked Stats Panel (Syed's `MyDay.jsx` lines 113–160):**
     - Render `<div className="relative">` with `<header className="anim-fade-up relative z-10 overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft via-brand-wash to-white p-5 pb-6 shadow-lift">`, blurred orb `pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-soft/60 blur-2xl`, time-of-day greeting (`Good morning` / `Good afternoon` / `Good evening`), `<h1 className="mt-0.5 text-[28px] font-bold leading-tight tracking-tight text-ink">Welcome Home</h1>`, and `<div className="mt-3"><PrivacyPill ... /></div>`.
     - Render the tucked stats panel right below: `<div className="anim-fade-up relative z-0 -mt-3 mx-3 rounded-card border border-line bg-white px-3.5 pb-2.5 pt-3.5 shadow-card">` with one row of 3 status items: red dot + `{selection.totalAwaiting} need action`, teal dot + `{countEnabledChannels(settings)} sources on`, violet dot + `AI {settings.allowAiReading ? 'On' : 'Off'}`.
   - **"Today's Important Decisions" Section:**
     - Keep `<section aria-labelledby="decisions-heading">` with `<h2 id="decisions-heading">Today's Important Decisions</h2>` and a red count pill (`bg-red-100 text-red-700`).
     - When `selection.emptyMessage` is shown, render Syed's `EmptyState`-styled card (`rounded-card border-2 border-dashed border-brand-soft bg-white px-6 py-7 text-center shadow-card`) containing a teal check icon circle and `{selection.emptyMessage}`.
     - When decisions are rendered, include Syed's carousel dot indicator bar below the cards (`h-[6px] rounded-full`, `w-5 bg-red-500`).
   - **"Your Helpers" Section:**
     - Style the 5 helper cards (`HOME_SECTION_CARDS`) after Syed's `Up next` cards in `MyDay.jsx`: `pressable anim-fade-up overflow-hidden rounded-card border border-line bg-white shadow-card no-underline` with a top accent gradient bar (`h-1.5 w-full bg-gradient-to-r from-teal-400 to-teal-300` for teal cards, `from-violet-400 to-violet-300` for social/family cards), `h-12 w-12 rounded-full bg-brand-wash text-brand` icon circle, title (`text-[20px] font-bold text-ink`), and description (`text-[16px] text-muted`).
2. In `src/app/calendar/page.tsx` (`CalendarPage`):
   - Keep `<BackToHome onClick={handleBack} />`, `"Calendar"` `h1`, and `"Add Event"` `SeniorButton`.
   - Replace the view switcher buttons with `<SegmentedControl options={[{ id: 'Today', label: 'Today' }, { id: 'This Week', label: 'This Week' }, { id: 'Month List', label: 'Month List' }]} value={viewMode} onChange={setViewMode} ariaLabel="Calendar views" />`.
   - Render `<MonthCalendar selectedDate={selectedIsoDate} onSelectDate={handleSelectCalendarDate} events={events} />` (where `selectedIsoDate` defaults to `todayDate.toString()` and clicking a date updates `selectedIsoDate`).
   - Wrap the active calendar view section (`aria-labelledby="calendar-view-heading"`) in Syed's white rounded bottom sheet (`anim-fade-up rounded-t-[20px] border border-line bg-white px-5 pb-8 pt-5 shadow-lift`), styling each event card with Syed's tabular time badge (`tnum`), category pill, location pin, and Edit/Delete buttons, and styling `"Nothing planned"` with Syed's `EmptyState` card.
   - Style Paper Calendar Snap and Reminder Timing sections with `rounded-card border border-line bg-white p-5 shadow-card`, using Syed's dashed dropzone (`rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-6`) for the photo picker.

- [ ] **Step 4: Run tests to verify Task 4 and all existing tests pass**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx tests/unit/uiComponentsAndScreens.test.tsx tests/a11y/accessibilityAndCopy.test.tsx tests/unit/finalFixUiRegressions.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/app/page.tsx src/app/calendar/page.tsx tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(screens): restyle HomeHub and CalendarPage to Syed MyDay and Calendar design"
```

---

### Task 5: Restyle UnifiedInboxPage (`src/app/inbox/page.tsx`), ScamShieldPage (`src/app/scam-shield/page.tsx`), AiMediaCheckPage (`src/app/media-check/page.tsx`), PhotoHelperPage (`src/app/photo-helper/page.tsx`) & MyDataPage (`src/app/my-data/page.tsx`)

**Files:**
- Modify: `src/app/inbox/page.tsx`
- Modify: `src/app/scam-shield/page.tsx`
- Modify: `src/app/media-check/page.tsx`
- Modify: `src/app/photo-helper/page.tsx`
- Modify: `src/app/my-data/page.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: Task 1–3 components (`FilterChips`, `Card`, `EmptyState`, `SeniorButton`, `SourceBadge`, `PriorityPill`, `TrafficLightCard`, `StepWizard`, `BackToHome`, `StatusLive`).
- Produces: Restyled `UnifiedInboxPage`, `ScamShieldPage`, `AiMediaCheckPage`, `PhotoHelperPage`, and `MyDataPage` with all existing exports and props preserved.

- [ ] **Step 1: Write the failing tests for the 5 restyled screens in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import { UnifiedInboxPage } from '@/app/inbox/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import { MyDataPage } from '@/app/my-data/page';

describe('Task 5: Syed Visual Design on Inbox, ScamShield, MediaCheck, PhotoHelper, and MyData', () => {
  it('UnifiedInboxPage renders sticky FilterChips bar and Syed AI summary gradient card on messages', () => {
    const html = renderToStaticMarkup(
      <UnifiedInboxPage
        initialSettings={createDefaultSettings()}
        initialItems={[
          {
            id: 'msg-1',
            source: 'whatsappForward',
            sender: 'City Clinic',
            text: 'Appointment on 2026-07-15 at 10:30',
            attachments: [],
            receivedAt: '2026-07-10T08:00:00.000Z',
            group: 'Personal',
            priority: 'Important',
            summary: {
              fromApp: 'From WhatsApp',
              whoSent: 'City Clinic',
              actionNeeded: 'Confirm calendar date',
              text: 'City Clinic shared an appointment.',
            },
            tier: 2,
            confidence: 0.9,
            status: 'ok',
          },
        ]}
      />
    );
    expect(html).toContain('sticky top-0');
    expect(html).toContain('from-brand-soft/80 via-brand-wash to-white');
    expect(html).toContain('AI summary');
    expect(html).toContain('rounded-card');
    expect(html).toContain('shadow-card');
  });

  it('ScamShieldPage, AiMediaCheckPage, PhotoHelperPage, and MyDataPage render Syed dashed dropzones and rounded-card shadow-card surfaces', () => {
    const scamHtml = renderToStaticMarkup(
      <ScamShieldPage initialSettings={createDefaultSettings()} />
    );
    expect(scamHtml).toContain('border-dashed border-brand-soft');
    expect(scamHtml).toContain('rounded-card');
    expect(scamHtml).toContain('shadow-card');

    const mediaHtml = renderToStaticMarkup(
      <AiMediaCheckPage initialSettings={createDefaultSettings()} />
    );
    expect(mediaHtml).toContain('border-dashed border-brand-soft');
    expect(mediaHtml).toContain('rounded-card');

    const photoHtml = renderToStaticMarkup(
      <PhotoHelperPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, photos: true },
        }}
      />
    );
    expect(photoHtml).toContain('border-dashed border-brand-soft');
    expect(photoHtml).toContain('rounded-card');

    const myDataHtml = renderToStaticMarkup(
      <MyDataPage initialSettings={createDefaultSettings()} initialAudit={[]} />
    );
    expect(myDataHtml).toContain('from-brand-soft via-brand-wash to-white');
    expect(myDataHtml).toContain('rounded-card');
    expect(myDataHtml).toContain('shadow-card');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `expected ... to contain 'sticky top-0'`

- [ ] **Step 3: Restyle `UnifiedInboxPage`, `ScamShieldPage`, `AiMediaCheckPage`, `PhotoHelperPage`, and `MyDataPage`**

1. **`src/app/inbox/page.tsx` (`UnifiedInboxPage`) — Syed's `Records.jsx` & `RecordDetail.jsx` style:**
   - Replace the group filter bar with a sticky frosted filter strip (`sticky top-0 z-20 -mx-5 bg-canvas/95 px-5 py-3 backdrop-blur-md`) rendering `<FilterChips>` for `GROUP_TABS` (`Personal`, `Family`, `Others`, `All`, `Promotion`).
   - Inside each message card (`rounded-card border border-line bg-white p-5 shadow-card anim-fade-up`), render the summary inside Syed's `RecordDetail.jsx` AI Summary gradient box (`relative overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft/80 via-brand-wash to-white p-4 shadow-card` with a blurred teal orb, `<Sparkles size={14} />` + `"AI summary"` uppercase header, `whoSent`, `summary.text`, and `actionNeeded`).
   - Style the empty inbox state with `<EmptyState>` (`"No messages in {activeTab} yet."`) and the prescription photo picker with Syed's dashed dropzone (`border-2 border-dashed border-brand-soft bg-white/70`).
2. **`src/app/scam-shield/page.tsx` (`ScamShieldPage`):**
   - Style the checker card, 4 Safety Habits cards, Family Secret Code Word card, and Safe Phone Checklist card with `rounded-card border border-line bg-white p-5 shadow-card anim-fade-up`.
   - Style the screenshot upload control with Syed's dashed drop area (`rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-4`) and each Safety Habit card with a `h-10 w-10 rounded-full bg-brand-wash text-brand` icon circle.
3. **`src/app/media-check/page.tsx` (`AiMediaCheckPage`):**
   - Style the photo picker area with Syed's `Upload.jsx` dashed dropzone (`rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-6 text-center`), the outcome card with Syed's gradient summary box, the 4-Spot Eye Check Guide cards with `rounded-card border border-line bg-white p-4 shadow-card`, and the Voice Clone Safety card with a warm amber glass gradient (`rounded-card border-2 border-[#D97706] bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-card`).
4. **`src/app/photo-helper/page.tsx` (`PhotoHelperPage`):**
   - Style the photo picker with Syed's dashed dropzone (`rounded-card border-2 border-dashed border-brand-soft bg-white/70 p-5`), the editor card with `rounded-card border border-line bg-white p-5 shadow-card`, and the Before/After comparison frames after Syed's `RecordDetail.jsx` document frame (`rounded-card border border-line bg-canvas p-4 shadow-card` for Before, `rounded-card border border-brand-soft bg-brand-wash/70 p-4 shadow-card` for After).
5. **`src/app/my-data/page.tsx` (`MyDataPage`):**
   - Wrap the top header intro in Syed's gradient hero banner (`overflow-hidden rounded-card border border-brand-soft/70 bg-gradient-to-br from-brand-soft via-brand-wash to-white p-5 shadow-lift`).
   - Style all 5 channel toggle cards, AI Reading card, Family Sharing card, What AI Read audit card, and Download My Data card with `rounded-card border border-line bg-white p-5 shadow-card`, and the Erase All My Data card with Syed's red glass gradient (`rounded-card border-2 border-[#BE123C] bg-gradient-to-br from-red-50/90 via-white to-red-50/40 p-5 shadow-card`).
6. Sync all updated files from `C:\Users\Amir\Projects\Project_Triage` to `C:\Users\Amir\Projects\Build_Bersama`.

- [ ] **Step 4: Run full typecheck, full test suite, and Vite production build**

Run: `.\node_modules\.bin\tsc.cmd --noEmit ; .\node_modules\.bin\vitest.cmd --run ; .\node_modules\.bin\vite.cmd build`
Expected:
- `tsc --noEmit`: 0 errors
- `vitest --run`: 19/19 test files passing (all 103 existing tests + new `syedVisualDesign.test.tsx` tests)
- `vite build`: exit 0 (`dist/` built cleanly)

- [ ] **Step 5: Commit and sync workspace**

```powershell
git add src/app/ tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(screens): restyle Inbox, ScamShield, MediaCheck, PhotoHelper, and MyData to Syed visual design"
```
