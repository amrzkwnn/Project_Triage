import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type AuditEntry,
  type CalendarEvent,
  type Channel,
  type InboxItem,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import { eraseAllDataAndTokens } from '@/lib/vault/erase';
import { exportDocument } from '@/lib/vault/export';
import { importDocument } from '@/lib/vault/import';
import { MAX_IMPORT_BYTES, type OAuthTokenRecord } from '@/lib/vault/schema';
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
    fc.string({ minLength: 1, maxLength: 16 }).filter((k) => k !== '__proto__'),
    fc.boolean(),
    { maxKeys: 5 }
  ),
  familyMembers: fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 16 }),
      name: fc.string({ minLength: 1, maxLength: 40 }),
      address: fc.string({ minLength: 1, maxLength: 60 }),
    }),
    { maxLength: 3 }
  ),
});

const richTextArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 150 }),
  fc.constantFrom(
    'Hello "Pakcik"! Line 1\nLine 2\r\nLine 3 — Terima kasih 😊',
    'Klinik Kesihatan: Temujanji pada 2025-06-15 jam 09:30 pagi.',
    '引号 "quotes" & \\backslashes\\ & मल्टीबाइट 텍스트'
  )
);

const inboxItemArb: fc.Arbitrary<InboxItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  source: channelArb,
  sender: fc.option(richTextArb, { nil: undefined }),
  text: richTextArb,
  attachments: fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 16 }),
      mime: fc.constantFrom('image/jpeg', 'image/png'),
      name: fc.string({ minLength: 1, maxLength: 30 }),
    }),
    { maxLength: 2 }
  ),
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

const calendarEventArb: fc.Arbitrary<CalendarEvent> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  title: richTextArb,
  date: fc
    .tuple(
      fc.integer({ min: 2024, max: 2028 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 })
    )
    .map(([y, m, d]) => `${y}-${pad2(m)}-${pad2(d)}`),
  time: fc.option(
    fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${pad2(h)}:${pad2(m)}`),
    { nil: undefined }
  ),
  location: fc.option(richTextArb, { nil: undefined }),
  category: fc.constantFrom(
    'Medical',
    'Family & Social',
    'Bills & Errands',
    'Daily Routine'
  ),
  sourceItemId: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
    nil: undefined,
  }),
  createdAt: fc
    .integer({ min: 1700000000000, max: 1800000000000 })
    .map((ms) => new Date(ms).toISOString()),
});

const auditEntryArb: fc.Arbitrary<AuditEntry> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  at: fc
    .tuple(
      fc.integer({ min: 2024, max: 2028 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
      fc.integer({ min: 0, max: 23 }),
      fc.integer({ min: 0, max: 59 }),
      fc.integer({ min: 0, max: 59 })
    )
    .map(
      ([y, m, d, hh, mm, ss]) =>
        `${y}-${pad2(m)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
    ),
  kind: fc.constantFrom('ai-read', 'family-share'),
  channel: fc.option(channelArb, { nil: undefined }),
  description: richTextArb.map((s) =>
    s.trim().length > 0 ? s.slice(0, 200) : 'Checked item'
  ),
  purpose: fc.option(
    richTextArb.map((s) =>
      s.trim().length > 0 ? s.slice(0, 200) : 'Summarize message'
    ),
    { nil: undefined }
  ),
  itemId: fc.option(fc.string({ minLength: 1, maxLength: 24 }), {
    nil: undefined,
  }),
  recipient: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
    nil: undefined,
  }),
});

const blobsArb: fc.Arbitrary<Record<string, Uint8Array>> = fc.dictionary(
  fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/),
  fc.uint8Array({ minLength: 1, maxLength: 64 }),
  { maxKeys: 3 }
);

let dbCounter = 0;
function nextDbName(prefix: string): string {
  dbCounter += 1;
  return `${prefix}_${dbCounter}`;
}

