import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_CATEGORIES,
  CALENDAR_CATEGORY_META,
  getCategoryMeta,
} from '@/lib/calendar/categories';
import { formatPlainDate, parsePlainDate } from '@/lib/calendar/dates';
import {
  extractCalendarCandidatesFromText,
  type Candidate,
} from '@/lib/calendar/ocr';
import {
  LEAD_MS,
  planReminder,
  ReminderScheduler,
  reminderTime,
} from '@/lib/calendar/reminders';
import {
  canKeepCandidate,
  candidateState,
  isDuplicateEvent,
  normalizeTitle,
  reviewCandidates,
} from '@/lib/calendar/snap';
import {
  renderEventDateAndTime,
  viewMonth,
  viewToday,
  viewWeek,
} from '@/lib/calendar/views';
import {
  LOW_CONFIDENCE_THRESHOLD,
  type CalendarCategory,
  type CalendarEvent,
  type ReminderLead,
} from '@/lib/types';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const IANA_TIME_ZONES = [
  'Asia/Kuala_Lumpur',
  'America/New_York',
  'Pacific/Auckland',
  'UTC',
  'Europe/London',
  'Asia/Tokyo',
  'America/Los_Angeles',
] as const;

const REMINDER_LEADS: readonly ReminderLead[] = [
  '15m',
  '30m',
  '1h',
  '2h',
  '1d',
];

const categoryArb: fc.Arbitrary<CalendarCategory> = fc.constantFrom(
  ...CALENDAR_CATEGORIES
);

const validDateStrArb = fc
  .tuple(fc.integer({ min: 2020, max: 2035 }), fc.integer({ min: 1, max: 12 }))
  .chain(([year, month]) =>
    fc
      .integer({ min: 1, max: daysInMonth(year, month) })
      .map((day) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`)
  );

const validTimeStrArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([hour, minute]) => `${pad(hour, 2)}:${pad(minute, 2)}`);

const titleArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .map((s) => s.replace(/[\r\n]/g, ' ').trim())
  .filter((s) => s.length > 0);

const createdAtArb = fc
  .tuple(
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.constantFrom(0, 1, 50, 500, 999),
    fc.boolean()
  )
  .map(([sec, ms, useDateIso]) => {
    const epochMs = 1_700_000_000_000 + sec * 1000 + ms;
    return useDateIso
      ? new Date(epochMs).toISOString()
      : Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
  });

function compareIsoInstants(a: string, b: string): number {
  try {
    return Temporal.Instant.compare(
      Temporal.Instant.from(a),
      Temporal.Instant.from(b)
    );
  } catch {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
}

function expectedFormattedTime(
  timeStr: string | undefined,
  timeFormat: '12h' | '24h'
): string {
  const effective = timeStr ?? '09:00';
  const hour = Number(effective.slice(0, 2));
  const minute = Number(effective.slice(3, 5));
  if (timeFormat === '24h') {
    return `${pad(hour, 2)}:${pad(minute, 2)}`;
  }
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad(minute, 2)} ${period}`;
}

function isSortedByTimeAndCreatedAt(events: readonly CalendarEvent[]): boolean {
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const curr = events[i];
    const prevTime = prev.time ?? '23:59';
    const currTime = curr.time ?? '23:59';
    if (prevTime > currTime) return false;
    if (
      prevTime === currTime &&
      compareIsoInstants(prev.createdAt, curr.createdAt) > 0
    ) {
      return false;
    }
  }
  return true;
}

