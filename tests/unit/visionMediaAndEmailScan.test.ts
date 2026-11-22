import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSettings,
  type AuditEntry,
  type InboxItem,
  type Result,
  type Settings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';
import { DEFAULT_DEV_TOKEN, TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { ALLOWED_LOG_ROUTES, createSafeLogger } from '@/lib/server/safeLog';
import {
  DEFAULT_GEMINI_MODEL,
  createGeminiMediaChecker,
  createGeminiScamChecker,
  isDefaultGeminiMediaChecker,
} from '@/lib/server/geminiProvider';
import {
  createMediaCheckPostHandler,
  createScamCheckPostHandler,
} from '@/lib/server/handlers';
import {
  getServerRuntime,
  resetServerRuntime,
  type ServerRuntime,
} from '@/lib/server/runtime';
import { dispatchApiRequest } from '@/lib/server/viteApiPlugin';
import { checkMediaWithAi } from '@/lib/media/aiMediaClient';
import { checkMessageWithAi } from '@/lib/scam/aiScamClient';
import type { ScamCheckOutput } from '@/lib/scam/verdict';
import { processEmailBatch } from '@/lib/inbox/emailChannel';
import { syncEmailsFromRelay } from '@/lib/inbox/emailClient';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { UnifiedInboxPage } from '@/app/inbox/page';

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
      depth += token[1] === '/' ? -1 : 1;
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

function encodeAsciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SAMPLE_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);
const SAMPLE_JPEG_BASE64 = bytesToBase64(SAMPLE_JPEG_BYTES);

