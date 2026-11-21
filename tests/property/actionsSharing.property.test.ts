import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  ALL_CHANNELS,
  type AuditEntry,
  type Channel,
  type ClaritySummary,
  type DecisionTier,
  type DetectedEvent,
  type InboxItem,
  type Result,
  type Settings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import {
  type Confirmation,
  confirmFromTap,
  isValidConfirmation,
} from '@/lib/actions/confirmation';
import {
  type Action,
  type ActionSideEffects,
  dismissProposal,
  execute,
  idleProposal,
} from '@/lib/actions/executor';
import {
  buildFamilySharePayload,
  canShowAskFamily,
  shareItemWithFamily,
  shouldOfferEnableSharing,
} from '@/lib/actions/sharing';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);
const tierArb: fc.Arbitrary<DecisionTier> = fc.constantFrom(1, 2, 3);
const actionIdArb: fc.Arbitrary<string> = fc.stringMatching(
  /^act-[a-zA-Z0-9_-]{2,20}$/
);

const detectedEventArb: fc.Arbitrary<DetectedEvent> = fc.record({
  date: fc.constantFrom('2025-05-15', '2026-02-28', '2026-11-21'),
  time: fc.constantFrom('09:30', '14:00', '18:45'),
  location: fc.option(fc.constantFrom('City Clinic', 'Room 4B'), {
    nil: undefined,
  }),
  title: fc.constantFrom('Clinic appointment', 'Family dinner', 'Dental visit'),
});

const singleStepActionArb: fc.Arbitrary<
  Exclude<Action, { kind: 'eraseAll' }>
> = fc.oneof(
  fc.record({
    actionId: actionIdArb,
    kind: fc.constant('forwardToCalendar' as const),
    event: detectedEventArb,
    itemId: fc.stringMatching(/^item-[0-9]{1,6}$/),
  }),
  fc.record({
    actionId: actionIdArb,
    kind: fc.constant('shareWithFamily' as const),
    itemId: fc.stringMatching(/^item-[0-9]{1,6}$/),
    recipient: fc.constantFrom('Amina', 'Wei Ling', 'David'),
  }),
  fc.record({
    actionId: actionIdArb,
    kind: fc.constantFrom(
      'sendMessage' as const,
      'deleteOriginal' as const,
      'openLink' as const,
      'pay' as const,
      'commitCalendarChange' as const,
      'commitMedication' as const
    ),
    payload: fc.record({ ref: fc.string({ minLength: 1, maxLength: 20 }) }),
  })
);

const secretCodeWordArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z0-9]{6,12}$/)
  .map((s) => `FAMILY_SECRET_${s}`);

const claritySummaryArb: fc.Arbitrary<ClaritySummary> = fc.record({
  fromApp: fc.constantFrom(
    'From Email',
    'From WhatsApp',
    'From SMS',
    'From Messenger',
    'From Photo'
  ),
  whoSent: fc.constantFrom('City Clinic', 'Unknown sender', 'Neighbor'),
  actionNeeded: fc.constantFrom(
    'No action needed',
    'Confirm calendar date',
    'Do not click link — check for scam'
  ),
  text: fc.constantFrom(
    'Clinic shared a checkup reminder for tomorrow.',
    'An unknown sender asked for urgent payment. Do not click any link.'
  ),
});

const inboxItemArb: fc.Arbitrary<InboxItem> = fc.record({
  id: fc.stringMatching(/^item-[a-z0-9]{4,12}$/),
  source: channelArb,
  sender: fc.option(fc.constantFrom('City Clinic', 'Neighbor', 'Unknown'), {
    nil: undefined,
  }),
  text: fc.string({ minLength: 1, maxLength: 160 }),
  attachments: fc.constant([]),
  receivedAt: fc
    .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
    .map((ms) => new Date(ms).toISOString()),
  group: fc.constantFrom('Personal', 'Family', 'Others'),
  priority: fc.constantFrom('Important', 'Social', 'Promotion'),
  summary: claritySummaryArb,
  tier: tierArb,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  status: fc.constant('ok' as const),
});

