import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type Attachment,
  type Channel,
  type DetectedEvent,
  type FamilyMember,
  type GroupCategory,
  type InboxItem,
  type PriorityType,
} from '@/lib/types';
import { buildClaritySummary } from '@/lib/ai/summary';
import { classify } from '@/lib/inbox/classify';
import { availableForwardActions, detectEvent } from '@/lib/inbox/events';
import { filterByTab, filterPromotions, sortInbox } from '@/lib/inbox/order';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);
const groupArb: fc.Arbitrary<GroupCategory> = fc.constantFrom(
  'Personal',
  'Family',
  'Others'
);
const priorityArb: fc.Arbitrary<PriorityType> = fc.constantFrom(
  'Important',
  'Social',
  'Promotion'
);

const VALID_GROUPS = new Set<GroupCategory>(['Personal', 'Family', 'Others']);
const VALID_PRIORITIES = new Set<PriorityType>([
  'Important',
  'Social',
  'Promotion',
]);

const EXPECTED_FROM_APP: Record<Channel, string> = {
  email: 'From Email',
  whatsappForward: 'From WhatsApp',
  smsPaste: 'From SMS',
  messengerPaste: 'From Messenger',
  photos: 'From Photo',
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

const validDateStrArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 }))
  .chain(([y, m]) =>
    fc
      .integer({ min: 1, max: daysInMonth(y, m) })
      .map((d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`)
  );

const validTimeStrArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${pad(h, 2)}:${pad(m, 2)}`);

const familyMemberArb: fc.Arbitrary<FamilyMember> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 16 }),
  name: fc.constantFrom('Amina', 'Wei Ling', 'David Tan', 'Nurul', 'Uncle Lim'),
  address: fc.constantFrom(
    'amina@family.example',
    'weiling@family.example',
    'david@family.example',
    '+60123456789'
  ),
});

const inboxItemArb: fc.Arbitrary<InboxItem> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  source: channelArb,
  sender: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
    nil: undefined,
  }),
  text: fc.string({ minLength: 1, maxLength: 120 }),
  attachments: fc.constant([] as Attachment[]),
  receivedAt: fc
    .integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 })
    .map((ms) => new Date(ms).toISOString()),
  group: groupArb,
  priority: priorityArb,
  tier: fc.constantFrom(1, 2, 3),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  status: fc.constantFrom('ok', 'uncategorized-failed'),
});

