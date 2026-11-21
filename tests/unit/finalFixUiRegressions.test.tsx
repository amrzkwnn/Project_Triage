import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HomeHub,
  executeHomeDefaultAskFamily,
  executeHomeDefaultConfirm,
} from '@/app/page';
import {
  UnifiedInboxPage,
  confirmForwardToCalendarWithVault,
  prepareCalendarForward,
  processPrescriptionPhotoWithConsent,
} from '@/app/inbox/page';
import { CalendarPage } from '@/app/calendar/page';
import {
  ScamShieldPage,
  readPreloadedScamText,
} from '@/app/scam-shield/page';
import {
  AiMediaCheckPage,
  readPreloadedMediaImageName,
} from '@/app/media-check/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import manifest from '@/app/manifest';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { applyPhotoPreset } from '@/lib/photo/presets';
import {
  createDefaultSettings,
  type AuditEntry,
  type CalendarEvent,
  type InboxItem,
  type Settings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function stripHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function createSpyVault(initial?: {
  settings?: Settings;
  items?: InboxItem[];
  events?: CalendarEvent[];
  audit?: AuditEntry[];
}): {
  vault: Vault;
  savedEvents: CalendarEvent[];
  savedItems: InboxItem[];
  savedAudit: AuditEntry[];
  getSettingsState: () => Settings;
} {
  let settingsState: Settings = initial?.settings ?? createDefaultSettings();
  const savedItems: InboxItem[] = [...(initial?.items ?? [])];
  const savedEvents: CalendarEvent[] = [...(initial?.events ?? [])];
  const savedAudit: AuditEntry[] = [...(initial?.audit ?? [])];

  const vault: Vault = {
    getSettings: async () => ({ ok: true, value: settingsState }),
    saveSettings: async (next) => {
      settingsState = next;
      return { ok: true, value: undefined };
    },
    putItem: async (item) => {
      savedItems.push(item);
      return { ok: true, value: undefined };
    },
    listItems: async () => ({ ok: true, value: [...savedItems] }),
    putEvent: async (ev) => {
      savedEvents.push(ev);
      return { ok: true, value: undefined };
    },
    listEvents: async () => ({ ok: true, value: [...savedEvents] }),
    deleteEvent: async (id) => {
      const idx = savedEvents.findIndex((e) => e.id === id);
      if (idx >= 0) savedEvents.splice(idx, 1);
      return { ok: true, value: undefined };
    },
    appendAudit: async (entry) => {
      savedAudit.push(entry);
      return { ok: true, value: undefined };
    },
    listAudit: async () => ({ ok: true, value: [...savedAudit] }),
    putBlob: async () => ({ ok: true, value: undefined }),
    getBlob: async () => ({ ok: true, value: undefined }),
    listBlobs: async () => ({ ok: true, value: {} }),
    saveOAuthToken: async () => ({ ok: true, value: undefined }),
    listOAuthTokens: async () => ({ ok: true, value: [] }),
    exportAll: async () => ({ ok: true, value: '{}' }),
    importAll: async () => ({ ok: true, value: undefined }),
    eraseAll: async () => ({ ok: true, value: undefined }),
  };

  return {
    vault,
    savedEvents,
    savedItems,
    savedAudit,
    getSettingsState: () => settingsState,
  };
}

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: overrides.id ?? 'item-1',
    source: overrides.source ?? 'whatsappForward',
    sender: overrides.sender ?? 'City Clinic',
    text:
      overrides.text ??
      'Clinic appointment on 2026-07-15 at 10:30. Check https://clinic.example',
    attachments: overrides.attachments ?? [
      {
        id: 'att-1',
        mime: 'image/png',
        name: 'clinic-photo.png',
        dataBase64: 'AAAA',
      },
    ],
    receivedAt: overrides.receivedAt ?? '2026-07-10T08:00:00.000Z',
    group: overrides.group ?? 'Personal',
    priority: overrides.priority ?? 'Important',
    summary: overrides.summary ?? {
      fromApp: 'From WhatsApp',
      whoSent: 'City Clinic',
      actionNeeded: 'Confirm calendar date',
      text: 'City Clinic appointment on 2026-07-15 at 10:30.',
    },
    detectedEvent:
      'detectedEvent' in overrides
        ? overrides.detectedEvent
        : {
            date: '2026-07-15',
            time: '10:30',
            title: 'City Clinic Appointment',
            location: 'Room 4B',
          },
    tier: overrides.tier ?? 2,
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? 'ok',
    proposals: overrides.proposals ?? [
      {
        id: 'prop-cal-1',
        kind: 'forwardToCalendar',
        label: 'Forward to Calendar',
        itemId: overrides.id ?? 'item-1',
        event: {
          date: '2026-07-15',
          time: '10:30',
          title: 'City Clinic Appointment',
          location: 'Room 4B',
        },
      },
    ],
  };
}

