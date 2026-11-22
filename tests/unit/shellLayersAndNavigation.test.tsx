import React from 'react';
// @ts-ignore -- node built-ins are available at test runtime; no node typings installed
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/lib/types';
import { PhoneFrame } from '@/components/PhoneFrame';
import { AppShell } from '@/app/layout';
import { HomeHub } from '@/app/page';
import { UnifiedInboxPage } from '@/app/inbox/page';
import { CalendarPage } from '@/app/calendar/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import { MyDataPage } from '@/app/my-data/page';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function visibleText(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

declare const process: { cwd(): string };
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('Task 1: persistent 3-layer viewport shell', () => {
  it('PhoneFrame is locked to the viewport height', () => {
    const html = renderToStaticMarkup(
      <PhoneFrame>
        <p>Hi</p>
      </PhoneFrame>
    );
    expect(html).toContain('h-[100dvh]');
    expect(html).toContain('max-h-[100dvh]');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('min-h-screen');
    expect(html).toContain('data-phone-screen="true"');
  });

  it('AppShell renders top, content and bottom layers as siblings', () => {
    const html = renderToStaticMarkup(
      <AppShell activePath="/">
        <p>Body</p>
      </AppShell>
    );
    const top = html.indexOf('data-shell-layer="top"');
    const content = html.indexOf('data-shell-layer="content"');
    const bottom = html.indexOf('data-shell-layer="bottom"');
    expect(top).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(top);
    expect(bottom).toBeGreaterThan(content);
    expect(html).toMatch(
      /data-shell-layer="content"[^>]*class="[^"]*app-scroll[^"]*overflow-y-auto[^"]*overscroll-contain/
    );
    expect(html).toMatch(/<header data-shell-layer="top"[^>]*shrink-0 [^>]*z-30|<header data-shell-layer="top"[^>]*z-30[^>]*shrink-0/);
    expect(html).toMatch(/<nav data-shell-layer="bottom"[^>]*z-30/);
    expect(BANNED_JARGON.test(visibleText(html))).toBe(false);
  });

  it('all 7 screens inside AppShell have no Back to Home and keep all 3 layers', () => {
    const s = createDefaultSettings();
    const screens: Array<[string, React.ReactElement]> = [
      ['Home', <HomeHub key="h" initialSettings={s} initialItems={[]} />],
      ['Inbox', <UnifiedInboxPage key="i" initialSettings={s} initialItems={[]} />],
      ['Calendar', <CalendarPage key="c" initialSettings={s} initialEvents={[]} initialToday="2026-07-15" />],
      ['Scam', <ScamShieldPage key="s" initialSettings={s} />],
      ['Media', <AiMediaCheckPage key="m" initialSettings={s} />],
      ['Photo', <PhotoHelperPage key="p" initialSettings={s} />],
      ['MyData', <MyDataPage key="d" initialSettings={s} initialAudit={[]} />],
    ];
    for (const [name, el] of screens) {
      const html = renderToStaticMarkup(<AppShell activePath="/">{el}</AppShell>);
      expect(html, name).not.toContain('Back to Home');
      expect(html, name).toContain('data-shell-layer="top"');
      expect(html, name).toContain('data-shell-layer="content"');
      expect(html, name).toContain('data-shell-layer="bottom"');
      expect(BANNED_JARGON.test(visibleText(html)), name).toBe(false);
    }
  });

  it('BackToHome component file is removed', () => {
    expect(fs.existsSync(path.join(root, 'src/components/BackToHome.tsx'))).toBe(false);
  });

  it('globals.css locks the viewport root and keeps print visible', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height: 100%;[^}]*overflow: hidden;/);
    expect(css).toContain('overflow: visible !important;');
    expect(css).not.toContain('min-height: 100vh;');
  });

  it('main.tsx resets content layer scroll on navigation', () => {
    const main = read('src/main.tsx');
    expect(main).toContain('[data-shell-layer="content"]');
    expect(main).toContain('scrollTop = 0');
  });
});
