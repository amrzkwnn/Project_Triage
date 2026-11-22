import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultSettings,
  type AuditEntry,
  type CalendarEvent,
  type InboxItem,
  type Result,
  type Settings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';
import {
  CALENDAR_CATEGORIES,
  inferCalendarCategory,
} from '@/lib/calendar/categories';
import { detectEvent } from '@/lib/inbox/events';
import { createGeminiAiProvider } from '@/lib/server/geminiProvider';
import {
  createDecidePostHandler,
  type DecideOutput,
} from '@/lib/server/handlers';
import { DEFAULT_DEV_TOKEN, TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { createSafeLogger } from '@/lib/server/safeLog';
import { analyze } from '@/lib/ai/engine';
import { processEmailBatch } from '@/lib/inbox/emailChannel';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { executeHomeDefaultConfirm } from '@/app/page';
import { forwardEventToCalendar } from '@/app/inbox/page';
import { CalendarPage, autoPickCalendarCategory } from '@/app/calendar/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function stripHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractButtonTags(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
}

function extractBadges(html: string): string[] {
  const badges: string[] = [];
  const openPattern = /<(span|div|a)\b[^>]*data-badge="true"[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const startIdx = match.index;
    const tagTokenPattern = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, 'gi');
    tagTokenPattern.lastIndex = openPattern.lastIndex;

    let depth = 1;
    let endIdx = html.length;
    let token: RegExpExecArray | null;
    while ((token = tagTokenPattern.exec(html)) !== null) {
      if (token[1] === '/') {
        depth -= 1;
      } else {
        depth += 1;
      }
      if (depth === 0) {
        endIdx = tagTokenPattern.lastIndex;
        break;
      }
    }
    badges.push(html.slice(startIdx, endIdx));
  }

  return badges;
}

type MockElement = {
  type: unknown;
  props: Record<string, unknown>;
};

function findElements(
  node: unknown,
  predicate: (el: MockElement) => boolean,
  found: MockElement[] = []
): MockElement[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      findElements(child, predicate, found);
    }
    return found;
  }
  const el = node as Partial<MockElement>;
  if (el.props && typeof el.props === 'object') {
    if (predicate(el as MockElement)) {
      found.push(el as MockElement);
    }
    if ('children' in el.props) {
      findElements(el.props.children, predicate, found);
    }
  }
  return found;
}

function createHookHarness() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const memos: Array<{ deps?: readonly unknown[]; value: unknown }> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let memoCursor = 0;

  const origUseState = React.useState;
  const origUseEffect = React.useEffect;
  const origUseRef = React.useRef;
  const origUseMemo = React.useMemo;
  const origUseCallback = React.useCallback;

  function install() {
    (React as { useState: unknown }).useState = (initial: unknown) => {
      const idx = stateCursor;
      stateCursor += 1;
      if (!(idx in states)) {
        states[idx] =
          typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const setState = (next: unknown) => {
        states[idx] =
          typeof next === 'function'
            ? (next as (prev: unknown) => unknown)(states[idx])
            : next;
      };
      return [states[idx], setState];
    };
    (React as { useEffect: unknown }).useEffect = () => {};
    (React as { useRef: unknown }).useRef = (initial: unknown) => {
      const idx = refCursor;
      refCursor += 1;
      if (!(idx in refs)) {
        refs[idx] = { current: initial };
      }
      return refs[idx];
    };
    (React as { useMemo: unknown }).useMemo = (
      factory: () => unknown,
      deps?: readonly unknown[]
    ) => {
      const idx = memoCursor;
      memoCursor += 1;
      const prev = memos[idx];
      const same =
        prev &&
        deps &&
        prev.deps &&
        deps.length === prev.deps.length &&
        deps.every((d, i) => Object.is(d, prev.deps![i]));
      if (same) return prev.value;
      const value = factory();
      memos[idx] = { deps, value };
      return value;
    };
    (React as { useCallback: unknown }).useCallback = (fn: unknown) => fn;
  }

  function restore() {
    (React as { useState: unknown }).useState = origUseState;
    (React as { useEffect: unknown }).useEffect = origUseEffect;
    (React as { useRef: unknown }).useRef = origUseRef;
    (React as { useMemo: unknown }).useMemo = origUseMemo;
    (React as { useCallback: unknown }).useCallback = origUseCallback;
  }

  function render<T>(fn: () => T): T {
    stateCursor = 0;
    refCursor = 0;
    memoCursor = 0;
    install();
    try {
      return fn();
    } finally {
      restore();
    }
  }

  return { render, restore };
}

