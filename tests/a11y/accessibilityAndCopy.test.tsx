import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  type CalendarEvent,
  type InboxItem,
  type Settings,
} from '@/lib/types';
import { HomeHub } from '@/app/page';
import { MyDataPage } from '@/app/my-data/page';
import {
  ScamShieldPage,
  UNREADABLE_SCREENSHOT_MESSAGE,
  evaluateScamCheckInput,
} from '@/app/scam-shield/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import {
  UnifiedInboxPage,
  evaluateInitialQuery,
  ingestInboxDraftWithConsent,
} from '@/app/inbox/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import {
  CalendarPage,
  applyCandidateDecisionWithPersistence,
} from '@/app/calendar/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function stripHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractButtonTags(html: string): string[] {
  const matches = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi);
  return matches ?? [];
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
      if (token[1] === '/') {
        depth -= 1;
      } else {
        depth += 1;
      }
      if (depth === 0) {
        endIdx = tagTokenPattern.lastIndex;
        break;
      }
    }
    badges.push(html.slice(startIdx, endIdx));
  }

  return badges;
}

const sampleSettings: Settings = {
  ...createDefaultSettings(),
  channels: {
    email: true,
    whatsappForward: true,
    smsPaste: true,
    messengerPaste: false,
    photos: true,
  },
  allowAiReading: false,
  caregiverShareEnabled: true,
  familyCodeWord: 'Mangoes',
  checklist: {
    'whatsapp-profile-contacts': true,
  },
};

const sampleItems: InboxItem[] = [
  {
    id: 'inbox-1',
    source: 'whatsappForward',
    sender: 'City Clinic',
    text: 'Your appointment is on 2026-07-15 at 10:30. Visit https://clinic.example',
    attachments: [
      {
        id: 'att-img-1',
        mime: 'image/jpeg',
        name: 'clinic-map.jpg',
        dataBase64: 'AAAA',
      },
    ],
    receivedAt: '2026-07-10T08:00:00.000Z',
    group: 'Personal',
    priority: 'Important',
    summary: {
      fromApp: 'From WhatsApp',
      whoSent: 'City Clinic',
      actionNeeded: 'Confirm calendar date',
      text: 'City Clinic shared an appointment on 2026-07-15 at 10:30.',
    },
    detectedEvent: {
      date: '2026-07-15',
      time: '10:30',
      title: 'City Clinic Appointment',
      location: 'Room 4B',
    },
    tier: 2,
    confidence: 0.9,
    status: 'ok',
    proposals: [
      {
        id: 'inbox-1:forwardToCalendar',
        kind: 'forwardToCalendar',
        label: 'Forward to Calendar',
        itemId: 'inbox-1',
        event: {
          date: '2026-07-15',
          time: '10:30',
          title: 'City Clinic Appointment',
        },
      },
    ],
  },
];

const sampleEvents: CalendarEvent[] = [
  {
    id: 'cal-1',
    title: 'Dr. Tan Checkup',
    date: '2026-07-15',
    time: '10:30',
    location: 'Room 4B',
    category: 'Medical',
    createdAt: '2026-07-10T08:00:00.000Z',
  },
];

