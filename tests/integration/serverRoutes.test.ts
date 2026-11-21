import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as ingestPost } from '@/app/api/ingest/route';
import { POST as ingestEmailPost } from '@/app/api/ingest/email/route';
import { GET as ingestPullGet } from '@/app/api/ingest/pull/route';
import { POST as ingestAckPost } from '@/app/api/ingest/ack/route';
import { POST as decidePost } from '@/app/api/decide/route';
import {
  HSTS_HEADER,
  applyHstsHeader,
  enforceHttpsAndHsts,
  getSecurityHeaders,
} from '@/middleware';
import { callDecideProxy } from '@/lib/ai/proxyClient';
import {
  DEFAULT_DEV_SENIOR_ID,
  DEFAULT_DEV_TOKEN,
  TokenRegistry,
} from '@/lib/server/auth';
import { MAX_DECIDE_BYTES, MAX_INGEST_BYTES } from '@/lib/server/handlers';
import { RELAY_TTL_MS } from '@/lib/server/relay';
import { createSafeLogger } from '@/lib/server/safeLog';
import {
  getServerRuntime,
  resetServerRuntime,
  setServerRuntime,
} from '@/lib/server/runtime';

function getEnv(): Record<string, string | undefined> {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  if (!g.process) {
    g.process = { env: {} };
  }
  if (!g.process.env) {
    g.process.env = {};
  }
  return g.process.env;
}

