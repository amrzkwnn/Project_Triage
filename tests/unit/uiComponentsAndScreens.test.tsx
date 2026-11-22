import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  type AuditEntry,
  type Channel,
  type InboxItem,
  type PriorityType,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import {
  type Confirmation,
  isValidConfirmation,
} from '@/lib/actions/confirmation';
import { AUDIT_EMPTY_MESSAGE } from '@/lib/vault/audit';
import { SeniorButton } from '@/components/SeniorButton';
import { StepWizard } from '@/components/StepWizard';
import { TrafficLightCard } from '@/components/TrafficLightCard';
import { SourceBadge } from '@/components/SourceBadge';
import { PriorityPill } from '@/components/PriorityPill';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { StatusLive } from '@/components/StatusLive';
import { PrivacyPill } from '@/components/PrivacyPill';
import manifest from '@/app/manifest';
import { AppShell, probeStoreUnavailable } from '@/app/layout';
import { HomeHub } from '@/app/page';
import { MyDataPage } from '@/app/my-data/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: overrides.id ?? 'item-1',
    source: overrides.source ?? 'email',
    sender: overrides.sender ?? 'City Clinic',
    text: overrides.text ?? 'Your appointment is on 2026-06-15 at 09:30.',
    attachments: overrides.attachments ?? [],
    receivedAt: overrides.receivedAt ?? '2026-06-10T08:00:00.000Z',
    group: overrides.group ?? 'Personal',
    priority: overrides.priority ?? 'Important',
    summary: overrides.summary ?? {
      fromApp: 'Email',
      whoSent: 'City Clinic',
      actionNeeded: 'Add appointment to calendar',
      text: 'City Clinic sent a reminder for your appointment.',
    },
    tier: overrides.tier ?? 2,
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? 'ok',
    ...overrides,
  };
}