describe('Accessibility, Touch Targets, Dual-Modality Badges, Copy & Bundle Safety (Task 15.3)', () => {
  const screens: Array<{
    name: string;
    isHome: boolean;
    element: React.ReactElement;
  }> = [
    {
      name: 'HomeHub',
      isHome: true,
      element: (
        <HomeHub initialSettings={sampleSettings} initialItems={sampleItems} />
      ),
    },
    {
      name: 'MyData',
      isHome: false,
      element: <MyDataPage initialSettings={sampleSettings} initialAudit={[]} />,
    },
    {
      name: 'ScamShield',
      isHome: false,
      element: (
        <ScamShieldPage
          initialSettings={sampleSettings}
          initialText="URGENT: Send gift cards right now and do not tell family!"
        />
      ),
    },
    {
      name: 'PhotoHelper',
      isHome: false,
      element: <PhotoHelperPage initialSettings={sampleSettings} />,
    },
    {
      name: 'UnifiedInbox',
      isHome: false,
      element: (
        <UnifiedInboxPage
          initialSettings={sampleSettings}
          initialItems={sampleItems}
        />
      ),
    },
    {
      name: 'AiMediaCheck',
      isHome: false,
      element: (
        <AiMediaCheckPage
          initialSettings={sampleSettings}
          initialOutcome={{
            result: 'Cannot tell',
            note: 'Messaging apps like WhatsApp often remove photo details, so we cannot tell from the file alone.',
          }}
        />
      ),
    },
    {
      name: 'Calendar',
      isHome: false,
      element: (
        <CalendarPage
          initialSettings={sampleSettings}
          initialEvents={sampleEvents}
          initialToday="2026-07-15"
        />
      ),
    },
  ];

  it('renders all 7 screens with no Back to Home control, min-h-[56px] buttons with text labels, dual-modality badges, and zero banned jargon', () => {
    for (const screen of screens) {
      const html = renderToStaticMarkup(screen.element);

      // 1. No screen renders a Back to Home control
      expect(html, `${screen.name} should not show Back to Home`).not.toContain(
        'Back to Home'
      );

      // 2. Every interactive <button> must carry min-h-[56px] and visible text label
      const buttons = extractButtonTags(html);
      expect(
        buttons.length,
        `${screen.name} should render interactive buttons`
      ).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(
          btn,
          `${screen.name} button missing min-h-[56px]: ${btn.slice(0, 120)}`
        ).toContain('min-h-[56px]');
        const visibleLabel = stripHtml(btn);
        expect(
          visibleLabel.length,
          `${screen.name} button missing visible text label`
        ).toBeGreaterThan(0);
      }

      // 3. Every badge carries BOTH an icon (aria-hidden="true") and visible text label
      const badges = extractBadges(html);
      for (const badge of badges) {
        expect(
          badge,
          `${screen.name} badge missing icon: ${badge.slice(0, 120)}`
        ).toContain('aria-hidden="true"');
        const badgeText = stripHtml(badge);
        expect(
          badgeText.length,
          `${screen.name} badge missing visible text label`
        ).toBeGreaterThan(0);
      }

      // 4. Zero banned technical jargon in rendered user-facing copy
      const visibleText = stripHtml(html);
      expect(
        visibleText,
        `${screen.name} contains banned technical jargon`
      ).not.toMatch(BANNED_JARGON);
    }
  });

  it('verifies section-specific screen requirements across all 5 section screens', () => {
    // Scam Shield: 4 Safety Habits, Is This Safe?, Family Secret Code Word, Checklist X of Y
    const scamHtml = renderToStaticMarkup(
      <ScamShieldPage
        initialSettings={sampleSettings}
        initialText="URGENT: Send gift cards right now and do not tell family!"
      />
    );
    expect(scamHtml).toContain('Is This Safe?');
    expect(scamHtml).toContain('Watch for Urgency');
    expect(scamHtml).toContain('Watch for Secrecy');
    expect(scamHtml).toContain('Watch for Unusual Payment');
    expect(scamHtml).toContain('Hang Up &amp; Call Back');
    expect(scamHtml).toContain('1 of 3 steps completed');
    expect(scamHtml).toContain('Likely Scam — Do Not Click or Pay');

    // Photo Helper: gated when photos OFF, 4 presets + zero sliders + Old Print Scan Tip when ON
    const photoOffHtml = renderToStaticMarkup(
      <PhotoHelperPage initialSettings={createDefaultSettings()} />
    );
    expect(photoOffHtml).toMatch(/turn on photo|photo access/i);
    expect(photoOffHtml).not.toContain('type="range"');

    const photoOnHtml = renderToStaticMarkup(
      <PhotoHelperPage initialSettings={sampleSettings} />
    );
    expect(photoOnHtml).toContain('Make Clearer');
    expect(photoOnHtml).toContain('Brighten Dark Photo');
    expect(photoOnHtml).toContain('Fix Old / Scratched Photo');
    expect(photoOnHtml).toContain('Tidy Background');
    expect(photoOnHtml).not.toContain('type="range"');
    expect(photoOnHtml).toContain('Old Print Scan Tip');
    expect(photoOnHtml).toContain('Step 1 of 3');

    // Unified Inbox: tabs, Promotion filter, Paste Message or Pick Photo, Apple Shortcut wizard, Forward-To actions
    const inboxHtml = renderToStaticMarkup(
      <UnifiedInboxPage
        initialSettings={sampleSettings}
        initialItems={sampleItems}
        initialQuery="?source=invalid-app&text=hello"
      />
    );
    expect(inboxHtml).toContain('Personal');
    expect(inboxHtml).toContain('Family');
    expect(inboxHtml).toContain('Others');
    expect(inboxHtml).toContain('All');
    expect(inboxHtml).toContain('Promotion');
    expect(inboxHtml).toContain('+ Paste Message or Pick Photo');
    expect(inboxHtml).toContain('Forward to Calendar');
    expect(inboxHtml).toContain('Forward to Scam Check');
    expect(inboxHtml).toContain('Forward to AI Image Check');
    expect(inboxHtml).toContain('Forward Summary to Family');

    // AI Media Check: 4-Spot Eye Check Guide, Voice Clone Safety, never "100% Real", Ask Family to Check
    const mediaHtml = renderToStaticMarkup(
      <AiMediaCheckPage
        initialSettings={sampleSettings}
        initialOutcome={{
          result: 'Camera signal found',
          signalName: 'Canon',
          note: 'Camera details were found, but this does not prove the photo is authentic.',
        }}
      />
    );
    expect(mediaHtml).toContain('Camera signal found');
    expect(mediaHtml).not.toMatch(/100%\s*real/i);
    expect(mediaHtml).toContain('Hands &amp; Fingers');
    expect(mediaHtml).toContain('Background Words &amp; Signs');
    expect(mediaHtml).toContain('Eyes, Teeth &amp; Glasses');
    expect(mediaHtml).toContain('Smooth Plastic Face Edges');
    expect(mediaHtml).toContain('Voice Clone Safety');
    expect(mediaHtml).toContain('Ask Family to Check');

    // Calendar: Today / This Week / Month List, Nothing planned, reminder lead times, low-confidence Please check
    const calHtml = renderToStaticMarkup(
      <CalendarPage
        initialSettings={sampleSettings}
        initialEvents={[]}
        initialToday="2026-07-15"
        initialSnapCandidates={[
          {
            id: 'cand-low',
            title: 'Dentist Visit',
            date: '2026-07-18',
            category: 'Medical',
            confidence: 0.4,
          },
        ]}
      />
    );
    expect(calHtml).toContain('Today');
    expect(calHtml).toContain('This Week');
    expect(calHtml).toContain('Month List');
    expect(calHtml).toContain('Nothing planned');
    expect(calHtml).toContain('Please check');
    expect(calHtml).toContain('15m');
    expect(calHtml).toContain('30m');
    expect(calHtml).toContain('1h');
    expect(calHtml).toContain('2h');
    expect(calHtml).toContain('1d');
  });

  it('verifies client source files never reference AI_API_KEY or GEMINI_API_KEY', async () => {
    const fsPromises = (await import(/* @vite-ignore */ 'node:' + 'fs/promises')) as {
      readdir(
        path: string,
        opts: { withFileTypes: true }
      ): Promise<Array<{ name: string; isDirectory(): boolean }>>;
      readFile(path: string, encoding: 'utf8'): Promise<string>;
    };
    const pathMod = (await import(/* @vite-ignore */ 'node:' + 'path')) as {
      join(...parts: string[]): string;
    };

    async function collectClientFiles(dir: string): Promise<string[]> {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'api' || entry.name === 'server') {
            continue;
          }
          files.push(...(await collectClientFiles(full)));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(full);
        }
      }
      return files;
    }

    const srcRoot = decodeURIComponent(
      new URL('../../src', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1'
      )
    );
    const clientFiles = await collectClientFiles(srcRoot);
    expect(clientFiles.length).toBeGreaterThan(0);

    for (const file of clientFiles) {
      const content = await fsPromises.readFile(file, 'utf8');
      expect(content, `Secret reference in client file ${file}`).not.toMatch(
        /\b(AI_API_KEY|GEMINI_API_KEY)\b/
      );
    }
  });

  it('Fix Round 1 regressions: screenshot-only scam check, calendar putEvent failure, inbox consent/storage failure, and query re-evaluation', async () => {
    // 1. ScamShield screenshot-only: readable OCR -> verdict; unreadable -> no verdict + retake/crop prompt
    const readableShot = evaluateScamCheckInput({
      messageText: '',
      screenshotName: 'bank-alert.png',
      screenshotOcrText:
        'URGENT: Pay RM500 right now and do not tell your family!',
    });
    expect(readableShot.ok).toBe(true);
    if (readableShot.ok) {
      expect(readableShot.verdict.value).toBe('danger');
    }

    const unreadableShot = evaluateScamCheckInput({
      messageText: '',
      screenshotName: 'blurry.jpg',
      screenshotOcrText: '   ',
    });
    expect(unreadableShot.ok).toBe(false);
    if (!unreadableShot.ok) {
      expect(unreadableShot.kind).toBe('unreadable-screenshot');
      expect(unreadableShot.message).toBe(UNREADABLE_SCREENSHOT_MESSAGE);
      expect(unreadableShot.message).not.toMatch(BANNED_JARGON);
    }

    const shotPageHtml = renderToStaticMarkup(
      <ScamShieldPage
        initialSettings={sampleSettings}
        initialScreenshotName="bank-alert.png"
        initialScreenshotOcrText="URGENT: Send gift cards right now and keep this secret!"
      />
    );
    expect(shotPageHtml).toContain('Likely Scam — Do Not Click or Pay');

    // 2. Calendar snap decision preserves state when vault.putEvent fails
    const existing: CalendarEvent[] = [...sampleEvents];
    const failedSnap = await applyCandidateDecisionWithPersistence({
      candidate: {
        id: 'cand-save-fail',
        title: 'Eye Clinic',
        date: '2026-07-20',
        time: '11:00',
        category: 'Medical',
        confidence: 0.9,
      },
      decision: 'keep',
      existingEvents: existing,
      vault: {
        putEvent: async () => ({
          ok: false,
          error: {
            code: 'tx-failed',
            message: 'We could not save that event on your device.',
          },
        }),
      },
    });
    expect(failedSnap.ok).toBe(false);
    if (!failedSnap.ok) {
      expect(failedSnap.errorMessage).toContain('could not save');
    }
    expect(existing).toHaveLength(1);

    const okSnap = await applyCandidateDecisionWithPersistence({
      candidate: {
        id: 'cand-save-ok',
        title: 'Eye Clinic',
        date: '2026-07-20',
        time: '11:00',
        category: 'Medical',
        confidence: 0.9,
      },
      decision: 'keep',
      existingEvents: existing,
      vault: {
        putEvent: async () => ({ ok: true, value: undefined }),
      },
    });
    expect(okSnap.ok).toBe(true);
    if (okSnap.ok) {
      expect(okSnap.nextEvents).toHaveLength(2);
    }

    // 3. UnifiedInbox ingestDraft returns false on OFF channel or storage failure (preserving input)
    const offChannelDraft = await ingestInboxDraftWithConsent({
      draft: {
        source: 'messengerPaste',
        text: 'Hello from friend',
        attachments: [],
        receivedAt: '2026-07-10T09:00:00.000Z',
      },
      settings: sampleSettings, // messengerPaste is false
    });
    expect(offChannelDraft.ok).toBe(false);

    const storageFailDraft = await ingestInboxDraftWithConsent({
      draft: {
        source: 'smsPaste',
        text: 'Appointment on 2026-07-22 at 10:00',
        attachments: [],
        receivedAt: '2026-07-10T09:00:00.000Z',
      },
      settings: sampleSettings,
      vault: {
        putItem: async () => ({
          ok: false,
          error: {
            code: 'tx-failed',
            message: 'Could not save message right now.',
          },
        }),
        appendAudit: async () => ({ ok: true, value: undefined }),
      },
    });
    expect(storageFailDraft.ok).toBe(false);

    const okDraft = await ingestInboxDraftWithConsent({
      draft: {
        source: 'smsPaste',
        text: 'Appointment on 2026-07-22 at 10:00',
        attachments: [],
        receivedAt: '2026-07-10T09:00:00.000Z',
      },
      settings: sampleSettings,
      vault: {
        putItem: async () => ({ ok: true, value: undefined }),
        appendAudit: async () => ({ ok: true, value: undefined }),
      },
    });
    expect(okDraft.ok).toBe(true);

    // 4. UnifiedInbox query re-evaluation handles valid, invalid, and cleared queries
    const validQuery = evaluateInitialQuery(
      '?source=whatsapp&text=Clinic+visit+tomorrow'
    );
    expect(validQuery.draft?.source).toBe('whatsappForward');
    expect(validQuery.draft?.text).toBe('Clinic visit tomorrow');
    expect(validQuery.error).toBeUndefined();

    const invalidQuery = evaluateInitialQuery('?source=unknown&text=Hi');
    expect(invalidQuery.draft).toBeUndefined();
    expect(invalidQuery.error).toBeDefined();

    const clearedQuery = evaluateInitialQuery('');
    expect(clearedQuery.draft).toBeUndefined();
    expect(clearedQuery.error).toBeUndefined();
  });
});
