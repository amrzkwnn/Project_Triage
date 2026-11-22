import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/layout';
import manifest from '@/app/manifest';
import { HomeHub } from '@/app/page';
import { UnifiedInboxPage } from '@/app/inbox/page';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { SeniorButton } from '@/components/SeniorButton';
import { StepWizard } from '@/components/StepWizard';
import { presentationContent } from '@/lib/presentation/content';
import { processEmailBatch } from '@/lib/inbox/emailChannel';
import {
  dismissItemLocally,
  useAutoEmailCheck,
} from '@/lib/inbox/useAutoEmailCheck';
import {
  createDefaultSettings,
  type InboxItem,
  type Settings,
} from '@/lib/types';
import { createVault } from '@/lib/vault/store';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function createHookHarness() {
  const stateSlots: unknown[] = [];
  const refSlots: Array<{ current: unknown }> = [];
  const effectPrevDeps: Array<readonly unknown[] | undefined> = [];
  const effectCleanups: Array<(() => void) | undefined> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let queuedEffects: Array<{
    idx: number;
    effect: () => void | (() => void);
  }> = [];

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
        queuedEffects.push({
          idx,
          effect: effect as () => void | (() => void),
        });
      }
    });

  return {
    render<T extends React.ReactNode>(renderFn: () => T): T {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
      queuedEffects = [];
      const tree = renderFn();
      for (const item of queuedEffects) {
        effectCleanups[item.idx]?.();
        const cleanup = item.effect();
        effectCleanups[item.idx] =
          typeof cleanup === 'function' ? cleanup : undefined;
      }
      return tree;
    },
    unmount() {
      for (let i = 0; i < effectCleanups.length; i += 1) {
        effectCleanups[i]?.();
        effectCleanups[i] = undefined;
      }
    },
    restore() {
      for (let i = 0; i < effectCleanups.length; i += 1) {
        effectCleanups[i]?.();
        effectCleanups[i] = undefined;
      }
      useEffectSpy.mockRestore();
      useCallbackSpy.mockRestore();
      useMemoSpy.mockRestore();
      useRefSpy.mockRestore();
      useStateSpy.mockRestore();
    },
  };
}

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: overrides.id ?? 'item-1',
    source: overrides.source ?? 'email',
    sender: overrides.sender ?? 'City Clinic',
    text: overrides.text ?? 'Your appointment is on 2026-12-01 at 10:00.',
    attachments: overrides.attachments ?? [],
    receivedAt: overrides.receivedAt ?? '2026-11-22T08:00:00.000Z',
    group: overrides.group ?? 'Personal',
    priority: overrides.priority ?? 'Important',
    summary: overrides.summary ?? {
      fromApp: 'From Email',
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Task 1: Triage Rebrand, Undismissed-Only Local Persistence, Finish Setup Hide & Auto Email Check', () => {
  describe('Rebrand to Triage', () => {
    it('AppShell, manifest(), presentationContent, and index.html use brand name Triage with no My Daily Helper', async () => {
      const m = manifest();
      expect(m.name).toBe('Triage');
      expect(m.short_name).toBe('Triage');
      expect(presentationContent.brand.name).toBe('Triage');

      const shellHtml = renderToStaticMarkup(
        <AppShell activePath="/">
          <p>Content</p>
        </AppShell>
      );
      expect(shellHtml).toContain('Triage');
      expect(shellHtml).not.toContain('My Daily Helper');
      expect(shellHtml).not.toContain('Daily Helper');
      expect(stripTags(shellHtml)).not.toMatch(BANNED_JARGON);

      const fsPromises = (await import(/* @vite-ignore */ 'node:' + 'fs/promises')) as {
        readFile(url: URL, encoding: 'utf8'): Promise<string>;
      };
      const indexHtml = await fsPromises.readFile(
        new URL('../../index.html', import.meta.url),
        'utf8'
      );
      expect(indexHtml).toContain('<title>Triage</title>');
      expect(indexHtml).not.toContain('My Daily Helper');
    });
  });

  describe('Vault.deleteItem, dismissItemLocally & email re-import prevention', () => {
    it('createVault().deleteItem(id) removes only the dismissed item and keeps undismissed items persisted', async () => {
      let failWrites = false;
      const vault = createVault({
        dbName: 'test_triage_delete_item_v1',
        shouldFailWrite: () => failWrites,
      });

      const keepItem = makeInboxItem({ id: 'keep-1', text: 'Keep this note.' });
      const dropItem = makeInboxItem({ id: 'drop-1', text: 'Dismiss this note.' });

      await vault.putItem(keepItem);
      await vault.putItem(dropItem);

      expect(typeof vault.deleteItem).toBe('function');

      failWrites = true;
      const failRes = await vault.deleteItem!('drop-1');
      expect(failRes.ok).toBe(false);

      failWrites = false;
      const delRes = await vault.deleteItem!('drop-1');
      expect(delRes.ok).toBe(true);

      const listed = await vault.listItems();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((i) => i.id)).toEqual(['keep-1']);
      }
    });

    it('dismissItemLocally deletes the item from Vault, persists dismissedItemIds, caps at 500, and prevents re-import on email check', async () => {
      const vault = createVault({ dbName: 'test_triage_dismiss_and_skip_v1' });
      const initialSettings: Settings = {
        ...createDefaultSettings(),
        channels: { ...createDefaultSettings().channels, email: true },
      };
      await vault.saveSettings(initialSettings);

      const emailA = makeInboxItem({
        id: 'gmail-dismissed-1',
        text: 'Appointment reminder to dismiss.',
      });
      const emailB = makeInboxItem({
        id: 'gmail-keep-2',
        text: 'Keep this clinic email.',
      });
      await vault.putItem(emailA);
      await vault.putItem(emailB);

      const dismissRes = await dismissItemLocally({
        itemId: 'gmail-dismissed-1',
        settings: initialSettings,
        vault,
      });
      expect(dismissRes.ok).toBe(true);
      if (!dismissRes.ok) return;

      expect(dismissRes.settings.dismissedItemIds).toEqual(['gmail-dismissed-1']);

      // Reload simulation: vault only contains undismissed item + persisted dismissedItemIds
      const reloadedItems = await vault.listItems();
      const reloadedSettings = await vault.getSettings();
      expect(reloadedItems.ok && reloadedItems.value.map((i) => i.id)).toEqual([
        'gmail-keep-2',
      ]);
      expect(
        reloadedSettings.ok && reloadedSettings.value.dismissedItemIds
      ).toEqual(['gmail-dismissed-1']);

      // Automatic email check must skip dismissed email ID and only import brand-new emails
      const batchRes = await processEmailBatch({
        settings: reloadedSettings.ok ? reloadedSettings.value : dismissRes.settings,
        tokenStatus: 'valid',
        emails: [
          {
            id: 'gmail-dismissed-1',
            from: 'City Clinic <care@clinic.sg>',
            subject: 'Old Dismissed Email',
            body: 'Appointment reminder to dismiss.',
            receivedAt: '2026-11-22T09:00:00.000Z',
          },
          {
            id: 'gmail-new-3',
            from: 'Mei Ling <mei@family.sg>',
            subject: 'Sunday Lunch',
            body: 'See you for lunch on Sunday at 12:30.',
            receivedAt: '2026-11-22T09:05:00.000Z',
          },
        ],
        vault,
      });

      expect(batchRes.processed.map((i) => i.id)).toEqual(['gmail-new-3']);

      const afterBatchItems = await vault.listItems();
      expect(afterBatchItems.ok).toBe(true);
      if (afterBatchItems.ok) {
        expect(afterBatchItems.value.map((i) => i.id)).toEqual([
          'gmail-keep-2',
          'gmail-new-3',
        ]);
      }

      // Cap at 500 newest dismissed IDs
      const existing500 = Array.from({ length: 500 }, (_, i) => `old-${i}`);
      const cappedRes = await dismissItemLocally({
        itemId: 'newest-501',
        settings: { ...initialSettings, dismissedItemIds: existing500 },
      });
      expect(cappedRes.ok).toBe(true);
      if (cappedRes.ok) {
        expect(cappedRes.settings.dismissedItemIds).toHaveLength(500);
        expect(cappedRes.settings.dismissedItemIds?.[0]).toBe('old-1');
        expect(cappedRes.settings.dismissedItemIds?.[499]).toBe('newest-501');
      }
    });
  });

  describe('UnifiedInboxPage Finish Setup Hide & Dismiss Persistence', () => {
    it('hides Easy Phone Shortcut Setup when shortcutSetupCompleted === true and persists on Finish Setup', async () => {
      const defaultHtml = renderToStaticMarkup(
        <UnifiedInboxPage
          initialSettings={createDefaultSettings()}
          initialItems={[]}
          initialEvents={[]}
        />
      );
      expect(defaultHtml).toContain('Easy Phone Shortcut Setup');
      expect(defaultHtml).not.toContain('My Daily Helper');

      const completedHtml = renderToStaticMarkup(
        <UnifiedInboxPage
          initialSettings={{
            ...createDefaultSettings(),
            shortcutSetupCompleted: true,
          }}
          initialItems={[]}
          initialEvents={[]}
        />
      );
      expect(completedHtml).not.toContain('Easy Phone Shortcut Setup');
      expect(stripTags(completedHtml)).not.toMatch(BANNED_JARGON);

      // Interactive: clicking Finish Setup hides wizard immediately & persists shortcutSetupCompleted: true
      const vault = createVault({ dbName: 'test_triage_finish_setup_v1' });
      const initialSettings = createDefaultSettings();
      await vault.saveSettings(initialSettings);

      const harness = createHookHarness();
      try {
        const tree1 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [],
            initialEvents: [],
            vault,
          })
        );
        const wizard = findElements(
          tree1,
          (el) => el.type === StepWizard
        )[0];
        expect(wizard).toBeDefined();
        expect(wizard.props.completeLabel).toBe('Finish Setup');

        await (wizard.props.onComplete as () => Promise<void> | void)();
        await Promise.resolve();

        const tree2 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [],
            initialEvents: [],
            vault,
          })
        );
        expect(findElements(tree2, (el) => el.type === StepWizard)).toHaveLength(0);
        expect(JSON.stringify(tree2)).not.toContain('Easy Phone Shortcut Setup');

        const persisted = await vault.getSettings();
        expect(persisted.ok && persisted.value.shortcutSetupCompleted).toBe(true);
      } finally {
        harness.restore();
      }
    });

    it('renders Dismiss button on inbox cards and persists removal from Vault on click', async () => {
      const vault = createVault({ dbName: 'test_triage_inbox_dismiss_btn_v1' });
      const settings = createDefaultSettings();
      const item = makeInboxItem({ id: 'inbox-drop-1' });
      await vault.saveSettings(settings);
      await vault.putItem(item);

      const html = renderToStaticMarkup(
        <UnifiedInboxPage
          initialSettings={settings}
          initialItems={[item]}
          initialEvents={[]}
        />
      );
      expect(html).toContain('Dismiss');
      expect(stripTags(html)).not.toMatch(BANNED_JARGON);

      const harness = createHookHarness();
      try {
        const tree1 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings: settings,
            initialItems: [item],
            initialEvents: [],
            vault,
          })
        );
        const dismissBtn = findElements(
          tree1,
          (el) =>
            el.type === SeniorButton &&
            String(el.props.children).trim() === 'Dismiss'
        )[0];
        expect(dismissBtn).toBeDefined();

        await (dismissBtn.props.onClick as () => Promise<void>)();
        await Promise.resolve();

        const itemsAfter = await vault.listItems();
        expect(itemsAfter.ok && itemsAfter.value).toEqual([]);
        const settingsAfter = await vault.getSettings();
        expect(
          settingsAfter.ok && settingsAfter.value.dismissedItemIds
        ).toContain('inbox-drop-1');
      } finally {
        harness.restore();
      }
    });

    it('HomeHub persists dismissal to Vault so only undismissed decisions remain stored locally', async () => {
      const vault = createVault({ dbName: 'test_triage_home_dismiss_v1' });
      const settings = createDefaultSettings();
      const itemA = makeInboxItem({ id: 'home-a', tier: 2 });
      const itemB = makeInboxItem({ id: 'home-b', tier: 2 });
      await vault.saveSettings(settings);
      await vault.putItem(itemA);
      await vault.putItem(itemB);

      const harness = createHookHarness();
      try {
        const tree1 = harness.render(() =>
          HomeHub({
            initialSettings: settings,
            initialItems: [itemA, itemB],
            vault,
          })
        );
        const cards = findElements(
          tree1,
          (el) => el.type === DecisionConfirmCard
        );
        expect(cards).toHaveLength(2);

        await (cards[0].props.onDismiss as () => Promise<void> | void)();
        await new Promise((r) => setTimeout(r, 10));

        const itemsAfter = await vault.listItems();
        expect(itemsAfter.ok).toBe(true);
        if (itemsAfter.ok) {
          expect(itemsAfter.value).toHaveLength(1);
        }
        const settingsAfter = await vault.getSettings();
        expect(settingsAfter.ok).toBe(true);
        if (settingsAfter.ok) {
          expect(settingsAfter.value.dismissedItemIds).toHaveLength(1);
        }
      } finally {
        harness.restore();
      }
    });
  });

  describe('useAutoEmailCheck periodic + visibility/focus polling', () => {
    it('runs onCheck on interval, visibilitychange (visible only), and focus, prevents overlapping in-flight runs, and cleans up on unmount', async () => {
      vi.useFakeTimers();

      const windowListeners = new Map<string, Set<() => void>>();
      const docListeners = new Map<string, Set<() => void>>();
      let visibilityState: 'visible' | 'hidden' = 'visible';

      vi.stubGlobal('window', {
        addEventListener: (type: string, fn: () => void) => {
          if (!windowListeners.has(type)) windowListeners.set(type, new Set());
          windowListeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: () => void) => {
          windowListeners.get(type)?.delete(fn);
        },
      });
      vi.stubGlobal('document', {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: (type: string, fn: () => void) => {
          if (!docListeners.has(type)) docListeners.set(type, new Set());
          docListeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: () => void) => {
          docListeners.get(type)?.delete(fn);
        },
      });

      const harness = createHookHarness();
      let resolveInFlight: (() => void) | undefined;
      const onCheck = vi.fn(() => {
        return new Promise<void>((resolve) => {
          resolveInFlight = resolve;
        });
      });

      function TestHost(props: { enabled: boolean; intervalMs?: number }) {
        useAutoEmailCheck({
          enabled: props.enabled,
          intervalMs: props.intervalMs,
          onCheck,
        });
        return null;
      }

      try {
        // 1. Disabled -> does not run
        harness.render(() => TestHost({ enabled: false, intervalMs: 60_000 }));
        vi.advanceTimersByTime(120_000);
        expect(onCheck).not.toHaveBeenCalled();

        // 2. Enabled -> runs on interval tick
        harness.render(() => TestHost({ enabled: true, intervalMs: 60_000 }));
        vi.advanceTimersByTime(60_000);
        expect(onCheck).toHaveBeenCalledTimes(1);

        // 3. While in flight, another interval + focus + visibilitychange must NOT overlap
        vi.advanceTimersByTime(60_000);
        windowListeners.get('focus')?.forEach((fn) => fn());
        docListeners.get('visibilitychange')?.forEach((fn) => fn());
        expect(onCheck).toHaveBeenCalledTimes(1);

        // Resolve first check so next check can run
        resolveInFlight?.();
        await Promise.resolve();
        await Promise.resolve();

        // 4. Focus triggers check
        windowListeners.get('focus')?.forEach((fn) => fn());
        expect(onCheck).toHaveBeenCalledTimes(2);
        resolveInFlight?.();
        await Promise.resolve();
        await Promise.resolve();

        // 5. visibilitychange when hidden does NOT trigger; when visible DOES trigger
        visibilityState = 'hidden';
        docListeners.get('visibilitychange')?.forEach((fn) => fn());
        expect(onCheck).toHaveBeenCalledTimes(2);

        visibilityState = 'visible';
        docListeners.get('visibilitychange')?.forEach((fn) => fn());
        expect(onCheck).toHaveBeenCalledTimes(3);
        resolveInFlight?.();
        await Promise.resolve();
        await Promise.resolve();

        // 6. Unmount cleans up timers and event listeners
        harness.unmount();
        expect(windowListeners.get('focus')?.size ?? 0).toBe(0);
        expect(docListeners.get('visibilitychange')?.size ?? 0).toBe(0);
        vi.advanceTimersByTime(180_000);
        expect(onCheck).toHaveBeenCalledTimes(3);
      } finally {
        harness.restore();
      }
    });

    it('is SSR-safe when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      const onCheck = vi.fn();
      function SsrHost() {
        useAutoEmailCheck({ enabled: true, onCheck });
        return <div>ok</div>;
      }
      expect(() => renderToStaticMarkup(<SsrHost />)).not.toThrow();
      expect(onCheck).not.toHaveBeenCalled();
    });
  });
});