describe('Inbox classification, ordering, clarity summary, and event detection', () => {
  // Feature: senior-digital-companion, Property 23: Classification is total and follows the rules
  it('Property 23: is total for arbitrary inputs and follows all five classification rules', () => {
    // 1. Totality for any arbitrary draft and family list
    fc.assert(
      fc.property(
        channelArb,
        fc.string({ minLength: 1, maxLength: 300 }),
        fc.option(fc.string({ minLength: 0, maxLength: 100 }), {
          nil: undefined,
        }),
        fc.array(familyMemberArb, { maxLength: 5 }),
        (source, text, sender, familyMembers) => {
          const res = classify({ source, text, sender }, { familyMembers });
          expect(VALID_GROUPS.has(res.group)).toBe(true);
          expect(VALID_PRIORITIES.has(res.priority)).toBe(true);
          expect(typeof res.scamWarning).toBe('boolean');
          expect(typeof res.proposeCheckScam).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );

    // 2. Rule 1: Clinic / doctor appointment email
    fc.assert(
      fc.property(
        fc.constantFrom('City Clinic', 'Dr. Tan', 'General Hospital', 'Medical Centre'),
        fc.constantFrom('appointment', 'checkup', 'visit'),
        validDateStrArb,
        validTimeStrArb,
        (clinicSender, apptWord, date, time) => {
          const res = classify({
            source: 'email',
            sender: clinicSender,
            text: `Reminder: your ${apptWord} is on ${date} at ${time}.`,
          });
          expect(res).toEqual({
            group: 'Personal',
            priority: 'Important',
            scamWarning: false,
            proposeCheckScam: false,
          });
        }
      ),
      { numRuns: 100 }
    );

    // 3. Rule 2: Saved family sender (urgent vs non-urgent, case-insensitive)
    fc.assert(
      fc.property(
        familyMemberArb,
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(
          'urgent',
          'emergency',
          'immediately',
          'right now',
          'hospital',
          'accident',
          'asap',
          'help me'
        ),
        fc.constantFrom(
          'Good morning, how are you?',
          'Bringing dinner over tonight',
          'Look at these garden photos',
          'Happy Sunday!'
        ),
        (member, useAddress, uppercaseSender, urgentWord, casualText) => {
          const rawSender = useAddress ? member.address : member.name;
          const sender = uppercaseSender
            ? rawSender.toUpperCase()
            : rawSender.toLowerCase();

          const casualRes = classify(
            { source: 'whatsappForward', sender, text: casualText },
            { familyMembers: [member] }
          );
          expect(casualRes).toEqual({
            group: 'Family',
            priority: 'Social',
            scamWarning: false,
            proposeCheckScam: false,
          });

          const urgentRes = classify(
            {
              source: 'whatsappForward',
              sender,
              text: `Please call me ${urgentWord}!`,
            },
            { familyMembers: [member] }
          );
          expect(urgentRes).toEqual({
            group: 'Family',
            priority: 'Important',
            scamWarning: false,
            proposeCheckScam: false,
          });
        }
      ),
      { numRuns: 100 }
    );

    // 4. Rule 3: Unknown sender with urgency + payment/link
    fc.assert(
      fc.property(
        fc.constantFrom('urgent', 'immediately', 'right now', 'asap', 'emergency'),
        fc.constantFrom(
          'https://pay-now.example/verify',
          'http://bank-alert.example',
          'pay $250 fee',
          'transfer RM500 to this bank',
          'verify account with a gift card'
        ),
        (urgentWord, paymentPhrase) => {
          const res = classify(
            {
              source: 'smsPaste',
              sender: 'Unknown Number',
              text: `${urgentWord}: please ${paymentPhrase}`,
            },
            {
              familyMembers: [
                { id: 'f1', name: 'Amina', address: 'amina@family.example' },
              ],
            }
          );
          expect(res).toEqual({
            group: 'Others',
            priority: 'Important',
            scamWarning: true,
            proposeCheckScam: true,
          });
        }
      ),
      { numRuns: 100 }
    );

    // 5. Rule 4 & Rule 5: Promotional vs Default
    fc.assert(
      fc.property(
        fc.constantFrom(
          'unsubscribe',
          'sale',
          '50% off',
          'discount',
          'promo',
          'newsletter',
          'limited time offer',
          'deal'
        ),
        (promoWord) => {
          const promoRes = classify({
            source: 'email',
            sender: 'store@example.com',
            text: `Spring ${promoWord} on fresh groceries this week.`,
          });
          expect(promoRes).toEqual({
            group: 'Others',
            priority: 'Promotion',
            scamWarning: false,
            proposeCheckScam: false,
          });

          const defaultRes = classify({
            source: 'smsPaste',
            sender: 'Neighbor',
            text: 'The parcel was left by the front gate.',
          });
          expect(defaultRes).toEqual({
            group: 'Others',
            priority: 'Social',
            scamWarning: false,
            proposeCheckScam: false,
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 24: Inbox ordering and filtering
  it('Property 24: orders Important first then recency descending, and filters by tab and promotions', () => {
    const tabArb = fc.constantFrom<'Personal' | 'Family' | 'Others' | 'All'>(
      'Personal',
      'Family',
      'Others',
      'All'
    );

    fc.assert(
      fc.property(
        fc.array(inboxItemArb, { maxLength: 40 }),
        tabArb,
        (items, tab) => {
          const snapshot = items.map((item) => ({ ...item }));
          const sorted = sortInbox(items);

          // Input not mutated and all items preserved
          expect(items).toEqual(snapshot);
          expect(sorted.length).toBe(items.length);
          for (const item of items) {
            expect(sorted).toContainEqual(item);
          }

          // Important items precede all non-Important items; within each bucket, receivedAt descending
          let seenNonImportant = false;
          for (let i = 0; i < sorted.length; i += 1) {
            const curr = sorted[i];
            if (curr.priority !== 'Important') {
              seenNonImportant = true;
            } else {
              expect(seenNonImportant).toBe(false);
            }

            if (i > 0) {
              const prev = sorted[i - 1];
              const sameBucket =
                (prev.priority === 'Important') ===
                (curr.priority === 'Important');
              if (sameBucket) {
                expect(Date.parse(prev.receivedAt)).toBeGreaterThanOrEqual(
                  Date.parse(curr.receivedAt)
                );
              }
            }
          }

          // filterByTab
          const tabbed = filterByTab(items, tab);
          const expectedTab =
            tab === 'All' ? sorted : sorted.filter((i) => i.group === tab);
          expect(tabbed).toEqual(expectedTab);

          // filterPromotions
          const promos = filterPromotions(items);
          expect(promos.every((p) => p.priority === 'Promotion')).toBe(true);
          expect(promos.length).toBe(
            items.filter((i) => i.priority === 'Promotion').length
          );
          for (let i = 1; i < promos.length; i += 1) {
            expect(Date.parse(promos[i - 1].receivedAt)).toBeGreaterThanOrEqual(
              Date.parse(promos[i].receivedAt)
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 25: Clarity summary shape
  it('Property 25: builds ClaritySummary with human-readable app, sender, actionNeeded, and 1-2 plain sentences (1..300 chars)', () => {
    const detectedEventArb: fc.Arbitrary<DetectedEvent> = fc.record({
      date: validDateStrArb,
      time: validTimeStrArb,
      title: fc.string({ minLength: 1, maxLength: 60 }).map((s) => s.trim() || 'Clinic visit'),
    });

    fc.assert(
      fc.property(
        channelArb,
        fc.option(fc.string({ minLength: 0, maxLength: 256 }), {
          nil: undefined,
        }),
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 600 }),
          fc.constantFrom(
            '   ',
            '...',
            'One. Two. Three. Four. Five.',
            'Hello! Are you coming? Please reply. Thanks! See you.'
          )
        ),
        fc.option(detectedEventArb, { nil: undefined }),
        fc.boolean(),
        (source, sender, text, detectedEvent, scamWarning) => {
          const summary = buildClaritySummary(
            { source, sender, text },
            { detectedEvent, scamWarning }
          );

          expect(summary.fromApp).toBe(EXPECTED_FROM_APP[source]);

          const trimmedSender = sender?.trim() ?? '';
          expect(summary.whoSent).toBe(
            trimmedSender.length > 0 ? trimmedSender : 'Unknown sender'
          );

          if (scamWarning) {
            expect(summary.actionNeeded.toLowerCase()).toContain('scam');
          } else if (detectedEvent) {
            expect(summary.actionNeeded.toLowerCase()).toContain('calendar');
          } else {
            expect(summary.actionNeeded).toBe('No action needed');
          }

          expect(summary.text.length).toBeGreaterThanOrEqual(1);
          expect(summary.text.length).toBeLessThanOrEqual(300);

          const sentences = summary.text
            .split(/[.!?]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          expect(sentences.length).toBeGreaterThanOrEqual(1);
          expect(sentences.length).toBeLessThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );

    // Unrecognized / Object.prototype-key sources fall back cleanly to 'From Message'
    for (const badSource of ['constructor', '__proto__', 'toString', 'valueOf']) {
      const summary = buildClaritySummary({
        source: badSource,
        text: 'Hello there',
      });
      expect(summary.fromApp).toBe('From Message');
    }
  });

  // Feature: senior-digital-companion, Property 26: Event detection and action visibility
  it('Property 26: detects events only for real YYYY-MM-DD + HH:mm without UTC conversion and computes exact forward actions', () => {
    // 1. Valid date + valid time -> detects exact date & time verbatim
    fc.assert(
      fc.property(
        validDateStrArb,
        validTimeStrArb,
        fc.constantFrom('Clinic checkup', 'Family dinner', 'Dental visit'),
        fc.option(
          fc.constantFrom('City Clinic', 'Room 4B', 'Main Hall'),
          { nil: undefined }
        ),
        (date, time, titlePrefix, location) => {
          const locClause = location ? ` Location: ${location}.` : '';
          const text = `${titlePrefix} on ${date} at ${time}.${locClause}`;
          const detected = detectEvent(text);

          expect(detected).toBeDefined();
          if (!detected) return;
          expect(detected.date).toBe(date);
          expect(detected.time).toBe(time);
          expect(detected.title.length).toBeGreaterThanOrEqual(1);
          expect(detected.title.length).toBeLessThanOrEqual(100);
          if (location) {
            expect(detected.location).toBe(location);
          }
        }
      ),
      { numRuns: 100 }
    );

    // 2. Invalid dates, invalid/embedded times, or missing date/time -> undefined
    const invalidEventTextArb = fc.oneof(
      // Impossible calendar dates with valid time
      fc
        .constantFrom('2025-02-29', '2025-04-31', '2025-13-01', '2025-00-10', '0000-01-01')
        .map((badDate) => `Appointment on ${badDate} at 09:30`),
      // Invalid or embedded times with valid date
      fc
        .constantFrom('24:00', '25:30', '99:00', '12:60', '123:45', '09:305', '24:00:15')
        .map((badTime) => `Appointment on 2025-06-15 at ${badTime}`),
      // Date only (no time)
      validDateStrArb.map((date) => `Reminder for ${date} only`),
      // Time only (no date)
      validTimeStrArb.map((time) => `Call me at ${time}`)
    );

    fc.assert(
      fc.property(invalidEventTextArb, (text) => {
        expect(detectEvent(text)).toBeUndefined();
      }),
      { numRuns: 100 }
    );

    // 3. availableForwardActions visibility rules
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        validDateStrArb,
        validTimeStrArb,
        (hasEvent, hasLink, hasImage, date, time) => {
          const text = hasLink
            ? 'Check details at https://example.org/info'
            : 'Just a regular text message without links';
          const attachments: Attachment[] = hasImage
            ? [{ id: 'a1', mime: 'image/jpeg', name: 'photo.jpg' }]
            : [{ id: 'a2', mime: 'application/pdf', name: 'doc.pdf' }];
          const detectedEvent: DetectedEvent | undefined = hasEvent
            ? { date, time, title: 'Clinic checkup' }
            : undefined;

          const actions = availableForwardActions(
            { text, attachments },
            detectedEvent
          );

          expect(actions.includes('forwardToCalendar')).toBe(hasEvent);
          expect(actions.includes('checkScam')).toBe(hasLink);
          expect(actions.includes('checkAiImage')).toBe(hasImage);
          expect(actions.includes('shareWithFamily')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