describe('Task 3: Gemini Vision Image Detection, Screenshot Scam Check & Email Image Scanning', () => {
  const originalGeminiModel = getProcessEnv().GEMINI_MODEL;

  afterEach(() => {
    if (originalGeminiModel === undefined) {
      delete getProcessEnv().GEMINI_MODEL;
    } else {
      getProcessEnv().GEMINI_MODEL = originalGeminiModel;
    }
    resetServerRuntime();
  });

  describe('createGeminiMediaChecker & safeLog routes', () => {
    it('whitelists /api/media-check in ALLOWED_LOG_ROUTES', () => {
      expect(ALLOWED_LOG_ROUTES.has('/api/media-check')).toBe(true);
    });

    it('sends multimodal inlineData to Gemini with x-goog-api-key header, parses structured output, and strips 100% real claims', async () => {
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
                        result: 'AI signal found',
                        signalName: 'Warped hands and scrambled shop sign',
                        note: 'The fingers look uneven and background letters are scrambled. This is not 100% real.',
                        scamWarning: {
                          value: 'danger',
                          flags: ['urgency', 'payment'],
                          reasons: [
                            'The image asks for urgent bank transfer payment.',
                          ],
                        },
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

      const defaultChecker = createGeminiMediaChecker();
      expect(isDefaultGeminiMediaChecker(defaultChecker)).toBe(true);

      const checker = createGeminiMediaChecker({ fetchFn: mockFetch });
      expect(isDefaultGeminiMediaChecker(checker)).toBe(false);

      const res = await checker(
        {
          imageBase64: SAMPLE_JPEG_BASE64,
          mimeType: 'image/jpeg',
          fileName: 'promo-photo.jpg',
        },
        'VISION_SECRET_KEY_123'
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
      );
      expect(calls[0].url).not.toContain('VISION_SECRET_KEY_123');

      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get('x-goog-api-key')).toBe('VISION_SECRET_KEY_123');

      const body = JSON.parse(String(calls[0].init?.body)) as {
        contents: Array<{
          role: string;
          parts: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        }>;
        generationConfig: {
          responseMimeType: string;
          responseSchema?: Record<string, unknown>;
        };
      };

      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseSchema).toBeDefined();
      const inlinePart = body.contents[0].parts.find((p) => p.inlineData);
      expect(inlinePart?.inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: SAMPLE_JPEG_BASE64,
      });

      expect(res.result).toBe('AI signal found');
      expect(res.signalName).toContain('Warped hands');
      expect(res.note).toBeDefined();
      expect(res.note!).not.toMatch(/100%\s*real/i);
      expect(res.scamWarning?.value).toBe('danger');
    });

    it('validates and sanitizes parsed.scamWarning inside createGeminiMediaChecker (strips 100% real and drops malformed scamWarning)', async () => {
      // 1. Valid scamWarning with forbidden "100% real" in reasons + invalid flag
      const sanitizedChecker = createGeminiMediaChecker({
        fetchFn: vi.fn(async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          result: 'AI signal found',
                          note: 'Edited visual details found.',
                          scamWarning: {
                            value: 'danger',
                            flags: ['payment', 'invalid-flag', 'payment'],
                            reasons: [
                              'Fake transfer slip pretending to be 100% real.',
                            ],
                          },
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      const res1 = await sanitizedChecker(
        { imageBase64: SAMPLE_JPEG_BASE64, mimeType: 'image/jpeg' },
        'KEY_1'
      );
      expect(res1.scamWarning).toBeDefined();
      expect(res1.scamWarning!.flags).toEqual(['payment']);
      expect(res1.scamWarning!.reasons[0]).not.toMatch(/100%\s*real/i);

      // 2. Malformed scamWarning (invalid value / missing reasons) -> omitted completely
      const malformedChecker = createGeminiMediaChecker({
        fetchFn: vi.fn(async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          result: 'Cannot tell',
                          note: 'Cannot tell from this photo.',
                          scamWarning: {
                            value: 'bogus-verdict',
                            flags: ['urgency'],
                            reasons: [],
                          },
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        ),
      });

      const res2 = await malformedChecker(
        { imageBase64: SAMPLE_JPEG_BASE64, mimeType: 'image/jpeg' },
        'KEY_2'
      );
      expect(res2.result).toBe('Cannot tell');
      expect(res2.scamWarning).toBeUndefined();
    });

    it('returns empty object safely on HTTP 500, malformed JSON, or network error', async () => {
      const http500 = createGeminiMediaChecker({
        fetchFn: vi.fn(
          async () => new Response('Failure VISION_SECRET', { status: 500 })
        ),
      });
      expect(
        await http500(
          { imageBase64: SAMPLE_JPEG_BASE64, mimeType: 'image/jpeg' },
          'VISION_SECRET'
        )
      ).toEqual({});

      const badJson = createGeminiMediaChecker({
        fetchFn: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'not-json' }] } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      });
      expect(
        await badJson(
          { imageBase64: SAMPLE_JPEG_BASE64, mimeType: 'image/jpeg' },
          'VISION_SECRET'
        )
      ).toEqual({});

      const netErr = createGeminiMediaChecker({
        fetchFn: vi.fn(async () => {
          throw new Error('Offline');
        }),
      });
      expect(
        await netErr(
          { imageBase64: SAMPLE_JPEG_BASE64, mimeType: 'image/jpeg' },
          'VISION_SECRET'
        )
      ).toEqual({});
    });
  });

  describe('POST /api/media-check handler & viteApiPlugin dispatch', () => {
    it('enforces 401 auth gate and rejects unsupported MIME types', async () => {
      const logs: string[] = [];
      const handler = createMediaCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
      });

      const unauth = await handler(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: SAMPLE_JPEG_BASE64,
            mimeType: 'image/jpeg',
          }),
        })
      );
      expect(unauth.status).toBe(401);

      const badMime = await handler(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            imageBase64: SAMPLE_JPEG_BASE64,
            mimeType: 'application/pdf',
          }),
        })
      );
      expect(badMime.status).toBe(400);

      for (const line of logs) {
        expect(line).toMatch(
          /^route=\/api\/media-check status=\d+ durationMs=\d+$/
        );
      }
    });

    it('combines provenance + Gemini Vision result, strips 100% real, preserves AI provenance monotonicity, and never leaks key', async () => {
      const logs: string[] = [];
      const handler = createMediaCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger((line) => logs.push(line)),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'MEDIA_SECRET_KEY_888' },
        mediaChecker: async (_params, apiKey) => {
          expect(apiKey).toBe('MEDIA_SECRET_KEY_888');
          return {
            result: 'Cannot tell',
            note: 'This photo looks 100% real and clearly taken outdoors.',
            scamWarning: {
              value: 'caution',
              flags: ['urgency'],
              reasons: ['Banner text urges fast action before tonight.'],
            },
          };
        },
      });

      // 1. Plain JPEG without AI provenance -> AI result returned with "100% real" stripped
      const res1 = await handler(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            imageBase64: SAMPLE_JPEG_BASE64,
            mimeType: 'image/jpeg',
            fileName: 'outdoor.jpg',
          }),
        })
      );
      expect(res1.status).toBe(200);
      const raw1 = await res1.text();
      expect(raw1).not.toContain('MEDIA_SECRET_KEY_888');
      expect(raw1).not.toMatch(/100%\s*real/i);
      const parsed1 = JSON.parse(raw1) as {
        result: string;
        note: string;
        source: 'ai' | 'device';
        scamWarning?: { value: string };
      };
      expect(parsed1.source).toBe('ai');
      expect(parsed1.result).toBe('Cannot tell');
      expect(parsed1.scamWarning?.value).toBe('caution');

      // 2. Bytes containing Midjourney AI provenance -> NEVER downgraded by AI returning "Cannot tell"
      const aiMarkedBytes = encodeAsciiBytes('PNG Midjourney generated image');
      const res2 = await handler(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            imageBase64: bytesToBase64(aiMarkedBytes),
            mimeType: 'image/png',
          }),
        })
      );
      expect(res2.status).toBe(200);
      const parsed2 = (await res2.json()) as {
        result: string;
        signalName?: string;
        source: 'ai' | 'device';
      };
      expect(parsed2.result).toBe('AI signal found');

      // 3. Fallback to device when mediaChecker fails
      const failingHandler = createMediaCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        env: { GEMINI_API_KEY: 'FAIL_SECRET_999' },
        mediaChecker: async () => {
          throw new Error('Gemini crashed with FAIL_SECRET_999');
        },
      });
      const res3 = await failingHandler(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            imageBase64: SAMPLE_JPEG_BASE64,
            mimeType: 'image/jpeg',
          }),
        })
      );
      expect(res3.status).toBe(200);
      const raw3 = await res3.text();
      expect(raw3).not.toContain('FAIL_SECRET_999');
      const parsed3 = JSON.parse(raw3) as { source: string; result: string };
      expect(parsed3.source).toBe('device');
      expect(parsed3.result).toBe('Cannot tell');

      for (const line of logs) {
        expect(line).not.toContain('MEDIA_SECRET_KEY_888');
      }
    });

    it('wires default mediaChecker in runtime and mounts POST /api/media-check in viteApiPlugin', async () => {
      resetServerRuntime();
      const defaultRt = getServerRuntime();
      expect(typeof defaultRt.mediaChecker).toBe('function');

      const rt: ServerRuntime = {
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        relay: new EncryptedRelayStore(),
        logger: createSafeLogger(() => {}),
        now: () => 1_750_000_000_000,
        env: { GEMINI_API_KEY: 'MEDIA_ROUTE_KEY' },
        mediaChecker: async () => ({
          result: 'AI signal found',
          signalName: 'Overly smooth skin and melted glasses frame',
          note: 'Some facial details look edited by AI. Pause before trusting this photo.',
        }),
      };

      const wrongMethod = await dispatchApiRequest(
        new Request('http://localhost:5173/api/media-check', { method: 'GET' }),
        rt
      );
      expect(wrongMethod?.status).toBe(405);

      const okRes = await dispatchApiRequest(
        new Request('http://localhost:5173/api/media-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            imageBase64: SAMPLE_JPEG_BASE64,
            mimeType: 'image/jpeg',
          }),
        }),
        rt
      );
      expect(okRes?.status).toBe(200);
      const json = (await okRes!.json()) as {
        result: string;
        source: string;
      };
      expect(json.source).toBe('ai');
      expect(json.result).toBe('AI signal found');
    });
  });

  describe('POST /api/scam-check with screenshot image (multimodal Gemini Vision)', () => {
    it('createGeminiScamChecker sends inlineData when screenshot imageBase64 + imageMime are provided', async () => {
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
                        value: 'danger',
                        flags: ['urgency', 'payment'],
                        reasons: [
                          'The screenshot demands an urgent bank fee via an unfamiliar web link.',
                        ],
                        instruction: 'Do not click or pay',
                        showAskFamily: true,
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

      const checker = createGeminiScamChecker({ fetchFn: mockFetch });
      const res = await checker(
        {
          text: '',
          imageBase64: SAMPLE_JPEG_BASE64,
          imageMime: 'image/jpeg',
        },
        'SCAM_VISION_KEY'
      );

      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(calls[0].init?.body)) as {
        contents: Array<{
          parts: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        }>;
      };
      const inlinePart = body.contents[0].parts.find((p) => p.inlineData);
      expect(inlinePart?.inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: SAMPLE_JPEG_BASE64,
      });
      expect(res.value).toBe('danger');
      expect(res.showAskFamily).toBe(true);
    });

    it('POST /api/scam-check accepts imageBase64 + imageMime with empty text and returns AI scam verdict', async () => {
      let receivedInput: unknown;
      const handler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        env: { GEMINI_API_KEY: 'SCREENSHOT_SCAM_KEY' },
        scamChecker: async (input) => {
          receivedInput = input;
          return {
            value: 'danger',
            flags: ['urgency', 'payment'],
            reasons: [
              'Screenshot shows a fake parcel fee warning demanding card details.',
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
            text: '',
            imageBase64: SAMPLE_JPEG_BASE64,
            imageMime: 'image/jpeg',
          }),
        })
      );

      expect(res.status).toBe(200);
      expect(receivedInput).toEqual({
        text: '',
        imageBase64: SAMPLE_JPEG_BASE64,
        imageMime: 'image/jpeg',
      });
      const json = (await res.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(json.source).toBe('ai');
      expect(json.value).toBe('danger');
      expect(json.showAskFamily).toBe(true);
    });

    it('POST /api/scam-check NEVER returns green safe on screenshot-only fallback when AI fails or is unconfigured (returns caution + showAskFamily)', async () => {
      // 1. Unconfigured API key on screenshot-only request
      const unconfiguredHandler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        env: {},
      });

      const resUnconf = await unconfiguredHandler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: '',
            imageBase64: SAMPLE_JPEG_BASE64,
            imageMime: 'image/jpeg',
          }),
        })
      );
      expect(resUnconf.status).toBe(200);
      const bodyUnconf = (await resUnconf.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(bodyUnconf.source).toBe('device');
      expect(bodyUnconf.value).toBe('caution');
      expect(bodyUnconf.showAskFamily).toBe(true);
      expect(bodyUnconf.instruction).toBe(
        'Be careful and verify before clicking or paying'
      );
      expect(bodyUnconf.reasons.join(' ')).not.toMatch(BANNED_JARGON);

      // 2. Provider throws on screenshot-only request -> caution (never safe)
      const crashingHandler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        env: { GEMINI_API_KEY: 'KEY_CRASH' },
        scamChecker: async () => {
          throw new Error('Timeout');
        },
      });
      const resCrash = await crashingHandler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: '',
            imageBase64: SAMPLE_JPEG_BASE64,
            imageMime: 'image/jpeg',
          }),
        })
      );
      const bodyCrash = (await resCrash.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(bodyCrash.source).toBe('device');
      expect(bodyCrash.value).toBe('caution');
      expect(bodyCrash.showAskFamily).toBe(true);

      // 3. Genuine AI safe verdict on harmless screenshot IS still accepted
      const safeAiHandler = createScamCheckPostHandler({
        tokenRegistry: new TokenRegistry(),
        rateLimiter: createRateLimiter(),
        logger: createSafeLogger(() => {}),
        env: { GEMINI_API_KEY: 'KEY_SAFE_SHOT' },
        scamChecker: async () => ({
          value: 'safe',
          flags: [],
          reasons: ['This screenshot shows a normal family lunch invitation.'],
          showAskFamily: false,
        }),
      });
      const resSafe = await safeAiHandler(
        new Request('http://localhost:5173/api/scam-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: '',
            imageBase64: SAMPLE_JPEG_BASE64,
            imageMime: 'image/jpeg',
          }),
        })
      );
      const bodySafe = (await resSafe.json()) as ScamCheckOutput & {
        source: 'ai' | 'device';
      };
      expect(bodySafe.source).toBe('ai');
      expect(bodySafe.value).toBe('safe');
    });
  });

  describe('checkMediaWithAi & checkMessageWithAi (Property 7 Consent & Audit-Before-Read)', () => {
    it('checkMediaWithAi makes 0 fetch calls and 0 audit writes when allowAiReading is false', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const { vault, entries } = makeMockVault();
      const fetchFn = vi.fn<typeof fetch>();

      const res = await checkMediaWithAi({
        bytes: SAMPLE_JPEG_BYTES,
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        settings,
        vault,
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.checkedBy).toBe('device');
        expect(res.outcome.result).toBe('Cannot tell');
      }
      expect(fetchFn).not.toHaveBeenCalled();
      expect(entries).toHaveLength(0);
    });

    it('checkMediaWithAi writes ai-read audit BEFORE calling /api/media-check and aborts with 0 fetch if vault missing or audit fails', async () => {
      const settings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };

      // Missing vault -> 0 fetch
      const fetchMissingVault = vi.fn<typeof fetch>();
      const missingRes = await checkMediaWithAi({
        bytes: SAMPLE_JPEG_BYTES,
        mimeType: 'image/jpeg',
        settings,
        vault: undefined,
        fetchFn: fetchMissingVault,
      });
      expect(missingRes.ok).toBe(false);
      expect(fetchMissingVault).not.toHaveBeenCalled();

      // Audit failure -> 0 fetch
      const { vault: failingVault } = makeMockVault({ failAudit: true });
      const fetchFailAudit = vi.fn<typeof fetch>();
      const failRes = await checkMediaWithAi({
        bytes: SAMPLE_JPEG_BYTES,
        mimeType: 'image/jpeg',
        settings,
        vault: failingVault,
        fetchFn: fetchFailAudit,
      });
      expect(failRes.ok).toBe(false);
      if (!failRes.ok) {
        expect(failRes.message).not.toMatch(BANNED_JARGON);
      }
      expect(fetchFailAudit).not.toHaveBeenCalled();

      // Happy path -> audit THEN fetch
      const order: string[] = [];
      const { vault, entries } = makeMockVault({
        onAudit: () => order.push('audit'),
      });
      const fetchOk = vi.fn<typeof fetch>(async (input) => {
        order.push(`fetch:${String(input)}`);
        return new Response(
          JSON.stringify({
            result: 'AI signal found',
            signalName: 'Visual distortion around hands',
            note: 'Hands look unusually blended. This photo is not 100% real.',
            source: 'ai',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const okRes = await checkMediaWithAi({
        bytes: SAMPLE_JPEG_BYTES,
        mimeType: 'image/jpeg',
        fileName: 'family.jpg',
        settings,
        vault,
        fetchFn: fetchOk,
      });

      expect(okRes.ok).toBe(true);
      if (okRes.ok) {
        expect(okRes.checkedBy).toBe('ai');
        expect(okRes.outcome.result).toBe('AI signal found');
        expect(okRes.outcome.note).not.toMatch(/100%\s*real/i);
      }
      expect(order).toEqual(['audit', 'fetch:/api/media-check']);
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('ai-read');
    });

    it('checkMessageWithAi with screenshot enforces consent gate and sends imageBase64 + imageMime after audit', async () => {
      // Consent OFF -> 0 fetch
      const offSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      const fetchOff = vi.fn<typeof fetch>();
      const { vault: offVault, entries: offEntries } = makeMockVault();
      const offRes = await checkMessageWithAi({
        text: '',
        imageBase64: SAMPLE_JPEG_BASE64,
        imageMime: 'image/jpeg',
        settings: offSettings,
        vault: offVault,
        fetchFn: fetchOff,
      });
      expect(offRes.ok).toBe(true);
      expect(fetchOff).not.toHaveBeenCalled();
      expect(offEntries).toHaveLength(0);

      // Consent ON -> audit then POST /api/scam-check with imageBase64 + imageMime
      const onSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: true,
      };
      const order: string[] = [];
      const { vault: onVault } = makeMockVault({
        onAudit: () => order.push('audit'),
      });
      let sentBody: Record<string, unknown> | undefined;
      const fetchOn = vi.fn<typeof fetch>(async (input, init) => {
        order.push(`fetch:${String(input)}`);
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            value: 'danger',
            flags: ['urgency', 'payment'],
            reasons: ['Screenshot demands urgent gift card payment.'],
            instruction: 'Do not click or pay',
            showAskFamily: true,
            source: 'ai',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const onRes = await checkMessageWithAi({
        text: '',
        imageBase64: SAMPLE_JPEG_BASE64,
        imageMime: 'image/jpeg',
        settings: onSettings,
        vault: onVault,
        fetchFn: fetchOn,
      });

      expect(onRes.ok).toBe(true);
      if (onRes.ok) {
        expect(onRes.checkedBy).toBe('ai');
        expect(onRes.verdict.value).toBe('danger');
      }
      expect(order).toEqual(['audit', 'fetch:/api/scam-check']);
      expect(sentBody).toMatchObject({
        text: '',
        imageBase64: SAMPLE_JPEG_BASE64,
        imageMime: 'image/jpeg',
      });

      // Screenshot-only HTTP 500 when allowAiReading is ON -> caution + showAskFamily, does NOT tell user to turn on AI Helper
      const { vault: failVault } = makeMockVault();
      const failShotRes = await checkMessageWithAi({
        text: '',
        imageBase64: SAMPLE_JPEG_BASE64,
        imageMime: 'image/jpeg',
        settings: onSettings,
        vault: failVault,
        fetchFn: vi.fn(async () => new Response('Server error', { status: 500 })),
      });
      expect(failShotRes.ok).toBe(true);
      if (failShotRes.ok) {
        expect(failShotRes.checkedBy).toBe('device');
        expect(failShotRes.verdict.value).toBe('caution');
        expect(failShotRes.verdict.showAskFamily).toBe(true);
        expect(failShotRes.verdict.instruction).toBe(
          'Be careful and verify before clicking or paying'
        );
        expect(failShotRes.verdict.reasons.join(' ')).not.toMatch(
          /turn on ai/i
        );
        expect(failShotRes.verdict.reasons.join(' ')).not.toMatch(
          BANNED_JARGON
        );
      }

      // Consent OFF on screenshot-only -> caution (never green safe)
      expect(offRes.ok).toBe(true);
      if (offRes.ok) {
        expect(offRes.verdict.value).toBe('caution');
        expect(offRes.verdict.showAskFamily).toBe(true);
      }
    });
  });

  describe('UI Screens: AiMediaCheckPage, ScamShieldPage, and UnifiedInboxPage mediaCheck badge', () => {
    it('AiMediaCheckPage renders Turn On AI Scanning helper when OFF, Checked with AI Helper / Device badges, zero jargon, min-h-[56px] buttons, and never 100% real', () => {
      const offHtml = renderToStaticMarkup(
        React.createElement(AiMediaCheckPage, {
          initialSettings: { ...createDefaultSettings(), allowAiReading: false },
          initialOutcome: {
            result: 'Cannot tell',
            note: 'No photo details were found on this device.',
          },
          initialCheckedBy: 'device',
        })
      );
      expect(offHtml).toContain('Turn On AI Scanning');
      expect(offHtml).toContain('Checked on This Device');
      expect(offHtml).not.toMatch(/100%\s*real/i);
      expect(stripHtml(offHtml)).not.toMatch(BANNED_JARGON);

      const onHtml = renderToStaticMarkup(
        React.createElement(AiMediaCheckPage, {
          initialSettings: { ...createDefaultSettings(), allowAiReading: true },
          initialOutcome: {
            result: 'AI signal found',
            signalName: 'Unnatural hand edges',
            note: 'Visual clues suggest this photo may have been created by AI.',
          },
          initialCheckedBy: 'ai',
          initialScamWarning: {
            value: 'danger',
            flags: ['payment'],
            reasons: ['The photo contains a suspicious payment request.'],
          },
        })
      );
      expect(onHtml).toContain('Checked with AI Helper');
      expect(onHtml).toContain('AI signal found');
      expect(onHtml).toContain('suspicious payment request');
      expect(onHtml).not.toContain('Turn On AI Scanning');
      expect(onHtml).not.toMatch(/100%\s*real/i);
      expect(stripHtml(onHtml)).not.toMatch(BANNED_JARGON);

      for (const html of [offHtml, onHtml]) {
        for (const btn of extractButtonTags(html)) {
          expect(btn).toContain('min-h-[56px]');
          expect(stripHtml(btn).length).toBeGreaterThan(0);
        }
        for (const badge of extractBadges(html)) {
          expect(badge).toContain('border-2');
          expect(badge).toContain('aria-hidden="true"');
          expect(stripHtml(badge).length).toBeGreaterThan(0);
        }
      }
    });

    it('AiMediaCheckPage preloaded-image effect does NOT overwrite a newly uploaded photo when Turn On AI Scanning updates settings', async () => {
      const vault = createVault({ dbName: 'test_media_preload_no_overwrite_v1' });
      const initialSettings: Settings = {
        ...createDefaultSettings(),
        allowAiReading: false,
      };
      await vault.saveSettings(initialSettings);

      const stateSlots: unknown[] = [];
      const refSlots: Array<{ current: unknown }> = [];
      const effectPrevDeps: Array<readonly unknown[] | undefined> = [];
      let stateCursor = 0;
      let refCursor = 0;
      let effectCursor = 0;
      let queuedEffects: Array<() => void> = [];

      const useStateSpy = vi.spyOn(React, 'useState').mockImplementation(((
        init: unknown
      ) => {
        const idx = stateCursor++;
        if (!(idx in stateSlots)) {
          stateSlots[idx] =
            typeof init === 'function' ? (init as () => unknown)() : init;
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
        init: unknown
      ) => {
        const idx = refCursor++;
        if (!(idx in refSlots)) {
          refSlots[idx] = { current: init };
        }
        return refSlots[idx];
      }) as typeof React.useRef);
      const useMemoSpy = vi
        .spyOn(React, 'useMemo')
        .mockImplementation((fn) => fn());
      const useCallbackSpy = vi
        .spyOn(React, 'useCallback')
        .mockImplementation((fn) => fn);
      const useEffectSpy = vi
        .spyOn(React, 'useEffect')
        .mockImplementation((effect, deps) => {
          const idx = effectCursor++;
          const prevDeps = effectPrevDeps[idx];
          const changed =
            !prevDeps ||
            !deps ||
            prevDeps.length !== deps.length ||
            deps.some((d, i) => !Object.is(d, prevDeps[i]));
          if (changed) {
            effectPrevDeps[idx] = deps ? [...deps] : undefined;
            queuedEffects.push(effect as () => void);
          }
        });

      const findEl = (
        node: React.ReactNode,
        pred: (el: React.ReactElement<Record<string, unknown>>) => boolean
      ): React.ReactElement<Record<string, unknown>> | undefined => {
        if (!node) return undefined;
        if (Array.isArray(node)) {
          for (const child of node) {
            const hit = findEl(child, pred);
            if (hit) return hit;
          }
          return undefined;
        }
        if (React.isValidElement(node)) {
          const el = node as React.ReactElement<Record<string, unknown>>;
          if (pred(el)) return el;
          if (el.props && 'children' in el.props) {
            return findEl(el.props.children as React.ReactNode, pred);
          }
        }
        return undefined;
      };

      const renderTree = () => {
        stateCursor = 0;
        refCursor = 0;
        effectCursor = 0;
        queuedEffects = [];
        const tree = AiMediaCheckPage({
          initialSettings,
          initialImageName: 'old-preloaded.jpg',
          initialImageDataBase64: SAMPLE_JPEG_BASE64,
          vault,
        });
        for (const eff of queuedEffects) eff();
        return tree;
      };

      try {
        // 1. Initial mount runs preloaded image check once
        let tree = renderTree();
        await new Promise((r) => setTimeout(r, 15));
        tree = renderTree();

        // 2. User uploads a different photo
        const fileInput = findEl(
          tree,
          (el) => el.type === 'input' && el.props.id === 'media-check-file-input'
        );
        expect(fileInput).toBeDefined();
        const uploadedBytes = encodeAsciiBytes('PNG Midjourney upload');
        const fakeFile = {
          name: 'new-upload.png',
          type: 'image/png',
          size: uploadedBytes.byteLength,
          arrayBuffer: async () => uploadedBytes.buffer,
        };
        await (
          fileInput!.props.onChange as (e: {
            target: { files: unknown[] };
          }) => Promise<void>
        )({ target: { files: [fakeFile] } });

        tree = renderTree();
        expect(stateSlots[1]).toBe('new-upload.png');

        // 3. User clicks "Turn On AI Scanning" -> settings updates in Vault & state
        const turnOnBtn = findEl(
          tree,
          (el) =>
            typeof el.props.onClick === 'function' &&
            el.props.children === 'Turn On AI Scanning'
        );
        expect(turnOnBtn).toBeDefined();
        await (turnOnBtn!.props.onClick as () => Promise<void>)();

        // Re-render after settings updated -> selectedFileName MUST remain 'new-upload.png' (never overwritten by 'old-preloaded.jpg'!)
        renderTree();
        await new Promise((r) => setTimeout(r, 15));
        expect(stateSlots[1]).toBe('new-upload.png');

        const saved = await vault.getSettings();
        expect(saved.ok).toBe(true);
        if (saved.ok) {
          expect(saved.value.allowAiReading).toBe(true);
        }
      } finally {
        useEffectSpy.mockRestore();
        useCallbackSpy.mockRestore();
        useMemoSpy.mockRestore();
        useRefSpy.mockRestore();
        useStateSpy.mockRestore();
      }
    });

    it('ScamShieldPage renders one-tap Turn On AI Scanning button when allowAiReading is OFF and keeps all accessibility invariants', () => {
      const offHtml = renderToStaticMarkup(
        React.createElement(ScamShieldPage, {
          initialSettings: { ...createDefaultSettings(), allowAiReading: false },
        })
      );
      expect(offHtml).toContain('Turn On AI Scanning');
      expect(stripHtml(offHtml)).not.toMatch(BANNED_JARGON);
      for (const btn of extractButtonTags(offHtml)) {
        expect(btn).toContain('min-h-[56px]');
        expect(stripHtml(btn).length).toBeGreaterThan(0);
      }

      const onHtml = renderToStaticMarkup(
        React.createElement(ScamShieldPage, {
          initialSettings: { ...createDefaultSettings(), allowAiReading: true },
          initialVerdict: {
            value: 'danger',
            flags: ['urgency', 'payment'],
            reasons: ['Screenshot asks for immediate transfer.'],
            instruction: 'Do not click or pay',
            showAskFamily: true,
          },
          initialCheckedBy: 'ai',
        })
      );
      expect(onHtml).toContain('Checked with AI Helper');
      expect(onHtml).not.toContain('Turn On AI Scanning');
      expect(stripHtml(onHtml)).not.toMatch(BANNED_JARGON);
      for (const badge of extractBadges(onHtml)) {
        expect(badge).toContain('border-2');
        expect(badge).toContain('aria-hidden="true"');
      }
    });

    it('UnifiedInboxPage renders item.mediaCheck dual-modality badge on email cards when present', () => {
      const itemWithMediaCheck: InboxItem = {
        id: 'email-img-card-1',
        source: 'email',
        sender: 'Unknown Promo <promo@example.com>',
        text: 'Check out this prize photo attached!',
        attachments: [
          {
            id: 'att-1',
            mime: 'image/jpeg',
            name: 'prize.jpg',
            dataBase64: SAMPLE_JPEG_BASE64,
          },
        ],
        receivedAt: '2026-11-22T07:00:00.000Z',
        group: 'Others',
        priority: 'Important',
        tier: 3,
        confidence: 0.9,
        status: 'ok',
        mediaCheck: {
          result: 'AI signal found',
          signalName: 'Scrambled prize certificate text',
          note: 'This attached photo shows signs of being AI-generated.',
        },
      };

      const html = renderToStaticMarkup(
        React.createElement(UnifiedInboxPage, {
          initialSettings: { ...createDefaultSettings(), allowAiReading: true },
          initialItems: [itemWithMediaCheck],
        })
      );

      expect(html).toContain('AI signal found');
      expect(html).toContain('This attached photo shows signs of being AI-generated.');
      expect(stripHtml(html)).not.toMatch(BANNED_JARGON);
      const badges = extractBadges(html);
      const mediaBadge = badges.find((b) => b.includes('AI signal found'));
      expect(mediaBadge).toBeDefined();
      expect(mediaBadge).toContain('border-2');
      expect(mediaBadge).toContain('aria-hidden="true"');
    });
  });

  describe('Email image attachment extraction & Gemini Vision scanning (emailClient + emailChannel)', () => {
    it('extracts Gmail format=full image attachment (<= 2 MB) and scans via /api/media-check when allowAiReading is ON', async () => {
      const vault = createVault({ dbName: 'test_gmail_vision_scan_v1' });
      const settings: Settings = {
        ...createDefaultSettings(),
        channels: {
          ...createDefaultSettings().channels,
          email: true,
        },
        allowAiReading: true,
      };
      await vault.saveSettings(settings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.vision-gmail-token',
      });

      const requestedUrls: string[] = [];
      const mockFetch = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        requestedUrls.push(url);

        if (
          url.startsWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?'
          )
        ) {
          return new Response(
            JSON.stringify({ messages: [{ id: 'gmail-img-1' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (
          url.startsWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-img-1?'
          )
        ) {
          expect(url).toContain('format=full');
          return new Response(
            JSON.stringify({
              id: 'gmail-img-1',
              snippet: 'Look at this attached winner cheque photo!',
              payload: {
                headers: [
                  { name: 'From', value: 'Prize Desk <prize@unknown.example>' },
                  { name: 'Subject', value: 'Attached Photo' },
                  { name: 'Date', value: 'Sun, 22 Nov 2026 07:00:00 +0000' },
                ],
                parts: [
                  {
                    partId: '0',
                    mimeType: 'text/plain',
                    body: { size: 42 },
                  },
                  {
                    partId: '1',
                    filename: 'winner-cheque.jpg',
                    mimeType: 'image/jpeg',
                    body: {
                      attachmentId: 'att-xyz-1',
                      size: SAMPLE_JPEG_BYTES.byteLength,
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (
          url ===
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-img-1/attachments/att-xyz-1'
        ) {
          return new Response(
            JSON.stringify({
              size: SAMPLE_JPEG_BYTES.byteLength,
              data: toBase64Url(SAMPLE_JPEG_BASE64),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/media-check') {
          return new Response(
            JSON.stringify({
              result: 'AI signal found',
              signalName: 'Altered cheque lettering',
              note: 'This image shows signs of AI editing and asks for a fee.',
              scamWarning: {
                value: 'danger',
                flags: ['payment'],
                reasons: ['Fake cheque image asking for a processing fee.'],
              },
              source: 'ai',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/decide') {
          return new Response(
            JSON.stringify({
              summary: {
                fromApp: 'Email',
                whoSent: 'Prize Desk',
                actionNeeded: 'Be careful before trusting this photo',
                text: 'Prize Desk sent an email with an attached photo.',
              },
              group: 'Others',
              priority: 'Important',
              confidence: 0.85,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/ingest/pull') {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not found', { status: 404 });
      });

      const res = await syncEmailsFromRelay({
        vault,
        settings,
        fetchFn: mockFetch,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.stored).toHaveLength(1);
        const item = res.stored[0];
        expect(item.attachments).toHaveLength(1);
        expect(item.attachments[0].mime).toBe('image/jpeg');
        expect(item.attachments[0].name).toBe('winner-cheque.jpg');
        expect(item.attachments[0].dataBase64).toBe(SAMPLE_JPEG_BASE64);
        expect(item.mediaCheck).toMatchObject({
          result: 'AI signal found',
          signalName: 'Altered cheque lettering',
        });
        expect(item.scamWarning?.value).toBe('danger');
      }
      expect(requestedUrls).toContain('/api/media-check');
    });

    it('processEmailBatch skips /api/media-check when allowAiReading is OFF (0 media-check calls)', async () => {
      const vault = createVault({ dbName: 'test_email_img_consent_off_v1' });
      const settings: Settings = {
        ...createDefaultSettings(),
        channels: {
          ...createDefaultSettings().channels,
          email: true,
        },
        allowAiReading: false,
      };
      const fetchMediaFn = vi.fn<typeof fetch>();

      const batch = await processEmailBatch({
        settings,
        tokenStatus: 'valid',
        emails: [
          {
            id: 'email-off-img-1',
            from: 'Friend <friend@example.com>',
            subject: 'Garden photo',
            body: 'Here is a photo from the garden.',
            receivedAt: '2026-11-22T07:00:00.000Z',
            attachments: [
              {
                id: 'img-1',
                mime: 'image/jpeg',
                name: 'garden.jpg',
                size: SAMPLE_JPEG_BYTES.byteLength,
                dataBase64: SAMPLE_JPEG_BASE64,
              },
            ],
          },
        ],
        vault,
        fetchMediaFn,
      });

      expect(batch.processed).toHaveLength(1);
      expect(fetchMediaFn).not.toHaveBeenCalled();
    });

    it('extracts Outlook image attachment when hasAttachments is true and scans via /api/media-check', async () => {
      const vault = createVault({ dbName: 'test_outlook_vision_scan_v1' });
      const settings: Settings = {
        ...createDefaultSettings(),
        channels: {
          ...createDefaultSettings().channels,
          email: true,
        },
        allowAiReading: true,
      };
      await vault.saveSettings(settings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'ah.kow@outlook.com',
        provider: 'Outlook',
        token: 'ms-vision-token',
      });

      const requestedUrls: string[] = [];
      const mockFetch = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.startsWith('https://graph.microsoft.com/v1.0/me/messages?')) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: 'outlook-img-1',
                  subject: 'Bank alert image',
                  from: {
                    emailAddress: {
                      name: 'Alert Desk',
                      address: 'alert@unknown.example',
                    },
                  },
                  receivedDateTime: '2026-11-22T07:10:00.000Z',
                  bodyPreview: 'Please review the attached notice.',
                  hasAttachments: true,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (
          url.startsWith(
            'https://graph.microsoft.com/v1.0/me/messages/outlook-img-1/attachments'
          )
        ) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: 'ms-att-1',
                  name: 'notice.png',
                  contentType: 'image/png',
                  size: SAMPLE_JPEG_BYTES.byteLength,
                  contentBytes: SAMPLE_JPEG_BASE64,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/media-check') {
          return new Response(
            JSON.stringify({
              result: 'AI signal found',
              signalName: 'Fake bank letterhead',
              note: 'This image shows signs of AI editing and asks for a fee.',
              scamWarning: {
                value: 'danger',
                flags: ['urgency', 'payment'],
                reasons: ['Fake bank notice asking for urgent transfer.'],
              },
              source: 'ai',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/decide') {
          return new Response(
            JSON.stringify({
              summary: {
                fromApp: 'Email',
                whoSent: 'Alert Desk',
                actionNeeded: 'Be careful before trusting this message',
                text: 'Alert Desk sent an email with an attached notice.',
              },
              group: 'Others',
              priority: 'Important',
              confidence: 0.85,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === '/api/ingest/pull') {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not found', { status: 404 });
      });

      const res = await syncEmailsFromRelay({
        vault,
        settings,
        fetchFn: mockFetch,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.stored).toHaveLength(1);
        const item = res.stored[0];
        expect(item.attachments).toHaveLength(1);
        expect(item.attachments[0].name).toBe('notice.png');
        expect(item.mediaCheck?.result).toBe('AI signal found');
        expect(item.scamWarning?.value).toBe('danger');
        expect(item.proposals?.some((p) => p.kind === 'checkScam')).toBe(true);
      }
      expect(requestedUrls).toContain('/api/media-check');
    });
  });
});
