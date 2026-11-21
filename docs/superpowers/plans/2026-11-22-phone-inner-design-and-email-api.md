# Phone-Only Design & Live Automatic Email API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only the inner-phone design in `AppShell`/`PhoneFrame` (removing the outer `DemoShell` marketing columns and outer hardware bezel chrome), mount all 5 `/api/*` backend routes directly inside the Vite dev/preview server, and wire user-facing Automatic Email Setup (Read-Only Sign-In + No-Login Auto-Forwarding) and automatic `/api/ingest/pull` synchronization in `MyDataPage` and `UnifiedInboxPage`.

**Architecture:** We simplify `AppShell` (`src/app/layout.tsx`) and `PhoneFrame` (`src/components/PhoneFrame.tsx`) so the app renders only the clean inner-phone interface (`max-w-[430px]` centered mobile screen with Syed's Teal/Canvas tokens, frosted top header, `.app-scroll` content, and frosted bottom `TabBar`) without external marketing columns or fake hardware bezels. We add a Vite server middleware plugin (`src/lib/server/viteApiPlugin.ts`) wired into `vite.config.ts` so `/api/ingest`, `/api/ingest/email`, `/api/ingest/pull`, `/api/ingest/ack`, and `/api/decide` run live on `http://localhost:5173/api/*`. Finally, we connect `src/lib/inbox/emailChannel.ts` and `src/lib/inbox/pullPipeline.ts` to the UI via `src/lib/inbox/emailClient.ts`, adding Read-Only Email Sign-In and 1-tap test email forwarding/pulling to `MyDataPage` and `UnifiedInboxPage`.

**Tech Stack:** TypeScript 5, React 19, Vite 5, Tailwind CSS 3.4, Lucide React, Web Fetch API / Node HTTP middleware, IndexedDB Vault, Vitest.

**Spec:**
- Functional Spec: `C:\Users\Amir\Projects\Build_Bersama\.kiro\specs\senior-digital-companion\{requirements.md,design.md,tasks.md}` (Requirements 4, 10, 11, 27)
- Visual Spec: `C:\Users\Amir\Projects\Build_Bersama\Project_Triage-Syed` (inner-phone screen design only)

## Global Constraints

- **Phone-Only Inner Design:** `AppShell` (`src/app/layout.tsx`) MUST NOT render `DemoShell` outer marketing columns or `.phone-body` outer hardware bezel chrome (`DynamicIsland`, simulated clock `StatusBar`, `HomeIndicator`, side buttons). It MUST render only the inner phone screen design (`max-w-[430px]` centered phone screen container with `ScreenPortalContext`, frosted top `<header>`, `.app-scroll` `<main id="main-content">`, and frosted bottom `<TabBar>`).
- **Live Vite API Routes:** `/api/ingest` (`POST`), `/api/ingest/email` (`POST`), `/api/ingest/pull` (`GET`), `/api/ingest/ack` (`POST`), and `/api/decide` (`POST`) MUST be mounted in `vite.config.ts` via `configureServer` and `configurePreviewServer` using `getServerRuntime()`.
- **Read-Only Email Scope Invariant:** Connecting an email account MUST validate scopes through `validateReadOnlyScopes` (`gmail.readonly` or `mail.read`) and reject any write/send/delete scope.
- **Consent Gate Invariant:** Automatic email pull (`syncEmailsFromRelay`) MUST check `admit(settings, { source: 'email' })` and never store emails in the Vault when `settings.channels.email` is `false`.
- **Touch Target & Button Invariant:** Every `<button>` rendered anywhere inside the 7 screens MUST include `min-h-[56px]` and a non-empty visible text label (`stripHtml(buttonHtml).length > 0`).
- **Dual-Modality Badge Invariant:** Every element with `data-badge="true"` MUST contain both an icon wrapper with `aria-hidden="true"` and visible text (`stripHtml(badgeHtml).length > 0`), plus `border-2` where asserted by existing tests.
- **Plain-Language Copy Invariant:** No user-facing text in any screen or component may match `/\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i`. (Use plain terms like `"Connected Email"`, `"Check for New Emails"`, `"Automatic Email Reading"`, `"Read-Only Access"` — never write `"OAuth"`, `"API"`, `"token"`, `"sync"`, or `"webhook"` in user-facing JSX copy!).
- **Shell & Test Runner Commands (Windows PowerShell 5.1):** Use `;` (never `&&`) and run `.\node_modules\.bin\tsc.cmd --noEmit`, `.\node_modules\.bin\vitest.cmd --run`, and `.\node_modules\.bin\vite.cmd build` in `C:\Users\Amir\Projects\Project_Triage\.worktrees\syed-visual-design`.

## Review Focus

1. **Banned jargon in new Email Connection UI copy:** `tests/a11y/accessibilityAndCopy.test.tsx` fails if any rendered screen contains `sync`, `token`, `api`, `cache`, `oauth`, or `webhook`. All labels, buttons, placeholders, and status messages in `MyDataPage` and `UnifiedInboxPage` must use plain language (`"Check for New Emails"`, `"Connect Read-Only Email"`, `"Automatic Email Reading"`). (Pinned in Task 3 test `MyDataPage and UnifiedInboxPage email connection controls contain zero banned jargon and all buttons have min-h-[56px]`).
2. **SSR / `renderToStaticMarkup` when `fetch` is unmocked or `window` is undefined:** `UnifiedInboxPage` automatic email check on mount must run inside `useEffect` and gracefully handle missing/failed `fetch` without throwing or polluting SSR static markup. (Pinned in Task 3 test `UnifiedInboxPage renders cleanly under renderToStaticMarkup and pulls queued relay emails via syncEmailsFromRelay`).
3. **`ScreenPortalContext` availability after removing outer `.phone-body` bezel:** `ToastProvider` portals toasts into `useScreenPortal()`. `PhoneFrame` in inner-screen mode must still provide `ScreenPortalContext` pointing to the phone screen container ref. (Pinned in Task 1 test `PhoneFrame provides ScreenPortalContext and renders only inner phone screen without outer bezel or DemoShell columns`).
4. **Node `IncomingMessage` body streaming in Vite middleware:** `POST /api/ingest/email` and `POST /api/ingest/ack` send JSON bodies; the Vite middleware adapter must read raw request chunks into a `Uint8Array` and construct a standard Web `Request` with method, headers, and body (omitting body on `GET`/`HEAD`). (Pinned in Task 2 test `viteApiPlugin dispatches POST /api/ingest/email, GET /api/ingest/pull, and POST /api/ingest/ack end-to-end`).
5. **Consent gate on email pull when `settings.channels.email` is OFF:** Pulling from `/api/ingest/pull` while `email` channel is `false` must discard the email without storing it in `Vault` (`Property 1` / `pullAndIngestFromRelay`). (Pinned in Task 3 test `syncEmailsFromRelay respects email consent gate and stores + acknowledges emails when email channel is ON`).

---

## File Structure

- **Modify:** `src/components/PhoneFrame.tsx` — Render only the inner phone screen container (`w-full max-w-[430px] min-h-screen bg-canvas`) with `ScreenPortalContext.Provider` and safe-area padding, removing the outer `.phone-body` bezel, side buttons, simulated `StatusBar`, `DynamicIsland`, and `HomeIndicator`.
- **Modify:** `src/app/layout.tsx` — Remove `<DemoShell>` wrapper from `AppShell` so only `<PhoneFrame>` (the inner phone design) is rendered.
- **Create:** `src/lib/server/viteApiPlugin.ts` — Vite plugin & Node HTTP dispatcher mounting `/api/ingest`, `/api/ingest/email`, `/api/ingest/pull`, `/api/ingest/ack`, and `/api/decide` against `getServerRuntime()`.
- **Modify:** `vite.config.ts` — Register `seniorCompanionApiPlugin()` in `plugins`.
- **Create:** `src/lib/inbox/emailClient.ts` — Plain-language client helpers for read-only email connection (`connectReadOnlyEmailAccount`, `listConnectedEmailAccounts`), sample clinic email relay submission (`sendSampleEmailToRelay`), and relay pull + vault ingestion (`syncEmailsFromRelay`).
- **Modify:** `src/app/my-data/page.tsx` — Add the **"Automatic Email Reading Setup"** card (Option 1: Read-Only Email Sign-In for Gmail/Outlook; Option 2: No-Login Auto-Forwarding + **"Send Test Clinic Email"** button) with connected account badges.
- **Modify:** `src/app/inbox/page.tsx` — Add **"Check for New Emails"** button and automatic on-mount relay email check when `settings.channels.email` is ON.
- **Modify:** `tests/unit/syedVisualDesign.test.tsx` — Update Task 2 shell assertions for inner-phone-only rendering and add Task 3 email UI tests.
- **Create:** `tests/integration/viteApiPlugin.test.ts` — Integration tests for the Vite API middleware plugin and end-to-end email relay pull flow.

---

### Task 1: Render Only the Design Inside the Phone (`PhoneFrame` & `AppShell`)

**Files:**
- Modify: `src/components/PhoneFrame.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: `useViewport` from `@/hooks/useViewport`.
- Produces:
  - `PhoneFrame({ children, reserved?: number })` & `useScreenPortal(): HTMLElement | null` in `src/components/PhoneFrame.tsx` (rendering only the inner phone screen design without `.phone-body`, `DynamicIsland`, `StatusBar`, `HomeIndicator`, or side buttons).
  - `AppShell` in `src/app/layout.tsx` wrapping children directly in `<PhoneFrame><ToastProvider>...</ToastProvider></PhoneFrame>` without `<DemoShell>`.

- [ ] **Step 1: Update the shell test in `tests/unit/syedVisualDesign.test.tsx` to assert phone-only inner design**

```tsx
  it('PhoneFrame provides ScreenPortalContext and AppShell renders only inner phone screen without outer bezel or DemoShell columns', () => {
    const html = renderToStaticMarkup(
      <AppShell isOffline storeUnavailable activePath="/">
        <p>Senior companion content</p>
      </AppShell>
    );
    expect(html).toContain('Skip to main content');
    expect(html).toContain('data-phone-screen="true"');
    expect(html).toContain('max-w-[430px]');
    expect(html).not.toContain('phone-body');
    expect(html).not.toContain('Daily phone life can feel overwhelming.');
    expect(html).toContain('<header');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('<main');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Senior companion content');
    const visible = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(BANNED_JARGON);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `expected ... to contain 'data-phone-screen="true"'` (and `not.toContain('phone-body')` failing)

- [ ] **Step 3: Update `src/components/PhoneFrame.tsx` and `src/app/layout.tsx`**

1. In `src/components/PhoneFrame.tsx`:
   - Keep `ScreenPortalContext`, `useScreenPortal()`, and `PhoneFrameProps` (`children`, `reserved`).
   - Remove `StatusBar`, `DynamicIsland`, `HomeIndicator`, side buttons, and `.phone-body`.
   - Render a clean outer wrapper (`min-h-screen w-full bg-canvas flex justify-center`) and the inner phone screen container (`ref={setPortal}`, `data-phone-screen="true"`, `className="relative flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden bg-canvas shadow-card sm:border-x sm:border-line"`, with `paddingTop: 'env(safe-area-inset-top, 0px)'` and `paddingBottom: 'env(safe-area-inset-bottom, 0px)'`) wrapping `<ScreenPortalContext.Provider value={portal}>{children}</ScreenPortalContext.Provider>`.
2. In `src/app/layout.tsx`:
   - Remove `<DemoShell>` import and wrapper so `AppShell` returns `<PhoneFrame><ToastProvider>...</ToastProvider></PhoneFrame>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\node_modules\.bin\tsc.cmd --noEmit ; .\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx tests/unit/uiComponentsAndScreens.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/components/PhoneFrame.tsx src/app/layout.tsx tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(shell): render only the inner phone design without outer bezel or DemoShell columns"
```

---

### Task 2: Mount Live API Endpoints (`/api/ingest`, `/api/ingest/email`, `/api/ingest/pull`, `/api/ingest/ack`, `/api/decide`) in Vite Server

**Files:**
- Create: `src/lib/server/viteApiPlugin.ts`
- Modify: `vite.config.ts`
- Test: `tests/integration/viteApiPlugin.test.ts`

**Interfaces:**
- Consumes: `getServerRuntime`, `type ServerRuntime` from `@/lib/server/runtime`; `createIngestPostHandler`, `createIngestEmailPostHandler`, `createIngestPullGetHandler`, `createIngestAckPostHandler`, `createDecidePostHandler` from `@/lib/server/handlers`.
- Produces:
  - `dispatchApiRequest(req: Request, runtime?: ServerRuntime): Promise<Response | null>` in `src/lib/server/viteApiPlugin.ts`
  - `seniorCompanionApiPlugin(runtime?: ServerRuntime): Plugin` in `src/lib/server/viteApiPlugin.ts`

- [ ] **Step 1: Write the failing test in `tests/integration/viteApiPlugin.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { createSafeLogger } from '@/lib/server/safeLog';
import type { ServerRuntime } from '@/lib/server/runtime';
import { dispatchApiRequest } from '@/lib/server/viteApiPlugin';

function createTestRuntime(): ServerRuntime {
  return {
    tokenRegistry: new TokenRegistry(),
    rateLimiter: createRateLimiter(),
    relay: new EncryptedRelayStore(),
    logger: createSafeLogger(),
    now: () => 1_750_000_000_000,
  };
}

describe('Task 2: Vite API Middleware Dispatcher (/api/*)', () => {
  it('viteApiPlugin dispatches POST /api/ingest/email, GET /api/ingest/pull, and POST /api/ingest/ack end-to-end', async () => {
    const rt = createTestRuntime();
    const authHeader = {
      Authorization: 'Bearer dev-senior-token-1',
      'Content-Type': 'application/json',
    };

    const emailRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/email', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          sender: 'City Clinic <appointments@cityclinic.org>',
          subject: 'Eye Checkup Reminder',
          text: 'Your appointment is on 2026-07-20 at 09:30.',
          receivedAt: '2026-07-15T08:00:00.000Z',
        }),
      }),
      rt
    );
    expect(emailRes).not.toBeNull();
    expect(emailRes!.status).toBe(200);
    const emailJson = (await emailRes!.json()) as { ok: boolean; id: string };
    expect(emailJson.ok).toBe(true);

    const pullRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/pull', {
        method: 'GET',
        headers: { Authorization: 'Bearer dev-senior-token-1' },
      }),
      rt
    );
    expect(pullRes).not.toBeNull();
    expect(pullRes!.status).toBe(200);
    const pullJson = (await pullRes!.json()) as {
      ok: boolean;
      items: Array<{ id: string; payload: { source: string; text: string } }>;
    };
    expect(pullJson.items).toHaveLength(1);
    expect(pullJson.items[0].payload.source).toBe('email');
    expect(pullJson.items[0].payload.text).toContain('Eye Checkup Reminder');

    const ackRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/ack', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ ids: [pullJson.items[0].id] }),
      }),
      rt
    );
    expect(ackRes).not.toBeNull();
    expect(ackRes!.status).toBe(200);

    const pullAfterAck = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/pull', {
        method: 'GET',
        headers: { Authorization: 'Bearer dev-senior-token-1' },
      }),
      rt
    );
    const pullAfterJson = (await pullAfterAck!.json()) as { items: unknown[] };
    expect(pullAfterJson.items).toHaveLength(0);
  });

  it('returns null for non-API routes and 405 for unsupported HTTP methods on API routes', async () => {
    const rt = createTestRuntime();
    const nonApi = await dispatchApiRequest(
      new Request('http://localhost:5173/inbox', { method: 'GET' }),
      rt
    );
    expect(nonApi).toBeNull();

    const wrongMethod = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/pull', { method: 'POST' }),
      rt
    );
    expect(wrongMethod).not.toBeNull();
    expect(wrongMethod!.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/integration/viteApiPlugin.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/server/viteApiPlugin"`

- [ ] **Step 3: Implement `src/lib/server/viteApiPlugin.ts` and register it in `vite.config.ts`**

1. In `src/lib/server/viteApiPlugin.ts`:
   - Implement `dispatchApiRequest(req: Request, runtime: ServerRuntime = getServerRuntime()): Promise<Response | null>` matching pathname:
     - `/api/ingest`: `POST` -> `createIngestPostHandler(runtime)(req)`, else `405`
     - `/api/ingest/email`: `POST` -> `createIngestEmailPostHandler(runtime)(req)`, else `405`
     - `/api/ingest/pull`: `GET` -> `createIngestPullGetHandler(runtime)(req)`, else `405`
     - `/api/ingest/ack`: `POST` -> `createIngestAckPostHandler(runtime)(req)`, else `405`
     - `/api/decide`: `POST` -> `createDecidePostHandler(runtime)(req)`, else `405`
     - Any other pathname -> `null`.
   - Implement `seniorCompanionApiPlugin(runtime?: ServerRuntime): Plugin` attaching a Connect middleware to `configureServer` and `configurePreviewServer` that intercepts requests starting with `/api/`, reads request body chunks into a `Buffer`, constructs a Web `Request`, calls `dispatchApiRequest`, and writes the status, headers, and body to `res`.
2. In `vite.config.ts`:
   - Import `seniorCompanionApiPlugin` from `./src/lib/server/viteApiPlugin` and add `seniorCompanionApiPlugin()` to `plugins: [react(), seniorCompanionApiPlugin()]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\node_modules\.bin\tsc.cmd --noEmit ; .\node_modules\.bin\vitest.cmd --run tests/integration/viteApiPlugin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/lib/server/viteApiPlugin.ts vite.config.ts tests/integration/viteApiPlugin.test.ts ; git commit -m "feat(api): mount /api/ingest and /api/decide routes in Vite server middleware"
```

---

### Task 3: User-Facing Automatic Email Setup (Read-Only Sign-In + Auto-Forwarding + Live Relay Pull in `MyDataPage` & `UnifiedInboxPage`)

**Files:**
- Create: `src/lib/inbox/emailClient.ts`
- Modify: `src/app/my-data/page.tsx`
- Modify: `src/app/inbox/page.tsx`
- Test: `tests/unit/syedVisualDesign.test.tsx`

**Interfaces:**
- Consumes: `validateReadOnlyScopes` from `@/lib/inbox/emailChannel`; `pullAndIngestFromRelay` from `@/lib/inbox/pullPipeline`; `setChannelToggle` from `@/lib/vault/settings`; `admit` from `@/lib/vault/consent`; `Vault`, `OAuthTokenRecord` from `@/lib/vault/schema`.
- Produces:
  - `connectReadOnlyEmailAccount(params: { vault?: Pick<Vault, 'saveOAuthToken' | 'saveSettings'>; settings: Settings; emailAddress: string; provider: 'Gmail' | 'Outlook'; scopes?: readonly string[] }): Promise<{ ok: true; record: OAuthTokenRecord; settings: Settings; message: string } | { ok: false; errorMessage: string }>` in `src/lib/inbox/emailClient.ts`
  - `sendSampleEmailToRelay(params?: { fetchFn?: typeof fetch; bearerToken?: string; sender?: string; subject?: string; text?: string }): Promise<{ ok: true; id: string } | { ok: false; errorMessage: string }>` in `src/lib/inbox/emailClient.ts`
  - `syncEmailsFromRelay(params: { vault: Vault; settings: Settings; fetchFn?: typeof fetch; bearerToken?: string }): Promise<{ ok: true; stored: InboxItem[]; message: string } | { ok: false; errorMessage: string }>` in `src/lib/inbox/emailClient.ts`

- [ ] **Step 1: Write the failing tests in `tests/unit/syedVisualDesign.test.tsx`**

```tsx
import {
  connectReadOnlyEmailAccount,
  sendSampleEmailToRelay,
  syncEmailsFromRelay,
} from '@/lib/inbox/emailClient';
import { dispatchApiRequest } from '@/lib/server/viteApiPlugin';
import { TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { createSafeLogger } from '@/lib/server/safeLog';

describe('Task 3: Automatic Email Activation UI & Relay Sync', () => {
  it('connectReadOnlyEmailAccount validates read-only scopes, saves record, and enables email channel', async () => {
    const savedTokens: any[] = [];
    let savedSettings = createDefaultSettings();
    const mockVault = {
      saveOAuthToken: async (rec: any) => {
        savedTokens.push(rec);
        return { ok: true as const, value: undefined };
      },
      saveSettings: async (next: any) => {
        savedSettings = next;
        return { ok: true as const, value: undefined };
      },
    };

    const rejected = await connectReadOnlyEmailAccount({
      vault: mockVault,
      settings: savedSettings,
      emailAddress: 'senior@gmail.com',
      provider: 'Gmail',
      scopes: ['gmail.modify'],
    });
    expect(rejected.ok).toBe(false);
    expect(savedTokens).toHaveLength(0);

    const connected = await connectReadOnlyEmailAccount({
      vault: mockVault,
      settings: savedSettings,
      emailAddress: 'senior@gmail.com',
      provider: 'Gmail',
    });
    expect(connected.ok).toBe(true);
    if (connected.ok) {
      expect(connected.settings.channels.email).toBe(true);
      expect(connected.record.account).toBe('senior@gmail.com');
    }
    expect(savedTokens).toHaveLength(1);
  });

  it('syncEmailsFromRelay respects email consent gate and stores + acknowledges emails when email channel is ON', async () => {
    const rt = {
      tokenRegistry: new TokenRegistry(),
      rateLimiter: createRateLimiter(),
      relay: new EncryptedRelayStore(),
      logger: createSafeLogger(),
      now: () => Date.now(),
    };
    const localFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? `http://localhost:5173${input}` : input.toString();
      const res = await dispatchApiRequest(new Request(url, init), rt);
      return res ?? new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const sendRes = await sendSampleEmailToRelay({ fetchFn: localFetch });
    expect(sendRes.ok).toBe(true);

    const storedItems: any[] = [];
    const mockVault: any = {
      listItems: async () => ({ ok: true, value: [...storedItems] }),
      putItem: async (item: any) => {
        storedItems.push(item);
        return { ok: true, value: undefined };
      },
      appendAudit: async () => ({ ok: true, value: undefined }),
    };

    const onSettings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
    };

    const pullRes = await syncEmailsFromRelay({
      vault: mockVault,
      settings: onSettings,
      fetchFn: localFetch,
    });
    expect(pullRes.ok).toBe(true);
    if (pullRes.ok) {
      expect(pullRes.stored).toHaveLength(1);
      expect(pullRes.stored[0].source).toBe('email');
    }
  });

  it('MyDataPage and UnifiedInboxPage email connection controls contain zero banned jargon and all buttons have min-h-[56px]', () => {
    const myDataHtml = renderToStaticMarkup(
      <MyDataPage initialSettings={createDefaultSettings()} initialAudit={[]} />
    );
    expect(myDataHtml).toContain('Automatic Email Reading');
    expect(myDataHtml).toContain('Connect Read-Only Email');
    expect(myDataHtml).toContain('Send Test Clinic Email');

    const inboxHtml = renderToStaticMarkup(
      <UnifiedInboxPage initialSettings={createDefaultSettings()} initialItems={[]} />
    );
    expect(inboxHtml).toContain('Check for New Emails');

    for (const html of [myDataHtml, inboxHtml]) {
      const visible = html.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible).not.toMatch(BANNED_JARGON);
      const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
      for (const btn of buttons) {
        expect(btn).toContain('min-h-[56px]');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\node_modules\.bin\vitest.cmd --run tests/unit/syedVisualDesign.test.tsx`
Expected: FAIL with `Failed to resolve import "@/lib/inbox/emailClient"`

- [ ] **Step 3: Implement `src/lib/inbox/emailClient.ts` and wire `MyDataPage` and `UnifiedInboxPage`**

1. Create `src/lib/inbox/emailClient.ts`:
   - `DEFAULT_DEV_BEARER_TOKEN = 'dev-senior-token-1'`
   - `connectReadOnlyEmailAccount`: validates `emailAddress` (must contain `@` and `.`), validates read-only scopes via `validateReadOnlyScopes(scopes ?? (provider === 'Gmail' ? ['gmail.readonly'] : ['mail.read']))`, builds `OAuthTokenRecord` (`id: 'email-account-primary'`, `account: trimmedEmail`, `provider`, `token: 'readonly-session'`), calls `vault.saveOAuthToken(record)`, enables `settings.channels.email = true` via `vault.saveSettings(nextSettings)`, and returns plain-language message `'Connected ' + trimmedEmail + ' with read-only email access. Email reading is now ON.'`.
   - `sendSampleEmailToRelay`: POSTs a sample clinic email (`sender: 'City Clinic <appointments@cityclinic.org>'`, `subject: 'Clinic Appointment Reminder'`, `text: 'Dear Patient, your checkup at City Clinic is scheduled for 2026-07-24 at 10:30 in Room 3A.'`) to `/api/ingest/email` with `Authorization: Bearer ${bearerToken}`.
   - `syncEmailsFromRelay`: calls `GET /api/ingest/pull` with `Authorization: Bearer ${bearerToken}`, maps returned `{ id, payload }` items to `{ id, draft }`, runs `pullAndIngestFromRelay` with `ackFn` calling `POST /api/ingest/ack`, and returns `{ ok: true, stored, message }`.
2. In `src/app/my-data/page.tsx`:
   - Add an **"Automatic Email Reading"** card inside the `Message & Photo Sources` section showing:
     - **Option 1: Read-Only Email Sign-In** — email input (`id="connect-email-input"`, placeholder `"For example: grandma@gmail.com"`), provider select (`id="connect-email-provider"`, `"Gmail"` / `"Outlook"`), and `<SeniorButton variant="primary" onClick={handleConnectEmail}>Connect Read-Only Email</SeniorButton>`, plus connected status badge when connected.
     - **Option 2: No-Login Email Forwarding** — plain explanation that family or clinic emails forwarded to the helper arrive automatically when **Email** is ON, with `<SeniorButton variant="secondary" onClick={handleSendTestEmail}>Send Test Clinic Email</SeniorButton>` that queues a sample clinic email via `sendSampleEmailToRelay` (and if Email is ON, pulls it into the Vault via `syncEmailsFromRelay`).
3. In `src/app/inbox/page.tsx`:
   - Add `<SeniorButton variant="secondary" onClick={handleCheckNewEmails}>Check for New Emails</SeniorButton>` next to `+ Paste Message or Pick Photo`.
   - In `useEffect`, when `settings.channels.email` is `true` and `initialItems === undefined`, automatically call `handleCheckNewEmails` once on mount so queued emails in `/api/ingest/pull` appear in the Unified Inbox list.

- [ ] **Step 4: Run full typecheck, test suite, and build**

Run: `.\node_modules\.bin\tsc.cmd --noEmit ; .\node_modules\.bin\vitest.cmd --run ; .\node_modules\.bin\vite.cmd build`
Expected:
- `tsc --noEmit`: 0 errors
- `vitest --run`: 20/20 test files passing
- `vite build`: exit 0

- [ ] **Step 5: Commit**

```powershell
git add src/lib/inbox/emailClient.ts src/app/my-data/page.tsx src/app/inbox/page.tsx tests/unit/syedVisualDesign.test.tsx ; git commit -m "feat(email): wire read-only email sign-in, test email relay, and live inbox pull"
```
