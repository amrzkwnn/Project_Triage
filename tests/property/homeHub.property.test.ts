import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type Channel,
  type DecisionTier,
  type InboxItem,
  type Settings,
  createDefaultSettings,
} from '@/lib/types';
import {
  HOME_SECTION_CARDS,
  countEnabledChannels,
  selectHomeDecisions,
} from '@/lib/home/decisions';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);

const inboxItemArb: fc.Arbitrary<InboxItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  source: channelArb,
  sender: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
    nil: undefined,
  }),
  text: fc.string({ minLength: 1, maxLength: 120 }),
  attachments: fc.constant([]),
  receivedAt: fc
    .integer({ min: 1700000000000, max: 1800000000000 })
    .map((ms) => new Date(ms).toISOString()),
  group: fc.constantFrom('Personal', 'Family', 'Others'),
  priority: fc.constantFrom('Important', 'Social', 'Promotion'),
  tier: fc.constantFrom<DecisionTier>(1, 2, 3),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  status: fc.constantFrom('ok', 'uncategorized-failed'),
});

const settingsChannelsArb: fc.Arbitrary<Settings> = fc
  .record({
    email: fc.boolean(),
    whatsappForward: fc.boolean(),
    smsPaste: fc.boolean(),
    messengerPaste: fc.boolean(),
    photos: fc.boolean(),
  })
  .chain((channels) =>
    fc.boolean().map((allowAiReading) => ({
      ...createDefaultSettings(),
      channels,
      allowAiReading,
    }))
  );

describe('Home Hub decision list and privacy pill properties', () => {
  it('defines the exact 5 Home Hub section cards in Requirement 2.1 order', () => {
    expect(HOME_SECTION_CARDS.map((c) => c.title)).toEqual([
      'Scam Shield',
      'Photo Helper',
      'Unified Inbox',
      'AI Media Check',
      'Calendar',
    ]);
    expect(HOME_SECTION_CARDS.map((c) => c.href)).toEqual([
      '/scam-shield',
      '/photo-helper',
      '/inbox',
      '/media-check',
      '/calendar',
    ]);
  });

  // Feature: senior-digital-companion, Property 27: Home Hub decision list
  it('Property 27: selects only Tier 2 & 3 items, orders Tier 3 first then oldest first, caps at 5 by default, and counts enabled channels', () => {
    fc.assert(
      fc.property(
        fc.array(inboxItemArb, { maxLength: 25 }),
        settingsChannelsArb,
        (items, settings) => {
          const defaultView = selectHomeDecisions(items, false);
          const expandedView = selectHomeDecisions(items, true);

          const expectedQualified = items.filter(
            (item) => item.tier === 2 || item.tier === 3
          );

          expect(defaultView.totalAwaiting).toBe(expectedQualified.length);
          expect(expandedView.totalAwaiting).toBe(expectedQualified.length);

          // No Tier 1 items may ever appear
          for (const item of expandedView.visible) {
            expect(item.tier === 2 || item.tier === 3).toBe(true);
          }

          // Ordering invariant: Tier 3 before Tier 2, and oldest first within each tier
          for (let i = 1; i < expandedView.visible.length; i += 1) {
            const prev = expandedView.visible[i - 1];
            const curr = expandedView.visible[i];
            if (prev.tier !== curr.tier) {
              expect(prev.tier).toBe(3);
              expect(curr.tier).toBe(2);
            } else {
              expect(Date.parse(prev.receivedAt)).toBeLessThanOrEqual(
                Date.parse(curr.receivedAt)
              );
            }
          }

          // Default visibility cap of 5 and reveal metadata
          if (expectedQualified.length === 0) {
            expect(defaultView.visible).toEqual([]);
            expect(defaultView.hasMore).toBe(false);
            expect(defaultView.remainingCount).toBe(0);
            expect(defaultView.emptyMessage).toBe(
              'Nothing needs your attention today'
            );
          } else if (expectedQualified.length > 5) {
            expect(defaultView.visible).toHaveLength(5);
            expect(defaultView.visible).toEqual(expandedView.visible.slice(0, 5));
            expect(defaultView.hasMore).toBe(true);
            expect(defaultView.remainingCount).toBe(
              expectedQualified.length - 5
            );
            expect(defaultView.emptyMessage).toBeUndefined();
          } else {
            expect(defaultView.visible).toHaveLength(expectedQualified.length);
            expect(defaultView.visible).toEqual(expandedView.visible);
            expect(defaultView.hasMore).toBe(false);
            expect(defaultView.remainingCount).toBe(0);
            expect(defaultView.emptyMessage).toBeUndefined();
          }

          // Expanded view shows every qualifying item
          expect(expandedView.visible).toHaveLength(expectedQualified.length);
          expect(expandedView.hasMore).toBe(false);
          expect(expandedView.remainingCount).toBe(0);

          // Privacy pill channel count equals exact number of enabled channels (0..5)
          const manualCount = ALL_CHANNELS.filter(
            (ch) => settings.channels[ch]
          ).length;
          const computedCount = countEnabledChannels(settings);
          expect(computedCount).toBe(manualCount);
          expect(computedCount).toBeGreaterThanOrEqual(0);
          expect(computedCount).toBeLessThanOrEqual(ALL_CHANNELS.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
