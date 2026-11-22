import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UnifiedInboxPage } from '@/app/inbox/page';
import { DecisionConfirmCard } from '@/components/DecisionConfirmCard';
import { processEmailBatch } from '@/lib/inbox/emailChannel';
import { saveItemToCategoryLocally } from '@/lib/inbox/itemActions';
import { parseSenderDisplay } from '@/lib/inbox/sender';
import { createDefaultSettings, type InboxItem } from '@/lib/types';
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

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'sender-item-1',
    source: 'email',
    sender: '"City Clinic" <appointments@cityclinic.org>',
    text: 'Your appointment is tomorrow.',
    attachments: [],
    receivedAt: '2026-11-20T09:00:00.000Z',
    group: 'Others',
    priority: 'Important',
    summary: {
      fromApp: 'From Email',
      whoSent: 'City Clinic',
      actionNeeded: 'Confirm visit',
      text: 'City Clinic reminded you about tomorrow.',
    },
    tier: 2,
    confidence: 0.9,
    status: 'ok',
    ...overrides,
  };
}

function findElements(
  node: React.ReactNode,
  predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean,
  acc: React.ReactElement<Record<string, unknown>>[] = []
): React.ReactElement<Record<string, unknown>>[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, acc);
    return acc;
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (predicate(el)) acc.push(el);
    if (el.props && 'children' in el.props) {
      findElements(el.props.children as React.ReactNode, predicate, acc);
    }
  }
  return acc;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean')
    return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) {
    return textOf(
      (node.props as { children?: React.ReactNode }).children as React.ReactNode
    );
  }
  return '';
}

