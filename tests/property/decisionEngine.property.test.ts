import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  ALL_CHANNELS,
  LOW_CONFIDENCE_THRESHOLD,
  type Attachment,
  type AuditEntry,
  type Channel,
  type DecisionTier,
  type GroupCategory,
  type InboxItemDraft,
  type PriorityType,
  type Proposal,
  type ProposalKind,
  type Result,
  type Settings,
  type Verdict,
  type VerdictValue,
  createDefaultSettings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import { analyzeWithRules } from '@/lib/ai/rules';
import { assignTier } from '@/lib/ai/tiering';
import {
  buildDecideProxyRequest,
  callDecideProxy,
} from '@/lib/ai/proxyClient';
import { analyze } from '@/lib/ai/engine';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);
const groupArb: fc.Arbitrary<GroupCategory> = fc.constantFrom(
  'Personal',
  'Family',
  'Others'
);
const priorityArb: fc.Arbitrary<PriorityType> = fc.constantFrom(
  'Important',
  'Social',
  'Promotion'
);
const verdictValueArb: fc.Arbitrary<VerdictValue> = fc.constantFrom(
  'safe',
  'caution',
  'danger'
);
const proposalKindArb: fc.Arbitrary<ProposalKind> = fc.constantFrom(
  'forwardToCalendar',
  'checkScam',
  'checkAiImage',
  'shareWithFamily'
);

const attachmentArb: fc.Arbitrary<Attachment> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  mime: fc.constantFrom('image/jpeg', 'image/png', 'application/pdf', 'text/plain'),
  name: fc.constantFrom('photo.jpg', 'scan.png', 'receipt.pdf', 'note.txt'),
});

const itemInputArb: fc.Arbitrary<InboxItemDraft & { id?: string; source: Channel }> =
  fc.record({
    id: fc.option(
      fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
      { nil: undefined }
    ),
    source: channelArb,
    sender: fc.option(
      fc.constantFrom(
        'City Clinic',
        'Dr. Tan',
        'Amina',
        'Unknown Caller',
        'store@example.com'
      ),
      { nil: undefined }
    ),
    text: fc.string({ minLength: 1, maxLength: 240 }),
    attachments: fc.array(attachmentArb, { maxLength: 2 }),
    receivedAt: fc
      .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
      .map((ms) => new Date(ms).toISOString()),
  });

const secretCodeWordArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z0-9]{6,12}$/)
  .map((s) => `CODEWORD_${s}`);

const settingsWithAiArb = (allowAiReading: boolean): fc.Arbitrary<Settings> =>
  fc.record({
    channels: fc.record({
      email: fc.boolean(),
      whatsappForward: fc.boolean(),
      smsPaste: fc.boolean(),
      messengerPaste: fc.boolean(),
      photos: fc.boolean(),
    }),
    allowAiReading: fc.constant(allowAiReading),
    caregiverShareEnabled: fc.boolean(),
    pushEnabled: fc.boolean(),
    reminderLead: fc.constantFrom('15m', '30m', '1h', '2h', '1d'),
    timeFormat: fc.constantFrom('12h', '24h'),
    familyCodeWord: secretCodeWordArb,
    checklist: fc.constant({}),
    familyMembers: fc.array(
      fc.record({
        id: fc.stringMatching(/^fm-[0-9]{1,4}$/),
        name: fc.constantFrom('Amina', 'Wei Ling', 'David Tan'),
        address: fc.constantFrom(
          'amina@family.example',
          'weiling@family.example',
          'david@family.example'
        ),
      }),
      { minLength: 1, maxLength: 3 }
    ),
  });

const proposalArb: fc.Arbitrary<Proposal> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  kind: proposalKindArb,
  label: fc.string({ minLength: 1, maxLength: 40 }),
  itemId: fc.string({ minLength: 1, maxLength: 20 }),
});

const verdictArb: fc.Arbitrary<Verdict> = fc.record({
  value: verdictValueArb,
  reasons: fc.array(fc.string({ minLength: 1, maxLength: 60 }), {
    minLength: 1,
    maxLength: 3,
  }),
  flags: fc.array(
    fc.constantFrom('urgency', 'secrecy', 'payment', 'domain-mismatch'),
    { maxLength: 3 }
  ),
});

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
            message: 'We could not record that activity. Please try again.',
          },
        };
      }
      entries.push(entry);
      return { ok: true, value: undefined };
    },
  };
  return { vault, entries };
}

