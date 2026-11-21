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
import { UnifiedInboxPage, mergeInboxItemsById } from '@/app/inbox/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import { MyDataPage } from '@/app/my-data/page';
import {
  buildCloudLoginRedirectUrl,
  completeCloudLoginCallback,
  connectReadOnlyEmailAccount,
  parseCloudLoginCallback,
  sendSampleEmailToRelay,
  syncEmailsFromRelay,
} from '@/lib/inbox/emailClient';
import {
  EMAIL_RECONNECT_MESSAGE,
  validateReadOnlyScopes,
} from '@/lib/inbox/emailChannel';
import { dispatchApiRequest } from '@/lib/server/viteApiPlugin';
import { TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { createSafeLogger } from '@/lib/server/safeLog';

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
    const demoHtml = renderToStaticMarkup(
      <DemoShell>
        <div>Demo Slot</div>
      </DemoShell>
    );
    expect(demoHtml).toContain(presentationContent.brand.name);
    expect(demoHtml).toContain(presentationContent.problem.heading);
    expect(demoHtml).toContain(presentationContent.solution.heading);
  });

  it('renders PhoneFrame and TabBar safely under SSR renderToStaticMarkup without outer bezel', () => {
    const html = renderToStaticMarkup(
      <PhoneFrame>
        <ToastProvider>
          <div>Inside Phone Screen</div>
          <TabBar activePath="/calendar" />
        </ToastProvider>
      </PhoneFrame>
    );
    expect(html).toContain('data-phone-screen="true"');
    expect(html).toContain('max-w-[430px]');
    expect(html).not.toContain('phone-body');
    expect(html).not.toContain('Daily phone life can feel overwhelming.');
    expect(html).toContain('Inside Phone Screen');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('href="/calendar"');
    expect(html).toContain('href="/scam-shield"');
    expect(html).toContain('href="/my-data"');
    expect(html).toContain('min-h-[56px]');
  });

  it('PhoneFrame provides ScreenPortalContext and AppShell renders only inner phone screen without outer bezel or DemoShell columns', () => {
    const html = renderToStaticMarkup(
      <AppShell isOffline storeUnavailable activePath="/">
        <p>Senior companion content</p>
      </AppShell>
    );
    expect(html).toContain('Skip to main content');
    expect(html).toContain('data-phone-screen="true"');
    expect(html).toContain('max-w-[430px]');
    expect(html).not.toContain('phone-body');
    expect(html).not.toContain('Daily phone life can feel overwhelming.');
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
    expect(html).toContain(
      'sticky top-0 z-20 -mx-5 bg-canvas/95 px-5 py-3 backdrop-blur-md max-w-none'
    );
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

describe('Task 3: Automatic Email Activation UI & Relay Sync', () => {
  it('connectReadOnlyEmailAccount validates read-only scopes, saves record, and enables email channel', async () => {
    const savedTokens: any[] = [];
    let savedSettings = createDefaultSettings();
    const mockVault = {
      saveOAuthToken: async (rec: any) => {
        savedTokens.push(rec);
        return { ok: true as const, value: undefined };
      },
      saveSettings: async (next: any) => {
        savedSettings = next;
        return { ok: true as const, value: undefined };
      },
    };

    const rejected = await connectReadOnlyEmailAccount({
      vault: mockVault,
      settings: savedSettings,
      emailAddress: 'senior@gmail.com',
      provider: 'Gmail',
      scopes: ['gmail.modify'],
    });
    expect(rejected.ok).toBe(false);
    expect(savedTokens).toHaveLength(0);

    const invalidEmail = await connectReadOnlyEmailAccount({
      vault: mockVault,
      settings: savedSettings,
      emailAddress: 'not-an-email',
      provider: 'Gmail',
    });
    expect(invalidEmail.ok).toBe(false);
    expect(savedTokens).toHaveLength(0);

    const connected = await connectReadOnlyEmailAccount({
      vault: mockVault,
      settings: savedSettings,
      emailAddress: 'senior@gmail.com',
      provider: 'Gmail',
    });
    expect(connected.ok).toBe(true);
    if (connected.ok) {
      expect(connected.settings.channels.email).toBe(true);
      expect(connected.record.account).toBe('senior@gmail.com');
      expect(connected.record.provider).toBe('Gmail');
      expect(connected.message).not.toMatch(BANNED_JARGON);
    }
    expect(savedTokens).toHaveLength(1);
    expect(savedSettings.channels.email).toBe(true);
  });

  it('syncEmailsFromRelay respects email consent gate and stores + acknowledges emails when email channel is ON', async () => {
    const rt = {
      tokenRegistry: new TokenRegistry(),
      rateLimiter: createRateLimiter(),
      relay: new EncryptedRelayStore(),
      logger: createSafeLogger(),
      now: () => Date.now(),
    };
    const localFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? `http://localhost:5173${input}` : input.toString();
      const res = await dispatchApiRequest(new Request(url, init), rt);
      return res ?? new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const sendRes = await sendSampleEmailToRelay({ fetchFn: localFetch });
    expect(sendRes.ok).toBe(true);

    const storedItems: any[] = [];
    const mockVault: any = {
      listItems: async () => ({ ok: true, value: [...storedItems] }),
      putItem: async (item: any) => {
        storedItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    // When email channel is OFF, consent gate blocks pulling and leaves queued email intact
    const offPullRes = await syncEmailsFromRelay({
      vault: mockVault,
      settings: createDefaultSettings(),
      fetchFn: localFetch,
    });
    expect(offPullRes.ok).toBe(false);
    if (!offPullRes.ok) {
      expect(offPullRes.errorMessage).not.toMatch(BANNED_JARGON);
    }
    expect(storedItems).toHaveLength(0);

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };

    const pullRes = await syncEmailsFromRelay({
      vault: mockVault,
      settings: onSettings,
      fetchFn: localFetch,
    });
    expect(pullRes.ok).toBe(true);
    if (pullRes.ok) {
      expect(pullRes.stored).toHaveLength(1);
      expect(pullRes.stored[0].source).toBe('email');
      expect(pullRes.stored[0].text).toContain('Clinic Appointment Reminder');
      expect(pullRes.stored[0].text).toContain('2026-07-24');
      expect(pullRes.message).not.toMatch(BANNED_JARGON);
    }

    // Second pull after ack should return 0 new emails
    const secondPull = await syncEmailsFromRelay({
      vault: mockVault,
      settings: onSettings,
      fetchFn: localFetch,
    });
    expect(secondPull.ok).toBe(true);
    if (secondPull.ok) {
      expect(secondPull.stored).toHaveLength(0);
      expect(secondPull.message).not.toMatch(BANNED_JARGON);
    }
  });

  it('MyDataPage renders only Sign In with Gmail and Sign In with Outlook buttons with zero banned jargon', () => {
    const myDataHtml = renderToStaticMarkup(
      <MyDataPage initialSettings={createDefaultSettings()} initialAudit={[]} />
    );
    expect(myDataHtml).toContain('Automatic Email Reading');
    expect(myDataHtml).toContain('Sign In with Gmail (Read-Only)');
    expect(myDataHtml).toContain('Sign In with Outlook (Read-Only)');
    expect(myDataHtml).not.toContain('Connect Read-Only Email');
    expect(myDataHtml).not.toContain('Option 2: No-Login Email Forwarding');
    expect(myDataHtml).not.toContain('Send Test Clinic Email');
    expect(myDataHtml).not.toContain('connect-email-input');
    expect(myDataHtml).not.toContain('connect-email-provider');

    const inboxHtml = renderToStaticMarkup(
      <UnifiedInboxPage initialSettings={createDefaultSettings()} initialItems={[]} />
    );
    expect(inboxHtml).toContain('Check for New Emails');

    for (const html of [myDataHtml, inboxHtml]) {
      const visible = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible).not.toMatch(BANNED_JARGON);
      const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
      for (const btn of buttons) {
        expect(btn).toContain('min-h-[56px]');
        expect(stripTags(btn).length).toBeGreaterThan(0);
      }
    }
  });

  it('UnifiedInboxPage merges vault items by id without clobbering and waits for initial loadData before auto-checking relay emails', async () => {
    // 1. Pure merge helper preserves prepended items and deduplicates by id
    const newlyPulled: any = {
      id: 'email-new-1',
      source: 'email',
      text: 'Fresh clinic reminder',
      attachments: [],
      receivedAt: '2026-07-20T09:00:00.000Z',
      group: 'Personal',
      priority: 'Important',
      tier: 2,
      confidence: 0.9,
      status: 'ok',
    };
    const existingVaultItem: any = {
      id: 'vault-old-1',
      source: 'smsPaste',
      text: 'Earlier saved SMS',
      attachments: [],
      receivedAt: '2026-07-19T08:00:00.000Z',
      group: 'Personal',
      priority: 'Social',
      tier: 1,
      confidence: 0.85,
      status: 'ok',
    };
    const merged = mergeInboxItemsById(
      [newlyPulled],
      [existingVaultItem, newlyPulled]
    );
    expect(merged.map((i) => i.id)).toEqual(['email-new-1', 'vault-old-1']);

    // 2. Mount sequencing: initialSettings.channels.email=true with initialItems=undefined
    //    must wait for loadData() to settle before calling /api/ingest/pull
    const rt = {
      tokenRegistry: new TokenRegistry(),
      rateLimiter: createRateLimiter(),
      relay: new EncryptedRelayStore(),
      logger: createSafeLogger(),
      now: () => Date.now(),
    };
    const fetchCalls: string[] = [];
    const localFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString();
      fetchCalls.push(path);
      const url = typeof input === 'string' ? `http://localhost:5173${input}` : input.toString();
      const res = await dispatchApiRequest(new Request(url, init), rt);
      return res ?? new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const sendRes = await sendSampleEmailToRelay({ fetchFn: localFetch });
    expect(sendRes.ok).toBe(true);
    fetchCalls.length = 0;

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };
    const vaultItems: any[] = [existingVaultItem];
    let resolveListItems!: (val: { ok: true; value: any[] }) => void;
    const deferredListItems = new Promise<{ ok: true; value: any[] }>((resolve) => {
      resolveListItems = resolve;
    });
    let listCalls = 0;
    const mockVault: any = {
      getSettings: async () => ({ ok: true, value: onSettings }),
      listItems: async () => {
        listCalls += 1;
        if (listCalls === 1) return deferredListItems;
        return { ok: true, value: [...vaultItems] };
      },
      listEvents: async () => ({ ok: true, value: [] }),
      putItem: async (item: any) => {
        vaultItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    const stateSlots: unknown[] = [];
    const refSlots: Array<{ current: unknown }> = [];
    const effectPrevDeps: Array<readonly unknown[] | undefined> = [];
    let stateCursor = 0;
    let refCursor = 0;
    let effectCursor = 0;
    let queuedEffects: Array<() => void> = [];

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

    const useRefSpy = vi.spyOn(React, 'useRef').mockImplementation(((
      initialValue: unknown
    ) => {
      const idx = refCursor++;
      if (!(idx in refSlots)) {
        refSlots[idx] = { current: initialValue };
      }
      return refSlots[idx];
    }) as typeof React.useRef);

    const useMemoSpy = vi
      .spyOn(React, 'useMemo')
      .mockImplementation((factory) => factory());
    const useCallbackSpy = vi
      .spyOn(React, 'useCallback')
      .mockImplementation((fn) => fn);
    const useEffectSpy = vi
      .spyOn(React, 'useEffect')
      .mockImplementation((effect, deps) => {
        const idx = effectCursor++;
        const prevDeps = effectPrevDeps[idx];
        const depsChanged =
          !prevDeps ||
          !deps ||
          prevDeps.length !== deps.length ||
          deps.some((d, i) => !Object.is(d, prevDeps[i]));
        if (depsChanged) {
          effectPrevDeps[idx] = deps ? [...deps] : undefined;
          queuedEffects.push(effect as () => void);
        }
      });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(localFetch);

    try {
      const renderAndRunEffects = () => {
        stateCursor = 0;
        refCursor = 0;
        effectCursor = 0;
        queuedEffects = [];
        UnifiedInboxPage({
          initialSettings: onSettings,
          vault: mockVault,
        });
        for (const eff of queuedEffects) {
          eff();
        }
      };

      // Render 1: loadData starts and is still pending -> /api/ingest/pull MUST NOT fire yet
      renderAndRunEffects();
      await Promise.resolve();
      expect(listCalls).toBe(1);
      expect(fetchCalls).not.toContain('/api/ingest/pull');

      // Now finish initial loadData() -> merges existingVaultItem & sets initialLoadDone = true
      resolveListItems({ ok: true, value: [existingVaultItem] });
      await new Promise((r) => setTimeout(r, 20));

      // Render 2: initialLoadDone is now true -> auto-check fires /api/ingest/pull once
      renderAndRunEffects();
      await new Promise((r) => setTimeout(r, 50));

      expect(fetchCalls).toContain('/api/ingest/pull');
      expect(fetchCalls).toContain('/api/ingest/ack');

      // Items state holds BOTH the newly pulled email AND the existing vault item
      const itemsState = stateSlots[1] as Array<{ id: string; source: string }>;
      expect(itemsState).toHaveLength(2);
      expect(itemsState.some((i) => i.id === 'vault-old-1')).toBe(true);
      expect(itemsState.some((i) => i.source === 'email')).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      useEffectSpy.mockRestore();
      useCallbackSpy.mockRestore();
      useMemoSpy.mockRestore();
      useRefSpy.mockRestore();
      useStateSpy.mockRestore();
    }
  });
});

describe('Task 1: Gmail & Outlook Cloud Sign-In Redirect, Callback, and Fetch', () => {
  it('buildCloudLoginRedirectUrl returns jargon-free error when clientId is missing and builds implicit read-only URLs for Gmail and Outlook', () => {
    const missingGmail = buildCloudLoginRedirectUrl({
      provider: 'Gmail',
      clientId: '',
    });
    expect(missingGmail.ok).toBe(false);
    if (!missingGmail.ok) {
      expect(missingGmail.errorMessage).toContain('VITE_GOOGLE_CLIENT_ID');
      expect(missingGmail.errorMessage).toContain('.env.local');
      expect(missingGmail.errorMessage).not.toMatch(BANNED_JARGON);
    }

    const missingOutlook = buildCloudLoginRedirectUrl({
      provider: 'Outlook',
      clientId: '',
    });
    expect(missingOutlook.ok).toBe(false);
    if (!missingOutlook.ok) {
      expect(missingOutlook.errorMessage).toContain('VITE_MICROSOFT_CLIENT_ID');
      expect(missingOutlook.errorMessage).toContain('.env.local');
      expect(missingOutlook.errorMessage).not.toMatch(BANNED_JARGON);
    }

    const gmailRes = buildCloudLoginRedirectUrl({
      provider: 'Gmail',
      clientId: 'google-client-123',
      emailAddress: 'grandma@gmail.com',
      redirectUri: 'http://localhost:5173/my-data',
    });
    expect(gmailRes.ok).toBe(true);
    if (gmailRes.ok) {
      const parsed = new URL(gmailRes.url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth'
      );
      expect(parsed.searchParams.get('response_type')).toBe('token');
      expect(parsed.searchParams.get('client_id')).toBe('google-client-123');
      expect(parsed.searchParams.get('scope')).toContain(
        'https://www.googleapis.com/auth/gmail.readonly'
      );
      expect(parsed.searchParams.get('access_type')).toBeNull();
      expect(parsed.searchParams.get('login_hint')).toBe('grandma@gmail.com');
      const state = new URLSearchParams(parsed.searchParams.get('state') ?? '');
      expect(state.get('provider')).toBe('Gmail');
    }

    const outlookRes = buildCloudLoginRedirectUrl({
      provider: 'Outlook',
      clientId: 'ms-client-456',
      redirectUri: 'http://localhost:5173/my-data',
    });
    expect(outlookRes.ok).toBe(true);
    if (outlookRes.ok) {
      const parsed = new URL(outlookRes.url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
      );
      expect(parsed.searchParams.get('response_type')).toBe('token');
      expect(parsed.searchParams.get('client_id')).toBe('ms-client-456');
      expect(parsed.searchParams.get('scope')).toContain(
        'https://graph.microsoft.com/mail.read'
      );
      expect(parsed.searchParams.get('scope')).not.toContain('offline_access');
      const state = new URLSearchParams(parsed.searchParams.get('state') ?? '');
      expect(state.get('provider')).toBe('Outlook');
    }
  });

  it('parseCloudLoginCallback parses hash access_token and search code callbacks', () => {
    const hashParsed = parseCloudLoginCallback(
      '',
      '#access_token=ya29.test&scope=https://www.googleapis.com/auth/gmail.readonly%20email&state=provider%3DGmail'
    );
    expect(hashParsed).toBeDefined();
    expect(hashParsed?.provider).toBe('Gmail');
    expect(hashParsed?.accessToken).toBe('ya29.test');
    expect(hashParsed?.grantedScopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'email',
    ]);
    expect(typeof hashParsed?.emailAddress).toBe('string');

    const searchParsed = parseCloudLoginCallback(
      '?code=ms-code-789&state=provider%3DOutlook%26email%3Dnana%2540outlook.com',
      ''
    );
    expect(searchParsed).toBeDefined();
    expect(searchParsed?.provider).toBe('Outlook');
    expect(searchParsed?.accessToken).toBe('ms-code-789');
    expect(searchParsed?.emailHint).toBe('nana@outlook.com');
    expect(searchParsed?.emailAddress).toBe('nana@outlook.com');

    expect(parseCloudLoginCallback('', '')).toBeUndefined();
    expect(parseCloudLoginCallback('?state=provider%3DGmail', '')).toBeUndefined();
  });

  it('completeCloudLoginCallback rejects write scopes and completes Gmail/Outlook sign-in by fetching user email', async () => {
    const savedTokens: any[] = [];
    let savedSettings = createDefaultSettings();
    const mockVault = {
      saveOAuthToken: async (rec: any) => {
        savedTokens.push(rec);
        return { ok: true as const, value: undefined };
      },
      saveSettings: async (next: any) => {
        savedSettings = next;
        return { ok: true as const, value: undefined };
      },
    };

    const writeRejected = await completeCloudLoginCallback({
      vault: mockVault,
      settings: savedSettings,
      hash: '#access_token=ya29.bad&scope=https://mail.google.com/&state=provider%3DGmail',
    });
    expect(writeRejected.ok).toBe(false);
    if (!writeRejected.ok) {
      expect(writeRejected.errorMessage).not.toMatch(BANNED_JARGON);
    }
    expect(savedTokens).toHaveLength(0);
    expect(savedSettings.channels.email).toBe(false);

    const googleFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toBe('https://www.googleapis.com/oauth2/v3/userinfo');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer ya29.gmail-live'
      );
      return new Response(JSON.stringify({ email: 'mary.tan@gmail.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const gmailDone = await completeCloudLoginCallback({
      vault: mockVault,
      settings: savedSettings,
      hash: '#access_token=ya29.gmail-live&scope=https://www.googleapis.com/auth/gmail.readonly%20email&state=provider%3DGmail',
      fetchFn: googleFetch,
    });
    expect(gmailDone.ok).toBe(true);
    if (gmailDone.ok) {
      expect(gmailDone.record.provider).toBe('Gmail');
      expect(gmailDone.record.account).toBe('mary.tan@gmail.com');
      expect(gmailDone.record.token).toBe('ya29.gmail-live');
      expect(gmailDone.settings.channels.email).toBe(true);
      expect(gmailDone.message).not.toMatch(BANNED_JARGON);
    }

    const outlookFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toBe('https://graph.microsoft.com/v1.0/me');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        'Bearer ms-live-token'
      );
      return new Response(
        JSON.stringify({ mail: null, userPrincipalName: 'ah.kow@outlook.com' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const outlookDone = await completeCloudLoginCallback({
      vault: mockVault,
      settings: createDefaultSettings(),
      hash: '#access_token=ms-live-token&scope=https://graph.microsoft.com/mail.read%20openid%20email&state=provider%3DOutlook',
      fetchFn: outlookFetch,
    });
    expect(outlookDone.ok).toBe(true);
    if (outlookDone.ok) {
      expect(outlookDone.record.provider).toBe('Outlook');
      expect(outlookDone.record.account).toBe('ah.kow@outlook.com');
      expect(outlookDone.record.token).toBe('ms-live-token');
      expect(outlookDone.settings.channels.email).toBe(true);
      expect(outlookDone.message).not.toMatch(BANNED_JARGON);
    }
  });

  it('syncEmailsFromRelay fetches Outlook messages via Microsoft Graph and ignores unavailable relay when cloud succeeds', async () => {
    const storedItems: any[] = [];
    const mockVault: any = {
      listOAuthTokens: async () => ({
        ok: true,
        value: [
          {
            id: 'email-account-primary',
            account: 'ah.kow@outlook.com',
            provider: 'Outlook',
            token: 'ms-graph-live-token',
          },
        ],
      }),
      listItems: async () => ({ ok: true, value: [...storedItems] }),
      putItem: async (item: any) => {
        storedItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    const calledUrls: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);
      if (url.startsWith('https://graph.microsoft.com/v1.0/me/messages')) {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
          'Bearer ms-graph-live-token'
        );
        return new Response(
          JSON.stringify({
            value: [
              {
                id: 'outlook-msg-1',
                subject: 'Dental Checkup Confirmation',
                from: {
                  emailAddress: {
                    name: 'Smile Clinic',
                    address: 'hello@smileclinic.sg',
                  },
                },
                receivedDateTime: '2026-08-10T09:15:00Z',
                bodyPreview:
                  'Your dental appointment is on 2026-08-15 at 11:00.',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Relay unavailable -> should be gracefully ignored because cloud fetch succeeded
      return new Response('Relay offline', { status: 503 });
    }) as typeof fetch;

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };

    const res = await syncEmailsFromRelay({
      vault: mockVault,
      settings: onSettings,
      fetchFn: mockFetch,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stored).toHaveLength(1);
      expect(res.stored[0].source).toBe('email');
      expect(res.stored[0].text).toContain('Dental Checkup Confirmation');
      expect(res.stored[0].sender).toContain('Smile Clinic');
      expect(res.message).not.toMatch(BANNED_JARGON);
    }
    expect(
      calledUrls.some((u) =>
        u.startsWith('https://graph.microsoft.com/v1.0/me/messages')
      )
    ).toBe(true);
  });

  it('syncEmailsFromRelay fetches Gmail messages + metadata and merges with relay items', async () => {
    const storedItems: any[] = [];
    const mockVault: any = {
      listOAuthTokens: async () => ({
        ok: true,
        value: [
          {
            id: 'email-account-primary',
            account: 'mary.tan@gmail.com',
            provider: 'Gmail',
            token: 'ya29.gmail-live-token',
          },
        ],
      }),
      listItems: async () => ({ ok: true, value: [...storedItems] }),
      putItem: async (item: any) => {
        storedItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    const rt = {
      tokenRegistry: new TokenRegistry(),
      rateLimiter: createRateLimiter(),
      relay: new EncryptedRelayStore(),
      logger: createSafeLogger(),
      now: () => Date.now(),
    };

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
          'Bearer ya29.gmail-live-token'
        );
        return new Response(
          JSON.stringify({ messages: [{ id: 'gmail-msg-42' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (
        url.startsWith(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-42'
        )
      ) {
        return new Response(
          JSON.stringify({
            id: 'gmail-msg-42',
            snippet: 'Reminder: bring your medication list on 2026-08-20 at 14:00.',
            payload: {
              headers: [
                { name: 'From', value: 'Polyclinic <care@polyclinic.sg>' },
                { name: 'Subject', value: 'Polyclinic Follow-Up' },
                { name: 'Date', value: 'Mon, 10 Aug 2026 08:30:00 +0000' },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const fullUrl = url.startsWith('http') ? url : `http://localhost:5173${url}`;
      const res = await dispatchApiRequest(new Request(fullUrl, init), rt);
      return res ?? new Response('Not found', { status: 404 });
    }) as typeof fetch;

    await sendSampleEmailToRelay({ fetchFn: mockFetch });

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };

    const res = await syncEmailsFromRelay({
      vault: mockVault,
      settings: onSettings,
      fetchFn: mockFetch,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stored).toHaveLength(2);
      expect(
        res.stored.some((item) => item.text.includes('Polyclinic Follow-Up'))
      ).toBe(true);
      expect(
        res.stored.some((item) =>
          item.text.includes('Clinic Appointment Reminder')
        )
      ).toBe(true);
      expect(res.message).not.toMatch(BANNED_JARGON);
    }
  });

  it('syncEmailsFromRelay returns reconnectRequired with EMAIL_RECONNECT_MESSAGE on 401/403 without deleting saved items', async () => {
    const existingSaved: any = {
      id: 'existing-saved-1',
      source: 'email',
      text: 'Previously saved clinic note',
      attachments: [],
      receivedAt: '2026-07-01T08:00:00.000Z',
      group: 'Personal',
      priority: 'Important',
      tier: 1,
      confidence: 0.9,
      status: 'ok',
    };
    const storedItems: any[] = [existingSaved];
    const mockVault: any = {
      listOAuthTokens: async () => ({
        ok: true,
        value: [
          {
            id: 'email-account-primary',
            account: 'mary.tan@gmail.com',
            provider: 'Gmail',
            token: 'expired-token-123',
          },
        ],
      }),
      listItems: async () => ({ ok: true, value: [...storedItems] }),
      putItem: async (item: any) => {
        storedItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };

    for (const status of [401, 403]) {
      const expiredFetch = (async () =>
        new Response('Unauthorized', { status })) as typeof fetch;

      const res = await syncEmailsFromRelay({
        vault: mockVault,
        settings: onSettings,
        fetchFn: expiredFetch,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.stored).toEqual([]);
        expect(res.reconnectRequired).toBe(true);
        expect(res.reconnectMessage).toBe(EMAIL_RECONNECT_MESSAGE);
        expect(res.message).toBe(EMAIL_RECONNECT_MESSAGE);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(storedItems).toHaveLength(1);
      expect(storedItems[0].id).toBe('existing-saved-1');
    }
  });
});

describe('Task 2: Read-Only Identity Scopes & MyDataPage Cloud Sign-In Lifecycle', () => {
  it('validateReadOnlyScopes accepts standard Google and Microsoft read-only identity scopes while rejecting write scopes', async () => {
    const googleExpanded = validateReadOnlyScopes([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ]);
    expect(googleExpanded.ok).toBe(true);

    const microsoftExpanded = validateReadOnlyScopes([
      'https://graph.microsoft.com/mail.read',
      'user.read',
      'https://graph.microsoft.com/user.read',
      'User.Read',
      'openid',
      'email',
    ]);
    expect(microsoftExpanded.ok).toBe(true);

    const stillRejectsWrite = validateReadOnlyScopes([
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
    expect(stillRejectsWrite.ok).toBe(false);

    const stillRejectsDelete = validateReadOnlyScopes([
      'user.read',
      'https://graph.microsoft.com/mail.readwrite',
    ]);
    expect(stillRejectsDelete.ok).toBe(false);

    // Live Google callback expanding email -> userinfo.email completes cleanly
    const savedTokens: any[] = [];
    let savedSettings = createDefaultSettings();
    const mockVault = {
      saveOAuthToken: async (rec: any) => {
        savedTokens.push(rec);
        return { ok: true as const, value: undefined };
      },
      saveSettings: async (next: any) => {
        savedSettings = next;
        return { ok: true as const, value: undefined };
      },
    };
    const googleFetch = (async () =>
      new Response(JSON.stringify({ email: 'ah.mei@gmail.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const liveCallback = await completeCloudLoginCallback({
      vault: mockVault,
      settings: savedSettings,
      hash: '#access_token=ya29.expanded&scope=https://www.googleapis.com/auth/gmail.readonly%20https://www.googleapis.com/auth/userinfo.email%20openid&state=provider%3DGmail',
      fetchFn: googleFetch,
    });
    expect(liveCallback.ok).toBe(true);
    if (liveCallback.ok) {
      expect(liveCallback.record.account).toBe('ah.mei@gmail.com');
      expect(liveCallback.settings.channels.email).toBe(true);
    }
  });

  it('MyDataPage skips callback completion on normal mount without triggering an error alert, and completes hash callback + cleans URL when present', async () => {
    const runMyDataMount = async (params: {
      search: string;
      hash: string;
      fetchFn?: typeof fetch;
    }) => {
      const replaceState = vi.fn();
      const assign = vi.fn();
      const onSettingsChange = vi.fn();
      const savedTokens: any[] = [];
      let vaultSettings = createDefaultSettings();
      const mockVault: any = {
        getSettings: async () => ({ ok: true, value: vaultSettings }),
        saveSettings: async (next: any) => {
          vaultSettings = next;
          return { ok: true, value: undefined };
        },
        listAudit: async () => ({ ok: true, value: [] }),
        listOAuthTokens: async () => ({ ok: true, value: [...savedTokens] }),
        saveOAuthToken: async (rec: any) => {
          savedTokens.push(rec);
          return { ok: true, value: undefined };
        },
      };

      const stateSlots: unknown[] = [];
      const effectPrevDeps: Array<readonly unknown[] | undefined> = [];
      let stateCursor = 0;
      let effectCursor = 0;
      let queuedEffects: Array<() => void> = [];

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
      const useCallbackSpy = vi
        .spyOn(React, 'useCallback')
        .mockImplementation((fn) => fn);
      const useEffectSpy = vi
        .spyOn(React, 'useEffect')
        .mockImplementation((effect, deps) => {
          const idx = effectCursor++;
          const prevDeps = effectPrevDeps[idx];
          const depsChanged =
            !prevDeps ||
            !deps ||
            prevDeps.length !== deps.length ||
            deps.some((d, i) => !Object.is(d, prevDeps[i]));
          if (depsChanged) {
            effectPrevDeps[idx] = deps ? [...deps] : undefined;
            queuedEffects.push(effect as () => void);
          }
        });

      const fetchSpy = params.fetchFn
        ? vi.spyOn(globalThis, 'fetch').mockImplementation(params.fetchFn)
        : vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/my-data',
          search: params.search,
          hash: params.hash,
          assign,
        },
        history: { replaceState },
      });

      try {
        const renderPass = () => {
          stateCursor = 0;
          effectCursor = 0;
          queuedEffects = [];
          const tree = MyDataPage({
            initialSettings: createDefaultSettings(),
            initialAudit: [],
            vault: mockVault,
            onSettingsChange,
          });
          for (const eff of queuedEffects) {
            eff();
          }
          return tree;
        };

        renderPass();
        await new Promise((r) => setTimeout(r, 30));
        const finalTree = renderPass();
        const alerts = findElements(finalTree, (el) => el.props.role === 'alert');
        const badges = findElements(finalTree, (el) => el.props['data-badge'] === 'true');
        return {
          replaceState,
          onSettingsChange,
          savedTokens,
          fetchSpy,
          alerts,
          badges,
        };
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        useEffectSpy.mockRestore();
        useCallbackSpy.mockRestore();
        useMemoSpy.mockRestore();
        useStateSpy.mockRestore();
      }
    };

    // 1. Normal visit: no callback params -> no fetch, no alert, no history.replaceState
    const normal = await runMyDataMount({ search: '', hash: '' });
    expect(normal.fetchSpy).not.toHaveBeenCalled();
    expect(normal.alerts).toHaveLength(0);
    expect(normal.replaceState).not.toHaveBeenCalled();
    expect(normal.savedTokens).toHaveLength(0);

    // 2. Hash callback with Gmail expanded userinfo.email scope -> connects account, updates settings, cleans URL
    const callbackRes = await runMyDataMount({
      search: '',
      hash: '#access_token=ya29.hash-ok&scope=https://www.googleapis.com/auth/gmail.readonly%20https://www.googleapis.com/auth/userinfo.email&state=provider%3DGmail',
      fetchFn: (async () =>
        new Response(JSON.stringify({ email: 'grandma.lee@gmail.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    });
    expect(callbackRes.alerts).toHaveLength(0);
    expect(callbackRes.savedTokens).toHaveLength(1);
    expect(callbackRes.savedTokens[0].account).toBe('grandma.lee@gmail.com');
    expect(callbackRes.savedTokens[0].token).toBe('ya29.hash-ok');
    expect(callbackRes.onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({ email: true }),
      })
    );
    expect(callbackRes.badges.length).toBeGreaterThan(0);
    expect(callbackRes.replaceState).toHaveBeenCalledWith(null, '', '/my-data');

    // 3. Callback with rejected write scope -> displays error alert and cleans URL
    const rejectedRes = await runMyDataMount({
      search: '',
      hash: '#access_token=ya29.bad&scope=https://mail.google.com/&state=provider%3DGmail',
    });
    expect(rejectedRes.alerts.length).toBeGreaterThan(0);
    expect(rejectedRes.savedTokens).toHaveLength(0);
    expect(rejectedRes.replaceState).toHaveBeenCalledWith(null, '', '/my-data');
  });
});