describe('Final Review Fix Wave UI Regressions', () => {
  it('Critical 4.1: UnifiedInbox gates prescription photo pick on photos channel and offers Turn On Photos', async () => {
    const spyOff = createSpyVault({
      settings: {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, photos: false },
      },
    });

    const blocked = await processPrescriptionPhotoWithConsent({
      settings: spyOff.getSettingsState(),
      photo: { id: 'rx-1', mime: 'image/jpeg', name: 'rx.jpg', size: 128 },
      extractedText: 'Blood pressure pill 2026-07-16 08:00',
      ocrConfidence: 0.85,
      vault: spyOff.vault,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.channelOff).toBe('photos');
      expect(blocked.errorMessage).toMatch(/photos/i);
    }
    expect(spyOff.savedItems).toHaveLength(0);

    // Rendered turn-on-channel offer displays Turn On Photos button without jargon
    const offerHtml = renderToStaticMarkup(
      <UnifiedInboxPage
        initialSettings={spyOff.getSettingsState()}
        initialItems={[]}
        initialEvents={[]}
        initialChannelOffChannel="photos"
      />
    );
    expect(offerHtml).toContain('Turn On Photos');
    expect(offerHtml).toContain('min-h-[56px]');
    expect(stripHtml(offerHtml)).not.toMatch(BANNED_JARGON);

    // Once Photos channel is ON, prescription photo is written to Vault
    const spyOn = createSpyVault({
      settings: {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, photos: true },
      },
    });
    const allowed = await processPrescriptionPhotoWithConsent({
      settings: spyOn.getSettingsState(),
      photo: { id: 'rx-2', mime: 'image/jpeg', name: 'rx.jpg', size: 128 },
      extractedText: 'Blood pressure pill 2026-07-16 08:00',
      ocrConfidence: 0.85,
      vault: spyOn.vault,
    });
    expect(allowed.ok).toBe(true);
    expect(spyOn.savedItems).toHaveLength(1);
  });

  it('Critical 4.2: UnifiedInbox Forward to Calendar prepares confirmation prompt with duplicate check before persisting', async () => {
    const existingDuplicate: CalendarEvent = {
      id: 'ev-existing',
      title: 'City Clinic Appointment',
      date: '2026-07-15',
      time: '10:30',
      category: 'Medical',
      createdAt: '2026-07-10T07:00:00.000Z',
    };

    const item = makeInboxItem();
    const preparedDup = prepareCalendarForward(item, [existingDuplicate]);
    expect(preparedDup).toBeDefined();
    expect(preparedDup!.isDuplicate).toBe(true);

    const preparedFresh = prepareCalendarForward(item, []);
    expect(preparedFresh).toBeDefined();
    expect(preparedFresh!.isDuplicate).toBe(false);

    // Render inline confirmation card with duplicate warning, Confirm and Cancel min-h-[56px]
    const promptHtml = renderToStaticMarkup(
      <UnifiedInboxPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, whatsappForward: true },
        }}
        initialItems={[item]}
        initialEvents={[existingDuplicate]}
        initialPendingCalendarForward={preparedDup}
      />
    );
    expect(promptHtml).toContain('Add to Calendar?');
    expect(promptHtml).toContain('City Clinic Appointment');
    expect(promptHtml).toContain('2026-07-15');
    expect(promptHtml).toContain('10:30');
    expect(promptHtml).toContain('similar event already exists');
    expect(promptHtml).toContain('Confirm');
    expect(promptHtml).toContain('Cancel');
    expect(stripHtml(promptHtml)).not.toMatch(BANNED_JARGON);

    // Confirming persists the event through execute + confirmFromTap
    const spy = createSpyVault({ events: [existingDuplicate] });
    const confirmed = await confirmForwardToCalendarWithVault({
      item,
      event: item.detectedEvent!,
      vault: spy.vault,
    });
    expect(confirmed.ok).toBe(true);
    expect(spy.savedEvents).toHaveLength(2);
    expect(spy.savedEvents[1].title).toBe('City Clinic Appointment');
    expect(spy.savedEvents[1].date).toBe('2026-07-15');
  });

  it('Critical 4.3: CalendarPage gates Paper Calendar Snap photo upload on photos channel', () => {
    const offHtml = renderToStaticMarkup(
      <CalendarPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, photos: false },
        }}
        initialEvents={[]}
        initialToday="2026-07-15"
      />
    );
    expect(offHtml).toContain('Photo Access is OFF');
    expect(offHtml).toContain('Turn On Photos');
    expect(offHtml).not.toContain('id="calendar-snap-photo-input"');
    expect(stripHtml(offHtml)).not.toMatch(BANNED_JARGON);

    const onHtml = renderToStaticMarkup(
      <CalendarPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, photos: true },
        }}
        initialEvents={[]}
        initialToday="2026-07-15"
      />
    );
    expect(onHtml).toContain('Snap Paper Calendar Photo');
    expect(onHtml).toContain('id="calendar-snap-photo-input"');
    expect(onHtml).toContain('accept="image/jpeg,image/png"');
    expect(stripHtml(onHtml)).not.toMatch(BANNED_JARGON);
  });

  it('Important 1: HomeHub wires default Confirm & Ask Family handlers and shows Turn On Family Sharing for Tier 3 when sharing is OFF', async () => {
    const offSettings: Settings = {
      ...createDefaultSettings(),
      caregiverShareEnabled: false,
      familyMembers: [{ id: 'fm-1', name: 'Amina', address: 'amina@example.com' }],
    };

    const calItem = makeInboxItem({ id: 'home-cal-1', tier: 2 });
    const tier3Item = makeInboxItem({
      id: 'home-danger-1',
      tier: 3,
      sender: 'Unknown Bank',
      text: 'URGENT: Send gift cards right now!',
      detectedEvent: undefined,
      proposals: [],
    });

    // Tier 3 with sharing OFF shows inline Turn On Family Sharing offer
    const offHtml = renderToStaticMarkup(
      <HomeHub initialSettings={offSettings} initialItems={[tier3Item, calItem]} />
    );
    expect(offHtml).toContain('Turn On Family Sharing');
    expect(offHtml).not.toContain('Ask Family to Check');
    expect(stripHtml(offHtml)).not.toMatch(BANNED_JARGON);

    // Tier 3 with sharing ON shows Ask Family to Check even when onAskFamily prop is omitted
    const onSettings: Settings = { ...offSettings, caregiverShareEnabled: true };
    const onHtml = renderToStaticMarkup(
      <HomeHub initialSettings={onSettings} initialItems={[tier3Item]} />
    );
    expect(onHtml).toContain('Ask Family to Check');
    expect(onHtml).not.toContain('Turn On Family Sharing');

    // Default Confirm handler executes forwardToCalendar via Vault using minted Confirmation
    const spy = createSpyVault({ settings: onSettings });
    const confirmToken = confirmFromTap('prop-cal-1');
    const confirmRes = await executeHomeDefaultConfirm({
      item: calItem,
      confirmation: confirmToken,
      settings: onSettings,
      vault: spy.vault,
    });
    expect(confirmRes.ok).toBe(true);
    expect(spy.savedEvents).toHaveLength(1);
    expect(spy.savedEvents[0].title).toBe('City Clinic Appointment');

    // Default Ask Family handler refuses when sharing is OFF and succeeds + audits when ON
    const blockedShare = await executeHomeDefaultAskFamily({
      item: tier3Item,
      settings: offSettings,
      vault: spy.vault,
    });
    expect(blockedShare.ok).toBe(false);
    expect(spy.savedAudit).toHaveLength(0);

    const allowedShare = await executeHomeDefaultAskFamily({
      item: tier3Item,
      settings: onSettings,
      vault: spy.vault,
    });
    expect(allowedShare.ok).toBe(true);
    expect(spy.savedAudit).toHaveLength(1);
    expect(spy.savedAudit[0].kind).toBe('family-share');
  });

  it('Important 2: Cross-section Forward-To encodes text & first image in URLs and preloads ScamShieldPage and AiMediaCheckPage', () => {
    const scamText = 'URGENT from Maybank: Click https://maybank2u.xyz/login now!';
    const item = makeInboxItem({ text: scamText });

    const inboxHtml = renderToStaticMarkup(
      <UnifiedInboxPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, whatsappForward: true },
        }}
        initialItems={[item]}
        initialEvents={[]}
      />
    );
    expect(inboxHtml).toContain(
      `/scam-shield?text=${encodeURIComponent(scamText)}`
    );
    expect(inboxHtml).toContain('/media-check?image=clinic-photo.png');

    // ScamShieldPage reads ?text= from window.location.search when initialText is omitted
    vi.stubGlobal('window', {
      location: { search: `?text=${encodeURIComponent(scamText)}` },
    });
    expect(readPreloadedScamText()).toBe(scamText);

    const scamHtml = renderToStaticMarkup(
      <ScamShieldPage initialSettings={createDefaultSettings()} />
    );
    expect(scamHtml).toContain('https://maybank2u.xyz/login');
    expect(scamHtml).toContain('Likely Scam — Do Not Click or Pay');

    // AiMediaCheckPage reads ?image= from window.location.search when initialImageName is omitted
    vi.stubGlobal('window', {
      location: { search: '?image=clinic-photo.png' },
    });
    expect(readPreloadedMediaImageName()).toBe('clinic-photo.png');

    const mediaHtml = renderToStaticMarkup(
      <AiMediaCheckPage initialSettings={createDefaultSettings()} />
    );
    expect(mediaHtml).toContain('Checked photo: clinic-photo.png');
  });

  it('Important 3: PhotoHelperPage renders actual Original and Improved <img> previews', async () => {
    const sampleJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9,
    ]);
    const presetRes = await applyPhotoPreset(sampleJpeg, 'Brighten Dark Photo');
    expect(presetRes.ok).toBe(true);
    if (!presetRes.ok) return;

    const html = renderToStaticMarkup(
      <PhotoHelperPage
        initialSettings={{
          ...createDefaultSettings(),
          channels: { ...createDefaultSettings().channels, photos: true },
        }}
        initialPhotoName="family.jpg"
        initialPhotoBytes={sampleJpeg}
        initialEditedBytes={presetRes.value.editedBytes}
        initialActivePreset="Brighten Dark Photo"
      />
    );

    expect(html).toContain('<img');
    expect(html).toContain('alt="Original photo preview"');
    expect(html).toContain('alt="Improved photo preview"');
    expect(html).toContain('src="data:image/jpeg;base64,');
    expect(stripHtml(html)).not.toMatch(BANNED_JARGON);
  });

  it('Important 8: index.html links manifest.webmanifest matching src/app/manifest.ts and package.json includes build:vite', async () => {
    const fsPromises = (await import(/* @vite-ignore */ 'node:' + 'fs/promises')) as {
      readFile(url: URL, encoding: 'utf8'): Promise<string>;
    };

    const indexHtml = await fsPromises.readFile(
      new URL('../../index.html', import.meta.url),
      'utf8'
    );
    expect(indexHtml).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />'
    );

    const webManifestRaw = await fsPromises.readFile(
      new URL('../../public/manifest.webmanifest', import.meta.url),
      'utf8'
    );
    expect(JSON.parse(webManifestRaw)).toEqual(manifest());

    const pkgRaw = await fsPromises.readFile(
      new URL('../../package.json', import.meta.url),
      'utf8'
    );
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:vite']).toBe('vite build');
  });
});