function makeMockAuditVault(options?: {
  failAudit?: boolean;
  onAudit?: (entry: AuditEntry) => void;
}): {
  vault: Pick<Vault, 'appendAudit' | 'putEvent'>;
  entries: AuditEntry[];
  savedEvents: CalendarEvent[];
} {
  const entries: AuditEntry[] = [];
  const savedEvents: CalendarEvent[] = [];
  const vault: Pick<Vault, 'appendAudit' | 'putEvent'> = {
    async appendAudit(entry: AuditEntry): Promise<Result<void, StoreError>> {
      options?.onAudit?.(entry);
      if (options?.failAudit) {
        return {
          ok: false,
          error: {
            code: 'tx-failed',
            message: 'We could not save the activity record right now.',
          },
        };
      }
      entries.push(entry);
      return { ok: true, value: undefined };
    },
    async putEvent(ev: CalendarEvent): Promise<Result<void, StoreError>> {
      savedEvents.push(ev);
      return { ok: true, value: undefined };
    },
  };
  return { vault, entries, savedEvents };
}

describe('Task 4: Accurate AI & Deterministic Categorization for Inbox & Calendar', () => {
  describe('1. inferCalendarCategory & detectEvent category inference', () => {
    it('classifies dinner, lunch, birthday, family, coffee, and party as Family & Social (NEVER Medical)', () => {
      expect(inferCalendarCategory('Family dinner with Sarah at 7pm')).toBe(
        'Family & Social'
      );
      expect(inferCalendarCategory('Lunch with friends')).toBe(
        'Family & Social'
      );
      expect(inferCalendarCategory('Grandson birthday party')).toBe(
        'Family & Social'
      );
      expect(inferCalendarCategory('Coffee with Auntie Mei')).toBe(
        'Family & Social'
      );
      expect(inferCalendarCategory('Dinner')).toBe('Family & Social');
    });

    it('classifies bills/errands, medical, and daily routine accurately', () => {
      expect(inferCalendarCategory('TNB electric bill due')).toBe(
        'Bills & Errands'
      );
      expect(inferCalendarCategory('Grocery errand at market')).toBe(
        'Bills & Errands'
      );
      expect(inferCalendarCategory('Bank visit for passbook')).toBe(
        'Bills & Errands'
      );
      expect(inferCalendarCategory('Dr. Tan dental checkup')).toBe('Medical');
      expect(inferCalendarCategory('City Clinic visit')).toBe('Medical');
      expect(inferCalendarCategory('Visit Sarah at home')).toBe(
        'Family & Social'
      );
      expect(inferCalendarCategory('Morning walk in the park')).toBe(
        'Daily Routine'
      );
    });

    it('attaches accurate inferred category onto DetectedEvent returned by detectEvent', () => {
      const dinnerEv = detectEvent('Dinner with family on 2026-11-25 at 19:00');
      expect(dinnerEv).toBeDefined();
      expect(dinnerEv?.category).toBe('Family & Social');

      const billEv = detectEvent('TNB electric bill due on 2026-11-28 at 10:00');
      expect(billEv).toBeDefined();
      expect(billEv?.category).toBe('Bills & Errands');

      const clinicEv = detectEvent(
        'Dr. Tan dental checkup on 2026-11-29 at 09:30'
      );
      expect(clinicEv).toBeDefined();
      expect(clinicEv?.category).toBe('Medical');
    });
  });

  describe('2. HomeHub & UnifiedInbox calendar forwarding (no hardcoded Medical)', () => {
    it('executeHomeDefaultConfirm saves Family & Social for dinner and preserves explicit detectedEvent.category', async () => {
      const { vault, savedEvents } = makeMockAuditVault();
      const dinnerItem: InboxItem = {
        id: 'dinner-home-1',
        source: 'whatsappForward',
        sender: 'Sarah',
        text: 'Dinner with family on 2026-11-25 at 19:00',
        attachments: [],
        receivedAt: '2026-11-22T09:00:00.000Z',
        group: 'Family',
        priority: 'Social',
        detectedEvent: {
          title: 'Dinner with family',
          date: '2026-11-25',
          time: '19:00',
        },
        tier: 2,
        confidence: 0.9,
        status: 'ok',
        proposals: [
          {
            id: 'dinner-home-1:forwardToCalendar',
            kind: 'forwardToCalendar',
            label: 'Add to Calendar',
            itemId: 'dinner-home-1',
            event: {
              title: 'Dinner with family',
              date: '2026-11-25',
              time: '19:00',
            },
          },
        ],
      };

      const res1 = await executeHomeDefaultConfirm({
        item: dinnerItem,
        confirmation: confirmFromTap('dinner-home-1:forwardToCalendar'),
        settings: createDefaultSettings(),
        vault,
      });

      expect(res1.ok).toBe(true);
      expect(savedEvents).toHaveLength(1);
      expect(savedEvents[0].category).toBe('Family & Social');

      // Explicit AI-extracted category 'Bills & Errands' is preserved
      const billItem: InboxItem = {
        ...dinnerItem,
        id: 'bill-home-2',
        text: 'Reminder about house task on 2026-11-26 at 11:00',
        detectedEvent: {
          title: 'House task',
          date: '2026-11-26',
          time: '11:00',
          category: 'Bills & Errands',
        },
        proposals: [
          {
            id: 'bill-home-2:forwardToCalendar',
            kind: 'forwardToCalendar',
            label: 'Add to Calendar',
            itemId: 'bill-home-2',
            event: {
              title: 'House task',
              date: '2026-11-26',
              time: '11:00',
              category: 'Bills & Errands',
            },
          },
        ],
      };

      const res2 = await executeHomeDefaultConfirm({
        item: billItem,
        confirmation: confirmFromTap('bill-home-2:forwardToCalendar'),
        settings: createDefaultSettings(),
        vault,
      });

      expect(res2.ok).toBe(true);
      expect(savedEvents).toHaveLength(2);
      expect(savedEvents[1].category).toBe('Bills & Errands');
    });

    it('forwardEventToCalendar in UnifiedInbox saves Family & Social for dinner and preserves detectedEvent.category', async () => {
      const { vault, savedEvents } = makeMockAuditVault();
      const dinnerItem: InboxItem = {
        id: 'dinner-inbox-1',
        source: 'email',
        sender: 'Amina',
        text: 'Dinner with family on 2026-11-25 at 19:00',
        attachments: [],
        receivedAt: '2026-11-22T09:00:00.000Z',
        group: 'Family',
        priority: 'Social',
        detectedEvent: {
          title: 'Dinner with family',
          date: '2026-11-25',
          time: '19:00',
        },
        tier: 2,
        confidence: 0.9,
        status: 'ok',
      };

      const res1 = await forwardEventToCalendar({
        item: dinnerItem,
        event: dinnerItem.detectedEvent!,
        vault,
      });

      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.createdEvent.category).toBe('Family & Social');
      }
      expect(savedEvents[0].category).toBe('Family & Social');

      const billItem: InboxItem = {
        ...dinnerItem,
        id: 'bill-inbox-2',
        text: 'General reminder on 2026-11-27 at 14:00',
        detectedEvent: {
          title: 'General reminder',
          date: '2026-11-27',
          time: '14:00',
          category: 'Bills & Errands',
        },
      };

      const res2 = await forwardEventToCalendar({
        item: billItem,
        event: billItem.detectedEvent!,
        vault,
      });

      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.createdEvent.category).toBe('Bills & Errands');
      }
      expect(savedEvents[1].category).toBe('Bills & Errands');
    });
  });

  describe('3. POST /api/decide + createGeminiAiProvider + analyze() + processEmailBatch()', () => {
    it('accepts x-inbox-categories header while preserving strict { item: { channel, text } } body validation and returning custom category & detectedEvent.category', async () => {
      const geminiCalls: Array<{ body: Record<string, unknown> }> = [];
      const mockGeminiFetch: typeof fetch = vi.fn(async (_url, init) => {
        const parsedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        geminiCalls.push({ body: parsedBody });
        const promptText = (
          (parsedBody.contents as Array<{ parts: Array<{ text: string }> }>)[0]
            .parts[0].text ?? ''
        );

        const aiReply: DecideOutput = promptText.includes('TNB')
          ? {
              summary: {
                fromApp: 'Email',
                whoSent: 'TNB Billing',
                actionNeeded: 'Pay electric bill before Friday',
                text: 'Your TNB electric bill of RM 120 is due on 2026-11-28.',
              },
              group: 'Bills',
              priority: 'Important',
              confidence: 0.93,
              detectedEvent: {
                date: '2026-11-28',
                time: '10:00',
                title: 'TNB Electric Bill Due',
                category: 'Bills & Errands',
              },
            }
          : {
              summary: {
                fromApp: 'Email',
                whoSent: 'Sarah',
                actionNeeded: 'Confirm calendar date',
                text: 'Sarah invited you to family dinner on 2026-11-25 at 7:00 PM.',
              },
              group: 'Family',
              priority: 'Social',
              confidence: 0.95,
              detectedEvent: {
                date: '2026-11-25',
                time: '19:00',
                title: 'Family Dinner with Sarah',
                category: 'Family & Social',
              },
            };

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(aiReply) }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const provider = createGeminiAiProvider({ fetchFn: mockGeminiFetch });
      const handler = createDecidePostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'TEST_TASK4_GEMINI_KEY' },
        aiProvider: provider,
      });

      // Strict body validation remains 100% intact even when x-inbox-categories is sent
      const badBodyRes = await handler(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            'x-inbox-categories': 'Personal,Family,Others,Bills',
          },
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'Hello',
              extraField: 'not-allowed',
            },
          }),
        })
      );
      expect(badBodyRes.status).toBe(400);

      // Valid request with custom category 'Bills' via x-inbox-categories header
      const billRes = await handler(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            'x-inbox-categories': 'Personal,Family,Others,Bills',
          },
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'TNB electric bill due on 2026-11-28 at 10:00.',
            },
          }),
        })
      );
      expect(billRes.status).toBe(200);
      const billOut = (await billRes.json()) as DecideOutput;
      expect(billOut.group).toBe('Bills');
      expect(billOut.priority).toBe('Important');
      expect(billOut.detectedEvent?.category).toBe('Bills & Errands');

      // Verify Gemini schema includes custom category in group enum and category enum on detectedEvent
      const genConfig = geminiCalls[0].body.generationConfig as {
        responseSchema: {
          properties: {
            group: { enum: string[] };
            detectedEvent: {
              properties: { category: { enum: string[] } };
            };
          };
        };
      };
      expect(genConfig.responseSchema.properties.group.enum).toContain('Bills');
      expect(
        genConfig.responseSchema.properties.detectedEvent.properties.category
          .enum
      ).toEqual([...CALENDAR_CATEGORIES]);

      // End-to-end through analyze() with settings.inboxCategories containing 'Bills'
      const settingsWithBills: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
        inboxCategories: ['Personal', 'Family', 'Others', 'Bills'],
      };
      const { vault, entries } = makeMockAuditVault();
      const capturedHeaders: string[] = [];
      const capturedBodies: string[] = [];

      const proxyFetch: typeof fetch = vi.fn(async (input, init) => {
        const hdrs = new Headers(init?.headers);
        capturedHeaders.push(hdrs.get('x-inbox-categories') ?? '');
        capturedBodies.push(String(init?.body ?? ''));
        return handler(
          new Request(`https://companion.example${String(input)}`, init)
        );
      });

      const analyzedBill = await analyze(
        {
          id: 'email-bill-1',
          source: 'email',
          text: 'TNB electric bill due on 2026-11-28 at 10:00.',
          attachments: [],
          receivedAt: '2026-11-22T08:00:00.000Z',
        },
        settingsWithBills,
        { vault, fetchFn: proxyFetch }
      );

      expect(analyzedBill.ok).toBe(true);
      expect(entries).toHaveLength(1);
      expect(capturedHeaders[0]).toContain('Bills');
      expect(capturedHeaders[0]).not.toContain('All');
      expect(capturedHeaders[0]).not.toContain('Promotion');
      // Body remains strictly { item: { channel, text } }
      const sentPayload = JSON.parse(capturedBodies[0]) as Record<
        string,
        unknown
      >;
      expect(Object.keys(sentPayload)).toEqual(['item']);
      expect(
        Object.keys(sentPayload.item as Record<string, unknown>).sort()
      ).toEqual(['channel', 'text']);

      if (analyzedBill.ok) {
        expect(analyzedBill.value.usedFallback).toBe(false);
        expect(analyzedBill.value.analysis.group).toBe('Bills');
        expect(analyzedBill.value.analysis.priority).toBe('Important');
        expect(analyzedBill.value.analysis.detectedEvent?.category).toBe(
          'Bills & Errands'
        );
      }

      // Dinner email through analyze() -> Family / Social / detectedEvent.category === 'Family & Social'
      const analyzedDinner = await analyze(
        {
          id: 'email-dinner-1',
          source: 'email',
          text: 'Family dinner with Sarah on 2026-11-25 at 19:00.',
          attachments: [],
          receivedAt: '2026-11-22T08:05:00.000Z',
        },
        settingsWithBills,
        { vault, fetchFn: proxyFetch }
      );
      expect(analyzedDinner.ok).toBe(true);
      if (analyzedDinner.ok) {
        expect(analyzedDinner.value.usedFallback).toBe(false);
        expect(analyzedDinner.value.analysis.group).toBe('Family');
        expect(analyzedDinner.value.analysis.priority).toBe('Social');
        expect(analyzedDinner.value.analysis.detectedEvent?.category).toBe(
          'Family & Social'
        );
      }

      // processEmailBatch preserves custom category and detectedEvent.category in vault
      const emailVault = createVault({
        dbName: `test_task4_email_cats_${Date.now()}`,
      });
      const emailSettings: Settings = {
        ...settingsWithBills,
        channels: { ...settingsWithBills.channels, email: true },
      };
      await emailVault.saveSettings(emailSettings);
      const batchRes = await processEmailBatch({
        settings: emailSettings,
        vault: emailVault,
        fetchDecideFn: proxyFetch,
        emails: [
          {
            id: 'em-bill-99',
            from: 'billing@tnb.example',
            subject: 'TNB Electric Bill',
            body: 'TNB electric bill due on 2026-11-28 at 10:00.',
            receivedAt: '2026-11-22T08:10:00.000Z',
          },
        ],
      });
      expect(batchRes.processed).toHaveLength(1);
      expect(batchRes.processed[0].group).toBe('Bills');
      expect(batchRes.processed[0].priority).toBe('Important');
      expect(batchRes.processed[0].detectedEvent?.category).toBe(
        'Bills & Errands'
      );
    });
  });

  describe('4. CalendarPage smart category inference, Auto-Pick with AI, Turn On AI Scanning, & a11y/copy invariants', () => {
    it('manual add form infers Family & Social when typing "Dinner with Ali" (does NOT hardcode Medical)', () => {
      const harness = createHookHarness();
      const props = {
        initialSettings: {
          ...createDefaultSettings(),
          allowAiReading: false,
        },
        initialEvents: [],
        initialInboxItems: [],
        initialToday: '2026-11-22',
      };

      // Open Add Event form
      const tree1 = harness.render(() => CalendarPage(props));
      const addBtn = findElements(
        tree1,
        (el) =>
          typeof el.props.onClick === 'function' &&
          el.props.children === 'Add Event'
      )[0];
      expect(addBtn).toBeDefined();
      (addBtn.props.onClick as () => void)();

      // Default category on freshly opened form must NOT be 'Medical'
      const tree2 = harness.render(() => CalendarPage(props));
      const catSelectInitial = findElements(
        tree2,
        (el) => el.type === 'select' && el.props.id === 'cal-category'
      )[0];
      expect(catSelectInitial).toBeDefined();
      expect(catSelectInitial.props.value).not.toBe('Medical');

      // Type "Dinner with Ali" into #cal-title -> auto-infers 'Family & Social'
      const titleInput = findElements(
        tree2,
        (el) => el.type === 'input' && el.props.id === 'cal-title'
      )[0];
      expect(titleInput).toBeDefined();
      (
        titleInput.props.onChange as (e: { target: { value: string } }) => void
      )({ target: { value: 'Dinner with Ali' } });

      const tree3 = harness.render(() => CalendarPage(props));
      const catSelectDinner = findElements(
        tree3,
        (el) => el.type === 'select' && el.props.id === 'cal-category'
      )[0];
      expect(catSelectDinner.props.value).toBe('Family & Social');

      // Clicking "Turn On AI Scanning" persists allowAiReading: true to vault
      const calVault = createVault({
        dbName: `test_task4_cal_turn_on_ai_${Date.now()}`,
      });
      const turnOnProps = {
        ...props,
        initialFormOpen: true,
        vault: calVault,
      };
      const harness2 = createHookHarness();
      const treeOff = harness2.render(() => CalendarPage(turnOnProps));
      const turnOnBtn = findElements(
        treeOff,
        (el) =>
          typeof el.props.onClick === 'function' &&
          el.props.children === 'Turn On AI Scanning'
      )[0];
      expect(turnOnBtn).toBeDefined();
      (turnOnBtn.props.onClick as () => void)();
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          calVault
            .getSettings()
            .then((saved) => {
              expect(saved.ok).toBe(true);
              if (saved.ok) {
                expect(saved.value.allowAiReading).toBe(true);
              }
              resolve();
            })
            .catch(reject);
        }, 25);
      });
    });

    it('autoPickCalendarCategory respects consent gate (0 fetch when OFF), Property 7 audit-before-read when ON, and uses /api/calendar-plan', async () => {
      // 1. AI OFF -> uses inferCalendarCategory with 0 fetch and 0 audit writes
      const { vault: offVault, entries: offEntries } = makeMockAuditVault();
      const offFetch = vi.fn<typeof fetch>();
      const offRes = await autoPickCalendarCategory({
        title: 'Dinner with Sarah',
        date: '2026-11-25',
        time: '19:00',
        todayIso: '2026-11-22',
        settings: { ...createDefaultSettings(), allowAiReading: false },
        vault: offVault,
        fetchFn: offFetch,
      });
      expect(offRes.ok).toBe(true);
      if (offRes.ok) {
        expect(offRes.category).toBe('Family & Social');
        expect(offRes.checkedBy).toBe('device');
      }
      expect(offFetch).not.toHaveBeenCalled();
      expect(offEntries).toHaveLength(0);

      // 2. AI ON + audit failure -> Property 7 aborts with 0 fetches
      const { vault: failVault } = makeMockAuditVault({ failAudit: true });
      const failFetch = vi.fn<typeof fetch>();
      const failRes = await autoPickCalendarCategory({
        title: 'Anniversary meal',
        date: '2026-11-25',
        time: '19:00',
        todayIso: '2026-11-22',
        settings: { ...createDefaultSettings(), allowAiReading: true },
        vault: failVault,
        fetchFn: failFetch,
      });
      expect(failRes.ok).toBe(false);
      expect(failFetch).not.toHaveBeenCalled();

      // 3. AI ON -> writes audit BEFORE calling /api/calendar-plan and returns AI category
      const order: string[] = [];
      const { vault: onVault } = makeMockAuditVault({
        onAudit: () => order.push('audit'),
      });
      const onFetch = vi.fn<typeof fetch>(async (input) => {
        order.push(`fetch:${String(input)}`);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                id: 'ai-1',
                title: 'Anniversary meal',
                date: '2026-11-25',
                time: '19:00',
                category: 'Family & Social',
                confidence: 0.94,
              },
            ],
            source: 'ai',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const onRes = await autoPickCalendarCategory({
        title: 'Anniversary meal',
        date: '2026-11-25',
        time: '19:00',
        todayIso: '2026-11-22',
        settings: { ...createDefaultSettings(), allowAiReading: true },
        vault: onVault,
        fetchFn: onFetch,
      });
      expect(onRes.ok).toBe(true);
      if (onRes.ok) {
        expect(onRes.category).toBe('Family & Social');
        expect(onRes.checkedBy).toBe('ai');
      }
      expect(order).toEqual(['audit', 'fetch:/api/calendar-plan']);
    });

    it('renders CalendarPage SSR safely with Auto-Pick Category with AI, Turn On AI Scanning when OFF, min-h-[56px] buttons, dual-modality badges, and zero banned jargon', () => {
      const htmlOff = renderToStaticMarkup(
        React.createElement(CalendarPage, {
          initialSettings: {
            ...createDefaultSettings(),
            allowAiReading: false,
          },
          initialEvents: [],
          initialInboxItems: [],
          initialToday: '2026-11-22',
          initialFormOpen: true,
        })
      );

      expect(htmlOff).toContain('Auto-Pick Category with AI');
      expect(htmlOff).toContain('Turn On AI Scanning');

      const buttons = extractButtonTags(htmlOff);
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(btn).toContain('min-h-[56px]');
        expect(stripHtml(btn).length).toBeGreaterThan(0);
      }

      for (const badge of extractBadges(htmlOff)) {
        expect(badge).toContain('aria-hidden="true"');
        expect(stripHtml(badge).length).toBeGreaterThan(0);
      }

      expect(stripHtml(htmlOff)).not.toMatch(BANNED_JARGON);

      const htmlOn = renderToStaticMarkup(
        React.createElement(CalendarPage, {
          initialSettings: {
            ...createDefaultSettings(),
            allowAiReading: true,
          },
          initialEvents: [],
          initialInboxItems: [],
          initialToday: '2026-11-22',
          initialFormOpen: true,
        })
      );
      expect(htmlOn).toContain('Auto-Pick Category with AI');
      expect(htmlOn).not.toContain('Turn On AI Scanning');
      expect(stripHtml(htmlOn)).not.toMatch(BANNED_JARGON);
    });
  });
});
