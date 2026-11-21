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
import { StatusLive } from '@/components/StatusLive';
import { BackToHome } from '@/components/BackToHome';
import { isValidConfirmation, type Confirmation } from '@/lib/actions/confirmation';
import { createDefaultSettings } from '@/lib/types';
import { PhoneFrame } from '@/components/PhoneFrame';
import { DemoShell } from '@/components/presentation/DemoShell';
import { TabBar } from '@/components/TabBar';
import { ToastProvider } from '@/components/Toast';
import { presentationContent } from '@/lib/presentation/content';
import { AppShell } from '@/app/layout';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState } from '@/components/EmptyState';
import { FilterChips } from '@/components/FilterChips';
import { SegmentedControl } from '@/components/SegmentedControl';
import { MonthCalendar } from '@/components/MonthCalendar';
import { HomeHub } from '@/app/page';
import { CalendarPage } from '@/app/calendar/page';
import { UnifiedInboxPage } from '@/app/inbox/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import { MyDataPage } from '@/app/my-data/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function findElements(
  node: React.ReactNode,
  predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean,
  acc: React.ReactElement<Record<string, unknown>>[] = []
): React.ReactElement<Record<string, unknown>>[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) {
      findElements(child, predicate, acc);
    }
    return acc;
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (predicate(el)) {
      acc.push(el);
    }
    if (el.props && 'children' in el.props) {
      findElements(el.props.children as React.ReactNode, predicate, acc);
    }
  }
  return acc;
}

