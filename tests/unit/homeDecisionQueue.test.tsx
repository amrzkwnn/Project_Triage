import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeHub } from '@/app/page';
import { confirmFromTap } from '@/lib/actions/confirmation';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import {
  createDefaultSettings,
  type InboxItem,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|stack trace|exception|indexeddb|oauth|webhook|regex)\b/i;
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
  vi.unstubAllGlobals();
});

function makeQueueItems(): InboxItem[] {
  return [
    makeInboxItem({
      id: 'q-1',
      tier: 3,
      sender: 'Bank Alerts',
      senderEmail: 'alert@bank.example',
      receivedAt: '2026-11-22T08:00:00.000Z',
      summary: {
        fromApp: 'From Email',
        whoSent: 'Bank Alerts',
        actionNeeded: 'Check your account',
        text: 'First urgent bank notice.',
      },
    }),
    makeInboxItem({
      id: 'q-2',
      tier: 2,
      group: 'Personal',
      sender: 'City Clinic',
      receivedAt: '2026-11-22T09:00:00.000Z',
      summary: {
        fromApp: 'From Email',
        whoSent: 'City Clinic',
        actionNeeded: 'Review reminder',
        text: 'Second clinic reminder.',
      },
    }),
  ];
}

function currentCards(tree: React.ReactNode) {
  return findElements(tree, (el) => el.type === DecisionConfirmCard);
}

function sleep(ms = 10) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Task 3: one-at-a-time Home decision queue', () => {
  it('renders only the top priority item with sender email, Save to, and progress', () => {
    const html = renderToStaticMarkup(
      <HomeHub
        initialSettings={createDefaultSettings()}
        initialItems={makeQueueItems()}
      />
    );
    expect(html).toContain('First urgent bank notice.');
    expect(html).toContain('alert@bank.example');
    expect(html).toContain('Save to');
    expect(html).toContain('data-home-queue-progress="true"');
    expect(html).toContain('1 of 2');
    expect(html).not.toContain('Second clinic reminder.');
    expect(html).not.toContain('Show ');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(BANNED_JARGON);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toContain('min-h-[56px]');
  });

  it('auto-advances on Save to category and keeps item in Vault under that category', async () => {
    const vault = createVault({ dbName: 'test_home_queue_save_v1' });
    const settings = createDefaultSettings();
    const items = makeQueueItems();
    await vault.saveSettings(settings);
    for (const i of items) await vault.putItem(i);

    const harness = createHookHarness();
    try {
      const props = { initialSettings: settings, initialItems: items, vault };
      let tree = harness.render(() => HomeHub(props));
      let cards = currentCards(tree);
      expect(cards).toHaveLength(1);
      expect(cards[0].props.summary).toBe('First urgent bank notice.');

      await (cards[0].props.onSaveToCategory as (c: string) => Promise<void>)(
        'Bills'
      );
      await sleep();
      tree = harness.render(() => HomeHub(props));
      cards = currentCards(tree);
      expect(cards).toHaveLength(1);
      expect(cards[0].props.summary).toBe('Second clinic reminder.');

      const list = await vault.listItems();
      expect(list.ok).toBe(true);
      if (list.ok) {
        const q1 = list.value.find((i) => i.id === 'q-1');
        expect(q1?.group).toBe('Bills');
        expect(q1?.homeHandled).toBe(true);
      }
      const s = await vault.getSettings();
      if (s.ok) expect(s.value.dismissedItemIds ?? []).not.toContain('q-1');

      await (cards[0].props.onSaveToCategory as (c: string) => Promise<void>)(
        'Personal'
      );
      await sleep();
      tree = harness.render(() => HomeHub(props));
      expect(currentCards(tree)).toHaveLength(0);
      const list2 = await vault.listItems();
      if (list2.ok) {
        expect(list2.value.find((i) => i.id === 'q-2')?.homeHandled).toBe(true);
      }
      expect(
        findElements(tree, (el) => typeof el.props.children === 'string' && el.props.children === 'Nothing needs your attention today').length
      ).toBeGreaterThan(0);
    } finally {
      harness.restore();
    }
  });

  it('keeps the current card and shows an alert when saving fails', async () => {
    const settings = createDefaultSettings();
    const items = makeQueueItems();
    const failing = {
      getSettings: async () => ({ ok: true as const, value: settings }),
      listItems: async () => ({ ok: true as const, value: items }),
      saveSettings: async () => ({ ok: true as const, value: undefined }),
      appendAudit: async () => ({ ok: true as const, value: undefined }),
      deleteItem: async () => ({ ok: true as const, value: undefined }),
      putItem: async () => ({
        ok: false as const,
        error: { message: 'nope' },
      }),
    } as unknown as Vault;

    const harness = createHookHarness();
    try {
      const props = {
        initialSettings: settings,
        initialItems: items,
        vault: failing,
      };
      let tree = harness.render(() => HomeHub(props));
      const cards = currentCards(tree);
      await (cards[0].props.onSaveToCategory as (c: string) => Promise<void>)(
        'Bills'
      );
      await sleep();
      tree = harness.render(() => HomeHub(props));
      const after = currentCards(tree);
      expect(after).toHaveLength(1);
      expect(after[0].props.summary).toBe('First urgent bank notice.');
      expect(
        findElements(tree, (el) => el.props.role === 'alert').length
      ).toBeGreaterThan(0);
    } finally {
      harness.restore();
    }
  });

  it('auto-advances on Dismiss and Confirm', async () => {
    const vault = createVault({ dbName: 'test_home_queue_dismiss_v1' });
    const settings = createDefaultSettings();
    const items = makeQueueItems();
    await vault.saveSettings(settings);
    for (const i of items) await vault.putItem(i);

    const harness = createHookHarness();
    try {
      const props = { initialSettings: settings, initialItems: items, vault };
      let tree = harness.render(() => HomeHub(props));
      let cards = currentCards(tree);
      await (cards[0].props.onDismiss as () => Promise<void>)();
      await sleep();
      tree = harness.render(() => HomeHub(props));
      cards = currentCards(tree);
      expect(cards).toHaveLength(1);
      expect(cards[0].props.summary).toBe('Second clinic reminder.');

      (cards[0].props.onConfirm as (c: unknown) => void)(confirmFromTap(String(cards[0].props.actionId)));
      await sleep(30);
      tree = harness.render(() => HomeHub(props));
      expect(currentCards(tree)).toHaveLength(0);
    } finally {
      harness.restore();
    }
  });
});
