import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
  formatPlainDate,
  formatPlainTime,
  parsePlainDate,
  parsePlainTime,
} from '@/lib/calendar/dates';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

const validDateTripleArb = fc
  .tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 12 }))
  .chain(([year, month]) =>
    fc
      .integer({ min: 1, max: daysInMonth(year, month) })
      .map((day) => ({ year, month, day }))
  );

const validTimePairArb = fc.record({
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
});

const JARGON_PATTERN =
  /\b(iso|regex|temporal|exception|stack|error code|invalid_date|nan|undefined|null|parse)\b/i;

describe('Plain date and time handling', () => {
  // Feature: senior-digital-companion, Property 15: Plain date round trip
  it('Property 15: round-trips any valid calendar date across years 0001..9999', () => {
    fc.assert(
      fc.property(validDateTripleArb, ({ year, month, day }) => {
        const expected = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
        const parsed = parsePlainDate(expected);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.value).toBeInstanceOf(Temporal.PlainDate);
        expect(parsed.value.year).toBe(year);
        expect(parsed.value.month).toBe(month);
        expect(parsed.value.day).toBe(day);

        const formatted = formatPlainDate(parsed.value);
        expect(formatted).toBe(expected);

        const reparsed = parsePlainDate(formatted);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
          expect(Temporal.PlainDate.compare(reparsed.value, parsed.value)).toBe(
            0
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it('round-trips boundary and leap-day dates verbatim', () => {
    const edgeDates = ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'];
    for (const iso of edgeDates) {
      const parsed = parsePlainDate(iso);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(formatPlainDate(parsed.value)).toBe(iso);
      }
    }
  });

  // Feature: senior-digital-companion, Property 16: Invalid dates are rejected
  it('Property 16: rejects malformed and impossible dates and leaves stored date unchanged', () => {
    const impossibleDateArb = fc.oneof(
      // Feb 29 on a non-leap year
      fc
        .integer({ min: 1, max: 9999 })
        .filter((y) => !isLeapYear(y))
        .map((y) => `${pad(y, 4)}-02-29`),
      // Feb 30 or 31
      fc
        .tuple(fc.integer({ min: 1, max: 9999 }), fc.constantFrom(30, 31))
        .map(([y, d]) => `${pad(y, 4)}-02-${pad(d, 2)}`),
      // 30-day months with day 31
      fc
        .tuple(
          fc.integer({ min: 1, max: 9999 }),
          fc.constantFrom(4, 6, 9, 11)
        )
        .map(([y, m]) => `${pad(y, 4)}-${pad(m, 2)}-31`),
      // Month out of range (00 or 13..99)
      fc
        .tuple(
          fc.integer({ min: 1, max: 9999 }),
          fc.oneof(fc.constant(0), fc.integer({ min: 13, max: 99 })),
          fc.integer({ min: 1, max: 28 })
        )
        .map(([y, m, d]) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`),
      // Day out of range (00 or 32..99)
      fc
        .tuple(
          fc.integer({ min: 1, max: 9999 }),
          fc.integer({ min: 1, max: 12 }),
          fc.oneof(fc.constant(0), fc.integer({ min: 32, max: 99 }))
        )
        .map(([y, m, d]) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`),
      // Year 0000
      fc
        .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
        .map(([m, d]) => `0000-${pad(m, 2)}-${pad(d, 2)}`),
      // Malformed formats
      fc.constantFrom(
        '2025-2-3',
        '2025/02/03',
        '2025-02-03T10:00:00Z',
        ' 2025-02-03',
        '2025-02-03 ',
        '02-03-2025',
        '25-02-03',
        'not-a-date',
        '',
        '2025-02-03 extra'
      ),
      // Arbitrary strings that don't match strict YYYY-MM-DD
      fc.string().filter((s) => !/^\d{4}-\d{2}-\d{2}$/.test(s))
    );

    fc.assert(
      fc.property(
        validDateTripleArb,
        impossibleDateArb,
        ({ year, month, day }, badDate) => {
          const initial = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
          let storedDate = initial;

          const result = parsePlainDate(badDate);
          if (result.ok) {
            storedDate = formatPlainDate(result.value);
          }

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.code).toBe('invalid-date');
          expect(result.error.message.trim().length).toBeGreaterThan(0);
          expect(result.error.message.toLowerCase()).toMatch(/date/);
          expect(result.error.message).not.toMatch(JARGON_PATTERN);
          expect(storedDate).toBe(initial);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('round-trips valid HH:mm times across 00:00..23:59', () => {
    fc.assert(
      fc.property(validTimePairArb, ({ hour, minute }) => {
        const expected = `${pad(hour, 2)}:${pad(minute, 2)}`;
        const parsed = parsePlainTime(expected);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.value).toBeInstanceOf(Temporal.PlainTime);
        expect(parsed.value.hour).toBe(hour);
        expect(parsed.value.minute).toBe(minute);
        expect(formatPlainTime(parsed.value)).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects malformed and out-of-range times', () => {
    const invalidTimeArb = fc.oneof(
      fc.constantFrom(
        '24:00',
        '25:00',
        '12:60',
        '9:05',
        '09:5',
        '12:30:00',
        '12:30 PM',
        '',
        'noon',
        ' 09:00',
        '09:00 '
      ),
      fc
        .tuple(fc.integer({ min: 24, max: 99 }), fc.integer({ min: 0, max: 59 }))
        .map(([h, m]) => `${pad(h, 2)}:${pad(m, 2)}`),
      fc
        .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 60, max: 99 }))
        .map(([h, m]) => `${pad(h, 2)}:${pad(m, 2)}`),
      fc.string().filter((s) => !/^\d{2}:\d{2}$/.test(s))
    );

    fc.assert(
      fc.property(invalidTimeArb, (badTime) => {
        const result = parsePlainTime(badTime);
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe('invalid-time');
        expect(result.error.message.trim().length).toBeGreaterThan(0);
        expect(result.error.message.toLowerCase()).toMatch(/time/);
        expect(result.error.message).not.toMatch(JARGON_PATTERN);
      }),
      { numRuns: 100 }
    );
  });
});
