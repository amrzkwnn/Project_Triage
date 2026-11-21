import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type AuditEntry,
  type Channel,
  type InboxItem,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import {
  AUDIT_EMPTY_MESSAGE,
  buildAuditEntry,
  formatLocalDateTimeToSecond,
  listAuditNewestFirst,
} from '@/lib/vault/audit';
import {
  type AiToggleEvent,
  admit,
  createAiToggleState,
  ingestWithConsent,
  mayCallAi,
  mayShare,
  stepAiToggle,
} from '@/lib/vault/consent';
import { setChannelToggle } from '@/lib/vault/settings';
import { createVault } from '@/lib/vault/store';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);

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
  familyCodeWord: fc.option(
    fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    { nil: undefined }
  ),
  checklist: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.boolean(),
    { maxKeys: 5 }
  ),
  familyMembers: fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 16 }),
      name: fc.string({ minLength: 1, maxLength: 40 }),
      address: fc.string({ minLength: 1, maxLength: 60 }),
    }),
    { maxLength: 4 }
  ),
});

const inboxItemArb: fc.Arbitrary<InboxItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  source: channelArb,
  sender: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
    nil: undefined,
  }),
  text: fc.string({ minLength: 1, maxLength: 200 }),
  attachments: fc.constant([]),
  receivedAt: fc
    .integer({ min: 1700000000000, max: 1800000000000 })
    .map((ms) => new Date(ms).toISOString()),
  group: fc.constantFrom('Personal', 'Family', 'Others'),
  priority: fc.constantFrom('Important', 'Social', 'Promotion'),
  tier: fc.constantFrom(1, 2, 3),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  status: fc.constantFrom('ok', 'uncategorized-failed'),
});

const pad2 = (n: number) => String(n).padStart(2, '0');

const localTimestampArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 })
  )
  .map(
    ([y, m, d, hh, mm, ss]) =>
      `${y}-${pad2(m)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
  );

const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  at: localTimestampArb,
  kind: fc.constantFrom('ai-read', 'family-share'),
  channel: fc.option(channelArb, { nil: undefined }),
  description: fc
    .string({ minLength: 1, maxLength: 120 })
    .map((s) => (s.trim().length > 0 ? s : 'Read a message')),
  purpose: fc.option(
    fc
      .string({ minLength: 1, maxLength: 120 })
      .map((s) => (s.trim().length > 0 ? s : 'Check for scam')),
    { nil: undefined }
  ),
  itemId: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
    nil: undefined,
  }),
  recipient: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
    nil: undefined,
  }),
});

let dbCounter = 0;
function nextDbName(prefix: string): string {
  dbCounter += 1;
  return `${prefix}_${dbCounter}`;
}

describe('Vault consent, settings, AI toggle, and audit ordering properties', () => {
  // Feature: senior-digital-companion, Property 1: Channel consent gating
  it('Property 1: writes an incoming item iff its channel toggle is ON, never restores discarded items, and preserves prior items', async () => {
    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        inboxItemArb,
        inboxItemArb,
        async (initialSettings, priorItem, incomingItem) => {
          const vault = createVault({ dbName: nextDbName('p1') });

          // Seed a prior item when its channel is intentionally enabled
          const seedSettings: Settings = {
            ...initialSettings,
            channels: {
              ...initialSettings.channels,
              [priorItem.source]: true,
            },
          };
          await vault.saveSettings(seedSettings);
          const seedDecision = await ingestWithConsent(
            vault,
            seedSettings,
            priorItem
          );
          expect(seedDecision.admitted).toBe(true);

          // Now apply the arbitrary settings under test
          await vault.saveSettings(initialSettings);
          const beforeList = await vault.listItems();
          expect(beforeList.ok).toBe(true);
          if (!beforeList.ok) return;
          expect(beforeList.value).toEqual([priorItem]);

          const channelOn = initialSettings.channels[incomingItem.source];
          const pureDecision = admit(initialSettings, incomingItem);
          const ingestResult = await ingestWithConsent(
            vault,
            initialSettings,
            incomingItem
          );

          expect(mayCallAi(initialSettings)).toBe(
            initialSettings.allowAiReading === true
          );
          expect(mayShare(initialSettings)).toBe(
            initialSettings.caregiverShareEnabled === true
          );

          const afterList = await vault.listItems();
          expect(afterList.ok).toBe(true);
          if (!afterList.ok) return;

          if (channelOn) {
            expect(pureDecision).toEqual({ admit: true });
            expect(ingestResult).toEqual({ admitted: true });
            expect(afterList.value).toEqual([priorItem, incomingItem]);
          } else {
            expect(pureDecision.admit).toBe(false);
            expect(ingestResult.admitted).toBe(false);
            if (!ingestResult.admitted) {
              expect(ingestResult.channel).toBe(incomingItem.source);
              expect(ingestResult.offer).toBe('turn-on-channel');
              expect(ingestResult.message.toLowerCase()).toContain('turn on');
            }
            // Local store is unchanged
            expect(afterList.value).toEqual([priorItem]);

            // Turning the channel ON later must NOT add the discarded item,
            // and items stored before the toggle change remain unchanged
            const toggledOn = await setChannelToggle(
              vault,
              initialSettings,
              incomingItem.source,
              true
            );
            expect(toggledOn.ok).toBe(true);
            const listAfterTurnOn = await vault.listItems();
            expect(listAfterTurnOn.ok).toBe(true);
            if (listAfterTurnOn.ok) {
              expect(listAfterTurnOn.value).toEqual([priorItem]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 2: Settings persistence round trip
  it('Property 2: round-trips any valid Settings value and reverts on save failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        settingsArb,
        channelArb,
        fc.boolean(),
        async (firstSettings, secondSettings, toggleChannel, nextEnabled) => {
          let failWrites = false;
          const dbName = nextDbName('p2');
          globalThis.localStorage.clear();

          const vault = createVault({
            dbName,
            storage: globalThis.localStorage,
            shouldFailWrite: () => failWrites,
          });

          // Default settings initially have all 5 channels OFF, AI OFF, caregiver OFF, push OFF, lead 1h
          const defaultLoaded = await vault.getSettings();
          expect(defaultLoaded.ok).toBe(true);
          if (defaultLoaded.ok) {
            expect(defaultLoaded.value).toEqual(createDefaultSettings());
          }

          // Save firstSettings and read back from same vault and a fresh vault sharing dbName
          const saveRes = await vault.saveSettings(firstSettings);
          expect(saveRes.ok).toBe(true);

          const loaded = await vault.getSettings();
          expect(loaded.ok).toBe(true);
          if (loaded.ok) {
            expect(loaded.value).toEqual(firstSettings);
          }

          const reopenedVault = createVault({
            dbName,
            storage: globalThis.localStorage,
          });
          const reloaded = await reopenedVault.getSettings();
          expect(reloaded.ok).toBe(true);
          if (reloaded.ok) {
            expect(reloaded.value).toEqual(firstSettings);
          }

          // Simulate a save failure: stored settings and in-memory toggle must revert to firstSettings
          failWrites = true;
          const failedSave = await vault.saveSettings(secondSettings);
          expect(failedSave.ok).toBe(false);

          const failedToggle = await setChannelToggle(
            vault,
            firstSettings,
            toggleChannel,
            nextEnabled
          );
          expect(failedToggle.ok).toBe(false);
          expect(failedToggle.settings).toEqual(firstSettings);

          const afterFailedLoad = await vault.getSettings();
          expect(afterFailedLoad.ok).toBe(true);
          if (afterFailedLoad.ok) {
            expect(afterFailedLoad.value).toEqual(firstSettings);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 5: AI toggle requires confirmation
  it('Property 5: enables allowAiReading only after confirm directly following request-on, dismiss keeps false, turn-off needs no confirmation', () => {
    const eventArb: fc.Arbitrary<AiToggleEvent> = fc.constantFrom(
      'request-on',
      'confirm',
      'dismiss',
      'turn-off'
    );

    fc.assert(
      fc.property(fc.array(eventArb, { minLength: 1, maxLength: 40 }), (events) => {
        let state = createAiToggleState();
        expect(state).toEqual({
          allowAiReading: false,
          awaitingConfirm: false,
        });

        for (const event of events) {
          const prev = state;
          state = stepAiToggle(prev, event);

          if (event === 'request-on') {
            if (!prev.allowAiReading) {
              expect(state.allowAiReading).toBe(false);
              expect(state.awaitingConfirm).toBe(true);
            } else {
              expect(state.allowAiReading).toBe(true);
              expect(state.awaitingConfirm).toBe(false);
            }
          } else if (event === 'confirm') {
            if (prev.awaitingConfirm) {
              expect(state.allowAiReading).toBe(true);
              expect(state.awaitingConfirm).toBe(false);
            } else {
              expect(state.allowAiReading).toBe(prev.allowAiReading);
              expect(state.awaitingConfirm).toBe(false);
            }
          } else if (event === 'dismiss') {
            if (prev.awaitingConfirm) {
              expect(state.allowAiReading).toBe(false);
              expect(state.awaitingConfirm).toBe(false);
            } else {
              expect(state.allowAiReading).toBe(prev.allowAiReading);
              expect(state.awaitingConfirm).toBe(false);
            }
          } else if (event === 'turn-off') {
            expect(state.allowAiReading).toBe(false);
            expect(state.awaitingConfirm).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 8: Audit log display order
  it('Property 8: sorts any set of Audit_Log entries most recent first and retains every entry', () => {
    expect(AUDIT_EMPTY_MESSAGE).toBe('The AI has not read anything.');
    expect(formatLocalDateTimeToSecond(new Date(2025, 4, 9, 14, 7, 3))).toBe(
      '2025-05-09 14:07:03'
    );

    fc.assert(
      fc.property(fc.array(auditEntryArb, { maxLength: 50 }), (entries) => {
        const snapshot = entries.map((e) => ({ ...e }));
        const ordered = listAuditNewestFirst(entries);

        // Input array must not be mutated
        expect(entries).toEqual(snapshot);

        // Contains every entry
        expect(ordered.length).toBe(entries.length);
        for (const entry of entries) {
          expect(ordered).toContainEqual(entry);
        }

        // Sorted by timestamp descending (most recent first)
        for (let i = 1; i < ordered.length; i += 1) {
          expect(ordered[i - 1].at >= ordered[i].at).toBe(true);
        }
      }),
      { numRuns: 100 }
    );

    // Also verify buildAuditEntry bounds (1..200 chars)
    const validBuilt = buildAuditEntry({
      kind: 'ai-read',
      channel: 'email',
      description: 'Checked email from clinic',
      purpose: 'Look for appointment date',
    });
    expect(validBuilt.ok).toBe(true);

    const emptyBuilt = buildAuditEntry({
      kind: 'ai-read',
      description: '   ',
    });
    expect(emptyBuilt.ok).toBe(false);

    const tooLongBuilt = buildAuditEntry({
      kind: 'ai-read',
      description: 'x'.repeat(201),
    });
    expect(tooLongBuilt.ok).toBe(false);
  });
});