describe('Decision engine, proxy client, and tiering properties', () => {
  // Feature: senior-digital-companion, Property 3: AI off means no external calls
  it('Property 3: makes zero external calls and writes zero audit entries when allowAiReading is false', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemInputArb,
        settingsWithAiArb(false),
        async (item, settings) => {
          const { vault, entries } = makeMockVault();
          const fetchFn = vi.fn<typeof fetch>();

          const res = await analyze(item, settings, { vault, fetchFn });

          expect(res.ok).toBe(true);
          if (!res.ok) return;

          expect(fetchFn).not.toHaveBeenCalled();
          expect(entries).toHaveLength(0);
          expect(res.value.usedFallback).toBe(false);
          expect(res.value.notice).toBeUndefined();

          const expectedRules = analyzeWithRules(item, { itemId: item.id });
          expect(res.value.analysis).toEqual(expectedRules);
          expect(res.value.tier).toBe(assignTier(expectedRules));
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 4: AI request contains only the inspected item
  it('Property 4: sends only the single inspected item channel and text, never settings, familyCodeWord, sender, or prior items', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemInputArb,
        settingsWithAiArb(true),
        fc.stringMatching(/^PRIOR_SECRET_[A-Z0-9]{6,10}$/),
        async (rawItem, settings, priorSecret) => {
          const item = {
            ...rawItem,
            sender: `SECRET_SENDER_${rawItem.id ?? 'x'}`,
            text: `Check message ${rawItem.text.slice(0, 80)}`,
          };

          // 1. Pure builder check
          const built = buildDecideProxyRequest(item);
          expect(Object.keys(built)).toEqual(['item']);
          expect(Object.keys(built.item).sort()).toEqual(['channel', 'text']);
          expect(built.item).toEqual({ channel: item.source, text: item.text });

          // 2. End-to-end analyze check inspecting outgoing fetch payload
          const { vault } = makeMockVault();
          const capturedBodies: string[] = [];
          const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
            capturedBodies.push(String(init?.body ?? ''));
            return new Response(
              JSON.stringify({
                group: 'Personal',
                priority: 'Important',
                confidence: 0.9,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });

          const res = await analyze(item, settings, { vault, fetchFn });
          expect(res.ok).toBe(true);
          expect(fetchFn).toHaveBeenCalledTimes(1);
          expect(capturedBodies).toHaveLength(1);

          const rawBody = capturedBodies[0];
          const parsed = JSON.parse(rawBody) as Record<string, unknown>;
          expect(Object.keys(parsed)).toEqual(['item']);
          const itemObj = parsed.item as Record<string, unknown>;
          expect(Object.keys(itemObj).sort()).toEqual(['channel', 'text']);
          expect(itemObj.channel).toBe(item.source);
          expect(itemObj.text).toBe(item.text);

          // Must not leak code word, sender, family members, or unrelated prior text
          if (settings.familyCodeWord) {
            expect(rawBody).not.toContain(settings.familyCodeWord);
          }
          expect(rawBody).not.toContain(item.sender);
          expect(rawBody).not.toContain(priorSecret);
          for (const member of settings.familyMembers) {
            expect(rawBody).not.toContain(member.address);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 6: Fallback on AI failure
  it('Property 6: falls back to on-device rules without retrying and keeps allowAiReading untouched on any proxy failure', async () => {
    const failureModeArb = fc.constantFrom(
      'network-error',
      'http-500',
      'http-503',
      'bad-json',
      'invalid-schema',
      'timeout'
    );

    await fc.assert(
      fc.asyncProperty(
        itemInputArb,
        settingsWithAiArb(true),
        failureModeArb,
        async (item, settings, mode) => {
          const { vault } = makeMockVault();
          const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
            if (mode === 'network-error') {
              throw new Error('ECONNREFUSED');
            }
            if (mode === 'http-500') {
              return new Response('Internal Server Error', { status: 500 });
            }
            if (mode === 'http-503') {
              return new Response('Service Unavailable', { status: 503 });
            }
            if (mode === 'bad-json') {
              return new Response('not valid json{{{', { status: 200 });
            }
            if (mode === 'invalid-schema') {
              return new Response(
                JSON.stringify({ group: 'INVALID_GROUP', confidence: 'oops' }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            // timeout mode: wait until abort signal fires
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                reject(err);
              });
            });
          });

          const res = await analyze(item, settings, {
            vault,
            fetchFn,
            timeoutMs: 5,
          });

          expect(res.ok).toBe(true);
          if (!res.ok) return;

          // At most one attempt (zero retries)
          expect(fetchFn).toHaveBeenCalledTimes(1);
          // Settings untouched
          expect(settings.allowAiReading).toBe(true);
          // Fallback analysis matches on-device rules
          const expectedRules = analyzeWithRules(item, { itemId: item.id });
          expect(res.value.usedFallback).toBe(true);
          expect(res.value.notice).toBe('A simpler on-device check was used.');
          expect(res.value.analysis).toEqual(expectedRules);
          expect(res.value.tier).toBe(assignTier(expectedRules));
        }
      ),
      { numRuns: 100 }
    );

    // Also verify callDecideProxy directly handles timeout without hanging even if fetch ignores signal
    const hangingFetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const timeoutRes = await callDecideProxy(
      { source: 'email', text: 'Hello' },
      { fetchFn: hangingFetch, timeoutMs: 10 }
    );
    expect(timeoutRes.ok).toBe(false);
    if (!timeoutRes.ok) {
      expect(timeoutRes.error.reason).toBe('timeout');
    }
    expect(hangingFetch).toHaveBeenCalledTimes(1);
  });

  // Feature: senior-digital-companion, Property 7: Audit before read
  it('Property 7: always writes an ai-read audit entry before calling the proxy and aborts before fetch if audit write fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemInputArb,
        settingsWithAiArb(true),
        fc.boolean(),
        async (item, settings, failAudit) => {
          const callOrder: string[] = [];
          const { vault, entries } = makeMockVault({
            failAudit,
            onAudit: () => {
              callOrder.push('audit');
            },
          });

          const fetchFn = vi.fn<typeof fetch>(async () => {
            callOrder.push('fetch');
            return new Response(JSON.stringify({ confidence: 0.9 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          });

          const res = await analyze(item, settings, { vault, fetchFn });

          if (failAudit) {
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.error.code).toBe('audit-write-failed');
              expect(res.error.message).toBe(
                'This item was not read because the record could not be saved.'
              );
            }
            expect(fetchFn).not.toHaveBeenCalled();
            expect(callOrder).toEqual(['audit']);
            expect(entries).toHaveLength(0);
          } else {
            expect(res.ok).toBe(true);
            expect(callOrder).toEqual(['audit', 'fetch']);
            expect(entries).toHaveLength(1);
            const entry = entries[0];
            expect(entry.kind).toBe('ai-read');
            expect(entry.channel).toBe(item.source);
            expect(entry.description.trim().length).toBeGreaterThanOrEqual(1);
            expect(entry.description.length).toBeLessThanOrEqual(200);
            expect(entry.purpose).toBeDefined();
            expect(entry.purpose!.trim().length).toBeGreaterThanOrEqual(1);
            expect(entry.purpose!.length).toBeLessThanOrEqual(200);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 9: Tier assignment
  it('Property 9: assigns Tier 3 on danger or confidence < 0.6, Tier 2 when proposals exist, and Tier 1 otherwise', async () => {
    await fc.assert(
      fc.property(
        fc.option(verdictArb, { nil: undefined }),
        fc.oneof(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.constantFrom(0, 0.59, 0.5999, LOW_CONFIDENCE_THRESHOLD, 0.61, 1)
        ),
        fc.array(proposalArb, { maxLength: 4 }),
        (verdict, confidence, proposals) => {
          const tier: DecisionTier = assignTier({
            verdict,
            confidence,
            proposals,
          });

          if (
            verdict?.value === 'danger' ||
            confidence < LOW_CONFIDENCE_THRESHOLD
          ) {
            expect(tier).toBe(3);
          } else if (proposals.length > 0) {
            expect(tier).toBe(2);
          } else {
            expect(tier).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );

    // Also verify proxy merge recomputes tier locally and ignores proxy-injected verdict/tier fields
    await fc.assert(
      fc.asyncProperty(
        itemInputArb,
        groupArb,
        priorityArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (item, proxyGroup, proxyPriority, proxyConfidence) => {
          const settings: Settings = {
            ...createDefaultSettings(),
            allowAiReading: true,
          };
          const { vault } = makeMockVault();
          const fetchFn = vi.fn<typeof fetch>(async () =>
            new Response(
              JSON.stringify({
                group: proxyGroup,
                priority: proxyPriority,
                confidence: proxyConfidence,
                // Attempted unauthorized overrides must be ignored
                tier: 1,
                verdict: { value: 'safe', reasons: ['spoofed'], flags: [] },
                proposals: [],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );

          const res = await analyze(item, settings, {
            vault,
            fetchFn,
            ruleCtx: {
              verdictOverride: {
                value: 'danger',
                reasons: ['Local danger verdict'],
                flags: ['urgency', 'payment'],
              },
            },
          });

          expect(res.ok).toBe(true);
          if (!res.ok) return;

          expect(res.value.usedFallback).toBe(false);
          expect(res.value.analysis.group).toBe(proxyGroup);
          expect(res.value.analysis.priority).toBe(proxyPriority);
          expect(res.value.analysis.confidence).toBe(proxyConfidence);
          expect(res.value.analysis.verdict?.value).toBe('danger');
          // Local danger verdict forces Tier 3 even if proxy tried to inject tier: 1 and verdict: safe
          expect(res.value.tier).toBe(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});