describe('Shared Accessible UI Components', () => {
  it('SeniorButton renders native button/anchor with >=56px touch target, border-2, and aria-hidden icon', () => {
    const buttonHtml = renderToStaticMarkup(
      <SeniorButton variant="primary" icon={<span data-icon="check">✓</span>}>
        Save Changes
      </SeniorButton>
    );
    expect(buttonHtml).toContain('<button');
    expect(buttonHtml).toContain('type="button"');
    expect(buttonHtml).toContain('min-h-[56px]');
    expect(buttonHtml).toContain('min-w-[56px]');
    expect(buttonHtml).toContain('border-2');
    expect(buttonHtml).toContain('aria-hidden="true"');
    expect(buttonHtml).toContain('Save Changes');

    const linkHtml = renderToStaticMarkup(
      <SeniorButton href="/my-data" variant="secondary">
        Open My Data
      </SeniorButton>
    );
    expect(linkHtml).toContain('<a');
    expect(linkHtml).toContain('href="/my-data"');
    expect(linkHtml).toContain('min-h-[56px]');
    expect(linkHtml).toContain('Open My Data');
  });

  it('StepWizard displays one step at a time with explicit Step X of Y and aria-current="step"', () => {
    const html = renderToStaticMarkup(
      <StepWizard
        currentStep={1}
        steps={[
          { title: 'Place photo flat', content: <p>Put your photo on a table.</p> },
          { title: 'Use good light', content: <p>Turn on a bright lamp nearby.</p> },
          { title: 'Hold steady', content: <p>Tap the round button gently.</p> },
        ]}
      />
    );
    expect(html).toContain('Step 2 of 3');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Use good light');
    expect(html).toContain('Turn on a bright lamp nearby.');
    expect(html).not.toContain('Put your photo on a table.');
    expect(html).toContain('Back');
    expect(html).toContain('Next');
  });

  it('TrafficLightCard renders icon, text label, color border, reasons, instruction, and Ask Family button', () => {
    const safeHtml = renderToStaticMarkup(
      <TrafficLightCard
        verdict={{
          value: 'safe',
          reasons: ['No warning signs were found in this message.'],
          flags: [],
        }}
      />
    );
    expect(safeHtml).toContain('Looks Safe');
    expect(safeHtml).toContain('aria-hidden="true"');
    expect(safeHtml).toContain('border-2');
    expect(safeHtml).toContain('No warning signs were found in this message.');
    expect(safeHtml).not.toContain('Ask Family to Check');

    const cautionHtml = renderToStaticMarkup(
      <TrafficLightCard
        verdict={{
          value: 'caution',
          reasons: ['This message rushes you to act quickly.'],
          flags: ['urgency'],
        }}
        instruction="Hang up and call back using a number saved in your contacts"
      />
    );
    expect(cautionHtml).toContain('Be Careful — Verify First');
    expect(cautionHtml).toContain('Hang up and call back');

    const dangerHtml = renderToStaticMarkup(
      <TrafficLightCard
        verdict={{
          value: 'danger',
          reasons: ['This message asks for urgent payment.'],
          flags: ['urgency', 'payment'],
        }}
        instruction="Do not click or pay"
        showAskFamily
        onAskFamily={() => {}}
      />
    );
    expect(dangerHtml).toContain('Likely Scam — Do Not Click or Pay');
    expect(dangerHtml).toContain('Do not click or pay');
    expect(dangerHtml).toContain('Ask Family to Check');
  });

  it('SourceBadge renders icon, explicit text label, and border-2 for all 5 channels', () => {
    const cases: Array<[Channel, string]> = [
      ['email', 'From Email'],
      ['whatsappForward', 'From WhatsApp'],
      ['smsPaste', 'From SMS'],
      ['messengerPaste', 'From Messenger'],
      ['photos', 'From Photo'],
    ];

    for (const [channel, expectedLabel] of cases) {
      const html = renderToStaticMarkup(<SourceBadge source={channel} />);
      expect(html).toContain(expectedLabel);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('border-2');
    }
  });

  it('PriorityPill renders icon, explicit text label, and border-2 for all 3 priorities', () => {
    const priorities: PriorityType[] = ['Important', 'Social', 'Promotion'];
    for (const priority of priorities) {
      const html = renderToStaticMarkup(<PriorityPill priority={priority} />);
      expect(html).toContain(priority);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('border-2');
    }
  });

  it('DecisionConfirmCard renders 20px summary and mints Confirmation ONLY when Confirm is tapped', () => {
    const confirmed: Confirmation[] = [];
    const onConfirm = vi.fn((c: Confirmation) => {
      confirmed.push(c);
    });
    const onDismiss = vi.fn();

    const html = renderToStaticMarkup(
      <DecisionConfirmCard
        actionId="action-calendar-42"
        tier={2}
        summary="Add Clinic Visit on Friday at 9:30 AM to your calendar?"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
    expect(html).toContain('text-[20px]');
    expect(html).toContain('Add Clinic Visit on Friday at 9:30 AM to your calendar?');
    expect(html).toContain('Confirm');
    expect(html).toContain('Dismiss');

    // Rendering alone must NEVER mint or confirm
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    // Inspect interactive handlers directly from the pure component tree
    const tree = DecisionConfirmCard({
      actionId: 'action-calendar-42',
      tier: 2,
      summary: 'Add Clinic Visit on Friday at 9:30 AM to your calendar?',
      onConfirm,
      onDismiss,
    });
    const buttons = findElements(
      tree,
      (el) => el.type === SeniorButton || el.type === 'button'
    );
    const confirmBtn = buttons.find((el) =>
      String(el.props.children).includes('Confirm')
    );
    const dismissBtn = buttons.find((el) =>
      String(el.props.children).includes('Dismiss')
    );
    expect(confirmBtn).toBeDefined();
    expect(dismissBtn).toBeDefined();

    // Dismiss must NEVER call onConfirm or mint a Confirmation
    (dismissBtn!.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    // Confirm MUST mint a valid branded Confirmation for actionId
    (confirmBtn!.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveLength(1);
    expect(isValidConfirmation(confirmed[0], 'action-calendar-42')).toBe(true);
    expect(isValidConfirmation(confirmed[0], 'other-action')).toBe(false);
  });

  it('StatusLive renders aria-live="polite" without moving focus', () => {
    const html = renderToStaticMarkup(<StatusLive message="Settings saved." />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Settings saved.');
    expect(html).not.toContain('tabindex');
  });

  it('PrivacyPill displays enabled source count and AI On/Off and links to /my-data', () => {
    const settings: Settings = {
      ...createDefaultSettings(),
      channels: {
        email: true,
        whatsappForward: true,
        smsPaste: false,
        messengerPaste: false,
        photos: true,
      },
      allowAiReading: true,
    };

    const onHtml = renderToStaticMarkup(<PrivacyPill settings={settings} />);
    expect(onHtml).toContain('My Data: 3 Sources On • AI On');
    expect(onHtml).toContain('href="/my-data"');
    expect(onHtml).toContain('min-h-[56px]');

    const offHtml = renderToStaticMarkup(
      <PrivacyPill settings={{ ...createDefaultSettings(), allowAiReading: false }} />
    );
    expect(offHtml).toContain('My Data: 0 Sources On • AI Off');
  });
});

describe('PWA Manifest, App Shell, Home Hub, and My Data Screen', () => {
  it('manifest() returns standalone PWA manifest with 1..45 char name and 192x192 + 512x512 icons', () => {
    const m = manifest();
    expect(m.name).toBe('Triage');
    expect(m.name.length).toBeGreaterThanOrEqual(1);
    expect(m.name.length).toBeLessThanOrEqual(45);
    expect(m.short_name).toBe('Triage');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.background_color).toBe('#FAF9F6');
    expect(m.theme_color).toBe('#0F766E');
    expect(m.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(m.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  });

  it('AppShell renders semantic landmarks, skip link, offline banner, and store error fallback', () => {
    const html = renderToStaticMarkup(
      <AppShell isOffline storeUnavailable>
        <p>Main page content stays usable.</p>
      </AppShell>
    );
    expect(html).toContain('Skip to main content');
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('<main');
    expect(html).toContain('id="main-content"');
    expect(html.toLowerCase()).toContain('offline');
    expect(html).toContain('Main page content stays usable.');
    expect(stripHtml(html)).not.toMatch(BANNED_JARGON);
  });

  it('HomeHub renders PrivacyPill, empty decision message, reveal control >5, error+retry, and 5 cards in order', () => {
    const emptyHtml = renderToStaticMarkup(
      <HomeHub initialSettings={createDefaultSettings()} initialItems={[]} />
    );
    expect(emptyHtml).toContain('My Data: 0 Sources On • AI Off');
    expect(emptyHtml).toContain("Today&#x27;s Important Decisions");
    expect(emptyHtml).toContain('Nothing needs your attention today');
    expect(emptyHtml).not.toContain('← Back to Home');

    const titles = [
      'Scam Shield',
      'Photo Helper',
      'Unified Inbox',
      'AI Media Check',
      'Calendar',
    ];
    let lastIdx = -1;
    for (const title of titles) {
      const idx = emptyHtml.indexOf(title);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
    expect(stripHtml(emptyHtml)).not.toMatch(BANNED_JARGON);

    const sevenItems = Array.from({ length: 7 }, (_, i) =>
      makeInboxItem({
        id: `d-${i}`,
        tier: i === 6 ? 3 : 2,
        receivedAt: new Date(1750000000000 + i * 60000).toISOString(),
        summary: {
          fromApp: 'Email',
          whoSent: `Sender ${i}`,
          actionNeeded: `Review item ${i}`,
          text: `Decision summary number ${i}`,
        },
      })
    );
    const cappedHtml = renderToStaticMarkup(
      <HomeHub initialSettings={createDefaultSettings()} initialItems={sevenItems} />
    );
    // Tier 3 item (index 6) appears first, and 2 items remain behind reveal control
    expect(cappedHtml).toContain('Decision summary number 6');
    expect(cappedHtml).toContain('Show 2 more');

    const errorHtml = renderToStaticMarkup(
      <HomeHub
        initialSettings={createDefaultSettings()}
        initialItems={[]}
        initialLoadError="We could not load your decisions right now."
      />
    );
    expect(errorHtml).toContain('We could not load your decisions right now.');
    expect(errorHtml).toContain('Try Again');
    expect(errorHtml).toContain('My Data: 0 Sources On • AI Off');
    for (const title of titles) {
      expect(errorHtml).toContain(title);
    }
  });

  it('MyDataPage renders no Back to Home, 5 channel toggles, AI confirmation, caregiver toggle, audit log, download, and two-step erase', () => {
    const emptyAuditHtml = renderToStaticMarkup(
      <MyDataPage
        initialSettings={createDefaultSettings()}
        initialAudit={[]}
        initialAiConfirmOpen
        initialExportError="We could not download your data right now."
        initialEraseStep={1}
      />
    );
    expect(emptyAuditHtml).not.toContain('Back to Home');
    expect(emptyAuditHtml).toContain('Email');
    expect(emptyAuditHtml).toContain('WhatsApp');
    expect(emptyAuditHtml).toContain('SMS');
    expect(emptyAuditHtml).toContain('Messenger');
    expect(emptyAuditHtml).toContain('Photos');
    expect(emptyAuditHtml).toContain('AI Reading');
    expect(emptyAuditHtml).toContain('Family Sharing');
    expect(emptyAuditHtml).toContain('What AI Read');
    expect(emptyAuditHtml).toContain(AUDIT_EMPTY_MESSAGE);
    expect(emptyAuditHtml).toContain('Download My Data');
    expect(emptyAuditHtml).toContain('Try Again');
    expect(emptyAuditHtml).toContain('Erase All My Data');
    expect(emptyAuditHtml).toContain('Continue');
    expect(emptyAuditHtml).toContain('Cancel');
    expect(stripHtml(emptyAuditHtml)).not.toMatch(BANNED_JARGON);

    const auditEntries: AuditEntry[] = [
      {
        id: 'a-old',
        at: '2026-06-10 09:00:00',
        kind: 'ai-read',
        channel: 'email',
        description: 'Older clinic email',
        purpose: 'Summarize message',
      },
      {
        id: 'a-new',
        at: '2026-06-11 10:15:00',
        kind: 'ai-read',
        channel: 'whatsappForward',
        description: 'Newer family message',
        purpose: 'Check for scam signs',
      },
    ];

    const step2Html = renderToStaticMarkup(
      <MyDataPage
        initialSettings={createDefaultSettings()}
        initialAudit={auditEntries}
        initialEraseStep={2}
      />
    );
    // Reverse chronological order: newer entry appears before older entry
    expect(step2Html.indexOf('Newer family message')).toBeLessThan(
      step2Html.indexOf('Older clinic email')
    );
    expect(step2Html).toContain('Erase Everything');
    expect(step2Html).toContain('cannot be undone');
    expect(stripHtml(step2Html)).not.toMatch(BANNED_JARGON);
  });

  it('probeStoreUnavailable detects healthy, error-returning, and throwing Local_Store states', async () => {
    const healthy = await probeStoreUnavailable({
      getSettings: async () => ({ ok: true, value: createDefaultSettings() }),
    });
    expect(healthy).toBe(false);

    const unavailable = await probeStoreUnavailable({
      getSettings: async () => ({
        ok: false,
        error: { code: 'unavailable', message: 'Storage is unavailable.' },
      }),
    });
    expect(unavailable).toBe(true);

    const throwing = await probeStoreUnavailable({
      getSettings: async () => {
        throw new Error('IndexedDB blocked');
      },
    });
    expect(throwing).toBe(true);
  });

  it('public/sw.js caches shell routes per-URL resiliently and always resolves offline fetch to a valid Response', async () => {
    const fsPromises = (await import(/* @vite-ignore */ 'node:' + 'fs/promises')) as {
      readFile(url: URL, encoding: 'utf8'): Promise<string>;
    };
    const swUrl = new URL('../../public/sw.js', import.meta.url);
    const swSource = await fsPromises.readFile(swUrl, 'utf8');

    const listeners = new Map<string, (event: unknown) => void>();
    const cachedMap = new Map<string, Response>();

    const mockCache = {
      add: vi.fn(async (url: string) => {
        if (url === '/scam-shield') {
          throw new Error('404 Not Found');
        }
        cachedMap.set(url, new Response(`cached:${url}`, { status: 200 }));
      }),
      addAll: vi.fn(async () => {
        throw new Error('addAll should not be called because atomic caching fails all URLs');
      }),
      put: vi.fn(async (req: { url?: string } | string, res: Response) => {
        const key = typeof req === 'string' ? req : req.url ?? '';
        cachedMap.set(key, res);
      }),
    };

    const mockCaches = {
      open: vi.fn(async () => mockCache),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
      match: vi.fn(async (req: { url?: string } | string) => {
        const key = typeof req === 'string' ? req : req.url ?? '';
        return cachedMap.get(key);
      }),
    };

    const selfObj = {
      location: { origin: 'https://helper.example' },
      addEventListener: (type: string, cb: (event: unknown) => void) => {
        listeners.set(type, cb);
      },
      skipWaiting: vi.fn(async () => undefined),
      clients: { claim: vi.fn(async () => undefined) },
    };

    const mockFetch = vi.fn(async () => {
      throw new Error('Offline');
    });

    const executeSw = new Function(
      'self',
      'caches',
      'fetch',
      'URL',
      'Response',
      'Promise',
      swSource
    );
    executeSw(selfObj, mockCaches, mockFetch, URL, Response, Promise);

    // 1. Install caches surviving routes even when one route fails
    const installHandler = listeners.get('install');
    expect(installHandler).toBeDefined();
    let installPromise: Promise<unknown> | undefined;
    installHandler!({
      waitUntil: (p: Promise<unknown>) => {
        installPromise = p;
      },
    });
    await installPromise;
    expect(mockCache.addAll).not.toHaveBeenCalled();
    expect(cachedMap.has('/')).toBe(true);
    expect(cachedMap.has('/my-data')).toBe(true);
    expect(cachedMap.has('/scam-shield')).toBe(false);

    // 2. Offline navigation when '/' is NOT cached still resolves a valid Response (never undefined)
    cachedMap.clear();
    const fetchHandler = listeners.get('fetch');
    expect(fetchHandler).toBeDefined();

    let navResponsePromise: Promise<Response> | undefined;
    fetchHandler!({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'https://helper.example/inbox',
      },
      respondWith: (p: Promise<Response>) => {
        navResponsePromise = p;
      },
    });
    const navRes = await navResponsePromise;
    expect(navRes).toBeInstanceOf(Response);
    expect(navRes!.status).toBe(503);

    // 3. Offline static asset miss resolves a valid Response (never undefined)
    let assetResponsePromise: Promise<Response> | undefined;
    fetchHandler!({
      request: {
        method: 'GET',
        mode: 'no-cors',
        url: 'https://helper.example/icons/icon-192.png',
      },
      respondWith: (p: Promise<Response>) => {
        assetResponsePromise = p;
      },
    });
    const assetRes = await assetResponsePromise;
    expect(assetRes).toBeInstanceOf(Response);
    expect(assetRes!.status).toBe(503);
  });
});