describe('Calendar views, categories, snap review, duplicates & reminders', () => {
  it('defines all four calendar categories with icon, label, and color metadata', () => {
    expect(CALENDAR_CATEGORIES).toEqual([
      'Medical',
      'Family & Social',
      'Bills & Errands',
      'Daily Routine',
    ]);

    for (const category of CALENDAR_CATEGORIES) {
      const meta = getCategoryMeta(category);
      expect(meta).toEqual(CALENDAR_CATEGORY_META[category]);
      expect(meta.label).toBe(category);
      expect(meta.iconName.trim().length).toBeGreaterThan(0);
      expect(meta.badgeClass.trim().length).toBeGreaterThan(0);
      expect(meta.borderClass.trim().length).toBeGreaterThan(0);
    }
  });

  // Feature: senior-digital-companion, Property 17: Time zone invariance
  it('Property 17: renders identical stored date and time strings across any two time zones', () => {
    fc.assert(
      fc.property(
        validDateStrArb,
        fc.option(validTimeStrArb, { nil: undefined }),
        fc.constantFrom(...IANA_TIME_ZONES),
        fc.constantFrom(...IANA_TIME_ZONES),
        (date, time, tzA, tzB) => {
          const event = time !== undefined ? { date, time } : { date };
          const renderedA = renderEventDateAndTime(event, tzA);
          const renderedB = renderEventDateAndTime(event, tzB);

          expect(renderedA).toEqual(renderedB);
          expect(renderedA.date).toBe(date);
          expect(renderedA.time).toBe(time);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 36: Calendar views ordering
  it('Property 36: orders Today, This Week, and Month List views accurately without mutating input', () => {
    const anchorDateArb = validDateStrArb.map((d) => Temporal.PlainDate.from(d));

    const eventsNearAnchorArb = anchorDateArb.chain((today) =>
      fc
        .array(
          fc.record({
            id: fc.uuid(),
            title: titleArb,
            dayOffset: fc.integer({ min: -10, max: 40 }),
            time: fc.option(validTimeStrArb, { nil: undefined }),
            category: categoryArb,
            createdAt: createdAtArb,
          }),
          { minLength: 0, maxLength: 30 }
        )
        .map((rows) => {
          const events: CalendarEvent[] = rows.map((row) => ({
            id: row.id,
            title: row.title,
            date: formatPlainDate(today.add({ days: row.dayOffset })),
            ...(row.time !== undefined ? { time: row.time } : {}),
            category: row.category,
            createdAt: row.createdAt,
          }));
          return { today, events };
        })
    );

    fc.assert(
      fc.property(eventsNearAnchorArb, ({ today, events }) => {
        const snapshot = events.map((e) => ({ ...e }));
        const todayStr = formatPlainDate(today);

        // Today view
        const todayEvents = viewToday(events, today);
        const expectedTodayIds = new Set(
          events.filter((e) => e.date === todayStr).map((e) => e.id)
        );
        expect(todayEvents.length).toBe(expectedTodayIds.size);
        for (const ev of todayEvents) {
          expect(ev.date).toBe(todayStr);
          expect(expectedTodayIds.has(ev.id)).toBe(true);
        }
        expect(isSortedByTimeAndCreatedAt(todayEvents)).toBe(true);

        // This Week view (today + next 6 days = 7 days)
        const weekGroups = viewWeek(events, today);
        expect(weekGroups).toHaveLength(7);
        for (let offset = 0; offset < 7; offset += 1) {
          const group = weekGroups[offset];
          const expectedDay = today.add({ days: offset });
          const expectedDateStr = formatPlainDate(expectedDay);

          expect(Temporal.PlainDate.compare(group.day, expectedDay)).toBe(0);
          expect(group.dateStr).toBe(expectedDateStr);

          const matching = events.filter((e) => e.date === expectedDateStr);
          expect(group.events).toHaveLength(matching.length);
          expect(isSortedByTimeAndCreatedAt(group.events)).toBe(true);

          if (matching.length === 0) {
            expect(group.emptyLabel).toBe('Nothing planned');
          } else {
            expect(group.emptyLabel).toBeUndefined();
          }
        }

        // Month List view (only days with >= 1 event in ym, chronological)
        const ym = today.toPlainYearMonth();
        const monthGroups = viewMonth(events, ym);
        let monthEventTotal = 0;

        for (let i = 0; i < monthGroups.length; i += 1) {
          const group = monthGroups[i];
          expect(group.day.year).toBe(ym.year);
          expect(group.day.month).toBe(ym.month);
          expect(group.dateStr).toBe(formatPlainDate(group.day));
          expect(group.events.length).toBeGreaterThan(0);
          expect(isSortedByTimeAndCreatedAt(group.events)).toBe(true);
          for (const ev of group.events) {
            expect(ev.date).toBe(group.dateStr);
          }
          if (i > 0) {
            expect(
              Temporal.PlainDate.compare(monthGroups[i - 1].day, group.day)
            ).toBe(-1);
          }
          monthEventTotal += group.events.length;
        }

        const expectedMonthCount = events.filter((e) => {
          const parsed = parsePlainDate(e.date);
          return (
            parsed.ok &&
            parsed.value.year === ym.year &&
            parsed.value.month === ym.month
          );
        }).length;
        expect(monthEventTotal).toBe(expectedMonthCount);

        // Input immutability
        expect(events).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 37: Candidate review and low confidence
  it('Property 37: rejects low-confidence pages, flags low-confidence candidates, and blocks unconfirmed keeps', () => {
    const candidateArb: fc.Arbitrary<Candidate> = fc.record({
      id: fc.uuid(),
      title: titleArb,
      date: validDateStrArb,
      time: fc.option(validTimeStrArb, { nil: undefined }),
      category: categoryArb,
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      dateConfirmed: fc.option(fc.boolean(), { nil: undefined }),
    });

    const existingEventArb: fc.Arbitrary<CalendarEvent> = fc.record({
      id: fc.uuid(),
      title: titleArb,
      date: validDateStrArb,
      time: fc.option(validTimeStrArb, { nil: undefined }),
      category: categoryArb,
      createdAt: createdAtArb,
    });

    fc.assert(
      fc.property(
        fc.array(existingEventArb, { maxLength: 5 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(candidateArb, { minLength: 1, maxLength: 12 }),
        fc.array(
          fc.record({
            decision: fc.constantFrom('keep', 'skip', 'keep-both') as fc.Arbitrary<
              'keep' | 'skip' | 'keep-both'
            >,
            confirmDate: fc.boolean(),
          }),
          { minLength: 12, maxLength: 12 }
        ),
        (existing, pageConfidence, candidates, rawChoices) => {
          const sampleText = candidates
            .map((c) => `${c.date} ${c.time ?? ''} ${c.title}`.trim())
            .join('\n');

          // OCR low-confidence page rejection
          const ocrResult = extractCalendarCandidatesFromText(
            sampleText,
            pageConfidence
          );
          if (pageConfidence < LOW_CONFIDENCE_THRESHOLD) {
            expect(ocrResult.ok).toBe(false);
            if (!ocrResult.ok) {
              expect(ocrResult.error.reason).toBe('low-confidence');
              expect(ocrResult.error.message).toBe(
                'The photo is hard to read. Please retake the photo in brighter light at a flat angle.'
              );
            }
          } else {
            expect(ocrResult.ok).toBe(true);
            if (ocrResult.ok) {
              expect(ocrResult.value.length).toBeGreaterThan(0);
              expect(ocrResult.value.length).toBeLessThanOrEqual(100);
            }
          }

          // Per-candidate state & keep eligibility
          for (const c of candidates) {
            const expectedState =
              c.confidence < LOW_CONFIDENCE_THRESHOLD && !c.dateConfirmed
                ? 'please-check'
                : 'ok';
            expect(candidateState(c)).toBe(expectedState);

            const expectedCanKeep =
              parsePlainDate(c.date).ok &&
              (c.confidence >= LOW_CONFIDENCE_THRESHOLD ||
                c.dateConfirmed === true);
            expect(canKeepCandidate(c)).toBe(expectedCanKeep);
          }

          // Review behavior
          const decisions = candidates.map((c, idx) => {
            const choice = rawChoices[idx];
            return {
              candidateId: c.id,
              decision: choice.decision,
              ...(choice.confirmDate ? { confirmedDate: c.date } : {}),
            };
          });

          const reviewed = reviewCandidates({
            existing,
            pageConfidence,
            candidates,
            decisions,
          });

          if (pageConfidence < LOW_CONFIDENCE_THRESHOLD) {
            expect(reviewed.lowConfidenceRejected).toBe(true);
            expect(reviewed.events).toEqual(existing);
          } else {
            expect(reviewed.lowConfidenceRejected).toBe(false);
            expect(reviewed.events.slice(0, existing.length)).toEqual(existing);

            // Simulate expected additions to verify unconfirmed low-confidence candidates are never added
            const added = reviewed.events.slice(existing.length);
            let expectedAddedCount = 0;
            const running: Pick<CalendarEvent, 'date' | 'title'>[] = [
              ...existing,
            ];

            for (let i = 0; i < candidates.length; i += 1) {
              const c = candidates[i];
              const d = decisions[i];
              if (d.decision === 'skip') continue;
              const effectiveDate = d.confirmedDate ?? c.date;
              const effectiveConfirmed =
                d.confirmedDate !== undefined || c.dateConfirmed === true;
              if (
                !canKeepCandidate({
                  confidence: c.confidence,
                  dateConfirmed: effectiveConfirmed,
                  date: effectiveDate,
                })
              ) {
                continue;
              }
              const dup = isDuplicateEvent(
                { date: effectiveDate, title: c.title },
                running
              );
              if (dup && d.decision !== 'keep-both') {
                continue;
              }
              expectedAddedCount += 1;
              running.push({ date: effectiveDate, title: c.title });
            }

            expect(added).toHaveLength(expectedAddedCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 38: Duplicate events and scan idempotence
  it('Property 38: detects case/whitespace-insensitive duplicates, honors keep-both, and makes repeated Keep scans idempotent', () => {
    const wordArb = fc.stringMatching(/^[A-Za-z0-9]{1,12}$/);
    const spacedTitleArb = fc
      .array(wordArb, { minLength: 1, maxLength: 4 })
      .map((words) => words.join(' '));

    const highConfCandidateArb: fc.Arbitrary<Candidate> = fc.record({
      id: fc.uuid(),
      title: spacedTitleArb,
      date: validDateStrArb,
      time: fc.option(validTimeStrArb, { nil: undefined }),
      category: categoryArb,
      confidence: fc.double({ min: 0.6, max: 1, noNaN: true }),
      dateConfirmed: fc.constant(true),
    });

    fc.assert(
      fc.property(
        fc.array(highConfCandidateArb, { minLength: 1, maxLength: 10 }),
        fc.double({ min: 0.6, max: 1, noNaN: true }),
        (candidates, pageConfidence) => {
          // Case + whitespace normalization invariant for duplicate detection
          const first = candidates[0];
          const noisyTitle = `  ${first.title.toUpperCase().replace(/ /g, '   ')}  `;
          expect(normalizeTitle(noisyTitle)).toBe(normalizeTitle(first.title));

          const seedExisting: CalendarEvent[] = [
            {
              id: 'existing-seed',
              title: noisyTitle,
              date: first.date,
              category: first.category,
              createdAt: '2025-01-01T00:00:00.000Z',
            },
          ];

          expect(isDuplicateEvent(first, seedExisting)).toBe(true);

          // 'keep' must skip the duplicate
          const keepOnDup = reviewCandidates({
            existing: seedExisting,
            pageConfidence,
            candidates: [first],
            decisions: [{ candidateId: first.id, decision: 'keep' }],
          });
          expect(keepOnDup.lowConfidenceRejected).toBe(false);
          expect(keepOnDup.events).toEqual(seedExisting);

          // 'keep-both' must add the duplicate explicitly
          const keepBothOnDup = reviewCandidates({
            existing: seedExisting,
            pageConfidence,
            candidates: [first],
            decisions: [{ candidateId: first.id, decision: 'keep-both' }],
          });
          expect(keepBothOnDup.lowConfidenceRejected).toBe(false);
          expect(keepBothOnDup.events).toHaveLength(seedExisting.length + 1);

          // Scan idempotence: running 'keep' on all candidates from the same photo twice
          // produces the exact same calendar as running it once.
          const allKeepDecisions = candidates.map((c) => ({
            candidateId: c.id,
            decision: 'keep' as const,
          }));

          const firstPass = reviewCandidates({
            existing: [],
            pageConfidence,
            candidates,
            decisions: allKeepDecisions,
          });
          const secondPass = reviewCandidates({
            existing: firstPass.events,
            pageConfidence,
            candidates,
            decisions: allKeepDecisions,
          });

          expect(firstPass.lowConfidenceRejected).toBe(false);
          expect(secondPass.lowConfidenceRejected).toBe(false);
          expect(secondPass.events).toEqual(firstPass.events);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 39: Reminder planning
  it('Property 39: computes lead-time instants, skips past reminders, formats notifications, and supports reschedule/cancel', () => {
    const longOrShortTitleArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .map((s) => s.replace(/[\r\n]/g, ' ').trim())
      .filter((s) => s.length > 0);

    fc.assert(
      fc.property(
        fc.uuid(),
        longOrShortTitleArb,
        validDateStrArb,
        fc.option(validTimeStrArb, { nil: undefined }),
        fc.constantFrom(...REMINDER_LEADS),
        fc.constantFrom(...IANA_TIME_ZONES),
        fc.constantFrom('12h', '24h') as fc.Arbitrary<'12h' | '24h'>,
        fc.integer({ min: -7_200_000, max: 7_200_000 }),
        (id, title, date, time, lead, timeZone, timeFormat, offsetFromFireMs) => {
          const event = {
            id,
            title,
            date,
            ...(time !== undefined ? { time } : {}),
          };

          const computedFireAt = reminderTime(event, lead, timeZone);
          const expectedEventInstant = Temporal.PlainDate.from(date)
            .toPlainDateTime(Temporal.PlainTime.from(time ?? '09:00'))
            .toZonedDateTime(timeZone)
            .toInstant();
          const expectedFireAt = expectedEventInstant.subtract({
            milliseconds: LEAD_MS[lead],
          });

          expect(Temporal.Instant.compare(computedFireAt, expectedFireAt)).toBe(
            0
          );

          // Past or exact-now skips; future schedules
          const now = Temporal.Instant.fromEpochMilliseconds(
            computedFireAt.epochMilliseconds + offsetFromFireMs
          );
          const plan = planReminder(event, lead, now, timeZone, timeFormat);

          if (offsetFromFireMs >= 0) {
            expect(plan).toEqual({ action: 'skip-past' });
          } else {
            expect(plan.action).toBe('schedule');
            if (plan.action === 'schedule') {
              expect(Temporal.Instant.compare(plan.fireAt, computedFireAt)).toBe(
                0
              );

              const truncatedTitle = title.slice(0, 60);
              expect(plan.notificationText).toContain(truncatedTitle);
              if (title.length > 60) {
                expect(plan.notificationText).not.toContain(title);
              }

              const weekday =
                WEEKDAY_NAMES[Temporal.PlainDate.from(date).dayOfWeek - 1];
              expect(plan.notificationText).toContain(weekday);
              expect(plan.notificationText).toContain(date);
              expect(plan.notificationText).toContain(
                expectedFormattedTime(time, timeFormat)
              );
            }
          }

          // ReminderScheduler schedule -> reschedule -> cancel lifecycle
          const scheduler = new ReminderScheduler();
          const futureNow = Temporal.Instant.fromEpochMilliseconds(
            computedFireAt.epochMilliseconds - 60_000
          );
          const firstSchedule = scheduler.schedule(
            event,
            lead,
            futureNow,
            timeZone,
            timeFormat
          );
          expect(firstSchedule.action).toBe('schedule');
          expect(scheduler.has(id)).toBe(true);
          expect(scheduler.size).toBe(1);

          // Reschedule to another lead time in the future cancels the prior one
          const nextLead: ReminderLead = lead === '15m' ? '1h' : '15m';
          const nextFireAt = reminderTime(event, nextLead, timeZone);
          const rescheduledNow = Temporal.Instant.fromEpochMilliseconds(
            nextFireAt.epochMilliseconds - 60_000
          );
          const rescheduled = scheduler.reschedule(
            event,
            nextLead,
            rescheduledNow,
            timeZone,
            timeFormat
          );
          expect(rescheduled.cancelledPrevious).toBe(true);
          expect(rescheduled.action).toBe('schedule');
          expect(scheduler.size).toBe(1);
          expect(scheduler.get(id)?.lead).toBe(nextLead);
          expect(scheduler.getCancelled().length).toBe(1);

          // Cancel removes the pending reminder
          expect(scheduler.cancel(id)).toBe(true);
          expect(scheduler.has(id)).toBe(false);
          expect(scheduler.size).toBe(0);
          expect(scheduler.cancel(id)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('covers OCR parsing edge cases, 100-candidate cap, invalid date rejection, and reschedule-to-past cancellation', () => {
    // OCR category inference & 12h/24h times
    const ocrText = [
      '2025-05-12 9:30 am Dr. Lim clinic checkup',
      '2025-05-13 18:00 Family dinner with Sarah',
      '2025-05-14 2pm Pay electricity bill',
      '2025-05-15 Morning walk in the park',
      '2025-02-30 10:00 Impossible date should be ignored',
    ].join('\n');

    const parsed = extractCalendarCandidatesFromText(ocrText, 0.9);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toHaveLength(4);
      expect(parsed.value[0]).toMatchObject({
        date: '2025-05-12',
        time: '09:30',
        category: 'Medical',
      });
      expect(parsed.value[1]).toMatchObject({
        date: '2025-05-13',
        time: '18:00',
        category: 'Family & Social',
      });
      expect(parsed.value[2]).toMatchObject({
        date: '2025-05-14',
        time: '14:00',
        category: 'Bills & Errands',
      });
      expect(parsed.value[3]).toMatchObject({
        date: '2025-05-15',
        category: 'Daily Routine',
      });
      expect(parsed.value[3].time).toBeUndefined();
    }

    // OCR no-events error
    const noEvents = extractCalendarCandidatesFromText('Just notes with no dates', 0.9);
    expect(noEvents.ok).toBe(false);
    if (!noEvents.ok) {
      expect(noEvents.error.reason).toBe('no-events');
    }

    // 100-candidate cap in OCR and reviewCandidates
    const manyLines = Array.from(
      { length: 120 },
      (_, idx) => `2025-06-01 Event number ${idx + 1}`
    ).join('\n');
    const cappedOcr = extractCalendarCandidatesFromText(manyLines, 0.9);
    expect(cappedOcr.ok).toBe(true);
    if (cappedOcr.ok) {
      expect(cappedOcr.value).toHaveLength(100);
    }

    const manyCandidates: Candidate[] = Array.from({ length: 120 }, (_, idx) => ({
      id: `bulk-${idx + 1}`,
      title: `Unique Event ${idx + 1}`,
      date: '2025-06-01',
      category: 'Daily Routine',
      confidence: 0.95,
    }));
    const cappedReview = reviewCandidates({
      existing: [],
      pageConfidence: 0.95,
      candidates: manyCandidates,
      decisions: manyCandidates.map((c) => ({
        candidateId: c.id,
        decision: 'keep',
      })),
    });
    expect(cappedReview.events).toHaveLength(100);

    // Invalid date blocked even with high confidence or dateConfirmed
    expect(
      canKeepCandidate({
        confidence: 0.99,
        dateConfirmed: true,
        date: '2025-02-29',
      })
    ).toBe(false);

    // Default timeFormat ('12h') and rescheduling into the past cancels previous reminder
    const event = {
      id: 'evt-resched',
      title: 'Blood pressure check',
      date: '2026-03-10',
      time: '14:30',
    };
    const scheduler = new ReminderScheduler();
    const fire1h = reminderTime(event, '1h', 'Asia/Kuala_Lumpur');
    const beforeFire = Temporal.Instant.fromEpochMilliseconds(
      fire1h.epochMilliseconds - 30_000
    );
    const scheduled = scheduler.schedule(
      event,
      '1h',
      beforeFire,
      'Asia/Kuala_Lumpur'
    );
    expect(scheduled.action).toBe('schedule');
    if (scheduled.action === 'schedule') {
      expect(scheduled.notificationText).toContain('2:30 PM');
      expect(scheduled.notificationText).toContain('Tuesday');
      expect(scheduled.notificationText).toContain('2026-03-10');
    }

    // Reschedule with '1d' lead puts fireAt in the past relative to beforeFire -> cancels previous
    const rescheduledPast = scheduler.reschedule(
      event,
      '1d',
      beforeFire,
      'Asia/Kuala_Lumpur'
    );
    expect(rescheduledPast.cancelledPrevious).toBe(true);
    expect(rescheduledPast.action).toBe('skip-past');
    expect(scheduler.has(event.id)).toBe(false);
    expect(scheduler.size).toBe(0);
    expect(scheduler.getCancelled()).toHaveLength(1);
  });

  it('orders tied-time events chronologically across mixed whole-second and sub-second createdAt instants and handles edited dates/HH:mm:ss OCR', () => {
    const today = Temporal.PlainDate.from('2026-11-21');
    const tiedEvents: CalendarEvent[] = [
      {
        id: 'later-ms',
        title: 'Second event',
        date: '2026-11-21',
        time: '10:00',
        category: 'Medical',
        createdAt: '2026-11-21T10:00:00.001Z',
      },
      {
        id: 'earlier-whole',
        title: 'First event',
        date: '2026-11-21',
        time: '10:00',
        category: 'Medical',
        createdAt: '2026-11-21T10:00:00Z',
      },
      {
        id: 'offset-earlier',
        title: 'Earliest via offset',
        date: '2026-11-21',
        time: '10:00',
        category: 'Medical',
        createdAt: '2026-11-21T17:59:59+08:00',
      },
    ];

    expect(viewToday(tiedEvents, today).map((e) => e.id)).toEqual([
      'offset-earlier',
      'earlier-whole',
      'later-ms',
    ]);

    const weekDay = viewWeek(tiedEvents, today)[0];
    expect(weekDay.events.map((e) => e.id)).toEqual([
      'offset-earlier',
      'earlier-whole',
      'later-ms',
    ]);

    const monthDay = viewMonth(tiedEvents, today.toPlainYearMonth())[0];
    expect(monthDay.events.map((e) => e.id)).toEqual([
      'offset-earlier',
      'earlier-whole',
      'later-ms',
    ]);

    // snap.ts emits fixed 3-digit millisecond ISO strings (.sssZ)
    const reviewed = reviewCandidates({
      existing: [],
      pageConfidence: 0.9,
      candidates: [
        {
          id: 'low-edit-valid',
          title: 'Edited clinic visit',
          date: '2026-11-21',
          category: 'Medical',
          confidence: 0.4,
        },
        {
          id: 'low-edit-invalid',
          title: 'Bad edited date',
          date: '2026-11-21',
          category: 'Medical',
          confidence: 0.4,
        },
      ],
      decisions: [
        {
          candidateId: 'low-edit-valid',
          decision: 'keep',
          confirmedDate: '2026-11-25',
        },
        {
          candidateId: 'low-edit-invalid',
          decision: 'keep',
          confirmedDate: '2026-02-30',
        },
      ],
    });
    expect(reviewed.events).toHaveLength(1);
    expect(reviewed.events[0].date).toBe('2026-11-25');
    expect(reviewed.events[0].createdAt).toMatch(/\.\d{3}Z$/);

    // OCR strips full HH:mm:ss cleanly without leaving ':00' in title
    const withSeconds = extractCalendarCandidatesFromText(
      '2026-11-21 09:30:00 Eye checkup',
      0.9
    );
    expect(withSeconds.ok).toBe(true);
    if (withSeconds.ok) {
      expect(withSeconds.value[0].time).toBe('09:30');
      expect(withSeconds.value[0].title).toBe('Eye checkup');
    }
  });
});