describe('Task 1: Syed Design Tokens and Core Components', () => {
  it('configures exact Syed color, radius, and shadow tokens in tailwind.config.js', () => {
    const extend = tailwindConfig.theme?.extend as Record<string, any>;
    expect(extend.fontFamily.sans).toEqual([
      '"Inter Variable"',
      'Inter',
      'system-ui',
      '-apple-system',
      'sans-serif',
    ]);
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

  it('merges Syed CSS utilities and motion keyframes with accessibility rules in src/app/globals.css', async () => {
    const fsPromises = (await import(/* @vite-ignore */ 'node:' + 'fs/promises')) as {
      readFile(url: URL, encoding: 'utf8'): Promise<string>;
    };
    const css = await fsPromises.readFile(
      new URL('../../src/app/globals.css', import.meta.url),
      'utf8'
    );

    for (const token of [
      '.tnum',
      '.app-scroll',
      '.no-scrollbar',
      '.chrome',
      '.pressable',
      '.phone-body',
      '.anim-fade-up',
      '.anim-fade-in',
      '.anim-pop',
      '.anim-toast',
      '.anim-collapse',
      '.anim-check',
      '.skeleton',
      '.pulse-ring',
      '.anim-col',
      '.doc-svg svg',
      '.print-doc',
      '@media print',
      '@media (prefers-reduced-motion: reduce)',
      'text-wrap: balance',
      '.skip-link',
      ':focus-visible',
      ':user-invalid',
      '@media (forced-colors: active)',
    ]) {
      expect(css, `globals.css missing ${token}`).toContain(token);
    }
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
    expect(tier3Html).toContain('backdrop-blur-md');
    expect(tier3Html).toContain('text-[20px]');
    expect(onConfirm).not.toHaveBeenCalled();

    const tier2Html = renderToStaticMarkup(
      <DecisionConfirmCard
        actionId="act-100"
        tier={2}
        summary="Confirm appointment date."
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
    expect(tier2Html).toContain('border-brand-soft');
    expect(tier2Html).toContain('bg-gradient-to-br');

    // Click-only confirmation minting
    const tree = DecisionConfirmCard({
      actionId: 'act-99',
      tier: 3,
      summary: 'Suspicious bank transfer message requires check.',
      onConfirm,
      onDismiss,
    });
    const buttons = findElements(tree, (el) => el.type === SeniorButton);
    const confirmBtn = buttons.find((el) =>
      String(el.props.children).includes('Confirm')
    );
    const dismissBtn = buttons.find((el) =>
      String(el.props.children).includes('Dismiss')
    );
    expect(confirmBtn).toBeDefined();
    expect(dismissBtn).toBeDefined();

    (dismissBtn!.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    (confirmBtn!.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveLength(1);
    expect(isValidConfirmation(confirmed[0], 'act-99')).toBe(true);

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

    const importantPill = renderToStaticMarkup(<PriorityPill priority="Important" />);
    expect(importantPill).toContain('border-red-200');
    expect(importantPill).toContain('bg-red-50');
    expect(importantPill).toContain('text-red-600');
    expect(importantPill).toContain('shadow-pill');
    expect(importantPill).toContain('border-2');

    const pillHtml = renderToStaticMarkup(
      <PrivacyPill settings={createDefaultSettings()} />
    );
    expect(pillHtml).toContain('shadow-pill');
    expect(pillHtml).toContain('pressable');
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
    expect(wizardHtml).toContain('h-[6px]');

    const trafficHtml = renderToStaticMarkup(
      <TrafficLightCard
        verdict={{ value: 'danger', reasons: ['Urgent payment demand'], flags: ['urgency'] }}
      />
    );
    expect(trafficHtml).toContain('rounded-card');
    expect(trafficHtml).toContain('shadow-card');
    expect(trafficHtml).toContain('bg-gradient-to-br');
    expect(trafficHtml).toContain('Likely Scam — Do Not Click or Pay');

    const statusHtml = renderToStaticMarkup(<StatusLive message="Saved." />);
    expect(statusHtml).toContain('rounded-card');
    expect(statusHtml).toContain('shadow-card');
    expect(statusHtml).toContain('border-brand-soft');
    expect(statusHtml).toContain('bg-brand-wash');

    const backHtml = renderToStaticMarkup(<BackToHome />);
    expect(backHtml).toContain('pressable');
    expect(backHtml).toContain('rounded-full');
    expect(backHtml).toContain('min-h-[56px]');
  });
});

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
    expect(html).toContain('width:414px;height:868px');
    expect(html).toContain('Inside Phone Screen');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('href="/calendar"');
    expect(html).toContain('href="/scam-shield"');
    expect(html).toContain('href="/my-data"');
    expect(html).toContain('min-h-[56px]');
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
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Senior companion content');
    const visible = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(BANNED_JARGON);
  });

  it('TabBar highlights the active path and delegates clicks to onNavigate', () => {
    const onNavigate = vi.fn();
    const tree = TabBar({ activePath: '/inbox', onNavigate });
    const links = findElements(tree, (el) => el.type === 'a');
    expect(links).toHaveLength(5);

    const inboxLink = links.find((el) => el.props.href === '/inbox');
    const calendarLink = links.find((el) => el.props.href === '/calendar');
    expect(inboxLink).toBeDefined();
    expect(calendarLink).toBeDefined();
    expect(String(inboxLink!.props.className)).toContain('text-brand');
    expect(String(calendarLink!.props.className)).toContain('text-muted');

    const preventDefault = vi.fn();
    (calendarLink!.props.onClick as (e: { preventDefault: () => void }) => void)({
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/calendar');
  });
});

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
          ariaLabel="Message groups"
        />
        <SegmentedControl
          options={[
            { id: 'Today', label: 'Today' },
            { id: 'This Week', label: 'This Week' },
            { id: 'Month List', label: 'Month List' },
          ]}
          value="Today"
          onChange={() => {}}
          ariaLabel="Calendar range"
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
            {
              id: 'ev-2',
              title: 'Family Dinner',
              date: '2026-07-15',
              time: '18:00',
              category: 'Family & Social',
              createdAt: '2026-07-10T08:00:00.000Z',
            },
            {
              id: 'ev-3',
              title: 'Morning Walk',
              date: '2026-07-15',
              time: '07:30',
              category: 'Daily Routine',
              createdAt: '2026-07-10T08:00:00.000Z',
            },
            {
              id: 'ev-4',
              title: 'Electricity Bill',
              date: '2026-07-15',
              time: '12:00',
              category: 'Bills & Errands',
              createdAt: '2026-07-10T08:00:00.000Z',
            },
          ]}
        />
      </div>
    );

    expect(html).toContain('from-ink to-brand-deep');
    expect(html).toContain('July 2026');
    expect(html).toContain('Previous month');
    expect(html).toContain('Next month');
    expect(html).toContain('bg-teal-300');
    expect(html).toContain('bg-violet-300');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');

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
    expect(html).toContain('Previous month');
    expect(html).toContain('Next month');
  });

  it('Card, SectionHeader, and EmptyState render Syed tokens', () => {
    const html = renderToStaticMarkup(
      <div>
        <SectionHeader
          id="needs-action-heading"
          title="Needs action now"
          count={3}
          countTone="red"
        >
          <span>Right slot</span>
        </SectionHeader>
        <SectionHeader title="Brand section" count={2} countTone="brand" />
        <SectionHeader title="Default section" count={1} countTone="default" />
        <Card>Card Body</Card>
        <Card onClick={() => {}}>Clickable Card</Card>
        <EmptyState
          icon={<span aria-hidden="true">★</span>}
          title="All clear"
          message="Nothing urgent today."
        />
      </div>
    );
    expect(html).toContain('data-card="true"');
    expect(html).toContain('rounded-card');
    expect(html).toContain('shadow-card');
    expect(html).toContain('pressable');
    expect(html).toContain('id="needs-action-heading"');
    expect(html).toContain('Right slot');
    expect(html).toContain('bg-red-100 text-red-700');
    expect(html).toContain('bg-brand-soft text-brand-deep');
    expect(html).toContain('bg-line text-muted');
    expect(html).toContain('anim-fade-up');
    expect(html).toContain('bg-brand-wash text-brand');
    expect(html).toContain('All clear');
    expect(html).toContain('Nothing urgent today.');
  });

  it('MonthCalendar syncs visible month/year when selectedDate prop changes across months while preserving manual browsing', () => {
    const stateSlots: unknown[] = [];
    let stateCursor = 0;

    const useStateSpy = vi.spyOn(React, 'useState').mockImplementation(((
      initialState: unknown
    ) => {
      const idx = stateCursor++;
      if (!(idx in stateSlots)) {
        stateSlots[idx] =
          typeof initialState === 'function'
            ? (initialState as () => unknown)()
            : initialState;
      }
      const setState = (next: unknown) => {
        stateSlots[idx] =
          typeof next === 'function'
            ? (next as (prev: unknown) => unknown)(stateSlots[idx])
            : next;
      };
      return [stateSlots[idx], setState];
    }) as typeof React.useState);

    const useMemoSpy = vi
      .spyOn(React, 'useMemo')
      .mockImplementation((factory) => factory());

    try {
      const onSelectDate = vi.fn();
      const renderTree = (selectedDate: string) => {
        stateCursor = 0;
        return MonthCalendar({
          selectedDate,
          onSelectDate,
          events: [],
        });
      };

      const readHeading = (tree: React.ReactNode) => {
        const headings = findElements(tree, (el) => el.type === 'h2');
        expect(headings).toHaveLength(1);
        return String(headings[0].props.children);
      };

      // 1. Initial render shows July 2026
      const tree1 = renderTree('2026-07-15');
      expect(readHeading(tree1)).toBe('July 2026');

      // 2. Manual Next month click advances to August 2026 and persists when selectedDate is unchanged
      const nextBtn = findElements(
        tree1,
        (el) => el.type === 'button' && el.props['aria-label'] === 'Next month'
      )[0];
      expect(nextBtn).toBeDefined();
      (nextBtn.props.onClick as () => void)();

      const tree2 = renderTree('2026-07-15');
      expect(readHeading(tree2)).toBe('August 2026');

      // 3. External selectedDate prop change across months syncs visible month/year to October 2026
      const tree3 = renderTree('2026-10-05');
      expect(readHeading(tree3)).toBe('October 2026');

      // 4. Manual Previous month browsing still works after external sync
      const prevBtn = findElements(
        tree3,
        (el) =>
          el.type === 'button' && el.props['aria-label'] === 'Previous month'
      )[0];
      expect(prevBtn).toBeDefined();
      (prevBtn.props.onClick as () => void)();

      const tree4 = renderTree('2026-10-05');
      expect(readHeading(tree4)).toBe('September 2026');
    } finally {
      useStateSpy.mockRestore();
      useMemoSpy.mockRestore();
    }
  });
});

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
    expect(html).toContain('from-violet-400 to-violet-300');
  });

  it('HomeHub renders red count pill and carousel dots when decisions exist', () => {
    const html = renderToStaticMarkup(
      <HomeHub
        initialSettings={createDefaultSettings()}
        initialItems={[
          {
            id: 'dec-1',
            source: 'whatsappForward',
            sender: 'City Clinic',
            text: 'Clinic appointment tomorrow at 10:00.',
            attachments: [],
            receivedAt: '2026-07-10T08:00:00.000Z',
            group: 'Personal',
            priority: 'Important',
            summary: {
              fromApp: 'From WhatsApp',
              whoSent: 'City Clinic',
              actionNeeded: 'Add to calendar',
              text: 'City Clinic sent an appointment reminder.',
            },
            tier: 2,
            confidence: 0.9,
            status: 'ok',
          },
        ]}
      />
    );
    expect(html).toContain('bg-red-100 text-red-700');
    expect(html).toContain('1 need action');
    expect(html).toContain('h-[6px] rounded-full');
    expect(html).toContain('w-5 bg-red-500');
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
    expect(html).toContain('aria-label="Calendar views"');
    expect(html).toContain('border-dashed border-brand-soft');
  });

  it('CalendarPage renders tabular time badge (tnum) and dashed photo dropzone when photos enabled', () => {
    const html = renderToStaticMarkup(
      <CalendarPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, photos: true },
        }}
        initialEvents={[
          {
            id: 'ev-1',
            title: 'Dr. Tan Checkup',
            date: '2026-07-15',
            time: '10:30',
            location: 'Room 4B',
            category: 'Medical',
            createdAt: '2026-07-10T08:00:00.000Z',
          },
        ]}
        initialToday="2026-07-15"
      />
    );
    expect(html).toContain('tnum');
    expect(html).toContain('10:30');
    expect(html).toContain('Room 4B');
    expect(html).toContain('border-dashed border-brand-soft');
    expect(html).toContain('id="calendar-snap-photo-input"');
  });
});

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
    expect(html).toContain('← Back to Home');

    const emptyHtml = renderToStaticMarkup(
      <UnifiedInboxPage initialSettings={createDefaultSettings()} initialItems={[]} />
    );
    expect(emptyHtml).toContain('No messages in All yet.');
    expect(emptyHtml).toContain('border-dashed');
  });

  it('ScamShieldPage, AiMediaCheckPage, PhotoHelperPage, and MyDataPage render Syed dashed dropzones and rounded-card shadow-card surfaces', () => {
    const scamHtml = renderToStaticMarkup(
      <ScamShieldPage initialSettings={createDefaultSettings()} />
    );
    expect(scamHtml).toContain('border-dashed border-brand-soft');
    expect(scamHtml).toContain('rounded-card');
    expect(scamHtml).toContain('shadow-card');
    expect(scamHtml).toContain('h-10 w-10 rounded-full bg-brand-wash text-brand');

    const mediaHtml = renderToStaticMarkup(
      <AiMediaCheckPage
        initialSettings={createDefaultSettings()}
        initialOutcome={{
          result: 'Cannot tell',
          note: 'No details found.',
        }}
      />
    );
    expect(mediaHtml).toContain('border-dashed border-brand-soft');
    expect(mediaHtml).toContain('rounded-card');
    expect(mediaHtml).toContain('from-brand-soft/80 via-brand-wash to-white');
    expect(mediaHtml).toContain('from-amber-50 via-white to-amber-50/40');

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
    expect(photoHtml).toContain('bg-brand-wash/70');

    const myDataHtml = renderToStaticMarkup(
      <MyDataPage initialSettings={createDefaultSettings()} initialAudit={[]} />
    );
    expect(myDataHtml).toContain('from-brand-soft via-brand-wash to-white');
    expect(myDataHtml).toContain('from-red-50/90 via-white to-red-50/40');
    expect(myDataHtml).toContain('rounded-card');
    expect(myDataHtml).toContain('shadow-card');
  });
});
