import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type Channel,
  type InboxItemDraft,
} from '@/lib/types';
import { TokenRegistry, hashToken } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore, RELAY_TTL_MS } from '@/lib/server/relay';
import {
  createSafeLogger,
  type SafeLogRecord,
} from '@/lib/server/safeLog';
import {
  createDecidePostHandler,
  createIngestAckPostHandler,
  createIngestEmailPostHandler,
  createIngestPostHandler,
  createIngestPullGetHandler,
} from '@/lib/server/handlers';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);

const tokenArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9._-]{12,40}$/)
  .map((s) => `tok_${s}`);

const seniorIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9-]{4,20}$/)
  .map((s) => `senior-${s}`);

const safeTextArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9 ,.!?:;'-]{12,140}$/)
  .filter((s) => s.trim().length >= 8);

const draftArb: fc.Arbitrary<InboxItemDraft> = fc.record({
  source: channelArb,
  text: safeTextArb,
  sender: fc.option(fc.stringMatching(/^[A-Za-z0-9 .@_-]{4,40}$/), {
    nil: undefined,
  }),
  attachments: fc.constant([]),
  receivedAt: fc
    .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
    .map((ms) => new Date(ms).toISOString()),
});

describe('Server security properties (Properties 42, 43, 44)', () => {
  // Feature: senior-digital-companion, Property 42: Token authentication and tenant isolation
  it('Property 42: enforces SHA-256 token authentication, encrypted relay storage, and strict tenant isolation', async () => {
    await fc.assert(
      fc.asyncProperty(
        seniorIdArb,
        seniorIdArb,
        tokenArb,
        tokenArb,
        tokenArb,
        draftArb,
        async (seniorA, seniorB, tokenA, tokenB, unknownToken, draft) => {
          fc.pre(seniorA !== seniorB);
          fc.pre(
            tokenA !== tokenB &&
              tokenA !== unknownToken &&
              tokenB !== unknownToken
          );

          const registry = new TokenRegistry({ includeDefaultDevToken: false });
          const hashA = registry.registerToken(tokenA, seniorA);
          const hashB = registry.registerToken(tokenB, seniorB);
          expect(hashA).toBe(hashToken(tokenA));
          expect(hashB).toBe(hashToken(tokenB));
          expect(hashA).not.toContain(tokenA);
          expect(hashB).not.toContain(tokenB);

          const rateLimiter = createRateLimiter({ limit: 1000, windowMs: 60_000 });
          const relay = new EncryptedRelayStore();
          const logger = createSafeLogger(() => {});
          const nowMs = 1_750_000_000_000;
          const deps = {
            tokenRegistry: registry,
            rateLimiter,
            relay,
            logger,
            now: () => nowMs,
          };

          const ingestPost = createIngestPostHandler(deps);
          const pullGet = createIngestPullGetHandler(deps);
          const ackPost = createIngestAckPostHandler(deps);

          // 1. Missing, malformed, and unknown tokens all get 401
          const badHeadersList: HeadersInit[] = [
            {},
            { Authorization: '' },
            { Authorization: 'Bearer ' },
            { Authorization: `Basic ${tokenA}` },
            { Authorization: `Bearer ${unknownToken}` },
            { 'x-ingest-token': unknownToken },
          ];
          for (const headers of badHeadersList) {
            const unauthIngest = await ingestPost(
              new Request('https://companion.example/api/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(draft),
              })
            );
            expect(unauthIngest.status).toBe(401);

            const unauthPull = await pullGet(
              new Request('https://companion.example/api/ingest/pull', {
                method: 'GET',
                headers,
              })
            );
            expect(unauthPull.status).toBe(401);
          }

          // 2. Ingest with tokenA while attempting to spoof seniorId=seniorB in body AND query
          const ingestRes = await ingestPost(
            new Request(
              `https://companion.example/api/ingest?seniorId=${encodeURIComponent(seniorB)}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${tokenA}`,
                },
                body: JSON.stringify({
                  ...draft,
                  seniorId: seniorB,
                }),
              }
            )
          );
          expect(ingestRes.status).toBe(200);
          const ingestBody = (await ingestRes.json()) as { ok: boolean; id: string };
          expect(ingestBody.ok).toBe(true);
          expect(typeof ingestBody.id).toBe('string');

          // 3. Stored relay record is AES-256-GCM encrypted at rest and scoped to seniorA
          const envelopes = relay.inspectStoredEnvelopes();
          expect(envelopes).toHaveLength(1);
          const env = envelopes[0];
          expect(env.id).toBe(ingestBody.id);
          expect(env.seniorId).toBe(seniorA);
          expect(env.createdAtMs).toBe(nowMs);
          expect(env.expiresAtMs).toBe(nowMs + RELAY_TTL_MS);
          expect(env.ivHex.length).toBeGreaterThanOrEqual(24);
          expect(env.authTagHex.length).toBe(32);
          const serializedEnv = JSON.stringify(env);
          expect(serializedEnv).not.toContain(draft.text);

          // 4. Tenant B cannot pull Tenant A's item (even spoofing query seniorId=seniorA)
          const pullB = await pullGet(
            new Request(
              `https://companion.example/api/ingest/pull?seniorId=${encodeURIComponent(seniorA)}`,
              {
                method: 'GET',
                headers: { Authorization: `Bearer ${tokenB}` },
              }
            )
          );
          expect(pullB.status).toBe(200);
          const pullBBody = (await pullB.json()) as { items: unknown[] };
          expect(pullBBody.items).toEqual([]);

          // 5. Tenant B cannot ack/delete Tenant A's item
          const ackB = await ackPost(
            new Request('https://companion.example/api/ingest/ack', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokenB}`,
              },
              body: JSON.stringify({ ids: [ingestBody.id], seniorId: seniorA }),
            })
          );
          expect(ackB.status).toBe(204);
          expect(relay.inspectStoredEnvelopes()).toHaveLength(1);

          // 6. Tenant A pulls its exact decrypted item
          const pullA = await pullGet(
            new Request('https://companion.example/api/ingest/pull', {
              method: 'GET',
              headers: { 'x-ingest-token': tokenA },
            })
          );
          expect(pullA.status).toBe(200);
          const pullABody = (await pullA.json()) as {
            items: Array<{ id: string; draft: InboxItemDraft; createdAtMs: number }>;
          };
          expect(pullABody.items).toHaveLength(1);
          expect(pullABody.items[0].id).toBe(ingestBody.id);
          expect(pullABody.items[0].draft).toEqual(draft);

          // 7. Tenant A acks and deletes its own item
          const ackA = await ackPost(
            new Request('https://companion.example/api/ingest/ack', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokenA}`,
              },
              body: JSON.stringify({ ids: [ingestBody.id] }),
            })
          );
          expect(ackA.status).toBe(204);
          expect(relay.inspectStoredEnvelopes()).toHaveLength(0);

          // 8. Revoking tokenA immediately rejects subsequent calls with 401
          expect(registry.revokeToken(tokenA)).toBe(true);
          const afterRevoke = await pullGet(
            new Request('https://companion.example/api/ingest/pull', {
              method: 'GET',
              headers: { Authorization: `Bearer ${tokenA}` },
            })
          );
          expect(afterRevoke.status).toBe(401);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 43: Rate limiting
  it('Property 43: enforces exact 60-requests-per-60s sliding window per token without counting rejected requests or leaking across tokens', () => {
    const WINDOW_MS = 60_000;
    const LIMIT = 60;

    fc.assert(
      fc.property(
        tokenArb,
        tokenArb,
        fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
        fc.array(
          fc.record({
            which: fc.constantFrom<'A' | 'B'>('A', 'B'),
            deltaMs: fc.integer({ min: 0, max: 2_500 }),
          }),
          { minLength: 65, maxLength: 140 }
        ),
        (tokenA, tokenB, baseMs, events) => {
          fc.pre(tokenA !== tokenB);

          const limiter = createRateLimiter();
          const oracleAllowed = new Map<string, number[]>([
            [tokenA, []],
            [tokenB, []],
          ]);

          let currentMs = baseMs;
          for (const ev of events) {
            currentMs += ev.deltaMs;
            const tok = ev.which === 'A' ? tokenA : tokenB;
            const hist = oracleAllowed.get(tok)!;
            const active = hist.filter(
              (ts) => ts > currentMs - WINDOW_MS && ts <= currentMs
            );
            const expectedAllowed = active.length < LIMIT;

            const result = limiter.check(tok, currentMs);

            if (expectedAllowed) {
              expect(result.allowed).toBe(true);
              if (result.allowed) {
                expect(result.remaining).toBe(LIMIT - (active.length + 1));
              }
              active.push(currentMs);
              oracleAllowed.set(tok, active);
            } else {
              expect(result.allowed).toBe(false);
              if (!result.allowed) {
                expect(result.status).toBe(429);
                expect(typeof result.body.error).toBe('string');
                expect(result.body.error.length).toBeGreaterThan(0);
              }
              // Rejected request MUST NOT be recorded
              oracleAllowed.set(tok, active);
            }
          }

          // Explicit check: burst 60 at t0, reject at t0 + 30_000, allow immediately at t0 + 60_000
          const burstLimiter = createRateLimiter();
          const t0 = baseMs;
          for (let i = 0; i < LIMIT; i += 1) {
            const r = burstLimiter.check(tokenA, t0);
            expect(r.allowed).toBe(true);
          }
          // Token B is completely unaffected
          expect(burstLimiter.check(tokenB, t0).allowed).toBe(true);
          // Rejected requests inside the window do not count toward the window
          for (let i = 0; i < 10; i += 1) {
            const rejected = burstLimiter.check(tokenA, t0 + 30_000);
            expect(rejected.allowed).toBe(false);
            if (!rejected.allowed) {
              expect(rejected.status).toBe(429);
            }
          }
          // At t0 + 59_999 still blocked
          expect(burstLimiter.check(tokenA, t0 + WINDOW_MS - 1).allowed).toBe(false);
          // At exactly t0 + 60_000, window (t0, t0 + 60_000] excludes t0 -> allowed!
          const recovered = burstLimiter.check(tokenA, t0 + WINDOW_MS);
          expect(recovered.allowed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 44: Logs never contain secrets or content
  it('Property 44: logs only whitelisted route, status, and durationMs and never leaks tokens, API keys, message content, summaries, or errors', async () => {
    const SAFE_LOG_PATTERN =
      /^route=(?:\/api\/ingest(?:\/email|\/pull|\/ack)?|\/api\/decide|middleware|unknown) status=\d+ durationMs=\d+$/;

    const canaryArb = (prefix: string) =>
      fc.stringMatching(/^[A-Z0-9]{10,18}$/).map((s) => `${prefix}_${s}`);

    await fc.assert(
      fc.asyncProperty(
        canaryArb('TOKSEC'),
        canaryArb('AIKEYSEC'),
        canaryArb('BODYSEC'),
        canaryArb('SENDERSEC'),
        canaryArb('SUMMARYSEC'),
        canaryArb('ERRSEC'),
        channelArb,
        async (
          secretToken,
          secretApiKey,
          secretContent,
          secretSender,
          secretSummary,
          secretError,
          channel
        ) => {
          const lines: string[] = [];
          const logger = createSafeLogger((line) => lines.push(line));

          // 1. Direct logger check with extra poisoned fields and non-whitelisted route
          logger.log({
            route: `/api/ingest?token=${secretToken}`,
            status: 200,
            durationMs: 12,
            text: secretContent,
            token: secretToken,
            apiKey: secretApiKey,
            summary: secretSummary,
            error: secretError,
          } as unknown as SafeLogRecord);

          // 2. Route handlers across normal, 400, 401, 500, and decide paths
          const registry = new TokenRegistry({ includeDefaultDevToken: false });
          registry.registerToken(secretToken, 'senior-prop44');
          const rateLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 });
          const relay = new EncryptedRelayStore();
          const deps = {
            tokenRegistry: registry,
            rateLimiter,
            relay,
            logger,
            now: () => 1_750_000_000_000,
          };

          const ingestPost = createIngestPostHandler(deps);
          const emailPost = createIngestEmailPostHandler(deps);
          const pullGet = createIngestPullGetHandler(deps);
          const ackPost = createIngestAckPostHandler(deps);
          const decidePost = createDecidePostHandler({
            logger,
            env: { AI_API_KEY: secretApiKey },
            aiProvider: async () => ({
              summary: {
                fromApp: 'From Email',
                whoSent: secretSender,
                actionNeeded: 'No action needed',
                text: `Summary containing ${secretSummary}`,
              },
              group: 'Personal',
              priority: 'Important',
              confidence: 0.9,
            }),
          });

          // Valid ingest
          const r1 = await ingestPost(
            new Request('https://companion.example/api/ingest', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secretToken}`,
              },
              body: JSON.stringify({
                source: channel,
                sender: secretSender,
                text: `Private note ${secretContent}`,
              }),
            })
          );
          expect(r1.status).toBe(200);
          const { id } = (await r1.json()) as { id: string };

          // Invalid ingest (400)
          const r2 = await ingestPost(
            new Request('https://companion.example/api/ingest', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secretToken}`,
              },
              body: JSON.stringify({
                source: 'bad-app',
                text: secretContent,
              }),
            })
          );
          expect(r2.status).toBe(400);

          // Unauthorized email ingest (401)
          const r3 = await emailPost(
            new Request('https://companion.example/api/ingest/email', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer wrong_${secretToken}`,
              },
              body: JSON.stringify({
                subject: secretContent,
                body: secretContent,
                from: secretSender,
              }),
            })
          );
          expect(r3.status).toBe(401);

          // Pull + Ack
          await pullGet(
            new Request('https://companion.example/api/ingest/pull', {
              method: 'GET',
              headers: { Authorization: `Bearer ${secretToken}` },
            })
          );
          await ackPost(
            new Request('https://companion.example/api/ingest/ack', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secretToken}`,
              },
              body: JSON.stringify({ ids: [id] }),
            })
          );

          // Decide with secret AI key
          const decideRes = await decidePost(
            new Request('https://companion.example/api/decide', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item: { channel, text: `Inspect ${secretContent}` },
              }),
            })
          );
          expect(decideRes.status).toBe(200);
          const decideRaw = await decideRes.text();
          expect(decideRaw).not.toContain(secretApiKey);

          // Forced unexpected 500 error containing secretError
          const crashingRelay = {
            enqueue: () => {
              throw new Error(`DB boom ${secretError} ${secretContent}`);
            },
            pull: () => [],
            ack: () => 0,
            inspectStoredEnvelopes: () => [],
          } as unknown as EncryptedRelayStore;

          const crashingIngest = createIngestPostHandler({
            ...deps,
            relay: crashingRelay,
          });
          const r500 = await crashingIngest(
            new Request('https://companion.example/api/ingest', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secretToken}`,
              },
              body: JSON.stringify({
                source: channel,
                text: secretContent,
              }),
            })
          );
          expect(r500.status).toBe(500);
          const r500Text = await r500.text();
          expect(r500Text).not.toContain(secretError);
          expect(r500Text).not.toContain(secretContent);
          expect(r500Text).not.toContain(secretToken);

          // Every single log line must strictly match the safe format and contain zero secrets
          expect(lines.length).toBeGreaterThanOrEqual(7);
          const forbidden = [
            secretToken,
            secretApiKey,
            secretContent,
            secretSender,
            secretSummary,
            secretError,
          ];
          for (const line of lines) {
            expect(line).toMatch(SAFE_LOG_PATTERN);
            for (const secret of forbidden) {
              expect(line).not.toContain(secret);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