describe('Task 2: sender email + Save to category', () => {
  describe('parseSenderDisplay', () => {
    it('splits quoted name and email', () => {
      expect(
        parseSenderDisplay(
          '"City Clinic" <appointments@cityclinic.org>',
          'City Clinic'
        )
      ).toEqual({
        displayName: 'City Clinic',
        emailAddress: 'appointments@cityclinic.org',
      });
    });
    it('does not duplicate a bare email address', () => {
      expect(
        parseSenderDisplay('grandma@gmail.com', 'grandma@gmail.com')
      ).toEqual({ displayName: 'grandma@gmail.com', emailAddress: undefined });
    });
    it('keeps parentheses in the name', () => {
      expect(parseSenderDisplay('Dr. Tan (Clinic) <dr.tan@clinic.sg>')).toEqual(
        { displayName: 'Dr. Tan (Clinic)', emailAddress: 'dr.tan@clinic.sg' }
      );
    });
    it('handles plain names', () => {
      expect(parseSenderDisplay('Mei Ling', 'Mei Ling')).toEqual({
        displayName: 'Mei Ling',
        emailAddress: undefined,
      });
    });
    it('falls back to senderEmail', () => {
      expect(parseSenderDisplay(undefined, undefined, 'care@clinic.sg')).toEqual(
        { displayName: 'care@clinic.sg', emailAddress: undefined }
      );
    });
  });

  it('processEmailBatch populates senderEmail from From header', async () => {
    const vault = createVault({ dbName: 'test_sender_email_batch_v1' });
    const settings = {
      ...createDefaultSettings(),
      channels: { ...createDefaultSettings().channels, email: true },
      allowAiReading: false,
    };
    await vault.saveSettings(settings);
    const res = await processEmailBatch({
      settings,
      tokenStatus: 'valid',
      vault,
      emails: [
        {
          id: 'em-1',
          from: 'City Clinic <appointments@cityclinic.org>',
          subject: 'Visit',
          body: 'Your doctor appointment is on 2026-07-20 at 14:00.',
          receivedAt: '2026-07-10T11:05:00.000Z',
        },
      ],
    });
    expect(res.processed).toHaveLength(1);
    expect(res.processed[0].senderEmail).toBe('appointments@cityclinic.org');
  });

  describe('saveItemToCategoryLocally', () => {
    it('rejects All and empty categories', async () => {
      const item = makeItem();
      for (const category of ['All', '']) {
        const res = await saveItemToCategoryLocally({ item, category });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.errorMessage.length).toBeGreaterThan(0);
          expect(res.errorMessage).not.toMatch(BANNED_JARGON);
        }
      }
    });

    it('saves group and homeHandled atomically without duplicates', async () => {
      const vault = createVault({ dbName: 'test_save_to_category_v1' });
      const item = makeItem();
      await vault.putItem(item);
      const res = await saveItemToCategoryLocally({
        item,
        category: 'Bills',
        markHomeHandled: true,
        vault,
      });
      expect(res.ok).toBe(true);
      const listed = await vault.listItems();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value).toHaveLength(1);
        expect(listed.value[0].group).toBe('Bills');
        expect(listed.value[0].homeHandled).toBe(true);
      }
    });

    it('rolls back when putItem fails after deleteItem', async () => {
      const item = makeItem();
      const putItem = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          error: { message: 'Could not store the item (exception).' },
        })
        .mockResolvedValueOnce({ ok: true, value: undefined });
      const deleteItem = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      const res = await saveItemToCategoryLocally({
        item,
        category: 'Bills',
        vault: { putItem, deleteItem } as never,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorMessage).not.toMatch(BANNED_JARGON);
      }
      expect(putItem).toHaveBeenCalledTimes(2);
      expect(putItem.mock.calls[1][0]).toEqual(item);
    });
  });

  describe('UnifiedInboxPage', () => {
    it('shows sender email and Save to, hides Forward Summary on Tier 2', () => {
      const html = renderToStaticMarkup(
        <UnifiedInboxPage
          initialSettings={{
            ...createDefaultSettings(),
            caregiverShareEnabled: true,
          }}
          initialItems={[makeItem()]}
          initialEvents={[]}
        />
      );
      expect(html).toContain('appointments@cityclinic.org');
      expect(html).toContain('data-sender-email="true"');
      expect(html).toContain('Save to');
      expect(html).not.toContain('Forward Summary to Family');
      expect(stripTags(html)).not.toMatch(BANNED_JARGON);
      const buttons = html.match(/<button\b[^>]*>/gi) ?? [];
      for (const b of buttons) expect(b).toContain('min-h-[56px]');
    });
  });

  describe('DecisionConfirmCard', () => {
    it('renders sender email and Save to button', () => {
      const html = renderToStaticMarkup(
        <DecisionConfirmCard
          actionId="a1"
          tier={2}
          title="City Clinic"
          summary="Please confirm"
          senderEmail="appointments@cityclinic.org"
          saveCategories={['Personal', 'Bills']}
          currentCategory="Personal"
          onSaveToCategory={() => undefined}
          onConfirm={() => undefined}
          onDismiss={() => undefined}
        />
      );
      expect(html).toContain('data-sender-email="true"');
      expect(html).toContain('appointments@cityclinic.org');
      expect(html).toContain('Save to');
    });

    it('toggles chooser and calls onSaveToCategory', () => {
      const slots: unknown[] = [];
      let cursor = 0;
      const stateSpy = vi.spyOn(React, 'useState').mockImplementation(((
        init: unknown
      ) => {
        const idx = cursor++;
        if (!(idx in slots)) slots[idx] = init;
        return [
          slots[idx],
          (next: unknown) => {
            slots[idx] =
              typeof next === 'function'
                ? (next as (p: unknown) => unknown)(slots[idx])
                : next;
          },
        ];
      }) as typeof React.useState);
      const effectSpy = vi
        .spyOn(React, 'useEffect')
        .mockImplementation(() => undefined);
      try {
        const onSave = vi.fn();
        const card = DecisionConfirmCard({
          actionId: 'a1',
          tier: 2,
          summary: 'Please confirm',
          saveCategories: ['Personal', 'Bills'],
          currentCategory: 'Personal',
          onSaveToCategory: onSave,
          onConfirm: () => undefined,
          onDismiss: () => undefined,
        });
        const pickerEl = findElements(card, (el) => 'categories' in el.props)[0];
        expect(pickerEl).toBeDefined();
        const render = () => {
          cursor = 0;
          return (pickerEl.type as (p: unknown) => React.ReactNode)(
            pickerEl.props
          );
        };
        const tree1 = render();
        const saveBtn = findElements(
          tree1,
          (el) => textOf(el.props.children as React.ReactNode).trim() === 'Save to'
        ).find((el) => typeof el.props.onClick === 'function');
        expect(saveBtn).toBeDefined();
        (saveBtn!.props.onClick as () => void)();
        const tree2 = render();
        const region = findElements(
          tree2,
          (el) => el.props['aria-label'] === 'Choose a category to save to'
        );
        expect(region).toHaveLength(1);
        const billsBtn = findElements(
          tree2,
          (el) =>
            typeof el.props.onClick === 'function' &&
            textOf(el.props.children as React.ReactNode).trim() === 'Bills'
        )[0];
        expect(billsBtn).toBeDefined();
        (billsBtn.props.onClick as () => void)();
        expect(onSave).toHaveBeenCalledWith('Bills');
      } finally {
        effectSpy.mockRestore();
        stateSpy.mockRestore();
      }
    });
  });
});
