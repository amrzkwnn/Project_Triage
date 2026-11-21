import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultSettings,
  type RedFlagCategory,
  type Result,
  type Settings,
} from '@/lib/types';
import type { StoreError, Vault } from '@/lib/vault/schema';
import { extractLinks } from '@/lib/scam/links';
import { checkText } from '@/lib/scam/verdict';
import {
  formatChecklistProgress,
  SAFE_PHONE_CHECKLIST_STEPS,
  SAFETY_HABITS,
  saveFamilyCodeWord,
  toggleChecklistStep,
  validateCodeWord,
} from '@/lib/scam/habits';

const URGENCY_PHRASES = [
  'urgent',
  'immediately',
  'right now',
  'act now',
  'within 24 hours',
  'account suspended',
  'card blocked',
  'emergency',
  'hurry',
  'last warning',
] as const;

const SECRECY_PHRASES = [
  "don't tell",
  'do not tell',
  'keep this secret',
  'tell no one',
  'between us',
  "don't mention to family",
] as const;

const PAYMENT_PHRASES = [
  'gift card',
  'wire transfer',
  'pay now',
  'send money',
  'bank transfer',
  'crypto',
  'bitcoin',
  'pin',
  'otp',
  'verification code',
  'RM 500',
  'fee',
  'bail',
] as const;

const BENIGN_FILLER = [
  'Hello neighbour, hope you are well today.',
  'The garden flowers are blooming nicely this week.',
  'See you at the community hall on Sunday morning.',
  'Thank you for dropping by with the tea.',
] as const;

const CLAIMED_ORGS = ['Maybank', 'CIMB', 'LHDN', 'City Clinic', 'Post Office'] as const;

const MISMATCH_DOMAINS = [
  'fast-login-check.xyz',
  'verify-now-portal.example',
  'unknown-site.test',
  'reward-claim-hub.invalid',
  'secure-update-center.org',
] as const;

function makeMockVault(shouldFail: boolean): {
  vault: Vault;
  getSavedSettings: () => Settings | undefined;
  saveCalls: number;
} {
  let savedSettings: Settings | undefined;
  const state = { saveCalls: 0 };

  const unsupported = async <T>(): Promise<Result<T, StoreError>> => ({
    ok: false,
    error: { code: 'unavailable', message: 'Not used in this test.' },
  });

  const vault: Vault = {
    async getSettings() {
      return {
        ok: true,
        value: savedSettings ? structuredClone(savedSettings) : createDefaultSettings(),
      };
    },
    async saveSettings(next: Settings) {
      state.saveCalls += 1;
      if (shouldFail) {
        return {
          ok: false,
          error: {
            code: 'tx-failed',
            message: 'Could not save your settings right now.',
          },
        };
      }
      savedSettings = structuredClone(next);
      return { ok: true, value: undefined };
    },
    putItem: () => unsupported(),
    listItems: () => unsupported(),
    putEvent: () => unsupported(),
    listEvents: () => unsupported(),
    deleteEvent: () => unsupported(),
    appendAudit: () => unsupported(),
    listAudit: () => unsupported(),
    putBlob: () => unsupported(),
    getBlob: () => unsupported(),
    listBlobs: () => unsupported(),
    saveOAuthToken: () => unsupported(),
    listOAuthTokens: () => unsupported(),
    exportAll: () => unsupported(),
    importAll: async () => ({
      ok: false,
      error: { reason: 'store-error', message: 'Not used in this test.' },
    }),
    eraseAll: () => unsupported(),
  };

  return {
    vault,
    getSavedSettings: () => savedSettings,
    get saveCalls() {
      return state.saveCalls;
    },
  };
}