const settingsArb: fc.Arbitrary<Settings> = fc.record({
  channels: fc.record({
    email: fc.boolean(),
    whatsappForward: fc.boolean(),
    smsPaste: fc.boolean(),
    messengerPaste: fc.boolean(),
    photos: fc.boolean(),
  }),
  allowAiReading: fc.boolean(),
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

function makeSpySideEffects(): {
  deps: ActionSideEffects;
  totalCalls: () => number;
  spies: {
    saveCalendarEvent: ReturnType<typeof vi.fn>;
    sendFamilyShare: ReturnType<typeof vi.fn>;
    runProtectedSideEffect: ReturnType<typeof vi.fn>;
    runEraseAll: ReturnType<typeof vi.fn>;
  };
} {
  const saveCalendarEvent = vi.fn(
    async (): Promise<Result<void, string>> => ({ ok: true, value: undefined })
  );
  const sendFamilyShare = vi.fn(
    async (): Promise<Result<void, string>> => ({ ok: true, value: undefined })
  );
  const runProtectedSideEffect = vi.fn(
    async (): Promise<Result<void, string>> => ({ ok: true, value: undefined })
  );
  const runEraseAll = vi.fn(
    async (): Promise<Result<void, string>> => ({ ok: true, value: undefined })
  );

  return {
    deps: {
      saveCalendarEvent,
      sendFamilyShare,
      runProtectedSideEffect,
      runEraseAll,
    },
    spies: {
      saveCalendarEvent,
      sendFamilyShare,
      runProtectedSideEffect,
      runEraseAll,
    },
    totalCalls: () =>
      saveCalendarEvent.mock.calls.length +
      sendFamilyShare.mock.calls.length +
      runProtectedSideEffect.mock.calls.length +
      runEraseAll.mock.calls.length,
  };
}

function makeAuditVault(): {
  vault: Pick<Vault, 'appendAudit'>;
  entries: AuditEntry[];
} {
  const entries: AuditEntry[] = [];
  const vault: Pick<Vault, 'appendAudit'> = {
    async appendAudit(entry: AuditEntry): Promise<Result<void, StoreError>> {
      entries.push(entry);
      return { ok: true, value: undefined };
    },
  };
  return { vault, entries };
}

describe('ActionExecutor confirmation gate and caregiver sharing properties', () => {
  // Feature: senior-digital-companion, Property 10: No side effect without a matching confirmation
  it('Property 10: executes zero side effects without a validly minted matching Confirmation, including two-step eraseAll', async () => {
    // 1. Single-step actions: missing, forged, cloned, mismatched, and valid confirmations
    await fc.assert(
      fc.asyncProperty(
        singleStepActionArb,
        actionIdArb,
        async (action, otherIdRaw) => {
          const otherId =
            otherIdRaw === action.actionId ? `${otherIdRaw}-diff` : otherIdRaw;

          // Missing confirmation
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const res = await execute(action, undefined, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(totalCalls()).toBe(0);
          }

          // Forged plain object cast as Confirmation
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const forged = { actionId: action.actionId } as unknown as Confirmation;
            expect(isValidConfirmation(forged, action.actionId)).toBe(false);
            const res = await execute(action, forged, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(totalCalls()).toBe(0);
          }

          // Shallow-cloned valid Confirmation (loses brand identity)
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const cloned = {
              ...confirmFromTap(action.actionId),
            } as unknown as Confirmation;
            expect(isValidConfirmation(cloned, action.actionId)).toBe(false);
            const res = await execute(action, cloned, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(totalCalls()).toBe(0);
          }

          // Valid Confirmation minted for a DIFFERENT actionId -> mismatch
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const wrongToken = confirmFromTap(otherId);
            expect(isValidConfirmation(wrongToken, action.actionId)).toBe(false);
            const res = await execute(action, wrongToken, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('mismatch');
            expect(totalCalls()).toBe(0);
          }

          // Valid matching Confirmation -> executes exactly the matching side effect once
          {
            const { deps, spies, totalCalls } = makeSpySideEffects();
            const validToken = confirmFromTap(action.actionId);
            expect(isValidConfirmation(validToken, action.actionId)).toBe(true);
            const res = await execute(action, validToken, deps);
            expect(res).toEqual({ ok: true, value: undefined });
            expect(totalCalls()).toBe(1);
            if (action.kind === 'forwardToCalendar') {
              expect(spies.saveCalendarEvent).toHaveBeenCalledWith(
                action.event,
                action.itemId
              );
            } else if (action.kind === 'shareWithFamily') {
              expect(spies.sendFamilyShare).toHaveBeenCalledWith(
                action.itemId,
                action.recipient
              );
            } else {
              expect(spies.runProtectedSideEffect).toHaveBeenCalledWith(
                action.kind,
                action.payload
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );

    // 2. Two-step eraseAll requires BOTH step1 and step2 valid matching confirmations
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        actionIdArb,
        actionIdArb,
        async (actionId, s1Raw, s2Raw) => {
          const step1ActionId = `${s1Raw}-s1`;
          const step2ActionId = `${s2Raw}-s2`;
          const eraseAction: Action = {
            actionId,
            kind: 'eraseAll',
            step1ActionId,
            step2ActionId,
          };

          const c1 = confirmFromTap(step1ActionId);
          const c2 = confirmFromTap(step2ActionId);

          // Only step1 -> rejected, 0 calls
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const res = await execute(eraseAction, { step1: c1 }, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(totalCalls()).toBe(0);
          }

          // Only step2 -> rejected, 0 calls
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const res = await execute(eraseAction, { step2: c2 }, deps);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(totalCalls()).toBe(0);
          }

          // Swapped step1/step2 -> mismatch, 0 calls
          {
            const { deps, totalCalls } = makeSpySideEffects();
            const res = await execute(
              eraseAction,
              { step1: c2, step2: c1 },
              deps
            );
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('mismatch');
            expect(totalCalls()).toBe(0);
          }

          // Both valid and matching -> succeeds, runEraseAll called once
          {
            const { deps, spies, totalCalls } = makeSpySideEffects();
            const res = await execute(
              eraseAction,
              { step1: c1, step2: c2 },
              deps
            );
            expect(res).toEqual({ ok: true, value: undefined });
            expect(spies.runEraseAll).toHaveBeenCalledTimes(1);
            expect(totalCalls()).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );

    // 3. Empty/whitespace actionId rejected by confirmFromTap & proposal queue helpers never auto-execute
    expect(() => confirmFromTap('')).toThrow();
    expect(() => confirmFromTap('   ')).toThrow();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (elapsedMs) => {
        const pending = { status: 'pending' as const };
        expect(idleProposal(pending, elapsedMs)).toEqual({ status: 'pending' });
        expect(dismissProposal(pending)).toEqual({ status: 'dismissed' });
      }),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 11: Sharing sends only the confirmed single item
  it('Property 11: gates sharing on caregiverShareEnabled + valid confirmation, sends only the single item without familyCodeWord, and audits only on success', async () => {
    await fc.assert(
      fc.asyncProperty(
        inboxItemArb,
        settingsArb,
        tierArb,
        actionIdArb,
        fc.constantFrom('Amina', 'Wei Ling', 'David Tan'),
        fc.boolean(),
        fc.boolean(),
        async (
          baseItem,
          settings,
          tier,
          actionId,
          recipient,
          confirmValid,
          transportSucceeds
        ) => {
          // Helper predicates
          expect(canShowAskFamily(settings)).toBe(
            settings.caregiverShareEnabled
          );
          expect(shouldOfferEnableSharing(settings, tier)).toBe(
            !settings.caregiverShareEnabled && tier === 3
          );

          // Inject familyCodeWord into item text & metadata to verify explicit stripping
          const codeWord = settings.familyCodeWord ?? 'FAMILY_SECRET_DEFAULT';
          const itemWithLeakedWord: InboxItem = {
            ...baseItem,
            text: `${baseItem.text} ${codeWord}`,
            sender: baseItem.sender ? `${baseItem.sender} ${codeWord}` : undefined,
            summary: baseItem.summary
              ? {
                  ...baseItem.summary,
                  text: `${baseItem.summary.text} ${codeWord}`,
                }
              : undefined,
          };

          const payload = buildFamilySharePayload(itemWithLeakedWord, settings);
          const payloadJson = JSON.stringify(payload);
          const allowedKeys = new Set([
            'itemId',
            'source',
            'sender',
            'text',
            'summary',
          ]);
          for (const key of Object.keys(payload)) {
            expect(allowedKeys.has(key)).toBe(true);
          }
          expect(payload.itemId).toBe(itemWithLeakedWord.id);
          expect(payload.source).toBe(itemWithLeakedWord.source);
          expect(payloadJson).not.toContain(codeWord);
          for (const member of settings.familyMembers) {
            expect(payloadJson).not.toContain(member.address);
          }

          // Execute shareItemWithFamily across all consent / confirmation / transport outcomes
          const { vault, entries } = makeAuditVault();
          const sentPayloads: Array<{
            payload: ReturnType<typeof buildFamilySharePayload>;
            recipient: string;
          }> = [];
          const sendTransport = vi.fn(
            async (
              p: ReturnType<typeof buildFamilySharePayload>,
              r: string
            ): Promise<Result<void, string>> => {
              sentPayloads.push({ payload: p, recipient: r });
              if (!transportSucceeds) {
                return {
                  ok: false,
                  error: 'Could not reach your family right now.',
                };
              }
              return { ok: true, value: undefined };
            }
          );

          const confirmation = confirmValid
            ? confirmFromTap(actionId)
            : undefined;

          const res = await shareItemWithFamily({
            item: itemWithLeakedWord,
            recipient,
            settings,
            confirmation,
            actionId,
            vault,
            sendTransport,
          });

          if (!settings.caregiverShareEnabled) {
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('sharing-off');
            expect(sendTransport).not.toHaveBeenCalled();
            expect(entries).toHaveLength(0);
          } else if (!confirmValid) {
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error.code).toBe('unconfirmed');
            expect(sendTransport).not.toHaveBeenCalled();
            expect(entries).toHaveLength(0);
          } else if (!transportSucceeds) {
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.error.code).toBe('send-failed');
              expect(res.error.canRetry).toBe(true);
            }
            expect(sendTransport).toHaveBeenCalledTimes(1);
            expect(entries).toHaveLength(0);
          } else {
            expect(res).toEqual({ ok: true, value: { sent: true } });
            expect(sendTransport).toHaveBeenCalledTimes(1);
            expect(sentPayloads).toHaveLength(1);
            expect(sentPayloads[0].recipient).toBe(recipient);
            expect(JSON.stringify(sentPayloads[0].payload)).not.toContain(
              codeWord
            );
            expect(entries).toHaveLength(1);
            expect(entries[0].kind).toBe('family-share');
            expect(entries[0].itemId).toBe(itemWithLeakedWord.id);
            expect(entries[0].recipient).toBe(recipient);
            expect(entries[0].description.trim().length).toBeGreaterThanOrEqual(
              1
            );
            expect(entries[0].description.length).toBeLessThanOrEqual(200);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
