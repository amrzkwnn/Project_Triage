import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  createGeminiAiProvider,
} from '@/lib/server/geminiProvider';
import {
  createDecidePostHandler,
  type DecideOutput,
} from '@/lib/server/handlers';
import { TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { createSafeLogger } from '@/lib/server/safeLog';
import {
  getServerRuntime,
  resetServerRuntime,
} from '@/lib/server/runtime';

function getEnv(): Record<string, string | undefined> {
  return (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env ?? {};
}

describe('Task 3: Live Google Gemini API Provider', () => {
  const originalGeminiModel = getEnv().GEMINI_MODEL;

  afterEach(() => {
    if (originalGeminiModel === undefined) {
      delete getEnv().GEMINI_MODEL;
    } else {
      getEnv().GEMINI_MODEL = originalGeminiModel;
    }
    resetServerRuntime();
  });

  it('calls Gemini generateContent with x-goog-api-key header, JSON schema config, and parses DecideOutput', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const expectedOutput: DecideOutput = {
      summary: {
        fromApp: 'Email',
        whoSent: 'City Clinic',
        actionNeeded: 'Confirm your Tuesday appointment',
        text: 'City Clinic sent a reminder about your checkup on Tuesday at 10:00 AM.',
      },
      group: 'Personal',
      priority: 'Important',
      confidence: 0.94,
    };

    const mockFetch: typeof fetch = vi.fn(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(expectedOutput) }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const provider = createGeminiAiProvider({ fetchFn: mockFetch });
    const result = await provider(
      {
        channel: 'email',
        text: 'City Clinic appointment reminder on Tuesday at 10:00 AM.',
      },
      'test-gemini-key'
    );

    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect(calls[0].url).not.toContain('test-gemini-key');
    expect(calls[0].init?.method).toBe('POST');

    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('x-goog-api-key')).toBe('test-gemini-key');
    expect(headers.get('content-type')).toBe('application/json');

    const body = JSON.parse(String(calls[0].init?.body)) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: {
        responseMimeType: string;
        responseSchema?: Record<string, unknown>;
      };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeDefined();
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toContain('plain');
    expect(body.contents[0].parts[0].text).toContain('City Clinic');

    expect(result).toEqual(expectedOutput);
  });

  it('respects custom model option and dynamic GEMINI_MODEL env override', async () => {
    const urls: string[] = [];
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: {
                        fromApp: 'Text Message',
                        whoSent: 'Maya',
                        actionNeeded: 'Reply when free',
                        text: 'Maya asked if you want to have tea tomorrow.',
                      },
                      group: 'Family',
                      priority: 'Social',
                      confidence: 0.88,
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

    const customProvider = createGeminiAiProvider({
      fetchFn: mockFetch,
      model: 'gemini-2.5-flash-lite',
    });
    await customProvider(
      { channel: 'smsPaste', text: 'Want tea tomorrow?' },
      'test-gemini-key'
    );

    expect(urls[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'
    );

    const dynamicProvider = createGeminiAiProvider({ fetchFn: mockFetch });
    getEnv().GEMINI_MODEL = 'gemini-2.5-pro';
    await dynamicProvider(
      { channel: 'smsPaste', text: 'Want tea tomorrow?' },
      'test-gemini-key'
    );

    expect(urls[1]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
    );
  });

  it('returns empty object without throwing on HTTP 500, invalid JSON, or network failure and falls back cleanly in /api/decide without leaking the key', async () => {
    const failureFetches: Array<{ name: string; fetchFn: typeof fetch }> = [
      {
        name: 'http-500',
        fetchFn: vi.fn(
          async () =>
            new Response('Internal error for test-gemini-key', { status: 500 })
        ),
      },
      {
        name: 'invalid-json',
        fetchFn: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [
                  { content: { parts: [{ text: 'not valid json {' }] } },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      },
      {
        name: 'rejected-fetch',
        fetchFn: vi.fn(async () => {
          throw new Error('Network failure test-gemini-key');
        }),
      },
    ];

    for (const scenario of failureFetches) {
      const provider = createGeminiAiProvider({ fetchFn: scenario.fetchFn });
      const rawResult = await provider(
        {
          channel: 'email',
          text: 'City Clinic appointment reminder on 2026-07-20 at 09:30.',
        },
        'test-gemini-key'
      );
      expect(rawResult, scenario.name).toEqual({});

      const logs: string[] = [];
      const logger = createSafeLogger((line) => {
        logs.push(line);
      });
      const handler = createDecidePostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger,
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'test-gemini-key' },
        aiProvider: provider,
      });

      const res = await handler(
        new Request('http://localhost:5173/api/decide', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer dev-senior-token-1',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'City Clinic appointment reminder on 2026-07-20 at 09:30.',
            },
          }),
        })
      );

      expect(res.status, scenario.name).toBe(200);
      const bodyText = await res.text();
      expect(bodyText, scenario.name).not.toContain('test-gemini-key');
      const parsed = JSON.parse(bodyText) as DecideOutput;
      expect(parsed.group, scenario.name).toBe('Personal');
      expect(parsed.priority, scenario.name).toBe('Important');
      expect(parsed.summary.fromApp, scenario.name).toBe('From Email');
      for (const line of logs) {
        expect(line, scenario.name).not.toContain('test-gemini-key');
      }
    }
  });

  it('wires default aiProvider in resetServerRuntime() / getServerRuntime()', () => {
    resetServerRuntime();
    const rt = getServerRuntime();
    expect(rt.aiProvider).toBeDefined();
    expect(typeof rt.aiProvider).toBe('function');
  });
});