describe('Scam Shield property tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Feature: senior-digital-companion, Property 28: Verdict shape and determinism
  it('Property 28: returns deterministic verdict with valid shape and 1..3 reasons <= 150 chars for any 1..5000 char text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 5000 }),
        fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
        (text, claimedOrg) => {
          const ctx = claimedOrg !== undefined ? { claimedOrg } : undefined;
          const first = checkText(text, ctx);
          const second = checkText(text, ctx);

          // Determinism
          expect(first).toEqual(second);

          // Valid verdict value
          expect(['safe', 'caution', 'danger']).toContain(first.value);

          // Reasons shape: 1..3 plain-language strings, each <= 150 chars
          expect(first.reasons.length).toBeGreaterThanOrEqual(1);
          expect(first.reasons.length).toBeLessThanOrEqual(3);
          for (const reason of first.reasons) {
            expect(typeof reason).toBe('string');
            expect(reason.trim().length).toBeGreaterThan(0);
            expect(reason.length).toBeLessThanOrEqual(150);
          }

          // Instructions & Ask Family contract (Req 15.4, 15.5)
          if (first.value === 'danger') {
            expect(first.instruction).toBe('Do not click or pay');
            expect(first.showAskFamily).toBe(true);
          } else if (first.value === 'caution') {
            expect(first.instruction).toBe(
              'Hang up and call back using a number saved in your contacts'
            );
            expect(first.showAskFamily).toBe(false);
          } else {
            expect(first.flags).toEqual([]);
            expect(first.showAskFamily).toBe(false);
            expect(first.reasons).toEqual([
              'No urgency, secrecy, payment demands, or mismatched link addresses were found.',
            ]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 29: Red flags are never safe
  it('Property 29: never returns safe when any red flag is present, names every detected category, and names domain + org on mismatch', () => {
    const flagSubsetArb = fc
      .record({
        urgency: fc.boolean(),
        secrecy: fc.boolean(),
        payment: fc.boolean(),
        domainMismatch: fc.boolean(),
      })
      .filter((s) => s.urgency || s.secrecy || s.payment || s.domainMismatch);

    fc.assert(
      fc.property(
        flagSubsetArb,
        fc.constantFrom(...BENIGN_FILLER),
        fc.constantFrom(...URGENCY_PHRASES),
        fc.constantFrom(...SECRECY_PHRASES),
        fc.constantFrom(...PAYMENT_PHRASES),
        fc.constantFrom(...CLAIMED_ORGS),
        fc.constantFrom(...MISMATCH_DOMAINS),
        fc.constantFrom('http://', 'https://', 'https://www.'),
        (
          active,
          filler,
          urgencyPhrase,
          secrecyPhrase,
          paymentPhrase,
          claimedOrg,
          mismatchDomain,
          schemePrefix
        ) => {
          const parts: string[] = [filler];
          const expectedFlags: RedFlagCategory[] = [];

          if (active.urgency) {
            parts.push(`Please respond ${urgencyPhrase}.`);
            expectedFlags.push('urgency');
          }
          if (active.secrecy) {
            parts.push(`Remember to ${secrecyPhrase} about this.`);
            expectedFlags.push('secrecy');
          }
          if (active.payment) {
            parts.push(`You must handle the ${paymentPhrase} today.`);
            expectedFlags.push('payment');
          }
          if (active.domainMismatch) {
            parts.push(`Open ${schemePrefix}${mismatchDomain}/verify`);
            expectedFlags.push('domain-mismatch');
          }

          const text = parts.join(' ');
          const ctx = active.domainMismatch ? { claimedOrg } : undefined;
          const verdict = checkText(text, ctx);

          // Also verify implicit "From <Org>:" detection when ctx is omitted
          if (active.domainMismatch) {
            const implicitVerdict = checkText(`From ${claimedOrg}: ${text}`);
            expect(implicitVerdict.value).not.toBe('safe');
            expect(implicitVerdict.flags).toContain('domain-mismatch');
          }

          // Lookalike short-suffix spoofed domains must also trigger domain-mismatch
          const lookalikeVerdict = checkText('Open https://maybank-my.xyz/login', {
            claimedOrg: 'Maybank',
          });
          expect(lookalikeVerdict.value).not.toBe('safe');
          expect(lookalikeVerdict.flags).toContain('domain-mismatch');

          // Never safe
          expect(verdict.value).not.toBe('safe');
          expect(['caution', 'danger']).toContain(verdict.value);

          // All expected flags detected
          for (const flag of expectedFlags) {
            expect(verdict.flags).toContain(flag);
          }

          // Reasons constraints still hold even when all 4 flags fire
          expect(verdict.reasons.length).toBeGreaterThanOrEqual(1);
          expect(verdict.reasons.length).toBeLessThanOrEqual(3);
          for (const r of verdict.reasons) {
            expect(r.length).toBeLessThanOrEqual(150);
          }

          const joinedReasons = verdict.reasons.join(' ').toLowerCase();
          if (active.urgency) {
            expect(joinedReasons).toContain('urgency');
          }
          if (active.secrecy) {
            expect(joinedReasons).toContain('secrecy');
          }
          if (active.payment) {
            expect(joinedReasons).toContain('payment');
          }
          if (active.domainMismatch) {
            const mismatchReason = verdict.reasons.find(
              (r) =>
                r.toLowerCase().includes(mismatchDomain.toLowerCase()) &&
                r.toLowerCase().includes(claimedOrg.toLowerCase())
            );
            expect(mismatchReason).toBeDefined();
          }

          // Danger escalation rule
          const expectDanger =
            (active.payment && active.urgency) ||
            (active.secrecy && (active.payment || active.urgency)) ||
            (active.domainMismatch && (active.payment || active.urgency));
          if (expectDanger) {
            expect(verdict.value).toBe('danger');
            expect(verdict.instruction).toBe('Do not click or pay');
            expect(verdict.showAskFamily).toBe(true);
          } else {
            expect(verdict.value).toBe('caution');
            expect(verdict.instruction).toBe(
              'Hang up and call back using a number saved in your contacts'
            );
            expect(verdict.showAskFamily).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 30: Scam check makes no requests
  it('Property 30: makes zero fetch or XMLHttpRequest calls even when text contains URLs', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('Network call forbidden in Scam Shield');
    });
    const xhrSpy = vi.fn(() => {
      throw new Error('XMLHttpRequest forbidden in Scam Shield');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);

    const domainArb = fc
      .tuple(
        fc.stringMatching(/^[a-z0-9]{2,12}$/),
        fc.constantFrom('com', 'org', 'net', 'my', 'example')
      )
      .map(([name, tld]) => `${name}.${tld}`);

    fc.assert(
      fc.property(
        fc.constantFrom('http://', 'https://', 'https://www.', 'http://WWW.'),
        domainArb,
        fc.stringMatching(/^\/[a-z0-9/_-]{0,20}$/),
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.option(fc.constantFrom(...CLAIMED_ORGS), { nil: undefined }),
        (prefix, domain, path, extra, claimedOrg) => {
          const url = `${prefix}${domain}${path}`;
          const text = `${extra} Check ${url} now.`;

          const links = extractLinks(text);
          expect(links.length).toBeGreaterThanOrEqual(1);
          expect(links.some((l) => l.domain === domain.toLowerCase())).toBe(true);

          checkText(text, claimedOrg ? { claimedOrg } : undefined);

          expect(fetchSpy).not.toHaveBeenCalled();
          expect(xhrSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 31: Family code word validation
  it('Property 31: validates family code words strictly (1..50 non-whitespace chars) and preserves existing value on rejection or store error', async () => {
    // Sanity check SAFETY_HABITS covers the 3 red flags + Hang Up & Call Back
    expect(SAFETY_HABITS.length).toBeGreaterThanOrEqual(4);
    const habitsText = JSON.stringify(SAFETY_HABITS).toLowerCase();
    expect(habitsText).toContain('urgency');
    expect(habitsText).toContain('secrecy');
    expect(habitsText).toContain('payment');
    expect(habitsText).toContain('hang up');

    const candidateArb = fc.oneof(
      fc.constant(''),
      fc.stringMatching(/^[ \t\n\r]{1,20}$/),
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 51, maxLength: 90 })
    );

    await fc.assert(
      fc.asyncProperty(
        candidateArb,
        fc.option(fc.stringMatching(/^[A-Za-z0-9 ]{3,20}$/), { nil: undefined }),
        fc.boolean(),
        async (input, existingWord, storeShouldFail) => {
          const isValid =
            input.length >= 1 && input.length <= 50 && input.trim().length > 0;

          const validation = validateCodeWord(input);
          if (isValid) {
            expect(validation).toEqual({ ok: true, value: input });
          } else {
            expect(validation.ok).toBe(false);
            if (!validation.ok) {
              if (input.trim().length === 0) {
                expect(validation.error).toBe('empty');
              } else {
                expect(validation.error).toBe('too-long');
              }
            }
          }

          const current: Settings = {
            ...createDefaultSettings(),
            familyCodeWord: existingWord,
          };
          const mock = makeMockVault(storeShouldFail);

          const saveResult = await saveFamilyCodeWord(mock.vault, current, input);

          if (!isValid) {
            expect(saveResult.ok).toBe(false);
            expect(mock.saveCalls).toBe(0);
            expect(current.familyCodeWord).toBe(existingWord);
          } else if (storeShouldFail) {
            expect(saveResult.ok).toBe(false);
            if (!saveResult.ok) {
              expect(saveResult.error.reason).toBe('store-error');
            }
            expect(current.familyCodeWord).toBe(existingWord);
            expect(mock.getSavedSettings()).toBeUndefined();
          } else {
            expect(saveResult.ok).toBe(true);
            if (saveResult.ok) {
              expect(saveResult.value.familyCodeWord).toBe(input);
            }
            expect(mock.getSavedSettings()?.familyCodeWord).toBe(input);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 32: Checklist progress text
  it('Property 32: formats "X of Y steps completed" accurately and reverts checklist state on vault failure', async () => {
    const stepIds = SAFE_PHONE_CHECKLIST_STEPS.map((s) => s.id);
    expect(stepIds.length).toBeGreaterThanOrEqual(3);
    expect(stepIds).toContain('whatsapp-profile-contacts');
    expect(stepIds).toContain('silence-unknown-callers');
    expect(stepIds).toContain('set-screen-lock');

    const checklistArb = fc.record({
      known: fc.dictionary(fc.constantFrom(...stepIds), fc.boolean()),
      unknown: fc.dictionary(
        fc.stringMatching(/^extra-step-[0-9]{1,3}$/),
        fc.boolean()
      ),
    });

    await fc.assert(
      fc.asyncProperty(
        checklistArb,
        fc.constantFrom(...stepIds),
        fc.boolean(),
        fc.boolean(),
        async ({ known, unknown }, stepToToggle, nextDone, storeShouldFail) => {
          const completedMap: Record<string, boolean> = { ...unknown, ...known };
          const expectedCount = SAFE_PHONE_CHECKLIST_STEPS.filter(
            (s) => completedMap[s.id] === true
          ).length;

          expect(formatChecklistProgress(completedMap)).toBe(
            `${expectedCount} of ${SAFE_PHONE_CHECKLIST_STEPS.length} steps completed`
          );

          const current: Settings = {
            ...createDefaultSettings(),
            checklist: { ...completedMap },
          };
          const mock = makeMockVault(storeShouldFail);
          const toggleRes = await toggleChecklistStep(
            mock.vault,
            current,
            stepToToggle,
            nextDone
          );

          if (storeShouldFail) {
            expect(toggleRes.ok).toBe(false);
            if (!toggleRes.ok) {
              expect(toggleRes.error.settings.checklist).toEqual(completedMap);
            }
            expect(current.checklist).toEqual(completedMap);
          } else {
            expect(toggleRes.ok).toBe(true);
            const expectedMap = { ...completedMap, [stepToToggle]: nextDone };
            const expectedAfter = SAFE_PHONE_CHECKLIST_STEPS.filter(
              (s) => expectedMap[s.id] === true
            ).length;
            if (toggleRes.ok) {
              expect(toggleRes.value.settings.checklist[stepToToggle]).toBe(
                nextDone
              );
              expect(toggleRes.value.progressText).toBe(
                `${expectedAfter} of ${SAFE_PHONE_CHECKLIST_STEPS.length} steps completed`
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
