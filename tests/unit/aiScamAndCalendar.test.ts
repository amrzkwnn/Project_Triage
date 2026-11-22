import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSettings,
  type AuditEntry,
  type CalendarEvent,
  type InboxItem,
  type Result,
  type Settings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import { TokenRegistry, DEFAULT_DEV_TOKEN } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { ALLOWED_LOG_ROUTES, createSafeLogger } from '@/lib/server/safeLog';
import {
  DEFAULT_GEMINI_MODEL,
  createGeminiAiProvider,
  createGeminiCalendarPlanner,
  createGeminiScamChecker,
  didGeminiPlannerFail,
  isDefaultGeminiCalendarPlanner,
  isDefaultGeminiScamChecker,
} from '@/lib/server/geminiProvider';
import {
  createCalendarPlanPostHandler,
  createDecidePostHandler,
  createScamCheckPostHandler,
  type DecideOutput,
} from '@/lib/server/handlers';
import {
  getServerRuntime,
  resetServerRuntime,
  type ServerRuntime,
} from '@/lib/server/runtime';
import { dispatchApiRequest } from '@/lib/server/viteApiPlugin';
import { analyze } from '@/lib/ai/engine';
import { autoPlanCalendarFromItems } from '@/lib/calendar/aiPlanClient';
import type { Candidate } from '@/lib/calendar/ocr';
import { checkMessageWithAi } from '@/lib/scam/aiScamClient';
import type { ScamCheckOutput } from '@/lib/scam/verdict';
import { CalendarPage } from '@/app/calendar/page';
import { ScamShieldPage } from '@/app/scam-shield/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function getProcessEnv(): Record<string, string | undefined> {
  return (
    (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env ?? {}
  );
}

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

function makeMockVault(options?: {
  failAudit?: boolean;
  onAudit?: (entry: AuditEntry) => void;
}): {
  vault: Pick<Vault, 'appendAudit'>;
  entries: AuditEntry[];
} {
  const entries: AuditEntry[] = [];
  const vault: Pick<Vault, 'appendAudit'> = {
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
  };
  return { vault, entries };
}

