import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BackToHome } from '@/components/BackToHome';
import { SeniorButton } from '@/components/SeniorButton';
import { MyDataPage } from '@/app/my-data/page';
import { UnifiedInboxPage } from '@/app/inbox/page';
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

function createFakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
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
}

function findElements(
  node: React.ReactNode,
  predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean,
  acc: React.ReactElement<Record<string, unknown>>[] = []
): React.ReactElement<Record<string, unknown>>[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) {
      findElements(child, predicate, acc);
    }
    return acc;
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (predicate(el)) {
      acc.push(el);
    }
    if (el.props && 'children' in el.props) {
      findElements(el.props.children as React.ReactNode, predicate, acc);
    }
  }
  return acc;
}

function stripTags(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function createHookHarness() {
  const stateSlots: unknown[] = [];
  const refSlots: Array<{ current: unknown }> = [];
  const effectPrevDeps: Array<readonly unknown[] | undefined> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let queuedEffects: Array<() => void | (() => void)> = [];

  const useStateSpy = vi.spyOn(React, 'useState').mockImplementation(((
    initialState: unknown
  ) => {
    const idx = stateCursor++;
    if (!(idx in stateSlots)) {
      stateSlots[idx] =
        typeof initialState === 'function'
          ? (initialState as () => unknown)()
          : initialState;
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
    initialValue: unknown
  ) => {
    const idx = refCursor++;
    if (!(idx in refSlots)) {
      refSlots[idx] = { current: initialValue };
    }
    return refSlots[idx];
  }) as typeof React.useRef);

  const useMemoSpy = vi
    .spyOn(React, 'useMemo')
    .mockImplementation((factory) => factory());
  const useCallbackSpy = vi
    .spyOn(React, 'useCallback')
    .mockImplementation((fn) => fn);
  const useEffectSpy = vi
    .spyOn(React, 'useEffect')
    .mockImplementation((effect, deps) => {
      const idx = effectCursor++;
      const prevDeps = effectPrevDeps[idx];
      const depsChanged =
        !prevDeps ||
        !deps ||
        prevDeps.length !== deps.length ||
        deps.some((d, i) => !Object.is(d, prevDeps[i]));
      if (depsChanged) {
        effectPrevDeps[idx] = deps ? [...deps] : undefined;
        queuedEffects.push(effect as () => void | (() => void));
      }
    });

  return {
    render<T extends React.ReactNode>(renderFn: () => T): T {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
      queuedEffects = [];
      const tree = renderFn();
      for (const eff of queuedEffects) {
        eff();
      }
      return tree;
    },
    restore() {
      useEffectSpy.mockRestore();
      useCallbackSpy.mockRestore();
      useMemoSpy.mockRestore();
      useRefSpy.mockRestore();
      useStateSpy.mockRestore();
    },
  };
}

describe('Task 2: Truthful Connection Badge, Disconnect, Auto-Check, Live Inbox Status Card & 1-Arrow Back Button', () => {
  describe('BackToHome 1-arrow fix', () => {
    it('renders exactly 1 arrow (← Back to Home) and NO <svg inside it', () => {
      const html = renderToStaticMarkup(<BackToHome />);
      expect(html).toContain('← Back to Home');
      expect(html).not.toContain('<svg');
      const arrowMatches = html.match(/←/g) ?? [];
      expect(arrowMatches).toHaveLength(1);
    });
  });

  describe('MyDataPage truthful connection badge, auto-check, and disconnect', () => {
    it('renders "Not connected yet" badge by default (dual-modality + border-2) with zero banned jargon', () => {
      const html = renderToStaticMarkup(
        <MyDataPage initialSettings={createDefaultSettings()} initialAudit={[]} />
      );
      expect(html).toContain('Not connected yet');
      expect(html).not.toContain('Connected (Gmail)');
      expect(html).not.toContain('Connected (Outlook)');
      expect(html).not.toContain('Disconnect Email');

      const badges = extractBadges(html);
      expect(badges.length).toBeGreaterThan(0);
      const notConnectedBadge = badges.find((b) => b.includes('Not connected yet'));
      expect(notConnectedBadge).toBeDefined();
      expect(notConnectedBadge).toContain('border-2');
      expect(notConnectedBadge).toContain('aria-hidden="true"');
      expect(stripTags(notConnectedBadge!)).toContain('Not connected yet');

      expect(stripTags(html)).not.toMatch(BANNED_JARGON);
      const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
      for (const btn of buttons) {
        expect(btn).toContain('min-h-[56px]');
        expect(stripTags(btn).length).toBeGreaterThan(0);
      }
    });

    it('auto-deletes stale readonly-session stub on mount and never renders green Connected', async () => {
      const vault = createVault({ dbName: 'test_mydata_stub_cleanup_v1' });
      await vault.saveSettings(createDefaultSettings());
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'stub.grandma@gmail.com',
        provider: 'Gmail',
        token: 'readonly-session',
      });

      const harness = createHookHarness();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('should not fetch for stub'));

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/my-data',
          search: '',
          hash: '',
          assign: vi.fn(),
        },
        history: { replaceState: vi.fn() },
        localStorage: createFakeLocalStorage(),
      });

      try {
        harness.render(() => MyDataPage({ vault }));
        await new Promise((r) => setTimeout(r, 40));
        const finalTree = harness.render(() => MyDataPage({ vault }));

        const tokensAfter = await vault.listOAuthTokens();
        expect(tokensAfter.ok).toBe(true);
        if (tokensAfter.ok) {
          expect(tokensAfter.value).toEqual([]);
        }
        expect(fetchSpy).not.toHaveBeenCalled();

        const badges = findElements(
          finalTree,
          (el) => el.props['data-badge'] === 'true'
        );
        const badgeText = JSON.stringify(badges);
        expect(badgeText).toContain('Not connected yet');
        expect(badgeText).not.toContain('Connected (Gmail)');
        expect(badgeText).not.toContain('stub.grandma@gmail.com');
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        harness.restore();
      }
    });

    it('shows Reconnect Needed (never green Connected) on mount when stored token returns 401, and Disconnect Email removes it', async () => {
      const vault = createVault({ dbName: 'test_mydata_expired_disconnect_v1' });
      const onSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(onSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.expired-401',
      });

      const harness = createHookHarness();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((async () =>
          new Response('Unauthorized', { status: 401 })) as typeof fetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/my-data',
          search: '',
          hash: '',
          assign: vi.fn(),
        },
        history: { replaceState: vi.fn() },
        localStorage: createFakeLocalStorage(),
      });

      try {
        harness.render(() => MyDataPage({ vault }));
        await new Promise((r) => setTimeout(r, 40));
        const expiredTree = harness.render(() => MyDataPage({ vault }));

        const badges = findElements(
          expiredTree,
          (el) => el.props['data-badge'] === 'true'
        );
        const badgeText = JSON.stringify(badges);
        expect(badgeText).toContain('Reconnect Needed');
        expect(badgeText).not.toContain('Connected (Gmail)');

        const disconnectBtn = findElements(
          expiredTree,
          (el) =>
            el.type === SeniorButton &&
            String(el.props.children).includes('Disconnect Email')
        )[0];
        expect(disconnectBtn).toBeDefined();

        await (disconnectBtn.props.onClick as () => Promise<void>)();
        await new Promise((r) => setTimeout(r, 30));

        const afterDisconnectTree = harness.render(() => MyDataPage({ vault }));
        const badgesAfter = findElements(
          afterDisconnectTree,
          (el) => el.props['data-badge'] === 'true'
        );
        expect(JSON.stringify(badgesAfter)).toContain('Not connected yet');

        const tokensAfter = await vault.listOAuthTokens();
        expect(tokensAfter.ok && tokensAfter.value).toEqual([]);
        const settingsAfter = await vault.getSettings();
        expect(settingsAfter.ok && settingsAfter.value.channels.email).toBe(false);
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        harness.restore();
      }
    });

    it('immediately runs syncEmailsFromRelay on OAuth callback completion, persists check status, and renders checked/new counts + Open Unified Inbox + Disconnect Email', async () => {
      const vault = createVault({ dbName: 'test_mydata_callback_autocheck_v1' });
      await vault.saveSettings(createDefaultSettings());

      const fakeStorage = createFakeLocalStorage();
      const replaceState = vi.fn();
      const harness = createHookHarness();

      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('userinfo')) {
          return new Response(JSON.stringify({ email: 'ah.lin@gmail.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('maxResults=1') && !url.includes('maxResults=10')) {
          return new Response(JSON.stringify({ messages: [{ id: 'g-101' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('maxResults=10')) {
          return new Response(
            JSON.stringify({ messages: [{ id: 'g-101' }, { id: 'g-102' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/messages/g-101')) {
          return new Response(
            JSON.stringify({
              id: 'g-101',
              snippet: 'Your clinic checkup is on 2026-12-01 at 10:00.',
              payload: {
                headers: [
                  { name: 'From', value: 'City Clinic <care@clinic.sg>' },
                  { name: 'Subject', value: 'Checkup Reminder' },
                  { name: 'Date', value: 'Sun, 22 Nov 2026 04:00:00 +0000' },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/messages/g-102')) {
          return new Response(
            JSON.stringify({
              id: 'g-102',
              snippet: 'Family dinner this Sunday at 6pm.',
              payload: {
                headers: [
                  { name: 'From', value: 'Mei Ling <mei@family.sg>' },
                  { name: 'Subject', value: 'Sunday Dinner' },
                  { name: 'Date', value: 'Sun, 22 Nov 2026 04:05:00 +0000' },
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
      }) as unknown as typeof fetch;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/my-data',
          search: '',
          hash: '#access_token=ya29.fresh-live&scope=https://www.googleapis.com/auth/gmail.readonly%20https://www.googleapis.com/auth/userinfo.email&state=provider%3DGmail',
          assign: vi.fn(),
        },
        history: { replaceState },
        localStorage: fakeStorage,
      });

      try {
        harness.render(() => MyDataPage({ vault }));
        await new Promise((r) => setTimeout(r, 80));
        const finalTree = harness.render(() => MyDataPage({ vault }));

        const snapshot = readEmailCheckStatus();
        expect(snapshot).toBeDefined();
        expect(snapshot?.account).toBe('ah.lin@gmail.com');
        expect(snapshot?.provider).toBe('Gmail');
        expect(snapshot?.checkedCount).toBe(2);
        expect(snapshot?.newCount).toBe(2);
        expect(snapshot?.status).toBe('ok');
        expect(snapshot?.message).not.toMatch(BANNED_JARGON);

        const serialized = JSON.stringify(finalTree);
        expect(serialized).toContain('Connected (Gmail)');
        expect(serialized).toContain('ah.lin@gmail.com');
        expect(serialized).toContain('2');
        expect(serialized).toContain('Open Unified Inbox');
        expect(serialized).toContain('Disconnect Email');

        const openInboxBtn = findElements(
          finalTree,
          (el) =>
            el.type === SeniorButton &&
            String(el.props.children).includes('Open Unified Inbox')
        )[0];
        expect(openInboxBtn).toBeDefined();
        expect(openInboxBtn.props.href).toBe('/inbox');

        const disconnectBtn = findElements(
          finalTree,
          (el) =>
            el.type === SeniorButton &&
            String(el.props.children).includes('Disconnect Email')
        )[0];
        expect(disconnectBtn).toBeDefined();

        expect(replaceState).toHaveBeenCalledWith(null, '', '/my-data');
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        harness.restore();
      }
    });
  });

  describe('UnifiedInboxPage Email Status Card, live checking state & cloud error visibility', () => {
    it('renders Email Status Card (data-card="true") with Email Not Connected by default in SSR and zero banned jargon', () => {
      vi.stubGlobal('window', undefined);
      try {
        const html = renderToStaticMarkup(
          <UnifiedInboxPage
            initialSettings={createDefaultSettings()}
            initialItems={[]}
          />
        );
        expect(html).toContain('data-card="true"');
        expect(html).toContain('Email Not Connected');

        const badges = extractBadges(html);
        const statusBadge = badges.find((b) =>
          b.includes('Email Not Connected')
        );
        expect(statusBadge).toBeDefined();
        expect(statusBadge).toContain('border-2');
        expect(statusBadge).toContain('aria-hidden="true"');

        expect(stripTags(html)).not.toMatch(BANNED_JARGON);
        const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
        for (const btn of buttons) {
          expect(btn).toContain('min-h-[56px]');
          expect(stripTags(btn).length).toBeGreaterThan(0);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('shows Checking Emails Now... while checking, then Connected (Gmail) + Last checked counts after completion', async () => {
      const vault = createVault({ dbName: 'test_inbox_status_live_v1' });
      const onSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(onSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.live-inbox-check',
      });

      let resolveGmailList!: (res: Response) => void;
      const gmailListPromise = new Promise<Response>((resolve) => {
        resolveGmailList = resolve;
      });

      const mockFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
          return gmailListPromise;
        }
        if (url.includes('/messages/gm-1')) {
          return new Response(
            JSON.stringify({
              id: 'gm-1',
              snippet: 'Reminder for your appointment.',
              payload: {
                headers: [
                  { name: 'From', value: 'Clinic <care@clinic.sg>' },
                  { name: 'Subject', value: 'Appointment' },
                  { name: 'Date', value: 'Sun, 22 Nov 2026 04:00:00 +0000' },
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

      const fakeStorage = createFakeLocalStorage();
      const harness = createHookHarness();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/inbox',
          search: '',
          hash: '',
        },
        localStorage: fakeStorage,
      });

      try {
        // Render 1: initial loadData
        harness.render(() => UnifiedInboxPage({ vault }));
        await new Promise((r) => setTimeout(r, 30));

        // Render 2: auto-check starts and pauses on gmailListPromise
        harness.render(() => UnifiedInboxPage({ vault }));
        await Promise.resolve();
        await Promise.resolve();

        // Render 3: while check is in flight -> "Checking Emails Now..." & "Checking Emails..."
        const checkingTree = harness.render(() => UnifiedInboxPage({ vault }));
        const checkingSerialized = JSON.stringify(checkingTree);
        expect(checkingSerialized).toContain('Checking Emails Now...');
        expect(checkingSerialized).toContain('Checking Emails...');
        expect(checkingSerialized).toContain('animate-spin');

        // Resolve Gmail fetch
        resolveGmailList(
          new Response(JSON.stringify({ messages: [{ id: 'gm-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
        await new Promise((r) => setTimeout(r, 60));

        // Render 4: check completed -> Connected (Gmail) + Last checked + checked/new counts
        const doneTree = harness.render(() => UnifiedInboxPage({ vault }));
        const doneSerialized = JSON.stringify(doneTree);
        expect(doneSerialized).toContain('Connected (Gmail)');
        expect(doneSerialized).toContain('mary.tan@gmail.com');
        expect(doneSerialized).toContain('Last checked');
        expect(doneSerialized).toContain('Check for New Emails');

        const persisted = readEmailCheckStatus();
        expect(persisted).toBeDefined();
        expect(persisted?.status).toBe('ok');
        expect(persisted?.checkedCount).toBe(1);
        expect(persisted?.newCount).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        harness.restore();
      }
    });

    it('surfaces real cloud errors clearly even on initial mount check (silentOnError) and shows Reconnect Needed when 401', async () => {
      const vault = createVault({ dbName: 'test_inbox_cloud_error_v1' });
      const onSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(onSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.server-500-token',
      });

      const mockFetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://gmail.googleapis.com/')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        if (url.includes('/api/ingest/pull')) {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const fakeStorage = createFakeLocalStorage();
      const harness = createHookHarness();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/inbox',
          search: '',
          hash: '',
        },
        localStorage: fakeStorage,
      });

      try {
        harness.render(() => UnifiedInboxPage({ vault }));
        await new Promise((r) => setTimeout(r, 30));
        harness.render(() => UnifiedInboxPage({ vault }));
        await new Promise((r) => setTimeout(r, 50));

        const errorTree = harness.render(() => UnifiedInboxPage({ vault }));
        const alerts = findElements(
          errorTree,
          (el) => el.props.role === 'alert'
        );
        expect(alerts.length).toBeGreaterThan(0);
        expect(JSON.stringify(alerts)).toContain(
          'We could not check for new emails right now. Please try again.'
        );
        const persisted = readEmailCheckStatus();
        expect(persisted?.status).toBe('error');

        // Also check Reconnect Needed badge rendering in SSR when initialReconnectMessage is passed
        const reconnectHtml = renderToStaticMarkup(
          <UnifiedInboxPage
            initialSettings={onSettings}
            initialItems={[]}
            initialReconnectMessage="Your email connection has ended."
          />
        );
        expect(reconnectHtml).toContain('Reconnect Needed');
        expect(stripTags(reconnectHtml)).not.toMatch(BANNED_JARGON);
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
        harness.restore();
      }
    });

    it('produces byte-for-byte identical SSR and initial client render even when localStorage has a prior check snapshot (no hydration mismatch)', () => {
      const onSettings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };

      // 1. SSR render (window is undefined)
      vi.stubGlobal('window', undefined);
      let ssrHtml = '';
      try {
        ssrHtml = renderToStaticMarkup(
          <UnifiedInboxPage initialSettings={onSettings} initialItems={[]} />
        );
      } finally {
        vi.unstubAllGlobals();
      }

      // 2. Client initial render (before useEffect) with populated localStorage
      const fakeStorage = createFakeLocalStorage();
      vi.stubGlobal('window', { localStorage: fakeStorage });
      try {
        saveEmailCheckStatus({
          account: 'mary.tan@gmail.com',
          provider: 'Gmail',
          checkedAtIso: '2026-11-22T04:00:00.000Z',
          checkedCount: 5,
          newCount: 2,
          status: 'ok',
          message: '2 new emails arrived in your Unified Inbox.',
        });

        const clientInitialHtml = renderToStaticMarkup(
          <UnifiedInboxPage initialSettings={onSettings} initialItems={[]} />
        );

        expect(clientInitialHtml).toBe(ssrHtml);
        expect(clientInitialHtml).toContain('Email Not Connected');
        expect(clientInitialHtml).not.toContain('Connected (Gmail)');
        expect(clientInitialHtml).not.toContain('Last checked');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('probes live connection when channels.email is false so UnifiedInboxPage and MyDataPage agree on Reconnect Needed (and hides stale counts when disconnected)', async () => {
      const vault = createVault({ dbName: 'test_cross_page_agreement_v1' });
      const offSettings = createDefaultSettings(); // channels.email === false
      await vault.saveSettings(offSettings);
      await vault.saveOAuthToken({
        id: 'email-account-primary',
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        token: 'ya29.expired-401-token',
      });

      const fakeStorage = createFakeLocalStorage();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((async () =>
          new Response('Unauthorized', { status: 401 })) as typeof fetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/inbox',
          search: '',
          hash: '',
          assign: vi.fn(),
        },
        history: { replaceState: vi.fn() },
        localStorage: fakeStorage,
      });

      // Seed stale "ok" status in localStorage — neither page may trust it when live probe returns 401
      saveEmailCheckStatus({
        account: 'mary.tan@gmail.com',
        provider: 'Gmail',
        checkedAtIso: '2026-11-22T04:00:00.000Z',
        checkedCount: 4,
        newCount: 1,
        status: 'ok',
        message: '1 new email arrived in your Unified Inbox.',
      });

      try {
        let inboxBadges = '';
        const inboxHarness = createHookHarness();
        try {
          inboxHarness.render(() => UnifiedInboxPage({ vault }));
          await new Promise((r) => setTimeout(r, 50));
          const inboxTree = inboxHarness.render(() => UnifiedInboxPage({ vault }));
          inboxBadges = JSON.stringify(
            findElements(inboxTree, (el) => el.props['data-badge'] === 'true')
          );
        } finally {
          inboxHarness.restore();
        }

        let myDataBadges = '';
        const myDataHarness = createHookHarness();
        try {
          myDataHarness.render(() => MyDataPage({ vault }));
          await new Promise((r) => setTimeout(r, 50));
          const myDataTree = myDataHarness.render(() => MyDataPage({ vault }));
          myDataBadges = JSON.stringify(
            findElements(myDataTree, (el) => el.props['data-badge'] === 'true')
          );
        } finally {
          myDataHarness.restore();
        }

        expect(inboxBadges).toContain('Reconnect Needed');
        expect(inboxBadges).not.toContain('Connected (Gmail)');
        expect(myDataBadges).toContain('Reconnect Needed');
        expect(myDataBadges).not.toContain('Connected (Gmail)');

        // Now test disconnected vault with only a readonly-session stub + stale localStorage snapshot
        const stubVault = createVault({ dbName: 'test_inbox_stale_status_v1' });
        await stubVault.saveSettings(offSettings);
        await stubVault.saveOAuthToken({
          id: 'stale-stub-1',
          account: 'old.stub@gmail.com',
          provider: 'Gmail',
          token: 'readonly-session',
        });

        const stubHarness = createHookHarness();
        try {
          stubHarness.render(() => UnifiedInboxPage({ vault: stubVault }));
          await new Promise((r) => setTimeout(r, 50));
          const stubTree = stubHarness.render(() =>
            UnifiedInboxPage({ vault: stubVault })
          );
          const stubSerialized = JSON.stringify(stubTree);
          expect(stubSerialized).toContain('Email Not Connected');
          expect(stubSerialized).not.toContain('Last checked');
          expect(stubSerialized).not.toContain('old.stub@gmail.com');
        } finally {
          stubHarness.restore();
        }
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
      }
    });

    it('MyDataPage cleans all empty/readonly-session stubs across multiple records and selects the valid cloud account matching UnifiedInboxPage', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((async () =>
          new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch);

      vi.stubGlobal('window', {
        location: {
          origin: 'http://localhost:5173',
          pathname: '/my-data',
          search: '',
          hash: '',
          assign: vi.fn(),
        },
        history: { replaceState: vi.fn() },
        localStorage: createFakeLocalStorage(),
      });

      try {
        // Case A: [stub, validRecord]
        const vaultA = createVault({ dbName: 'test_mydata_stub_then_valid_v1' });
        await vaultA.saveSettings(createDefaultSettings());
        await vaultA.saveOAuthToken({
          id: 'a-stub',
          account: 'stub@gmail.com',
          provider: 'Gmail',
          token: 'readonly-session',
        });
        await vaultA.saveOAuthToken({
          id: 'b-valid',
          account: 'real.senior@gmail.com',
          provider: 'Gmail',
          token: 'ya29.real-valid-token',
        });

        const harnessA = createHookHarness();
        try {
          harnessA.render(() => MyDataPage({ vault: vaultA }));
          await new Promise((r) => setTimeout(r, 50));
          const treeA = harnessA.render(() => MyDataPage({ vault: vaultA }));

          const badgesA = JSON.stringify(
            findElements(treeA, (el) => el.props['data-badge'] === 'true')
          );
          expect(badgesA).toContain('Connected (Gmail): real.senior@gmail.com');

          const tokensAfterA = await vaultA.listOAuthTokens();
          expect(tokensAfterA.ok && tokensAfterA.value.map((t) => t.id)).toEqual([
            'b-valid',
          ]);
        } finally {
          harnessA.restore();
        }

        // Case B: [validRecord, trailingStub]
        const vaultB = createVault({ dbName: 'test_mydata_valid_then_stub_v1' });
        await vaultB.saveSettings(createDefaultSettings());
        await vaultB.saveOAuthToken({
          id: 'a-valid',
          account: 'real.senior@gmail.com',
          provider: 'Gmail',
          token: 'ya29.real-valid-token',
        });
        await vaultB.saveOAuthToken({
          id: 'b-stub',
          account: 'trailing.stub@gmail.com',
          provider: 'Gmail',
          token: 'readonly-session',
        });

        const harnessB = createHookHarness();
        try {
          harnessB.render(() => MyDataPage({ vault: vaultB }));
          await new Promise((r) => setTimeout(r, 50));
          const treeB = harnessB.render(() => MyDataPage({ vault: vaultB }));

          const badgesB = JSON.stringify(
            findElements(treeB, (el) => el.props['data-badge'] === 'true')
          );
          expect(badgesB).toContain('Connected (Gmail): real.senior@gmail.com');

          const tokensAfterB = await vaultB.listOAuthTokens();
          expect(tokensAfterB.ok && tokensAfterB.value.map((t) => t.id)).toEqual([
            'a-valid',
          ]);
        } finally {
          harnessB.restore();
        }
      } finally {
        vi.unstubAllGlobals();
        fetchSpy.mockRestore();
      }
    });
  });
});
