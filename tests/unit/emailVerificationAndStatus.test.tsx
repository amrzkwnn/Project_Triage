import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings, type InboxItem } from '@/lib/types';
import { createVault } from '@/lib/vault/store';
import {
  clearEmailCheckStatus,
  completeCloudLoginCallback,
  disconnectEmailAccount,
  readEmailCheckStatus,
  saveEmailCheckStatus,
  syncEmailsFromRelay,
  verifyCloudEmailConnection,
  type EmailCheckStatusSnapshot,
} from '@/lib/inbox/emailClient';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

describe('Task 1: Truthful Cloud Connection Verification, Disconnect, Parallel Fetch & Check Status', () => {
  describe('verifyCloudEmailConnection', () => {
    it('returns disconnected for undefined record, empty token, or readonly-session stub', async () => {
      const fetchFn = vi.fn() as unknown as typeof fetch;

      const missing = await verifyCloudEmailConnection({
        record: undefined,
        fetchFn,
      });
      expect(missing.status).toBe('disconnected');
      if (missing.status === 'disconnected') {
        expect(missing.message.trim().length).toBeGreaterThan(0);
        expect(missing.message).not.toMatch(BANNED_JARGON);
      }

      const stub = await verifyCloudEmailConnection({
        record: {
          id: 'email-account-primary',
          account: 'grandma@gmail.com',
          provider: 'Gmail',
          token: 'readonly-session',
        },
        fetchFn,
      });
      expect(stub.status).toBe('disconnected');
      if (stub.status === 'disconnected') {
        expect(stub.message).not.toMatch(BANNED_JARGON);
      }

      const emptyToken = await verifyCloudEmailConnection({
        record: {
          id: 'email-account-primary',
          account: 'grandma@gmail.com',
          provider: 'Gmail',
          token: '   ',
        },
        fetchFn,
      });
      expect(emptyToken.status).toBe('disconnected');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('probes Gmail mailbox and returns connected on 200, expired on 401/403, and offline on network error', async () => {
      const record = {
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail' as const,
        token: 'ya29.live-gmail-token',
      };

      const okFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        expect(url).toContain('https://gmail.googleapis.com/');
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
          'Bearer ya29.live-gmail-token'
        );
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }) as unknown as typeof fetch;

      const okRes = await verifyCloudEmailConnection({ record, fetchFn: okFetch });
      expect(okRes).toEqual({
        status: 'connected',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
      });

      for (const status of [401, 403]) {
        const failFetch = (async () =>
          new Response('Denied', { status })) as typeof fetch;
        const expiredRes = await verifyCloudEmailConnection({
          record,
          fetchFn: failFetch,
        });
        expect(expiredRes.status).toBe('expired');
        if (expiredRes.status === 'expired') {
          expect(expiredRes.account).toBe('mary.tan@gmail.com');
          expect(expiredRes.provider).toBe('Gmail');
          expect(expiredRes.message.trim().length).toBeGreaterThan(0);
          expect(expiredRes.message).not.toMatch(BANNED_JARGON);
        }
      }

      const offlineFetch = (async () => {
        throw new Error('Failed to fetch');
      }) as typeof fetch;
      const offlineRes = await verifyCloudEmailConnection({
        record,
        fetchFn: offlineFetch,
      });
      expect(offlineRes.status).toBe('offline');
      if (offlineRes.status === 'offline') {
        expect(offlineRes.account).toBe('mary.tan@gmail.com');
        expect(offlineRes.provider).toBe('Gmail');
        expect(offlineRes.message.trim().length).toBeGreaterThan(0);
        expect(offlineRes.message).not.toMatch(BANNED_JARGON);
      }
    });

    it('probes Outlook mailbox via Microsoft Graph and returns connected on 200 and expired on 401/403', async () => {
      const record = {
        id: 'email-account-primary',
        account: 'ah.kow@outlook.com',
        provider: 'Outlook' as const,
        token: 'ms-live-token',
      };

      const okFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        expect(url).toContain('https://graph.microsoft.com/');
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
          'Bearer ms-live-token'
        );
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }) as unknown as typeof fetch;

      const okRes = await verifyCloudEmailConnection({ record, fetchFn: okFetch });
      expect(okRes).toEqual({
        status: 'connected',
        account: 'ah.kow@outlook.com',
        provider: 'Outlook',
      });

      const forbiddenFetch = (async () =>
        new Response('Forbidden', { status: 403 })) as typeof fetch;
      const forbiddenRes = await verifyCloudEmailConnection({
        record,
        fetchFn: forbiddenFetch,
      });
      expect(forbiddenRes.status).toBe('expired');
      if (forbiddenRes.status === 'expired') {
        expect(forbiddenRes.message).not.toMatch(BANNED_JARGON);
      }
    });
  });

  describe('completeCloudLoginCallback truthful scope & mailbox verification', () => {
    it('rejects Gmail callback when scope only includes openid + userinfo.email (missing gmail.readonly)', async () => {
      const savedTokens: unknown[] = [];
      let savedSettings = createDefaultSettings();
      const mockVault = {
        saveOAuthToken: async (rec: unknown) => {
          savedTokens.push(rec);
          return { ok: true as const, value: undefined };
        },
        saveSettings: async (next: typeof savedSettings) => {
          savedSettings = next;
          return { ok: true as const, value: undefined };
        },
      };

      const fetchFn = vi.fn() as unknown as typeof fetch;

      const res = await completeCloudLoginCallback({
        vault: mockVault,
        settings: savedSettings,
        hash: '#access_token=ya29.no-mail-scope&scope=openid%20https://www.googleapis.com/auth/userinfo.email&state=provider%3DGmail',
        fetchFn,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorMessage.trim().length).toBeGreaterThan(0);
        expect(res.errorMessage).not.toMatch(BANNED_JARGON);
      }
      expect(savedTokens).toHaveLength(0);
      expect(savedSettings.channels.email).toBe(false);
    });

    it('rejects Outlook callback when scope is missing mail.read', async () => {
      const savedTokens: unknown[] = [];
      let savedSettings = createDefaultSettings();
      const mockVault = {
        saveOAuthToken: async (rec: unknown) => {
          savedTokens.push(rec);
          return { ok: true as const, value: undefined };
        },
        saveSettings: async (next: typeof savedSettings) => {
          savedSettings = next;
          return { ok: true as const, value: undefined };
        },
      };

      const res = await completeCloudLoginCallback({
        vault: mockVault,
        settings: savedSettings,
        hash: '#access_token=ms-no-mail&scope=openid%20email%20https://graph.microsoft.com/user.read&state=provider%3DOutlook',
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorMessage).not.toMatch(BANNED_JARGON);
      }
      expect(savedTokens).toHaveLength(0);
      expect(savedSettings.channels.email).toBe(false);
    });

    it('rejects Gmail callback without saving when live Gmail mailbox probe returns 403', async () => {
      const savedTokens: unknown[] = [];
      let savedSettings = createDefaultSettings();
      const mockVault = {
        saveOAuthToken: async (rec: unknown) => {
          savedTokens.push(rec);
          return { ok: true as const, value: undefined };
        },
        saveSettings: async (next: typeof savedSettings) => {
          savedSettings = next;
          return { ok: true as const, value: undefined };
        },
      };

      const fetchFn = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('userinfo')) {
          return new Response(JSON.stringify({ email: 'grandma@gmail.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('https://gmail.googleapis.com/')) {
          return new Response('Gmail API disabled or insufficient scope', {
            status: 403,
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const res = await completeCloudLoginCallback({
        vault: mockVault,
        settings: savedSettings,
        hash: '#access_token=ya29.forbidden&scope=https://www.googleapis.com/auth/gmail.readonly%20openid%20https://www.googleapis.com/auth/userinfo.email&state=provider%3DGmail',
        fetchFn,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorMessage.trim().length).toBeGreaterThan(0);
        expect(res.errorMessage).not.toMatch(BANNED_JARGON);
      }
      expect(savedTokens).toHaveLength(0);
      expect(savedSettings.channels.email).toBe(false);
    });

    it('succeeds when gmail.readonly is present and live mailbox probe returns 200', async () => {
      const savedTokens: Array<{ account: string; provider: string; token: string }> =
        [];
      let savedSettings = createDefaultSettings();
      const mockVault = {
        saveOAuthToken: async (rec: {
          id: string;
          account: string;
          provider: string;
          token: string;
        }) => {
          savedTokens.push(rec);
          return { ok: true as const, value: undefined };
        },
        saveSettings: async (next: typeof savedSettings) => {
          savedSettings = next;
          return { ok: true as const, value: undefined };
        },
      };

      const probedUrls: string[] = [];
      const fetchFn = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        probedUrls.push(url);
        if (url.includes('userinfo')) {
          return new Response(JSON.stringify({ email: 'grandma@gmail.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('https://gmail.googleapis.com/')) {
          return new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const res = await completeCloudLoginCallback({
        vault: mockVault,
        settings: savedSettings,
        hash: '#access_token=ya29.verified&scope=https://www.googleapis.com/auth/gmail.readonly%20openid%20https://www.googleapis.com/auth/userinfo.email&state=provider%3DGmail',
        fetchFn,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.record.account).toBe('grandma@gmail.com');
        expect(res.record.provider).toBe('Gmail');
        expect(res.record.token).toBe('ya29.verified');
        expect(res.settings.channels.email).toBe(true);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
      expect(
        probedUrls.some((u) => u.startsWith('https://gmail.googleapis.com/'))
      ).toBe(true);
      expect(savedTokens).toHaveLength(1);
      expect(savedSettings.channels.email).toBe(true);
    });
  });

  describe('createVault().deleteOAuthToken and disconnectEmailAccount', () => {
    it('deletes stored OAuth record, turns settings.channels.email to false, and preserves saved inbox items', async () => {
      const vault = createVault({ dbName: 'test_disconnect_email_v1' });
      const initialSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(initialSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.live-token',
      });

      const savedItem: InboxItem = {
        id: 'saved-clinic-1',
        source: 'email',
        sender: 'City Clinic',
        text: 'Clinic appointment on 2026-09-10 at 09:00.',
        attachments: [],
        receivedAt: '2026-09-01T08:00:00.000Z',
        group: 'Personal',
        priority: 'Important',
        tier: 2,
        confidence: 0.9,
        status: 'ok',
      };
      await vault.putItem(savedItem);

      expect(typeof vault.deleteOAuthToken).toBe('function');

      const res = await disconnectEmailAccount({
        vault,
        settings: initialSettings,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.settings.channels.email).toBe(false);
        expect(res.message.trim().length).toBeGreaterThan(0);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }

      const tokensAfter = await vault.listOAuthTokens();
      expect(tokensAfter.ok).toBe(true);
      if (tokensAfter.ok) {
        expect(tokensAfter.value).toEqual([]);
      }

      const settingsAfter = await vault.getSettings();
      expect(settingsAfter.ok).toBe(true);
      if (settingsAfter.ok) {
        expect(settingsAfter.value.channels.email).toBe(false);
      }

      const itemsAfter = await vault.listItems();
      expect(itemsAfter.ok).toBe(true);
      if (itemsAfter.ok) {
        expect(itemsAfter.value).toHaveLength(1);
        expect(itemsAfter.value[0].id).toBe('saved-clinic-1');
      }
    });

    it('createVault().deleteOAuthToken removes only the matching token id and respects write failures', async () => {
      let failWrites = false;
      const vault = createVault({
        dbName: 'test_delete_single_oauth_v1',
        shouldFailWrite: () => failWrites,
      });

      await vault.saveOAuthToken({
        id: 'tok-a',
        account: 'a@gmail.com',
        provider: 'Gmail',
        token: 'secret-a',
      });
      await vault.saveOAuthToken({
        id: 'tok-b',
        account: 'b@outlook.com',
        provider: 'Outlook',
        token: 'secret-b',
      });

      failWrites = true;
      const failedDel = await vault.deleteOAuthToken!('tok-a');
      expect(failedDel.ok).toBe(false);

      failWrites = false;
      const okDel = await vault.deleteOAuthToken!('tok-a');
      expect(okDel.ok).toBe(true);

      const remaining = await vault.listOAuthTokens();
      expect(remaining.ok).toBe(true);
      if (remaining.ok) {
        expect(remaining.value.map((r) => r.id)).toEqual(['tok-b']);
      }
    });
  });

  describe('syncEmailsFromRelay parallel Gmail detail fetches & checkedCount', () => {
    it('fetches Gmail message details in parallel and returns checkedCount alongside stored', async () => {
      const vault = createVault({ dbName: 'test_parallel_gmail_v1' });
      const onSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(onSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.parallel-token',
      });

      let inFlight = 0;
      let maxInFlight = 0;
      const resolvers: Array<() => void> = [];

      const mockFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (
          url.startsWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?'
          )
        ) {
          return new Response(
            JSON.stringify({
              messages: [{ id: 'g-1' }, { id: 'g-2' }, { id: 'g-3' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const detailMatch = url.match(/\/messages\/(g-\d+)\?/);
        if (detailMatch) {
          const msgId = detailMatch[1];
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);

          await new Promise<void>((resolve) => {
            resolvers.push(resolve);
            if (resolvers.length === 3) {
              for (const fn of resolvers) fn();
            }
          });

          inFlight -= 1;
          return new Response(
            JSON.stringify({
              id: msgId,
              snippet: `Clinic reminder body for ${msgId}`,
              payload: {
                headers: [
                  { name: 'From', value: 'City Clinic <care@clinic.sg>' },
                  { name: 'Subject', value: `Subject ${msgId}` },
                  { name: 'Date', value: 'Mon, 10 Aug 2026 08:30:00 +0000' },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url.includes('/api/ingest/pull')) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const res = await syncEmailsFromRelay({
        vault,
        settings: onSettings,
        fetchFn: mockFetch,
      });

      expect(res.ok).toBe(true);
      expect(maxInFlight).toBe(3);
      if (res.ok) {
        expect(res.stored).toHaveLength(3);
        expect(res.checkedCount).toBe(3);
        expect(res.message).not.toMatch(BANNED_JARGON);
      }
    });
  });

  describe('Email check status persistence and SSR safety', () => {
    it('saves, reads, and clears EmailCheckStatusSnapshot when window.localStorage is present', () => {
      const store = new Map<string, string>();
      const fakeStorage: Storage = {
        get length() {
          return store.size;
        },
        clear() {
          store.clear();
        },
        getItem(key: string) {
          return store.has(key) ? store.get(key)! : null;
        },
        key(index: number) {
          return Array.from(store.keys())[index] ?? null;
        },
        removeItem(key: string) {
          store.delete(key);
        },
        setItem(key: string, value: string) {
          store.set(key, value);
        },
      };

      vi.stubGlobal('window', { localStorage: fakeStorage });
      try {
        clearEmailCheckStatus();
        expect(readEmailCheckStatus()).toBeUndefined();

        const snapshot: EmailCheckStatusSnapshot = {
          account: 'mary.tan@gmail.com',
          provider: 'Gmail',
          checkedAtIso: '2026-11-22T04:00:00.000Z',
          checkedCount: 5,
          newCount: 2,
          status: 'ok',
          message: '2 new emails arrived in your Unified Inbox.',
        };

        saveEmailCheckStatus(snapshot);
        expect(readEmailCheckStatus()).toEqual(snapshot);

        clearEmailCheckStatus();
        expect(readEmailCheckStatus()).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('is SSR-safe when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      try {
        expect(() =>
          saveEmailCheckStatus({
            checkedAtIso: '2026-11-22T04:00:00.000Z',
            checkedCount: 0,
            newCount: 0,
            status: 'ok',
            message: 'Checked for new emails. You are all caught up.',
          })
        ).not.toThrow();
        expect(readEmailCheckStatus()).toBeUndefined();
        expect(() => clearEmailCheckStatus()).not.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