describe('Task 3: AI-Powered Scam Checking & Enriched /api/decide', () => {
  const originalGeminiModel = getProcessEnv().GEMINI_MODEL;

  afterEach(() => {
    if (originalGeminiModel === undefined) {
      delete getProcessEnv().GEMINI_MODEL;
    } else {
      getProcessEnv().GEMINI_MODEL = originalGeminiModel;
    }
    resetServerRuntime();
  });

  describe('createGeminiScamChecker & safeLog routes', () => {
    it('whitelists /api/scam-check and /api/calendar-plan in ALLOWED_LOG_ROUTES', () => {
      expect(ALLOWED_LOG_ROUTES.has('/api/scam-check')).toBe(true);
      expect(ALLOWED_LOG_ROUTES.has('/api/calendar-plan')).toBe(true);
    });

    it('calls Gemini generateContent with x-goog-api-key header, JSON mime type, and parses structured scam output', async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const expected: ScamCheckOutput = {
        value: 'danger',
        flags: ['urgency', 'payment'],
        reasons: [
          'The sender is pretending to be a family member in trouble and asking for money.',
        ],
        instruction: 'Do not click or pay',
        showAskFamily: true,
      };

      const mockFetch: typeof fetch = vi.fn(async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(expected) }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const defaultChecker = createGeminiScamChecker();
      expect(isDefaultGeminiScamChecker(defaultChecker)).toBe(true);

      const checker = createGeminiScamChecker({ fetchFn: mockFetch });
      expect(isDefaultGeminiScamChecker(checker)).toBe(false);

      const result = await checker(
        'Hi Grandma, my phone broke and I need help covering a bill from this new number.',
        'secret-scam-key-123'
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
      );
      expect(calls[0].url).not.toContain('secret-scam-key-123');

      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get('x-goog-api-key')).toBe('secret-scam-key-123');
      expect(headers.get('content-type')).toBe('application/json');

      const body = JSON.parse(String(calls[0].init?.body)) as {
        generationConfig: {
          responseMimeType: string;
          responseSchema?: Record<string, unknown>;
        };
      };
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toBeDefined();

      expect(result).toEqual(expected);
    });

    it('returns empty object without throwing on HTTP 500, invalid JSON, or network error', async () => {
      const http500 = createGeminiScamChecker({
        fetchFn: vi.fn(
          async () => new Response('Server error secret-key', { status: 500 })
        ),
      });
      expect(await http500('Check this message', 'secret-key')).toEqual({});

      const badJson = createGeminiScamChecker({
        fetchFn: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: '{not-json' }] } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      });
      expect(await badJson('Check this message', 'secret-key')).toEqual({});

      const networkErr = createGeminiScamChecker({
        fetchFn: vi.fn(async () => {
          throw new Error('Network failure');
        }),
      });
      expect(await networkErr('Check this message', 'secret-key')).toEqual({});

      // Dynamic GEMINI_MODEL env override
      const urls: string[] = [];
      const envOverrideChecker = createGeminiScamChecker({
        fetchFn: vi.fn(async (input) => {
          urls.push(String(input));
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{}' }] } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }),
      });
      getProcessEnv().GEMINI_MODEL = 'gemini-2.5-pro';
      await envOverrideChecker('Check override', 'secret-key');
      expect(urls[0]).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
      );
    });
  });

  describe('POST /api/scam-check handler & viteApiPlugin dispatch', () => {
    it('enforces 401 auth gate and 5000 character max validation', async () => {
      const logs: string[] = [];
      const handler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
      });

      const unauth = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Hello' }),
        })
      );
      expect(unauth.status).toBe(401);

      const tooLong = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ text: 'a'.repeat(5_001) }),
        })
      );
      expect(tooLong.status).toBe(400);

      const emptyText = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ text: '   ' }),
        })
      );
      expect(emptyText.status).toBe(400);

      for (const line of logs) {
        expect(line).toMatch(/^route=\/api\/scam-check status=\d+ durationMs=\d+$/);
      }
    });

    it('upgrades subtle scam detected by Gemini with source: ai without leaking key', async () => {
      const logs: string[] = [];
      let receivedKey = '';
      const handler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'SUPER_SECRET_SCAM_KEY_999' },
        scamChecker: async (_text, apiKey) => {
          receivedKey = apiKey;
          return {
            value: 'danger',
            flags: ['urgency'],
            reasons: [
              'This looks like a fake relative asking for help from a new number.',
            ],
            instruction: 'Do not click or pay',
            showAskFamily: true,
          };
        },
      });

      const res = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: 'Hi Mum, this is my new number. My wallet was lost and I need a favor today.',
          }),
        })
      );

      expect(res.status).toBe(200);
      expect(receivedKey).toBe('SUPER_SECRET_SCAM_KEY_999');
      const raw = await res.text();
      expect(raw).not.toContain('SUPER_SECRET_SCAM_KEY_999');

      const body = JSON.parse(raw) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(body.source).toBe('ai');
      expect(body.value).toBe('danger');
      expect(body.showAskFamily).toBe(true);
      expect(body.reasons[0]).toContain('fake relative');

      for (const line of logs) {
        expect(line).not.toContain('SUPER_SECRET_SCAM_KEY_999');
      }
    });

    it('NEVER downgrades a deterministic danger verdict to safe even if AI returns safe', async () => {
      const handler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'KEY_NO_DOWNGRADE' },
        scamChecker: async () => ({
          value: 'safe',
          flags: [],
          reasons: ['Looks totally fine.'],
          showAskFamily: false,
        }),
      });

      const res = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: 'URGENT: Send gift cards right now and do not tell family!',
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(body.value).toBe('danger');
      expect(body.showAskFamily).toBe(true);
      expect(body.flags).toContain('urgency');
      expect(body.flags).toContain('payment');
    });

    it('falls back to deterministic checkText with source: device on AI error without leaking key', async () => {
      const logs: string[] = [];
      const handler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'LEAK_TEST_KEY_42' },
        scamChecker: async () => {
          throw new Error('Provider exploded with LEAK_TEST_KEY_42');
        },
      });

      const res = await handler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: 'URGENT: Your card blocked, pay now!',
          }),
        })
      );

      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain('LEAK_TEST_KEY_42');
      const body = JSON.parse(raw) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(body.source).toBe('device');
      expect(body.value).toBe('danger');
      for (const line of logs) {
        expect(line).not.toContain('LEAK_TEST_KEY_42');
      }
    });

    it('mounts POST /api/scam-check in viteApiPlugin dispatchApiRequest and wires scamChecker in default runtime', async () => {
      resetServerRuntime();
      const defaultRt = getServerRuntime();
      expect(typeof defaultRt.scamChecker).toBe('function');

      const rt: ServerRuntime = {
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        relay: new EncryptedRelayStore(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'VITE_PLUGIN_SCAM_KEY' },
        scamChecker: async (_text, apiKey) => {
          expect(apiKey).toBe('VITE_PLUGIN_SCAM_KEY');
          return {
            value: 'caution',
            flags: ['urgency'],
            reasons: ['Verify this request directly before responding.'],
            instruction:
              'Hang up and call back using a number saved in your contacts',
            showAskFamily: false,
          };
        },
      };

      const wrongMethod = await dispatchApiRequest(
        new Request('http://localhost:5173/api/scam-check', { method: 'GET' }),
        rt
      );
      expect(wrongMethod).not.toBeNull();
      expect(wrongMethod!.status).toBe(405);

      const okRes = await dispatchApiRequest(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ text: 'Please verify your account details.' }),
        }),
        rt
      );
      expect(okRes).not.toBeNull();
      expect(okRes!.status).toBe(200);
      const parsed = (await okRes!.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(parsed.source).toBe('ai');
      expect(parsed.value).toBe('caution');
    });
  });

  describe('checkMessageWithAi client (Property 7 consent & audit-before-read)', () => {
    it('makes ZERO fetch calls and writes ZERO audit entries when allowAiReading is false', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const { vault, entries } = makeMockVault();
      const fetchFn = vi.fn<typeof fetch>();

      const res = await checkMessageWithAi({
        text: 'Hello, see you at lunch tomorrow.',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.checkedBy).toBe('device');
        expect(res.verdict.value).toBe('safe');
      }
      expect(fetchFn).not.toHaveBeenCalled();
      expect(entries).toHaveLength(0);
    });

    it('writes an ai-read audit entry BEFORE calling /api/scam-check when allowAiReading is true', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const order: string[] = [];
      const { vault, entries } = makeMockVault({
        onAudit: () => order.push('audit'),
      });
      const fetchFn = vi.fn<typeof fetch>(async (input) => {
        order.push(`fetch:${String(input)}`);
        return new Response(
          JSON.stringify({
            value: 'danger',
            flags: ['urgency'],
            reasons: ['Subtle impersonation scam detected.'],
            instruction: 'Do not click or pay',
            showAskFamily: true,
            source: 'ai',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await checkMessageWithAi({
        text: 'Hi Mum, I lost my phone and need help today.',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.checkedBy).toBe('ai');
        expect(res.verdict.value).toBe('danger');
      }
      expect(order).toEqual(['audit', 'fetch:/api/scam-check']);
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('ai-read');
    });

    it('aborts with zero fetch calls if audit write fails', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const { vault, entries } = makeMockVault({ failAudit: true });
      const fetchFn = vi.fn<typeof fetch>();

      const res = await checkMessageWithAi({
        text: 'Check this message please.',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message.length).toBeGreaterThan(0);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFn).not.toHaveBeenCalled();
      expect(entries).toHaveLength(0);
    });

    it('aborts with zero fetch calls when allowAiReading is true and vault is undefined (Property 7)', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const fetchFn = vi.fn<typeof fetch>();

      const res = await checkMessageWithAi({
        text: 'Check this message without a vault.',
        settings,
        vault: undefined,
        fetchFn,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message.length).toBeGreaterThan(0);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('falls back to on-device verdict on HTTP 500 and never downgrades deterministic danger client-side', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const { vault: vault1 } = makeMockVault();
      const http500Res = await checkMessageWithAi({
        text: 'URGENT: Send gift cards right now and do not tell family!',
        settings,
        vault: vault1,
        fetchFn: vi.fn(async () => new Response('Server error', { status: 500 })),
      });
      expect(http500Res.ok).toBe(true);
      if (http500Res.ok) {
        expect(http500Res.checkedBy).toBe('device');
        expect(http500Res.verdict.value).toBe('danger');
        expect(http500Res.notice).toBeDefined();
        expect(http500Res.notice!).not.toMatch(BANNED_JARGON);
      }

      const { vault: vault2 } = makeMockVault();
      const downgradeRes = await checkMessageWithAi({
        text: 'URGENT: Send gift cards right now and do not tell family!',
        settings,
        vault: vault2,
        fetchFn: vi.fn(async () =>
          new Response(
            JSON.stringify({
              value: 'safe',
              flags: [],
              reasons: ['Spoofed safe verdict.'],
              showAskFamily: false,
              source: 'ai',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });
      expect(downgradeRes.ok).toBe(true);
      if (downgradeRes.ok) {
        expect(downgradeRes.verdict.value).toBe('danger');
        expect(downgradeRes.checkedBy).toBe('device');
      }
    });
  });

  describe('Enriched /api/decide & analyze() merge', () => {
    it('merges AI scamWarning (respecting no-downgrade) and valid AI detectedEvent (adding forwardToCalendar proposal)', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };

      // 1. Subtle scam + natural-language event returned by /api/decide
      const { vault: vault1 } = makeMockVault();
      const fetchEnriched = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            summary: {
              fromApp: 'Email',
              whoSent: 'Neighborhood Clinic',
              actionNeeded: 'Add appointment to calendar and verify sender',
              text: 'Your checkup is scheduled for tomorrow at 10 AM.',
            },
            group: 'Personal',
            priority: 'Important',
            confidence: 0.91,
            scamWarning: {
              value: 'caution',
              flags: ['urgency'],
              reasons: ['Verify this message directly with the clinic.'],
            },
            detectedEvent: {
              date: '2026-11-23',
              time: '10:00',
              title: 'Neighborhood Clinic Checkup',
              location: 'Room 2A',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res1 = await analyze(
        {
          id: 'item-ai-1',
          source: 'email',
          text: 'Reminder: checkup tomorrow at 10am at Room 2A.',
          attachments: [],
          receivedAt: '2026-11-22T08:00:00.000Z',
        },
        settings,
        { vault: vault1, fetchFn: fetchEnriched }
      );

      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value.usedFallback).toBe(false);
        expect(res1.value.analysis.scamWarning).toBe(true);
        expect(res1.value.analysis.verdict?.value).toBe('caution');
        expect(res1.value.analysis.detectedEvent).toEqual({
          date: '2026-11-23',
          time: '10:00',
          title: 'Neighborhood Clinic Checkup',
          location: 'Room 2A',
        });
        const calProposals = res1.value.analysis.proposals.filter(
          (p) => p.kind === 'forwardToCalendar'
        );
        expect(calProposals).toHaveLength(1);
        expect(calProposals[0].event?.date).toBe('2026-11-23');
        const scamProposals = res1.value.analysis.proposals.filter(
          (p) => p.kind === 'checkScam'
        );
        expect(scamProposals).toHaveLength(1);
      }

      // 2. Safety monotonicity: deterministic danger MUST NOT be downgraded by AI scamWarning: safe
      const { vault: vault2 } = makeMockVault();
      const fetchDowngrade = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            group: 'Others',
            priority: 'Important',
            confidence: 0.9,
            scamWarning: {
              value: 'safe',
              flags: [],
              reasons: ['No problem found.'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res2 = await analyze(
        {
          id: 'item-ai-2',
          source: 'smsPaste',
          text: 'URGENT: Pay RM500 right now at https://bad.example!',
          attachments: [],
          receivedAt: '2026-11-22T08:00:00.000Z',
        },
        settings,
        { vault: vault2, fetchFn: fetchDowngrade }
      );

      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.analysis.verdict?.value).toBe('danger');
        expect(res2.value.tier).toBe(3);
      }

      // 3. Server /api/decide sanitizes detectedEvent & enforces no-downgrade on scamWarning
      const decideHandler = createDecidePostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'DECIDE_KEY_123' },
        aiProvider: async () =>
          ({
            summary: {
              fromApp: 'Email',
              whoSent: 'Unknown',
              actionNeeded: 'Be careful',
              text: 'Urgent payment request.',
            },
            group: 'Others',
            priority: 'Important',
            confidence: 0.9,
            scamWarning: {
              value: 'safe',
              flags: [],
              reasons: ['Wrongly marked safe.'],
            },
            detectedEvent: {
              date: '2026-02-31', // invalid calendar date -> must be rejected
              time: '25:99',
              title: 'Invalid Event',
            },
          }) as DecideOutput,
      });

      const decideRes = await decideHandler(
        new Request('http://localhost:5173/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'URGENT: Send gift cards right now and do not tell family!',
            },
          }),
        })
      );
      expect(decideRes.status).toBe(200);
      const decideJson = (await decideRes.json()) as DecideOutput;
      expect(decideJson.scamWarning?.value).toBe('danger');
      expect(decideJson.detectedEvent).toBeUndefined();

      // 4. createGeminiAiProvider prompt includes today's ISO date and optional schema fields
      const capturedBodies: string[] = [];
      const provider = createGeminiAiProvider({
        fetchFn: vi.fn(async (_url, init) => {
          capturedBodies.push(String(init?.body ?? ''));
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{}' }] } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }),
      });
      await provider({ channel: 'email', text: 'Lunch tomorrow at 12pm.' }, 'k');
      const reqBody = JSON.parse(capturedBodies[0]) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: {
          responseSchema: { properties: Record<string, unknown> };
        };
      };
      const todayIso = new Date().toISOString().slice(0, 10);
      expect(reqBody.contents[0].parts[0].text).toContain(todayIso);
      expect(reqBody.generationConfig.responseSchema.properties).toHaveProperty(
        'scamWarning'
      );
      expect(reqBody.generationConfig.responseSchema.properties).toHaveProperty(
        'detectedEvent'
      );
    });
  });

  describe('ScamShieldPage UI & a11y invariants', () => {
    it('renders Checked on This Device / Checked with AI Helper badges, calm AI tip when OFF, zero banned jargon, and min-h-[56px] buttons (SSR safe)', () => {
      const offSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const onSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };

      const deviceHtml = renderToStaticMarkup(
        React.createElement(ScamShieldPage, {
          initialSettings: offSettings,
          initialText:
            'URGENT: Send gift cards right now and do not tell family!',
        })
      );

      expect(deviceHtml).toContain('Checked on This Device');
      expect(deviceHtml).toMatch(/AI Reading|AI Helper/i);
      expect(stripHtml(deviceHtml)).not.toMatch(BANNED_JARGON);

      const aiHtml = renderToStaticMarkup(
        React.createElement(ScamShieldPage, {
          initialSettings: onSettings,
          initialText: 'Hi Mum, this is my new number.',
          initialVerdict: {
            value: 'danger',
            flags: ['urgency'],
            reasons: ['Likely impersonation scam.'],
            instruction: 'Do not click or pay',
            showAskFamily: true,
          },
          initialCheckedBy: 'ai',
        })
      );

      expect(aiHtml).toContain('Checked with AI Helper');
      expect(stripHtml(aiHtml)).not.toMatch(BANNED_JARGON);

      for (const html of [deviceHtml, aiHtml]) {
        const buttons = extractButtonTags(html);
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
          expect(btn).toContain('min-h-[56px]');
          expect(stripHtml(btn).length).toBeGreaterThan(0);
        }

        const badges = extractBadges(html);
        expect(badges.length).toBeGreaterThan(0);
        for (const badge of badges) {
          expect(badge).toContain('aria-hidden="true"');
          expect(badge).toContain('border-2');
          expect(stripHtml(badge).length).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe('Task 4: AI-Powered Calendar Automatic Planning (/api/calendar-plan & CalendarPage)', () => {
  const originalGeminiModel = getProcessEnv().GEMINI_MODEL;

  afterEach(() => {
    if (originalGeminiModel === undefined) {
      delete getProcessEnv().GEMINI_MODEL;
    } else {
      getProcessEnv().GEMINI_MODEL = originalGeminiModel;
    }
    resetServerRuntime();
  });

  describe('createGeminiCalendarPlanner', () => {
    it('calls Gemini generateContent with x-goog-api-key header, todayIso, JSON schema, and parses natural-language schedules', async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const mockFetch: typeof fetch = vi.fn(async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        candidates: [
                          {
                            title: 'Dentist Visit',
                            date: '2026-11-24',
                            time: '14:30',
                            location: 'Smile Clinic',
                            category: 'Medical',
                            confidence: 0.92,
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const defaultPlanner = createGeminiCalendarPlanner();
      expect(isDefaultGeminiCalendarPlanner(defaultPlanner)).toBe(true);

      const planner = createGeminiCalendarPlanner({ fetchFn: mockFetch });
      expect(isDefaultGeminiCalendarPlanner(planner)).toBe(false);

      const result = await planner(
        {
          items: [
            {
              id: 'msg-1',
              sender: 'Smile Clinic',
              text: 'Dentist next Tuesday at 2:30 PM at Smile Clinic',
              receivedAt: '2026-11-22T08:00:00.000Z',
            },
          ],
          todayIso: '2026-11-22',
        },
        'secret-calendar-key-123'
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
      );
      expect(calls[0].url).not.toContain('secret-calendar-key-123');

      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get('x-goog-api-key')).toBe('secret-calendar-key-123');
      expect(headers.get('content-type')).toBe('application/json');

      const body = JSON.parse(String(calls[0].init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: {
          responseMimeType: string;
          responseSchema?: Record<string, unknown>;
        };
      };
      expect(body.contents[0].parts[0].text).toContain('2026-11-22');
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toBeDefined();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        location: 'Smile Clinic',
        category: 'Medical',
        confidence: 0.92,
      });
    });

    it('returns [] without throwing on HTTP 500, invalid JSON, or network error, tags failures for didGeminiPlannerFail, and honors GEMINI_MODEL env override', async () => {
      const http500 = createGeminiCalendarPlanner({
        fetchFn: vi.fn(
          async () => new Response('Server error secret-key', { status: 500 })
        ),
      });
      const http500Res = await http500(
        { items: [{ text: 'Lunch tomorrow at noon' }], todayIso: '2026-11-22' },
        'secret-key'
      );
      expect(http500Res).toEqual([]);
      expect(didGeminiPlannerFail(http500Res)).toBe(true);

      const badJson = createGeminiCalendarPlanner({
        fetchFn: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: '{not-json' }] } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      });
      const badJsonRes = await badJson(
        { items: [{ text: 'Lunch tomorrow at noon' }], todayIso: '2026-11-22' },
        'secret-key'
      );
      expect(badJsonRes).toEqual([]);
      expect(didGeminiPlannerFail(badJsonRes)).toBe(true);

      const networkErr = createGeminiCalendarPlanner({
        fetchFn: vi.fn(async () => {
          throw new Error('Network failure');
        }),
      });
      const networkErrRes = await networkErr(
        { items: [{ text: 'Lunch tomorrow at noon' }], todayIso: '2026-11-22' },
        'secret-key'
      );
      expect(networkErrRes).toEqual([]);
      expect(didGeminiPlannerFail(networkErrRes)).toBe(true);

      const urls: string[] = [];
      const envOverridePlanner = createGeminiCalendarPlanner({
        fetchFn: vi.fn(async (input) => {
          urls.push(String(input));
          return new Response(
            JSON.stringify({
              candidates: [
                { content: { parts: [{ text: '{"candidates":[]}' }] } },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }),
      });
      getProcessEnv().GEMINI_MODEL = 'gemini-2.5-pro';
      const emptyValidRes = await envOverridePlanner(
        { items: [{ text: 'Checkup tomorrow at 9am' }], todayIso: '2026-11-22' },
        'secret-key'
      );
      expect(emptyValidRes).toEqual([]);
      expect(didGeminiPlannerFail(emptyValidRes)).toBe(false);
      expect(urls[0]).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
      );
    });
  });

  describe('POST /api/calendar-plan handler & viteApiPlugin dispatch', () => {
    it('enforces 401 auth, max 20 items, and valid todayIso validation', async () => {
      const logs: string[] = [];
      const handler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
      });

      const unauth = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{ text: 'Dentist on 2026-11-24 at 14:30' }],
            todayIso: '2026-11-22',
          }),
        })
      );
      expect(unauth.status).toBe(401);

      const tooMany = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: Array.from({ length: 21 }, (_, idx) => ({
              text: `Event ${idx + 1} on 2026-11-24`,
            })),
            todayIso: '2026-11-22',
          }),
        })
      );
      expect(tooMany.status).toBe(400);

      const badDate = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [{ text: 'Dentist next Tuesday' }],
            todayIso: '2026-02-31',
          }),
        })
      );
      expect(badDate.status).toBe(400);

      for (const line of logs) {
        expect(line).toMatch(
          /^route=\/api\/calendar-plan status=\d+ durationMs=\d+$/
        );
      }
    });

    it('drops invalid dates/times, clamps confidence to [0, 1], deduplicates, and never leaks GEMINI_API_KEY', async () => {
      const logs: string[] = [];
      let receivedKey = '';
      const handler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'SUPER_SECRET_CALENDAR_KEY_777' },
        calendarPlanner: async (_params, apiKey) => {
          receivedKey = apiKey;
          return [
            {
              id: 'ai-1',
              title: 'Dentist Visit',
              date: '2026-11-24',
              time: '14:30',
              location: 'Smile Clinic',
              category: 'Medical',
              confidence: 1.8, // must clamp to 1
            },
            {
              id: 'ai-dup',
              title: '  dentist   visit  ',
              date: '2026-11-24',
              time: '14:30',
              category: 'Medical',
              confidence: 0.8,
            },
            {
              id: 'ai-bad-date',
              title: 'Fake Date Event',
              date: '2026-02-31', // invalid date -> drop
              time: '10:00',
              category: 'Daily Routine',
              confidence: 0.9,
            },
            {
              id: 'ai-bad-time',
              title: 'Fake Time Event',
              date: '2026-11-25',
              time: '25:99', // invalid time -> drop
              category: 'Bills & Errands',
              confidence: 0.9,
            },
            {
              id: 'ai-low-conf',
              title: 'Family Dinner',
              date: '2026-11-26',
              category: 'Family & Social',
              confidence: -0.5, // must clamp to 0
            },
          ];
        },
      });

      const res = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [
              {
                id: 'in-1',
                text: 'Dentist next Tuesday at 2:30 PM at Smile Clinic. Also family dinner Thursday.',
              },
            ],
            todayIso: '2026-11-22',
          }),
        })
      );

      expect(res.status).toBe(200);
      expect(receivedKey).toBe('SUPER_SECRET_CALENDAR_KEY_777');
      const raw = await res.text();
      expect(raw).not.toContain('SUPER_SECRET_CALENDAR_KEY_777');

      const body = JSON.parse(raw) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(body.source).toBe('ai');
      expect(body.candidates).toHaveLength(2);
      expect(body.candidates[0]).toMatchObject({
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        location: 'Smile Clinic',
        category: 'Medical',
        confidence: 1,
      });
      expect(body.candidates[1]).toMatchObject({
        title: 'Family Dinner',
        date: '2026-11-26',
        category: 'Family & Social',
        confidence: 0,
      });

      for (const line of logs) {
        expect(line).not.toContain('SUPER_SECRET_CALENDAR_KEY_777');
      }
    });

    it('falls back to deterministic extraction with source: device on AI error without leaking key', async () => {
      const logs: string[] = [];
      const handler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'CAL_LEAK_GUARD_99' },
        calendarPlanner: async () => {
          throw new Error('Gemini blew up with CAL_LEAK_GUARD_99');
        },
      });

      const res = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [
              {
                text: '2026-11-24 14:30 Eye Clinic Checkup',
              },
            ],
            todayIso: '2026-11-22',
          }),
        })
      );

      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain('CAL_LEAK_GUARD_99');
      const body = JSON.parse(raw) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(body.source).toBe('device');
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]).toMatchObject({
        date: '2026-11-24',
        time: '14:30',
        category: 'Medical',
      });
      for (const line of logs) {
        expect(line).not.toContain('CAL_LEAK_GUARD_99');
      }
    });

    it('returns source: device (not ai) when Gemini fails silently on natural-language items with empty baseline, and source: ai on genuine empty AI response', async () => {
      const failingPlanner = createGeminiCalendarPlanner({
        fetchFn: vi.fn(async () => new Response('Upstream error', { status: 500 })),
      });
      const failingHandler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'KEY_SILENT_FAIL' },
        calendarPlanner: failingPlanner,
      });

      const failRes = await failingHandler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [{ text: 'Dentist next Tuesday at 2:30 PM at Smile Clinic' }],
            todayIso: '2026-11-22',
          }),
        })
      );
      expect(failRes.status).toBe(200);
      const failBody = (await failRes.json()) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(failBody.candidates).toEqual([]);
      expect(failBody.source).toBe('device');

      const emptySuccessPlanner = createGeminiCalendarPlanner({
        fetchFn: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [
                  { content: { parts: [{ text: '{"candidates":[]}' }] } },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      });
      const emptySuccessHandler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'KEY_EMPTY_OK' },
        calendarPlanner: emptySuccessPlanner,
      });

      const emptyRes = await emptySuccessHandler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [{ text: 'Just saying hello, hope you are well!' }],
            todayIso: '2026-11-22',
          }),
        })
      );
      expect(emptyRes.status).toBe(200);
      const emptyBody = (await emptyRes.json()) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(emptyBody.candidates).toEqual([]);
      expect(emptyBody.source).toBe('ai');
    });

    it('deduplicates same-slot AI and deterministic baseline candidates when one normalized title contains the other', async () => {
      const handler = createCalendarPlanPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'KEY_MERGE_DEDUP' },
        calendarPlanner: async () => [
          {
            id: 'ai-slot-1',
            title: 'Dentist Visit',
            date: '2026-11-24',
            time: '14:30',
            location: 'Smile Clinic',
            category: 'Medical',
            confidence: 0.95,
          },
        ],
      });

      const res = await handler(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [
              {
                text: '2026-11-24 14:30 Dentist Visit at Smile Clinic',
              },
            ],
            todayIso: '2026-11-22',
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(body.source).toBe('ai');
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]).toMatchObject({
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        location: 'Smile Clinic',
        category: 'Medical',
      });
    });

    it('wires calendarPlanner in default runtime and dispatches POST /api/calendar-plan in viteApiPlugin', async () => {
      resetServerRuntime();
      const defaultRt = getServerRuntime();
      expect(typeof defaultRt.calendarPlanner).toBe('function');

      const rt: ServerRuntime = {
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        relay: new EncryptedRelayStore(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'VITE_PLUGIN_CAL_KEY' },
        calendarPlanner: async (_params, apiKey) => {
          expect(apiKey).toBe('VITE_PLUGIN_CAL_KEY');
          return [
            {
              id: 'rt-1',
              title: 'Dr. Tan Checkup',
              date: '2026-11-26',
              time: '14:00',
              location: 'City Clinic',
              category: 'Medical',
              confidence: 0.91,
            },
          ];
        },
      };

      const wrongMethod = await dispatchApiRequest(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'GET',
        }),
        rt
      );
      expect(wrongMethod).not.toBeNull();
      expect(wrongMethod!.status).toBe(405);

      const okRes = await dispatchApiRequest(
        new Request('http://localhost:5173/api/calendar-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            items: [{ text: 'Dr. Tan next Thursday 2pm at City Clinic' }],
            todayIso: '2026-11-22',
          }),
        }),
        rt
      );
      expect(okRes).not.toBeNull();
      expect(okRes!.status).toBe(200);
      const parsed = (await okRes!.json()) as {
        candidates: Candidate[];
        source: 'ai' | 'device';
      };
      expect(parsed.source).toBe('ai');
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].title).toBe('Dr. Tan Checkup');
    });
  });

  describe('autoPlanCalendarFromItems client (Property 7 consent, audit-before-read, dedup)', () => {
    const existingEvents: CalendarEvent[] = [
      {
        id: 'ev-existing-1',
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        category: 'Medical',
        createdAt: '2026-11-20T08:00:00.000Z',
      },
    ];

    it('makes ZERO fetch calls and writes ZERO audit entries when allowAiReading is false, using deterministic extraction and deduplicating existingEvents', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const { vault, entries } = makeMockVault();
      const fetchFn = vi.fn<typeof fetch>();

      const res = await autoPlanCalendarFromItems({
        items: [
          { id: 'm1', text: '2026-11-24 14:30 Dentist Visit' },
          { id: 'm2', text: '2026-11-25 10:00 Family Lunch' },
        ],
        existingEvents,
        todayIso: '2026-11-22',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.checkedBy).toBe('device');
        expect(res.candidates).toHaveLength(1);
        expect(res.candidates[0]).toMatchObject({
          title: 'Family Lunch',
          date: '2026-11-25',
          time: '10:00',
          category: 'Family & Social',
        });
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFn).not.toHaveBeenCalled();
      expect(entries).toHaveLength(0);
    });

    it('writes ai-read audit BEFORE calling /api/calendar-plan when allowAiReading is true and deduplicates against existingEvents', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const order: string[] = [];
      const { vault, entries } = makeMockVault({
        onAudit: () => order.push('audit'),
      });
      const fetchFn = vi.fn<typeof fetch>(async (input) => {
        order.push(`fetch:${String(input)}`);
        return new Response(
          JSON.stringify({
            source: 'ai',
            candidates: [
              {
                id: 'ai-dup',
                title: 'Dentist Visit',
                date: '2026-11-24',
                time: '14:30',
                location: 'Smile Clinic',
                category: 'Medical',
                confidence: 0.95,
              },
              {
                id: 'ai-new',
                title: 'Dr. Tan Checkup',
                date: '2026-11-26',
                time: '14:00',
                location: 'City Clinic',
                category: 'Medical',
                confidence: 0.92,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const res = await autoPlanCalendarFromItems({
        items: [
          {
            id: 'm1',
            text: 'Dentist next Tuesday 2:30pm and Dr. Tan next Thursday 2pm at City Clinic.',
          },
        ],
        existingEvents,
        todayIso: '2026-11-22',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.checkedBy).toBe('ai');
        expect(res.candidates).toHaveLength(1);
        expect(res.candidates[0]).toMatchObject({
          title: 'Dr. Tan Checkup',
          date: '2026-11-26',
          time: '14:00',
          location: 'City Clinic',
          category: 'Medical',
        });
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(order).toEqual(['audit', 'fetch:/api/calendar-plan']);
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('ai-read');
    });

    it('aborts with ZERO fetch calls if appendAudit fails or vault is omitted when allowAiReading is true (Property 7)', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const { vault: failingVault, entries } = makeMockVault({
        failAudit: true,
      });
      const fetchFn1 = vi.fn<typeof fetch>();

      const failedAuditRes = await autoPlanCalendarFromItems({
        items: [{ id: 'm1', text: 'Dentist next Tuesday at 2:30 PM' }],
        existingEvents: [],
        todayIso: '2026-11-22',
        settings,
        vault: failingVault,
        fetchFn: fetchFn1,
      });

      expect(failedAuditRes.ok).toBe(false);
      if (!failedAuditRes.ok) {
        expect(failedAuditRes.message.length).toBeGreaterThan(0);
        expect(failedAuditRes.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFn1).not.toHaveBeenCalled();
      expect(entries).toHaveLength(0);

      const fetchFn2 = vi.fn<typeof fetch>();
      const missingVaultRes = await autoPlanCalendarFromItems({
        items: [{ id: 'm1', text: 'Dentist next Tuesday at 2:30 PM' }],
        existingEvents: [],
        todayIso: '2026-11-22',
        settings,
        vault: undefined,
        fetchFn: fetchFn2,
      });

      expect(missingVaultRes.ok).toBe(false);
      if (!missingVaultRes.ok) {
        expect(missingVaultRes.message.length).toBeGreaterThan(0);
        expect(missingVaultRes.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFn2).not.toHaveBeenCalled();
    });
  });

  describe('CalendarPage Automatic Plan UI & a11y invariants', () => {
    it('renders Automatic Plan from Messages & Emails card, Auto-Plan Calendar with AI button (min-h-[56px]), dual-modality badges, confirmation queue, and zero banned jargon (SSR safe)', () => {
      const offSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const onSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const sampleInbox: InboxItem[] = [
        {
          id: 'inbox-cal-1',
          source: 'email',
          sender: 'Smile Clinic',
          text: 'Dentist next Tuesday at 2:30 PM at Smile Clinic',
          attachments: [],
          receivedAt: '2026-11-22T08:00:00.000Z',
          group: 'Personal',
          priority: 'Important',
          tier: 2,
          confidence: 0.9,
          status: 'ok',
        },
      ];
      const queuedCandidate: Candidate = {
        id: 'cand-ai-1',
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        location: 'Smile Clinic',
        category: 'Medical',
        confidence: 0.92,
      };

      const offHtml = renderToStaticMarkup(
        React.createElement(CalendarPage, {
          initialSettings: offSettings,
          initialEvents: [],
          initialInboxItems: sampleInbox,
          initialToday: '2026-11-22',
          initialPlanSource: 'device',
          initialSnapCandidates: [queuedCandidate],
          initialQueueError:
            'Please enter a valid date in YYYY-MM-DD format before keeping.',
        })
      );

      expect(offHtml).toContain('Automatic Plan from Messages &amp; Emails');
      expect(offHtml).toContain('Auto-Plan Calendar with AI');
      expect(offHtml).toContain('Found on This Device');
      expect(offHtml).toContain('Keep on Calendar');
      expect(offHtml).toContain('Skip');
      expect(offHtml).toContain('Smile Clinic');
      expect(offHtml).toContain('Photo Access is OFF');
      expect(offHtml).toContain(
        'Please enter a valid date in YYYY-MM-DD format before keeping.'
      );
      expect(stripHtml(offHtml)).not.toMatch(BANNED_JARGON);

      const onHtml = renderToStaticMarkup(
        React.createElement(CalendarPage, {
          initialSettings: onSettings,
          initialEvents: [],
          initialInboxItems: sampleInbox,
          initialToday: '2026-11-22',
          initialPlanSource: 'ai',
          initialSnapCandidates: [queuedCandidate],
        })
      );

      expect(onHtml).toContain('Automatic Plan from Messages &amp; Emails');
      expect(onHtml).toContain('Auto-Plan Calendar with AI');
      expect(onHtml).toContain('Planned with AI Helper');
      expect(stripHtml(onHtml)).not.toMatch(BANNED_JARGON);

      for (const html of [offHtml, onHtml]) {
        const buttons = extractButtonTags(html);
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
          expect(btn).toContain('min-h-[56px]');
          expect(stripHtml(btn).length).toBeGreaterThan(0);
        }

        const badges = extractBadges(html);
        expect(badges.length).toBeGreaterThan(0);
        for (const badge of badges) {
          expect(badge).toContain('aria-hidden="true"');
          expect(badge).toContain('border-2');
          expect(stripHtml(badge).length).toBeGreaterThan(0);
        }
      }
    });
  });
});
