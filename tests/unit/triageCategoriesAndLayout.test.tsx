import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UnifiedInboxPage } from '@/app/inbox/page';
import {
  DEFAULT_INBOX_CATEGORIES,
  PROTECTED_INBOX_CATEGORIES,
  addInboxCategory,
  deleteInboxCategory,
  getVisibleInboxCategories,
  isProtectedInboxCategory,
} from '@/lib/inbox/categories';
import { filterByTab } from '@/lib/inbox/order';
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

function extractButtons(html: string): string[] {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) ?? [];
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

function extractMailScrollLayer(html: string): string | null {
  const openMatch = /<div\b[^>]*data-mail-scroll-layer="true"[^>]*>/i.exec(html);
  if (!openMatch) return null;
  const startIdx = openMatch.index;
  const divTokenPattern = /<(\/?)div\b[^>]*>/gi;
  divTokenPattern.lastIndex = openMatch.index + openMatch[0].length;

  let depth = 1;
  let endIdx = html.length;
  let token: RegExpExecArray | null;
  while ((token = divTokenPattern.exec(html)) !== null) {
    if (token[1] === '/') {
      depth -= 1;
    } else {
      depth += 1;
    }
    if (depth === 0) {
      endIdx = divTokenPattern.lastIndex;
      break;
    }
  }
  return html.slice(startIdx, endIdx);
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
  let stateCursor = 0;
  let refCursor = 0;

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
    .mockImplementation(() => undefined);

  return {
    render<T extends React.ReactNode>(renderFn: () => T): T {
      stateCursor = 0;
      refCursor = 0;
      return renderFn();
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

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  const sender = overrides.sender ?? 'City Power';
  return {
    id: overrides.id ?? 'item-1',
    source: overrides.source ?? 'email',
    sender,
    text: overrides.text ?? 'Your monthly electricity bill is ready.',
    attachments: overrides.attachments ?? [],
    receivedAt: overrides.receivedAt ?? '2026-11-20T09:00:00.000Z',
    group: overrides.group ?? 'Others',
    priority: overrides.priority ?? 'Social',
    summary: overrides.summary ?? {
      fromApp: 'From Email',
      whoSent: sender,
      actionNeeded: 'Review bill amount',
      text: `${sender} sent your monthly bill.`,
    },
    tier: overrides.tier ?? 1,
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? 'ok',
    ...overrides,
  };
}

describe('Task 2: Dedicated Scrollable Mail Layer & Custom Inbox Categories', () => {
  describe('categories helpers (src/lib/inbox/categories.ts)', () => {
    it('exports protected & default constants and checks isProtectedInboxCategory case-insensitively', () => {
      expect(PROTECTED_INBOX_CATEGORIES).toEqual(['All', 'Personal']);
      expect(DEFAULT_INBOX_CATEGORIES).toEqual([
        'Personal',
        'Family',
        'Others',
        'Promotion',
      ]);

      expect(isProtectedInboxCategory('All')).toBe(true);
      expect(isProtectedInboxCategory('all')).toBe(true);
      expect(isProtectedInboxCategory('  ALL  ')).toBe(true);
      expect(isProtectedInboxCategory('Personal')).toBe(true);
      expect(isProtectedInboxCategory('personal')).toBe(true);
      expect(isProtectedInboxCategory(' PERSONAL ')).toBe(true);

      expect(isProtectedInboxCategory('Family')).toBe(false);
      expect(isProtectedInboxCategory('Others')).toBe(false);
      expect(isProtectedInboxCategory('Promotion')).toBe(false);
      expect(isProtectedInboxCategory('Bills')).toBe(false);
      expect(isProtectedInboxCategory('')).toBe(false);
    });

    it('getVisibleInboxCategories matches default order when unset and always includes Personal and All', () => {
      expect(getVisibleInboxCategories(undefined)).toEqual([
        'Personal',
        'Family',
        'Others',
        'All',
        'Promotion',
      ]);
      expect(getVisibleInboxCategories(createDefaultSettings())).toEqual([
        'Personal',
        'Family',
        'Others',
        'All',
        'Promotion',
      ]);

      const emptyCats: Settings = {
        ...createDefaultSettings(),
        inboxCategories: [],
      };
      expect(getVisibleInboxCategories(emptyCats)).toEqual(['Personal', 'All']);

      const customCats: Settings = {
        ...createDefaultSettings(),
        inboxCategories: ['Personal', 'Family', 'Bills', 'All', 'bills'],
      };
      expect(getVisibleInboxCategories(customCats)).toEqual([
        'Personal',
        'Family',
        'Bills',
        'All',
      ]);
    });

    it('addInboxCategory adds trimmed custom names and rejects empty, duplicate, and >24 char names with plain language', () => {
      const base = createDefaultSettings();

      const added = addInboxCategory(base, '  Bills  ');
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      expect(added.category).toBe('Bills');
      expect(added.settings.inboxCategories).toContain('Bills');
      expect(added.settings.inboxCategories).toContain('Personal');
      expect(base.inboxCategories).toBeUndefined(); // immutable

      const emptyRes = addInboxCategory(base, '   ');
      expect(emptyRes.ok).toBe(false);
      if (!emptyRes.ok) {
        expect(emptyRes.errorMessage.length).toBeGreaterThan(0);
        expect(emptyRes.errorMessage).not.toMatch(BANNED_JARGON);
      }

      const dupCustom = addInboxCategory(added.settings, 'bills');
      expect(dupCustom.ok).toBe(false);
      if (!dupCustom.ok) {
        expect(dupCustom.errorMessage).not.toMatch(BANNED_JARGON);
      }

      const dupProtectedAll = addInboxCategory(base, 'all');
      expect(dupProtectedAll.ok).toBe(false);
      if (!dupProtectedAll.ok) {
        expect(dupProtectedAll.errorMessage).not.toMatch(BANNED_JARGON);
      }

      const dupProtectedPersonal = addInboxCategory(base, 'PERSONAL');
      expect(dupProtectedPersonal.ok).toBe(false);
      if (!dupProtectedPersonal.ok) {
        expect(dupProtectedPersonal.errorMessage).not.toMatch(BANNED_JARGON);
      }

      const tooLong = addInboxCategory(base, 'A'.repeat(25));
      expect(tooLong.ok).toBe(false);
      if (!tooLong.ok) {
        expect(tooLong.errorMessage).not.toMatch(BANNED_JARGON);
      }

      const exact24 = addInboxCategory(base, 'B'.repeat(24));
      expect(exact24.ok).toBe(true);
    });

    it('deleteInboxCategory rejects All and Personal, and deletes Family, Others, Promotion, and custom Bills cleanly', () => {
      const base = createDefaultSettings();

      for (const protectedName of ['All', 'all', 'Personal', 'PERSONAL']) {
        const res = deleteInboxCategory(base, protectedName);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.errorMessage).not.toMatch(BANNED_JARGON);
        }
      }

      const withBills = addInboxCategory(base, 'Bills');
      expect(withBills.ok).toBe(true);
      if (!withBills.ok) return;

      const delFamily = deleteInboxCategory(withBills.settings, 'Family');
      expect(delFamily.ok).toBe(true);
      if (!delFamily.ok) return;
      expect(getVisibleInboxCategories(delFamily.settings)).not.toContain(
        'Family'
      );

      const delOthers = deleteInboxCategory(delFamily.settings, 'Others');
      expect(delOthers.ok).toBe(true);
      if (!delOthers.ok) return;
      expect(getVisibleInboxCategories(delOthers.settings)).not.toContain(
        'Others'
      );

      const delPromo = deleteInboxCategory(delOthers.settings, 'Promotion');
      expect(delPromo.ok).toBe(true);
      if (!delPromo.ok) return;
      expect(getVisibleInboxCategories(delPromo.settings)).not.toContain(
        'Promotion'
      );

      const delBills = deleteInboxCategory(delPromo.settings, 'Bills');
      expect(delBills.ok).toBe(true);
      if (!delBills.ok) return;
      expect(getVisibleInboxCategories(delBills.settings)).toEqual([
        'Personal',
        'All',
      ]);
    });
  });

  describe('filterByTab custom category & built-in tab support', () => {
    it('filters custom category Bills as well as All, Personal, Family, Others, and Promotion', () => {
      const items: InboxItem[] = [
        makeItem({
          id: 'p1',
          group: 'Personal',
          priority: 'Important',
          receivedAt: '2026-11-20T10:00:00.000Z',
        }),
        makeItem({
          id: 'f1',
          group: 'Family',
          priority: 'Social',
          receivedAt: '2026-11-20T11:00:00.000Z',
        }),
        makeItem({
          id: 'o1',
          group: 'Others',
          priority: 'Social',
          receivedAt: '2026-11-20T08:00:00.000Z',
        }),
        makeItem({
          id: 'pr1',
          group: 'Others',
          priority: 'Promotion',
          receivedAt: '2026-11-20T12:00:00.000Z',
        }),
        makeItem({
          id: 'b1',
          group: 'Bills',
          priority: 'Social',
          receivedAt: '2026-11-20T09:00:00.000Z',
        }),
        makeItem({
          id: 'b2',
          group: 'Bills',
          priority: 'Important',
          receivedAt: '2026-11-20T07:00:00.000Z',
        }),
      ];

      expect(filterByTab(items, 'Bills').map((i) => i.id)).toEqual([
        'b2',
        'b1',
      ]);
      expect(filterByTab(items, 'Personal').map((i) => i.id)).toEqual(['p1']);
      expect(filterByTab(items, 'Family').map((i) => i.id)).toEqual(['f1']);
      expect(filterByTab(items, 'Others').map((i) => i.id)).toEqual([
        'pr1',
        'o1',
      ]);
      expect(filterByTab(items, 'Promotion').map((i) => i.id)).toEqual(['pr1']);
      expect(filterByTab(items, 'All')).toHaveLength(6);
    });
  });

  describe('UnifiedInboxPage dedicated scrollable mail layer & Manage Categories UI', () => {
    it('renders dedicated scrollable mail layer below category bar with zero <nav inside scroll pane and protects Personal & All from deletion', () => {
      const settingsWithBills: Settings = {
        ...createDefaultSettings(),
        inboxCategories: ['Personal', 'Family', 'Others', 'Promotion', 'Bills'],
      };
      const items = [
        makeItem({ id: 'msg-bill', group: 'Bills', sender: 'Water Utility' }),
      ];

      const html = renderToStaticMarkup(
        <UnifiedInboxPage
          initialSettings={settingsWithBills}
          initialItems={items}
          initialEvents={[]}
        />
      );

      // Dedicated scrollable mail layer exists cleanly below category nav
      const navIdx = html.indexOf('<nav aria-label="Inbox groups"');
      const scrollIdx = html.indexOf('data-mail-scroll-layer="true"');
      expect(navIdx).toBeGreaterThan(-1);
      expect(scrollIdx).toBeGreaterThan(navIdx);

      const scrollLayerHtml = extractMailScrollLayer(html);
      expect(scrollLayerHtml).not.toBeNull();
      expect(scrollLayerHtml!).toContain('overflow-y-auto');
      expect(scrollLayerHtml!).toContain('overscroll-contain');
      expect(scrollLayerHtml!).not.toContain('<nav');
      expect(scrollLayerHtml!).toContain('Water Utility');

      // Manage Categories panel: no Delete button for All or Personal; Delete <name> for all others
      expect(html).toContain('Manage Categories');
      expect(html).not.toContain('Delete All');
      expect(html).not.toContain('Delete Personal');
      expect(html).toContain('Delete Family');
      expect(html).toContain('Delete Others');
      expect(html).toContain('Delete Promotion');
      expect(html).toContain('Delete Bills');

      // Every button has min-h-[56px] and visible text
      const buttons = extractButtons(html);
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of buttons) {
        expect(btn).toContain('min-h-[56px]');
        expect(stripTags(btn).length).toBeGreaterThan(0);
      }

      // Every badge has aria-hidden="true" icon + visible text + border-2
      const badges = extractBadges(html);
      for (const badge of badges) {
        expect(badge).toContain('aria-hidden="true"');
        expect(badge).toContain('border-2');
        expect(stripTags(badge).length).toBeGreaterThan(0);
      }

      // Zero banned jargon
      expect(stripTags(html)).not.toMatch(BANNED_JARGON);
    });

    it('persists created/deleted categories via vault.saveSettings and per-card category move via vault.putItem', async () => {
      const vault = createVault({ dbName: 'test_triage_custom_categories_v1' });
      const initialSettings = createDefaultSettings();
      const item = makeItem({ id: 'move-item-1', group: 'Others' });
      await vault.saveSettings(initialSettings);
      await vault.putItem(item);

      const harness = createHookHarness();
      try {
        // 1. Add custom category "Bills"
        const tree1 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [item],
            initialEvents: [],
            vault,
          })
        );
        const nameInput = findElements(
          tree1,
          (el) => el.type === 'input' && el.props.id === 'new-inbox-category-input'
        )[0];
        expect(nameInput).toBeDefined();
        (
          nameInput.props.onChange as (e: { target: { value: string } }) => void
        )({ target: { value: 'Bills' } });

        const tree2 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [item],
            initialEvents: [],
            vault,
          })
        );
        const addForm = findElements(
          tree2,
          (el) =>
            el.type === 'form' &&
            el.props['aria-label'] === 'Add inbox category'
        )[0];
        expect(addForm).toBeDefined();
        (
          addForm.props.onSubmit as (e: { preventDefault: () => void }) => void
        )({ preventDefault: () => {} });
        await new Promise((r) => setTimeout(r, 15));

        const savedAfterAdd = await vault.getSettings();
        expect(savedAfterAdd.ok).toBe(true);
        if (savedAfterAdd.ok) {
          expect(savedAfterAdd.value.inboxCategories).toContain('Bills');
        }

        // 2. Move item to "Bills" via per-card category select
        const tree3 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [item],
            initialEvents: [],
            vault,
          })
        );
        const moveSelect = findElements(
          tree3,
          (el) =>
            el.type === 'select' &&
            el.props.id === 'inbox-move-category-move-item-1'
        )[0];
        expect(moveSelect).toBeDefined();
        (
          moveSelect.props.onChange as (e: {
            target: { value: string };
          }) => void
        )({ target: { value: 'Bills' } });
        await new Promise((r) => setTimeout(r, 15));

        const listedAfterMove = await vault.listItems();
        expect(listedAfterMove.ok).toBe(true);
        if (listedAfterMove.ok) {
          expect(listedAfterMove.value).toHaveLength(1);
          expect(listedAfterMove.value[0].group).toBe('Bills');
        }

        // 3. Delete "Family" category and verify persistence
        const tree4 = harness.render(() =>
          UnifiedInboxPage({
            initialSettings,
            initialItems: [item],
            initialEvents: [],
            vault,
          })
        );
        const deleteFamilyBtn = findElements(
          tree4,
          (el) => el.props['aria-label'] === 'Delete Family'
        )[0];
        expect(deleteFamilyBtn).toBeDefined();
        (deleteFamilyBtn.props.onClick as () => void)();
        await new Promise((r) => setTimeout(r, 15));

        const savedAfterDelete = await vault.getSettings();
        expect(savedAfterDelete.ok).toBe(true);
        if (savedAfterDelete.ok) {
          expect(savedAfterDelete.value.inboxCategories).not.toContain('Family');
          expect(savedAfterDelete.value.inboxCategories).toContain('Personal');
          expect(savedAfterDelete.value.inboxCategories).toContain('Bills');
        }
      } finally {
        harness.restore();
      }
    });
  });
});