describe('Vault storage, export/import, atomicity, collision, and erase properties', () => {
  // Feature: senior-digital-companion, Property 12: Export and import round trip
  it('Property 12: exporting, importing into an empty Vault, and exporting again yields an identical document', async () => {
    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        fc.array(inboxItemArb, { maxLength: 6 }),
        fc.uniqueArray(calendarEventArb, {
          selector: (e) => e.id,
          maxLength: 6,
        }),
        fc.array(auditEntryArb, { maxLength: 6 }),
        blobsArb,
        async (settings, items, events, audit, blobs) => {
          const vaultA = createVault({ dbName: nextDbName('p12_a') });
          await vaultA.saveSettings(settings);
          for (const item of items) {
            await vaultA.putItem(item);
          }
          for (const ev of events) {
            await vaultA.putEvent(ev);
          }
          for (const entry of audit) {
            await vaultA.appendAudit(entry);
          }
          for (const [id, bytes] of Object.entries(blobs)) {
            await vaultA.putBlob(id, bytes);
          }

          const exported1 = await exportDocument(vaultA);
          expect(exported1.ok).toBe(true);
          if (!exported1.ok) return;

          // Valid UTF-8 JSON indented with 2 spaces and integer schemaVersion
          const parsed1 = JSON.parse(exported1.value);
          expect(Number.isInteger(parsed1.schemaVersion)).toBe(true);
          expect(parsed1.schemaVersion).toBe(1);
          expect(JSON.stringify(parsed1, null, 2)).toBe(exported1.value);

          const vaultB = createVault({ dbName: nextDbName('p12_b') });
          const importRes = await importDocument(vaultB, exported1.value);
          expect(importRes.ok).toBe(true);

          const exported2 = await exportDocument(vaultB);
          expect(exported2.ok).toBe(true);
          if (!exported2.ok) return;

          expect(exported2.value).toBe(exported1.value);

          const bSettings = await vaultB.getSettings();
          const bItems = await vaultB.listItems();
          const bEvents = await vaultB.listEvents();
          const bAudit = await vaultB.listAudit();
          const bBlobs = await vaultB.listBlobs();

          expect(bSettings.ok && bSettings.value).toEqual(settings);
          expect(bItems.ok && bItems.value).toEqual(items);
          expect(bEvents.ok && bEvents.value).toEqual(events);
          expect(bAudit.ok && bAudit.value).toEqual(audit);
          expect(bBlobs.ok && bBlobs.value).toEqual(blobs);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 13: Invalid imports change nothing
  it('Property 13: rejects malformed, unversioned, unsupported-version, missing-field, or >10MB imports and leaves the Vault unchanged', async () => {
    const invalidImportArb: fc.Arbitrary<{
      text: string;
      expectedReason:
        | 'malformed-json'
        | 'missing-version'
        | 'unsupported-version'
        | 'missing-field';
    }> = fc.oneof(
      fc
        .constantFrom(
          '{not json',
          '',
          'null',
          '[]',
          '"just a string"',
          '{"schemaVersion": 1,'
        )
        .map((text) => ({ text, expectedReason: 'malformed-json' as const })),
      fc
        .constant(
          JSON.stringify({
            settings: createDefaultSettings(),
            items: [],
            events: [],
            audit: [],
          })
        )
        .map((text) => ({ text, expectedReason: 'missing-version' as const })),
      fc
        .constantFrom(0, 2, -1, 1.5, '1', 'v1', true)
        .map((ver) => ({
          text: JSON.stringify({
            schemaVersion: ver,
            settings: createDefaultSettings(),
            items: [],
            events: [],
            audit: [],
          }),
          expectedReason: 'unsupported-version' as const,
        })),
      fc
        .constantFrom('settings', 'items', 'events', 'audit')
        .map((missingField) => {
          const base: Record<string, unknown> = {
            schemaVersion: 1,
            settings: createDefaultSettings(),
            items: [],
            events: [],
            audit: [],
          };
          delete base[missingField];
          return {
            text: JSON.stringify(base),
            expectedReason: 'missing-field' as const,
          };
        })
    );

    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        fc.array(inboxItemArb, { minLength: 1, maxLength: 3 }),
        fc.uniqueArray(calendarEventArb, {
          selector: (e) => e.id,
          minLength: 1,
          maxLength: 3,
        }),
        fc.array(auditEntryArb, { minLength: 1, maxLength: 3 }),
        invalidImportArb,
        async (settings, items, events, audit, invalidCase) => {
          const vault = createVault({ dbName: nextDbName('p13') });
          await vault.saveSettings(settings);
          for (const item of items) await vault.putItem(item);
          for (const ev of events) await vault.putEvent(ev);
          for (const entry of audit) await vault.appendAudit(entry);

          const beforeExport = await vault.exportAll();
          expect(beforeExport.ok).toBe(true);

          const res = await vault.importAll(invalidCase.text);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error.reason).toBe(invalidCase.expectedReason);
            expect(res.error.message.trim().length).toBeGreaterThan(0);
          }

          const afterExport = await vault.exportAll();
          expect(afterExport).toEqual(beforeExport);
        }
      ),
      { numRuns: 100 }
    );

    // Also verify size > 10 MB rejection before parsing
    const vaultOversized = createVault({ dbName: nextDbName('p13_oversized') });
    const initialSettings = createDefaultSettings();
    await vaultOversized.saveSettings(initialSettings);
    const oversizedText = 'x'.repeat(MAX_IMPORT_BYTES + 10);
    const oversizedRes = await importDocument(vaultOversized, oversizedText);
    expect(oversizedRes.ok).toBe(false);
    if (!oversizedRes.ok) {
      expect(oversizedRes.error.reason).toBe('too-large');
    }
  });

  // Feature: senior-digital-companion, Property 14: Failed writes leave stored data unchanged
  it('Property 14: when a write operation fails, all previously stored data remains readable and unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        inboxItemArb,
        inboxItemArb,
        calendarEventArb,
        calendarEventArb,
        auditEntryArb,
        auditEntryArb,
        async (
          initialSettings,
          seedItem,
          failingItem,
          seedEvent,
          failingEvent,
          seedAudit,
          failingAudit
        ) => {
          let failWrites = false;
          globalThis.localStorage.clear();
          const vault = createVault({
            dbName: nextDbName('p14'),
            storage: globalThis.localStorage,
            shouldFailWrite: () => failWrites,
          });

          await vault.saveSettings(initialSettings);
          await vault.putItem(seedItem);
          await vault.putEvent(seedEvent);
          await vault.appendAudit(seedAudit);
          await vault.putBlob('blob-1', new Uint8Array([1, 2, 3]));

          const beforeExport = await vault.exportAll();
          expect(beforeExport.ok).toBe(true);

          // Turn on write failures
          failWrites = true;

          const r1 = await vault.saveSettings(createDefaultSettings());
          const r2 = await vault.putItem(failingItem);
          const r3 = await vault.putEvent(failingEvent);
          const r4 = await vault.deleteEvent(seedEvent.id);
          const r5 = await vault.appendAudit(failingAudit);
          const r6 = await vault.putBlob('blob-2', new Uint8Array([9, 9]));
          const r7 = await vault.eraseAll();
          const r8 = await vault.importAll(
            beforeExport.ok ? beforeExport.value : '{}'
          );

          expect(r1.ok).toBe(false);
          expect(r2.ok).toBe(false);
          expect(r3.ok).toBe(false);
          expect(r4.ok).toBe(false);
          expect(r5.ok).toBe(false);
          expect(r6.ok).toBe(false);
          expect(r7.ok).toBe(false);
          expect(r8.ok).toBe(false);

          // Re-enable reads / check that everything stored before the failures is untouched
          failWrites = false;
          const afterExport = await vault.exportAll();
          expect(afterExport).toEqual(beforeExport);

          const storedSettings = await vault.getSettings();
          const storedItems = await vault.listItems();
          const storedEvents = await vault.listEvents();
          const storedAudit = await vault.listAudit();
          const storedBlob = await vault.getBlob('blob-1');

          expect(storedSettings.ok && storedSettings.value).toEqual(
            initialSettings
          );
          expect(storedItems.ok && storedItems.value).toEqual([seedItem]);
          expect(storedEvents.ok && storedEvents.value).toEqual([seedEvent]);
          expect(storedAudit.ok && storedAudit.value).toEqual([seedAudit]);
          expect(storedBlob.ok && storedBlob.value).toEqual(
            new Uint8Array([1, 2, 3])
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 22: Identifier collision keeps both
  it('Property 22: keeps the existing item unchanged and stores an incoming item with the same id as a separate entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        inboxItemArb,
        inboxItemArb,
        async (firstItem, secondTemplate) => {
          const collidingItem: InboxItem = {
            ...secondTemplate,
            id: firstItem.id,
          };

          const vault = createVault({ dbName: nextDbName('p22') });
          const firstSnapshot = structuredClone(firstItem);
          const secondSnapshot = structuredClone(collidingItem);

          const r1 = await vault.putItem(firstItem);
          const r2 = await vault.putItem(collidingItem);
          expect(r1.ok).toBe(true);
          expect(r2.ok).toBe(true);

          const listed = await vault.listItems();
          expect(listed.ok).toBe(true);
          if (!listed.ok) return;

          expect(listed.value.length).toBe(2);
          expect(listed.value[0]).toEqual(firstSnapshot);
          expect(listed.value[1]).toEqual(secondSnapshot);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 40: Erase with token revocation
  it('Property 40: erases all local data and tokens regardless of revocation outcome and reports exact failed accounts', async () => {
    const tokenOutcomeArb = fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 16 }),
        account: fc
          .stringMatching(/^[a-z0-9._-]{1,12}@example\.com$/)
          .map((s) => s),
        provider: fc.constantFrom('Google', 'Microsoft', 'Yahoo'),
        token: fc.string({ minLength: 8, maxLength: 32 }),
        outcome: fc.constantFrom('success', 'error', 'timeout'),
      }),
      { maxLength: 5 }
    );

    await fc.assert(
      fc.asyncProperty(
        settingsArb,
        inboxItemArb,
        calendarEventArb,
        auditEntryArb,
        tokenOutcomeArb,
        async (settings, item, event, audit, tokenSpecs) => {
          globalThis.localStorage.clear();
          const vault = createVault({
            dbName: nextDbName('p40'),
            storage: globalThis.localStorage,
          });

          await vault.saveSettings(settings);
          await vault.putItem(item);
          await vault.putEvent(event);
          await vault.appendAudit(audit);
          await vault.putBlob('photo-1', new Uint8Array([4, 5, 6]));

          const uniqueSpecs = tokenSpecs.filter(
            (spec, idx, arr) =>
              arr.findIndex((other) => other.id === spec.id) === idx
          );

          for (const spec of uniqueSpecs) {
            const rec: OAuthTokenRecord = {
              id: spec.id,
              account: spec.account,
              provider: spec.provider,
              token: spec.token,
            };
            await vault.saveOAuthToken(rec);
          }

          const outcomeById = new Map(
            uniqueSpecs.map((s) => [s.id, s.outcome] as const)
          );
          const expectedFailedAccounts = uniqueSpecs
            .filter((s) => s.outcome !== 'success')
            .map((s) => s.account);

          const res = await eraseAllDataAndTokens(vault, {
            timeoutMs: 15,
            revokeToken: async (rec, signal) => {
              const outcome = outcomeById.get(rec.id) ?? 'success';
              if (outcome === 'error') {
                throw new Error('Revocation rejected by provider');
              }
              if (outcome === 'timeout') {
                await new Promise<void>((_, reject) => {
                  signal.addEventListener('abort', () => {
                    reject(new Error('Aborted'));
                  });
                });
              }
            },
          });

          expect(res.ok).toBe(true);
          if (!res.ok) return;

          // Local store must hold no data and no local tokens
          const afterItems = await vault.listItems();
          const afterEvents = await vault.listEvents();
          const afterAudit = await vault.listAudit();
          const afterBlobs = await vault.listBlobs();
          const afterTokens = await vault.listOAuthTokens();
          const afterSettings = await vault.getSettings();

          expect(afterItems.ok && afterItems.value).toEqual([]);
          expect(afterEvents.ok && afterEvents.value).toEqual([]);
          expect(afterAudit.ok && afterAudit.value).toEqual([]);
          expect(afterBlobs.ok && afterBlobs.value).toEqual({});
          expect(afterTokens.ok && afterTokens.value).toEqual([]);
          expect(afterSettings.ok && afterSettings.value).toEqual(
            createDefaultSettings()
          );

          if (expectedFailedAccounts.length === 0) {
            expect(res.value.allRevoked).toBe(true);
            expect(res.value.failedAccounts).toEqual([]);
            expect(res.value.instructions).toBeUndefined();
          } else {
            expect(res.value.allRevoked).toBe(false);
            expect(res.value.failedAccounts).toEqual(expectedFailedAccounts);
            expect(res.value.instructions).toBeDefined();
            for (const acct of expectedFailedAccounts) {
              expect(res.value.message).toContain(acct);
              expect(res.value.instructions).toContain(acct);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
