import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { createVault } from '@/lib/vault/store';
import { eraseAllDataAndTokens } from '@/lib/vault/erase';
import { SETTINGS_LS_KEY, type OAuthTokenRecord } from '@/lib/vault/schema';
import {
  createDefaultSettings,
  type CalendarEvent,
  type InboxItemDraft,
  type Settings,
} from '@/lib/types';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { execute } from '@/lib/actions/executor';
import { viewToday } from '@/lib/calendar/views';
import { pullAndIngestFromRelay } from '@/lib/inbox/pullPipeline';
import {
  commitPrescriptionSchedule,
  createPrescriptionItem,
} from '@/lib/inbox/prescription';
import {
  MAX_EMAIL_BYTES,
  processEmailBatch,
  validateReadOnlyScopes,
} from '@/lib/inbox/emailChannel';
import { POST as ingestPost } from '@/app/api/ingest/route';
import { GET as ingestPullGet } from '@/app/api/ingest/pull/route';
import { POST as ingestAckPost } from '@/app/api/ingest/ack/route';
import { DEFAULT_DEV_TOKEN } from '@/lib/server/auth';
import {
  getServerRuntime,
  resetServerRuntime,
  setServerRuntime,
} from '@/lib/server/runtime';
import { createSafeLogger } from '@/lib/server/safeLog';

function createMockLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('End-to-End Senior Digital Companion Flows (Task 15.2)', () => {
  let dbCounter = 0;
  let currentNowMs = 1_750_000_000_000;

  beforeEach(() => {
    dbCounter += 1;
    currentNowMs = 1_750_000_000_000;
    resetServerRuntime();
    const rt = getServerRuntime();
    setServerRuntime({
      ...rt,
      logger: createSafeLogger(() => {}),
      now: () => currentNowMs,
    });
  });

  afterEach(() => {
    resetServerRuntime();
  });

  it('Flow 1: WhatsApp forward -> relay pull -> ConsentGate -> classification -> DetectedEvent -> Forward to Calendar with confirmFromTap -> appears in viewToday', async () => {
    const vault = createVault({
      dbName: `e2e-flow1-${dbCounter}-${Date.now()}`,
      storage: createMockLocalStorage(),
    });

    const settings: Settings = {
      ...createDefaultSettings(),
      channels: {
        ...createDefaultSettings().channels,
        whatsappForward: true,
        email: false,
      },
      allowAiReading: false,
    };
    await vault.saveSettings(settings);

    // 1. WhatsApp forward arrives at /api/ingest
    const waRes = await ingestPost(
      new Request('https://companion.example/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
        },
        body: JSON.stringify({
          source: 'whatsappForward',
          sender: 'City Clinic',
          text: 'Dr. Tan clinic appointment on 2026-07-15 at 10:30 Location: Room 4B.',
          receivedAt: '2026-07-10T08:00:00.000Z',
        }),
      })
    );
    expect(waRes.status).toBe(200);

    // Also enqueue an email item while email channel is OFF to verify ConsentGate discards it
    const offChannelRes = await ingestPost(
      new Request('https://companion.example/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
        },
        body: JSON.stringify({
          source: 'email',
          sender: 'Newsletter',
          text: 'Summer 50% off sale!',
          receivedAt: '2026-07-10T08:05:00.000Z',
        }),
      })
    );
    expect(offChannelRes.status).toBe(200);

    // 2. Pull pending items from relay
    const pullRes = await ingestPullGet(
      new Request('https://companion.example/api/ingest/pull', {
        method: 'GET',
        headers: { Authorization: `Bearer ${DEFAULT_DEV_TOKEN}` },
      })
    );
    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as {
      items: Array<{ id: string; draft: InboxItemDraft }>;
    };
    expect(pullBody.items).toHaveLength(2);

    // 3. Run pullAndIngestFromRelay with real /api/ingest/ack
    const ackedBatches: string[][] = [];
    const pipelineRes = await pullAndIngestFromRelay({
      vault,
      settings,
      pulledItems: pullBody.items,
      nowMs: Date.parse('2026-07-10T08:10:00.000Z'),
      ackFn: async (ids) => {
        ackedBatches.push(ids);
        const ackRes = await ingestAckPost(
          new Request('https://companion.example/api/ingest/ack', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${DEFAULT_DEV_TOKEN}`,
            },
            body: JSON.stringify({ ids }),
          })
        );
        expect(ackRes.status).toBe(204);
      },
    });

    expect(pipelineRes.stored).toHaveLength(1);
    expect(pipelineRes.discardedChannels).toContain('email');
    expect(pipelineRes.duplicatesSkipped).toBe(0);
    expect(pipelineRes.fallbackUsedCount).toBe(0);
    expect(ackedBatches.flat()).toHaveLength(2);

    // Relay is now empty after ack
    expect(getServerRuntime().relay.inspectStoredEnvelopes()).toHaveLength(0);

    // 4. Verify classification, DetectedEvent, and Forward to Calendar proposal
    const savedItem = pipelineRes.stored[0];
    expect(savedItem.source).toBe('whatsappForward');
    expect(savedItem.group).toBe('Personal');
    expect(savedItem.priority).toBe('Important');
    expect(savedItem.detectedEvent).toBeDefined();
    expect(savedItem.detectedEvent?.date).toBe('2026-07-15');
    expect(savedItem.detectedEvent?.time).toBe('10:30');
    expect(savedItem.tier).toBe(2);

    const calProposal = savedItem.proposals?.find(
      (p) => p.kind === 'forwardToCalendar'
    );
    expect(calProposal).toBeDefined();

    // 5. Execute Forward to Calendar using branded confirmFromTap
    const confirmation = confirmFromTap(calProposal!.id);
    const execRes = await execute(
      {
        actionId: calProposal!.id,
        kind: 'forwardToCalendar',
        event: savedItem.detectedEvent!,
        itemId: savedItem.id,
      },
      confirmation,
      {
        saveCalendarEvent: async (ev, itemId) => {
          const calEvent: CalendarEvent = {
            id: `ev-${itemId}`,
            title: ev.title,
            date: ev.date,
            time: ev.time,
            location: ev.location,
            category: 'Medical',
            sourceItemId: itemId,
            createdAt: '2026-07-10T08:15:00.000Z',
          };
          const putRes = await vault.putEvent(calEvent);
          return putRes.ok
            ? { ok: true, value: undefined }
            : { ok: false, error: putRes.error.message };
        },
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
      }
    );
    expect(execRes.ok).toBe(true);

    // 6. Verify event appears in viewToday for 2026-07-15
    const eventsRes = await vault.listEvents();
    expect(eventsRes.ok).toBe(true);
    const todayEvents = viewToday(
      eventsRes.ok ? eventsRes.value : [],
      Temporal.PlainDate.from('2026-07-15')
    );
    expect(todayEvents).toHaveLength(1);
    expect(todayEvents[0].date).toBe('2026-07-15');
    expect(todayEvents[0].time).toBe('10:30');
    expect(todayEvents[0].category).toBe('Medical');
  });

  it('Flow 2: AI ON with proxy failure -> audit entry written, falls back to rules in 1 attempt, allowAiReading stays ON', async () => {
    const vault = createVault({
      dbName: `e2e-flow2-${dbCounter}-${Date.now()}`,
      storage: createMockLocalStorage(),
    });

    const settings: Settings = {
      ...createDefaultSettings(),
      channels: {
        ...createDefaultSettings().channels,
        smsPaste: true,
      },
      allowAiReading: true,
    };
    await vault.saveSettings(settings);

    const failingFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const ackFn = vi.fn(async () => {});

    const res = await pullAndIngestFromRelay({
      vault,
      settings,
      pulledItems: [
        {
          id: 'sms-1',
          draft: {
            source: 'smsPaste',
            sender: 'Unknown',
            text: 'URGENT: Your account is suspended. Pay RM500 now at https://fake-bank.example',
            attachments: [],
            receivedAt: '2026-07-10T09:00:00.000Z',
          },
        },
      ],
      ackFn,
      fetchDecideFn: failingFetch,
    });

    // Exactly 1 proxy attempt (zero retries), fell back to rules
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(res.fallbackUsedCount).toBe(1);
    expect(res.stored).toHaveLength(1);
    expect(res.stored[0].tier).toBe(3);
    expect(res.stored[0].scamWarning?.value).toBe('danger');

    // Audit entry was written BEFORE external read
    const auditRes = await vault.listAudit();
    expect(auditRes.ok).toBe(true);
    expect(auditRes.ok ? auditRes.value : []).toHaveLength(1);
    expect(auditRes.ok ? auditRes.value[0].kind : '').toBe('ai-read');

    // allowAiReading remains ON
    const persistedSettings = await vault.getSettings();
    expect(persistedSettings.ok).toBe(true);
    expect(persistedSettings.ok && persistedSettings.value.allowAiReading).toBe(
      true
    );
  });

  it('Flow 3: Two-step Erase flow -> revokes OAuth tokens and wipes Vault + localStorage', async () => {
    const mockStorage = createMockLocalStorage();
    const vault = createVault({
      dbName: `e2e-flow3-${dbCounter}-${Date.now()}`,
      storage: mockStorage,
    });

    const settings: Settings = {
      ...createDefaultSettings(),
      channels: {
        ...createDefaultSettings().channels,
        email: true,
      },
      allowAiReading: true,
      familyCodeWord: 'Sunflower',
    };
    await vault.saveSettings(settings);
    expect(mockStorage.getItem(SETTINGS_LS_KEY)).not.toBeNull();

    await vault.putItem({
      id: 'item-erase-1',
      source: 'email',
      sender: 'Clinic',
      text: 'Reminder for visit',
      attachments: [],
      receivedAt: '2026-07-10T09:00:00.000Z',
      group: 'Personal',
      priority: 'Important',
      tier: 1,
      confidence: 0.9,
      status: 'ok',
    });

    const tokenRecord: OAuthTokenRecord = {
      id: 'tok-gmail-1',
      account: 'senior@example.com',
      provider: 'google',
      token: 'secret-token-value',
    };
    await vault.saveOAuthToken(tokenRecord);

    const revokedAccounts: string[] = [];

    // Execute through two-step ActionExecutor gate
    const step1 = confirmFromTap('erase-step-1');
    const step2 = confirmFromTap('erase-step-2');

    // Verify single step alone is rejected
    const partialRes = await execute(
      {
        actionId: 'erase-all',
        kind: 'eraseAll',
        step1ActionId: 'erase-step-1',
        step2ActionId: 'erase-step-2',
      },
      { step1 },
      {
        saveCalendarEvent: async () => ({ ok: true, value: undefined }),
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => ({ ok: true, value: undefined }),
      }
    );
    expect(partialRes.ok).toBe(false);

    // Now confirm both steps
    const fullRes = await execute(
      {
        actionId: 'erase-all',
        kind: 'eraseAll',
        step1ActionId: 'erase-step-1',
        step2ActionId: 'erase-step-2',
      },
      { step1, step2 },
      {
        saveCalendarEvent: async () => ({ ok: true, value: undefined }),
        sendFamilyShare: async () => ({ ok: true, value: undefined }),
        runProtectedSideEffect: async () => ({ ok: true, value: undefined }),
        runEraseAll: async () => {
          const eraseOut = await eraseAllDataAndTokens(vault, {
            revokeToken: async (rec) => {
              revokedAccounts.push(rec.account);
            },
          });
          return eraseOut.ok
            ? { ok: true, value: undefined }
            : { ok: false, error: eraseOut.error.message };
        },
      }
    );

    expect(fullRes.ok).toBe(true);
    expect(revokedAccounts).toEqual(['senior@example.com']);

    // Vault stores and localStorage are wiped
    const itemsAfter = await vault.listItems();
    const tokensAfter = await vault.listOAuthTokens();
    const settingsAfter = await vault.getSettings();
    expect(itemsAfter.ok && itemsAfter.value).toHaveLength(0);
    expect(tokensAfter.ok && tokensAfter.value).toHaveLength(0);
    expect(mockStorage.getItem(SETTINGS_LS_KEY)).toBeNull();
    expect(settingsAfter.ok && settingsAfter.value.allowAiReading).toBe(false);
    expect(settingsAfter.ok && settingsAfter.value.channels.email).toBe(false);
  });

  it('Flow 4: Prescription photo low-confidence -> Tier 3 with retake prompt; email channel > 25 MB skipped while subsequent emails succeed', async () => {
    const vault = createVault({
      dbName: `e2e-flow4-${dbCounter}-${Date.now()}`,
      storage: createMockLocalStorage(),
    });

    // Part A: Prescription photo low confidence -> Personal + Important + From Photo + Tier 3 + retake prompt
    const lowConfRx = await createPrescriptionItem({
      id: 'rx-blurry-1',
      photo: {
        id: 'photo-rx-1',
        name: 'prescription.jpg',
        mime: 'image/jpeg',
        dataBase64: 'AAAA',
      },
      extractedText: 'blurry text',
      ocrConfidence: 0.35,
      receivedAt: '2026-07-10T10:00:00.000Z',
      vault,
    });
    expect(lowConfRx.ok).toBe(true);
    if (lowConfRx.ok) {
      expect(lowConfRx.value.item.source).toBe('photos');
      expect(lowConfRx.value.item.group).toBe('Personal');
      expect(lowConfRx.value.item.priority).toBe('Important');
      expect(lowConfRx.value.item.tier).toBe(3);
      expect(lowConfRx.value.needsRetake).toBe(true);
      expect(lowConfRx.value.retakeMessage).toMatch(/hard to read|retake/i);
      expect(lowConfRx.value.showOriginalAboveText).toBe(true);
    }

    // Medication schedule commit requires explicit Confirmation
    const unconfirmedMed = await commitPrescriptionSchedule({
      actionId: 'med-1',
      confirmation: undefined,
      event: {
        date: '2026-07-16',
        time: '08:00',
        title: 'Take blood pressure medicine',
      },
      sourceItemId: 'rx-blurry-1',
      vault,
    });
    expect(unconfirmedMed.ok).toBe(false);

    const confirmedMed = await commitPrescriptionSchedule({
      actionId: 'med-1',
      confirmation: confirmFromTap('med-1'),
      event: {
        date: '2026-07-16',
        time: '08:00',
        title: 'Take blood pressure medicine',
      },
      sourceItemId: 'rx-blurry-1',
      vault,
    });
    expect(confirmedMed.ok).toBe(true);

    // Part B: Email channel read-only scope check + > 25 MB email skipped while next email succeeds
    const badScopes = validateReadOnlyScopes([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
    expect(badScopes.ok).toBe(false);

    const goodScopes = validateReadOnlyScopes([
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
    expect(goodScopes.ok).toBe(true);

    const emailSettings: Settings = {
      ...createDefaultSettings(),
      channels: {
        ...createDefaultSettings().channels,
        email: true,
      },
      allowAiReading: false,
    };

    const emailResult = await processEmailBatch({
      settings: emailSettings,
      tokenStatus: 'valid',
      vault,
      emails: [
        {
          id: 'email-huge',
          from: 'Clinic',
          subject: 'Large scan',
          body: 'Attached large file',
          sizeBytes: MAX_EMAIL_BYTES + 1024,
          receivedAt: '2026-07-10T11:00:00.000Z',
        },
        {
          id: 'email-ok',
          from: 'City Clinic',
          subject: 'Clinic Appointment',
          body: 'Your doctor appointment is on 2026-07-20 at 14:00.',
          sizeBytes: 2048,
          receivedAt: '2026-07-10T11:05:00.000Z',
        },
      ],
    });

    expect(emailResult.stoppedBecauseOff).toBe(false);
    expect(emailResult.reconnectRequired).toBe(false);
    expect(emailResult.skippedCount).toBe(1);
    expect(emailResult.notices.some((n) => /25 MB/i.test(n))).toBe(true);
    expect(emailResult.processed).toHaveLength(1);
    expect(emailResult.processed[0].id).toBe('email-ok');
    expect(emailResult.processed[0].group).toBe('Personal');
    expect(emailResult.processed[0].priority).toBe('Important');

    // Expired/revoked token keeps existing emails and asks to reconnect
    const expiredResult = await processEmailBatch({
      settings: emailSettings,
      tokenStatus: 'revoked',
      vault,
      emails: [
        {
          id: 'email-after-revoke',
          from: 'Friend',
          body: 'Hello',
          receivedAt: '2026-07-10T12:00:00.000Z',
        },
      ],
    });
    expect(expiredResult.reconnectRequired).toBe(true);
    expect(expiredResult.processed).toHaveLength(0);
    const remainingItems = await vault.listItems();
    expect(
      remainingItems.ok &&
        remainingItems.value.some((it) => it.id === 'email-ok')
    ).toBe(true);
  });
});