describe('Server API routes & middleware integration', () => {
  let capturedLogs: string[];
  let currentNowMs: number;

  beforeEach(() => {
    capturedLogs = [];
    currentNowMs = 1_750_000_000_000;
    resetServerRuntime();
    const rt = getServerRuntime();
    setServerRuntime({
      ...rt,
      logger: createSafeLogger((line) => capturedLogs.push(line)),
      now: () => currentNowMs,
    });
  });

  afterEach(() => {
    delete getEnv().AI_API_KEY;
    delete getEnv().GEMINI_API_KEY;
    resetServerRuntime();
  });

  describe('POST /api/ingest', () => {
    it('returns 200 and enqueues an encrypted draft with the default dev token', async () => {
      const res = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            source: 'sms',
            sender: 'City Clinic',
            text: 'Appointment on 2026-05-12 at 09:30.',
            receivedAt: '2026-05-01T10:00:00Z',
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; id: string };
      expect(body.ok).toBe(true);
      expect(body.id.length).toBeGreaterThan(0);

      const envelopes = getServerRuntime().relay.inspectStoredEnvelopes();
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0].seniorId).toBe(DEFAULT_DEV_SENIOR_ID);
      expect(JSON.stringify(envelopes[0])).not.toContain('Appointment on 2026-05-12');
      expect(capturedLogs[capturedLogs.length - 1]).toMatch(
        /^route=\/api\/ingest status=200 durationMs=\d+$/
      );
    });

    it('returns 400 naming the failing field when payload validation fails', async () => {
      const missingText = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ingest-token': DEFAULT_DEV_TOKEN,
          },
          body: JSON.stringify({ source: 'email' }),
        })
      );
      expect(missingText.status).toBe(400);
      const missingTextBody = (await missingText.json()) as {
        error: string;
        field: string;
      };
      expect(missingTextBody.field).toBe('text');
      expect(missingTextBody.error).toContain('text');

      const badSource = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ source: 'carrier-pigeon', text: 'Hello' }),
        })
      );
      expect(badSource.status).toBe(400);
      const badSourceBody = (await badSource.json()) as {
        error: string;
        field: string;
      };
      expect(badSourceBody.field).toBe('source');
      expect(badSourceBody.error).toContain('source');
    });

    it('returns 401 on missing or unknown bearer token', async () => {
      const res = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'email', text: 'Hello' }),
        })
      );
      expect(res.status).toBe(401);
    });

    it('returns 413 with a plain message when payload exceeds 10 MB', async () => {
      const viaHeader = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            'Content-Length': String(MAX_INGEST_BYTES + 1),
          },
          body: JSON.stringify({ source: 'email', text: 'Small body with huge header' }),
        })
      );
      expect(viaHeader.status).toBe(413);
      const viaHeaderBody = (await viaHeader.json()) as { error: string };
      expect(viaHeaderBody.error.toLowerCase()).toContain('too large');

      const oversizedPayload = 'a'.repeat(MAX_INGEST_BYTES + 16);
      const viaBody = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: oversizedPayload,
        })
      );
      expect(viaBody.status).toBe(413);
      const viaBodyJson = (await viaBody.json()) as { error: string };
      expect(viaBodyJson.error.toLowerCase()).toContain('too large');
    });

    it('returns 429 on the 61st request within 60 seconds', async () => {
      for (let i = 0; i < 60; i += 1) {
        const okRes = await ingestPost(
          new Request('https://companion.example/api/ingest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            },
            body: JSON.stringify({ source: 'sms', text: `Msg ${i}` }),
          })
        );
        expect(okRes.status).toBe(200);
      }

      const limited = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ source: 'sms', text: 'Msg 61' }),
        })
      );
      expect(limited.status).toBe(429);
    });
  });

  describe('POST /api/ingest/email', () => {
    it('normalizes { subject, body, from } and { text, sender } payloads with source email', async () => {
      const res1 = await ingestEmailPost(
        new Request('https://companion.example/api/ingest/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            subject: 'Clinic visit',
            body: 'Your check-up is on 2026-06-10 at 14:00.',
            from: 'clinic@example.org',
          }),
        })
      );
      expect(res1.status).toBe(200);

      const res2 = await ingestEmailPost(
        new Request('https://companion.example/api/ingest/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            text: 'Family dinner this Sunday at 18:00.',
            sender: 'Amina',
            attachments: [],
            receivedAt: '2026-06-01T08:00:00Z',
          }),
        })
      );
      expect(res2.status).toBe(200);

      const pullRes = await ingestPullGet(
        new Request('https://companion.example/api/ingest/pull', {
          method: 'GET',
          headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
        })
      );
      expect(pullRes.status).toBe(200);
      const pulled = (await pullRes.json()) as {
        items: Array<{ id: string; draft: { source: string; text: string; sender?: string } }>;
      };
      expect(pulled.items).toHaveLength(2);
      expect(pulled.items[0].draft.source).toBe('email');
      expect(pulled.items[0].draft.sender).toBe('clinic@example.org');
      expect(pulled.items[0].draft.text).toContain('Clinic visit');
      expect(pulled.items[0].draft.text).toContain('2026-06-10');
      expect(pulled.items[1].draft.source).toBe('email');
      expect(pulled.items[1].draft.sender).toBe('Amina');
    });

    it('enforces 401 and 413 on /api/ingest/email', async () => {
      const unauth = await ingestEmailPost(
        new Request('https://companion.example/api/ingest/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'Hi', body: 'There', from: 'a@b.c' }),
        })
      );
      expect(unauth.status).toBe(401);

      const tooLarge = await ingestEmailPost(
        new Request('https://companion.example/api/ingest/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            'Content-Length': String(MAX_INGEST_BYTES + 100),
          },
          body: '{}',
        })
      );
      expect(tooLarge.status).toBe(413);
    });
  });

  describe('GET /api/ingest/pull + POST /api/ingest/ack end-to-end with TTL', () => {
    it('supports full ingest -> pull -> ack lifecycle and expires items after 7 days', async () => {
      const rt = getServerRuntime();
      rt.tokenRegistry.registerToken('senior-two-token', 'senior-2');

      const r1 = await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            source: 'whatsapp',
            text: 'Remember to bring your glasses.',
          }),
        })
      );
      const { id: id1 } = (await r1.json()) as { id: string };

      // Senior 2 cannot see or ack Senior 1's item
      const pull2 = await ingestPullGet(
        new Request('https://companion.example/api/ingest/pull', {
          method: 'GET',
          headers: { Authorization: 'Bearer senior-two-token' },
        })
      );
      expect(((await pull2.json()) as { items: unknown[] }).items).toEqual([]);

      const ack2 = await ingestAckPost(
        new Request('https://companion.example/api/ingest/ack', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer senior-two-token',
          },
          body: JSON.stringify({ ids: [id1] }),
        })
      );
      expect(ack2.status).toBe(204);

      // Senior 1 still pulls the item
      const pull1 = await ingestPullGet(
        new Request('https://companion.example/api/ingest/pull', {
          method: 'GET',
          headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
        })
      );
      const pull1Json = (await pull1.json()) as { items: Array<{ id: string }> };
      expect(pull1Json.items.map((x) => x.id)).toEqual([id1]);

      // Senior 1 acks -> 204 and queue is now empty
      const ack1 = await ingestAckPost(
        new Request('https://companion.example/api/ingest/ack', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({ ids: [id1] }),
        })
      );
      expect(ack1.status).toBe(204);

      const pullAfterAck = await ingestPullGet(
        new Request('https://companion.example/api/ingest/pull', {
          method: 'GET',
          headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
        })
      );
      expect(((await pullAfterAck.json()) as { items: unknown[] }).items).toEqual([]);

      // Enqueue a second item and advance clock past 7-day TTL
      await ingestPost(
        new Request('https://companion.example/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            source: 'sms',
            text: 'Expiring reminder',
          }),
        })
      );
      currentNowMs += RELAY_TTL_MS;

      const pullExpired = await ingestPullGet(
        new Request('https://companion.example/api/ingest/pull', {
          method: 'GET',
          headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
        })
      );
      expect(((await pullExpired.json()) as { items: unknown[] }).items).toEqual([]);
    });
  });

  describe('POST /api/decide', () => {
    it('computes refined summary/group/priority/confidence statelessly without echoing API key or storing content', async () => {
      getEnv().AI_API_KEY = 'SUPER_SECRET_KEY_DO_NOT_LEAK_999';

      const res = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'City Clinic appointment reminder on 2026-07-04 at 10:30.',
            },
          }),
        })
      );

      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain('SUPER_SECRET_KEY_DO_NOT_LEAK_999');

      const parsed = JSON.parse(raw) as {
        summary: {
          fromApp: string;
          whoSent: string;
          actionNeeded: string;
          text: string;
        };
        group: string;
        priority: string;
        confidence: number;
      };
      expect(parsed.group).toBe('Personal');
      expect(parsed.priority).toBe('Important');
      expect(parsed.confidence).toBeGreaterThanOrEqual(0);
      expect(parsed.confidence).toBeLessThanOrEqual(1);
      expect(parsed.summary.fromApp).toBe('From Email');
      expect(parsed.summary.actionNeeded).toBe('Confirm calendar date');

      // Stateless: zero items stored in relay, logs never contain key or content
      expect(getServerRuntime().relay.inspectStoredEnvelopes()).toHaveLength(0);
      for (const line of capturedLogs) {
        expect(line).not.toContain('SUPER_SECRET_KEY_DO_NOT_LEAK_999');
        expect(line).not.toContain('City Clinic');
      }
    });

    it('integrates cleanly with callDecideProxy and supports injectable AI provider with GEMINI_API_KEY', async () => {
      getEnv().GEMINI_API_KEY = 'GEMINI_SECRET_KEY_777';
      let receivedKey = '';
      const rt = getServerRuntime();
      setServerRuntime({
        ...rt,
        aiProvider: async (item, apiKey) => {
          receivedKey = apiKey;
          return {
            summary: {
              fromApp: 'From SMS',
              whoSent: 'Clinic Desk',
              actionNeeded: 'Confirm calendar date',
              text: `Refined check for ${item.channel}.`,
            },
            group: 'Personal',
            priority: 'Important',
            confidence: 0.92,
          };
        },
      });

      const proxyResult = await callDecideProxy(
        { source: 'smsPaste', text: 'Your doctor visit is tomorrow.' },
        {
          fetchFn: async (input, init) =>
            decidePost(
              new Request(`https://companion.example${String(input)}`, init)
            ),
        }
      );

      expect(proxyResult.ok).toBe(true);
      expect(receivedKey).toBe('GEMINI_SECRET_KEY_777');
      if (proxyResult.ok) {
        expect(proxyResult.value.group).toBe('Personal');
        expect(proxyResult.value.priority).toBe('Important');
        expect(proxyResult.value.confidence).toBe(0.92);
        expect(JSON.stringify(proxyResult.value)).not.toContain(
          'GEMINI_SECRET_KEY_777'
        );
      }
      for (const line of capturedLogs) {
        expect(line).not.toContain('GEMINI_SECRET_KEY_777');
      }
    });

    it('rejects missing items, extra items/fields, and oversized payloads with 400', async () => {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
      };

      const missingItem = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({}),
        })
      );
      expect(missingItem.status).toBe(400);

      const extraTopLevel = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            item: { channel: 'smsPaste', text: 'Hello' },
            extraItems: [{ channel: 'email', text: 'Another' }],
          }),
        })
      );
      expect(extraTopLevel.status).toBe(400);

      const extraItemField = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            item: {
              channel: 'smsPaste',
              text: 'Hello',
              familyCodeWord: 'SECRET',
            },
          }),
        })
      );
      expect(extraItemField.status).toBe(400);

      const oversized = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            item: {
              channel: 'email',
              text: 'x'.repeat(12_000),
            },
          }),
        })
      );
      expect(oversized.status).toBe(400);
    });

    it('returns 401 for unauthenticated /api/decide requests and 429 when rate limit is exceeded', async () => {
      const unauth = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: { channel: 'email', text: 'Hello' },
          }),
        })
      );
      expect(unauth.status).toBe(401);

      const badToken = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid-token',
          },
          body: JSON.stringify({
            item: { channel: 'email', text: 'Hello' },
          }),
        })
      );
      expect(badToken.status).toBe(401);

      for (let i = 0; i < 60; i += 1) {
        const okRes = await decidePost(
          new Request('https://companion.example/api/decide', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            },
            body: JSON.stringify({
              item: { channel: 'smsPaste', text: `Check ${i}` },
            }),
          })
        );
        expect(okRes.status).toBe(200);
      }

      const limited = await decidePost(
        new Request('https://companion.example/api/decide', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
          },
          body: JSON.stringify({
            item: { channel: 'smsPaste', text: 'Check 61' },
          }),
        })
      );
      expect(limited.status).toBe(429);
    });

    it('aborts streaming body reads as soon as cumulative bytes exceed limit without buffering full stream', async () => {
      let chunksPulled = 0;
      const chunk = new Uint8Array(16 * 1024).fill(65); // 16 KB per chunk
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksPulled += 1;
          controller.enqueue(chunk);
        },
      });

      const req = new Request('https://companion.example/api/decide', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
        },
        body: stream,
        duplex: 'half',
      } as RequestInit);

      const res = await decidePost(req);
      expect(res.status).toBe(400);
      // MAX_DECIDE_BYTES is 64 KB -> pulling 5 chunks (80 KB) exceeds limit and cancels immediately
      expect(chunksPulled).toBeLessThanOrEqual(Math.ceil(MAX_DECIDE_BYTES / chunk.byteLength) + 2);
    });
  });

  describe('TokenRegistry production guard & env token support', () => {
    it('disables DEFAULT_DEV_TOKEN when NODE_ENV is production and supports INGEST_API_TOKEN', () => {
      const prodRegistry = new TokenRegistry({
        env: {
          NODE_ENV: 'production',
          INGEST_API_TOKEN: 'prod-secret-token-42',
          INGEST_SENIOR_ID: 'senior-prod-1',
        },
      });

      const devAuth = prodRegistry.verifyToken(
        new Request('https://companion.example/api/ingest', {
          headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
        })
      );
      expect(devAuth.ok).toBe(false);

      const prodAuth = prodRegistry.verifyToken(
        new Request('https://companion.example/api/ingest', {
          headers: { Authorization: 'Bearer prod-secret-token-42' },
        })
      );
      expect(prodAuth.ok).toBe(true);
      if (prodAuth.ok) {
        expect(prodAuth.seniorId).toBe('senior-prod-1');
      }

      const defaultSeniorProd = new TokenRegistry({
        env: {
          NODE_ENV: 'production',
          INGEST_API_TOKEN: 'prod-default-senior-tok',
        },
      });
      const defaultSeniorAuth = defaultSeniorProd.verifyToken(
        new Request('https://companion.example/api/ingest', {
          headers: { Authorization: 'Bearer prod-default-senior-tok' },
        })
      );
      expect(defaultSeniorAuth.ok).toBe(true);
      if (defaultSeniorAuth.ok) {
        expect(defaultSeniorAuth.seniorId).toBe(DEFAULT_DEV_SENIOR_ID);
      }
    });
  });

  describe('middleware enforceHttpsAndHsts', () => {
    it('redirects http x-forwarded-proto to https with 308 and HSTS header', () => {
      expect(HSTS_HEADER).toBe('max-age=63072000; includeSubDomains; preload');

      const httpReq = new Request(
        'http://companion.example/api/ingest/pull?foo=bar',
        {
          headers: { 'x-forwarded-proto': 'http' },
        }
      );
      const redirect = enforceHttpsAndHsts(httpReq);
      expect(redirect).not.toBeNull();
      expect(redirect!.status).toBe(308);
      expect(redirect!.headers.get('location')).toBe(
        'https://companion.example/api/ingest/pull?foo=bar'
      );
      expect(redirect!.headers.get('strict-transport-security')).toBe(
        HSTS_HEADER
      );
    });

    it('returns null for https requests without nextResponse and applies HSTS header when nextResponse or helpers are used', () => {
      const httpsReq = new Request('https://companion.example/api/ingest/pull', {
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(enforceHttpsAndHsts(httpsReq)).toBeNull();

      const withRes = enforceHttpsAndHsts(
        httpsReq,
        new Response('ok', { status: 200 })
      );
      expect(withRes).not.toBeNull();
      expect(withRes!.status).toBe(200);
      expect(withRes!.headers.get('strict-transport-security')).toBe(
        HSTS_HEADER
      );

      const applied = applyHstsHeader(new Response('ok', { status: 200 }));
      expect(applied.headers.get('strict-transport-security')).toBe(
        HSTS_HEADER
      );

      expect(getSecurityHeaders(httpsReq)).toEqual({
        'Strict-Transport-Security': HSTS_HEADER,
      });

      const noHeaderReq = new Request('https://companion.example/api/ingest/pull');
      expect(enforceHttpsAndHsts(noHeaderReq)).toBeNull();
    });
  });
});
