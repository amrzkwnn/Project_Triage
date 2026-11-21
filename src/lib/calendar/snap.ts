import { Temporal } from 'temporal-polyfill';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import { MAX_SNAP_CANDIDATES, type Candidate } from '@/lib/calendar/ocr';
import { LOW_CONFIDENCE_THRESHOLD, type CalendarEvent } from '@/lib/types';

export type { Candidate };

export type CandidateDecision = {
  candidateId: string;
  decision: 'keep' | 'skip' | 'keep-both';
  confirmedDate?: string;
};

export type ReviewCandidatesParams = {
  existing: readonly CalendarEvent[];
  pageConfidence: number;
  candidates: readonly Candidate[];
  decisions: ReadonlyArray<CandidateDecision>;
};

export type ReviewCandidatesResult = {
  events: CalendarEvent[];
  lowConfidenceRejected: boolean;
};

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function candidateState(
  c: Pick<Candidate, 'confidence' | 'dateConfirmed'>
): 'ok' | 'please-check' {
  if (!(c.confidence >= LOW_CONFIDENCE_THRESHOLD) && !c.dateConfirmed) {
    return 'please-check';
  }
  return 'ok';
}

export function canKeepCandidate(
  c: Pick<Candidate, 'confidence' | 'dateConfirmed' | 'date'>
): boolean {
  if (!parsePlainDate(c.date).ok) {
    return false;
  }
  return (
    c.confidence >= LOW_CONFIDENCE_THRESHOLD || c.dateConfirmed === true
  );
}

function duplicateKey(date: string, title: string): string {
  return `${date}\u0000${normalizeTitle(title)}`;
}

export function isDuplicateEvent(
  candidate: Pick<Candidate, 'date' | 'title'>,
  existing: readonly Pick<CalendarEvent, 'date' | 'title'>[]
): boolean {
  const targetTitle = normalizeTitle(candidate.title);
  return existing.some(
    (event) =>
      event.date === candidate.date &&
      normalizeTitle(event.title) === targetTitle
  );
}

function allocateUniqueEventId(
  preferredId: string,
  usedIds: Set<string>
): string {
  if (!usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }
  let suffix = 2;
  while (usedIds.has(`${preferredId}-${suffix}`)) {
    suffix += 1;
  }
  const uniqueId = `${preferredId}-${suffix}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

export function reviewCandidates(
  params: ReviewCandidatesParams
): ReviewCandidatesResult {
  const { existing, pageConfidence, candidates, decisions } = params;

  if (
    !Number.isFinite(pageConfidence) ||
    pageConfidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return {
      events: [...existing],
      lowConfidenceRejected: true,
    };
  }

  const decisionMap = new Map<string, CandidateDecision>();
  for (const decision of decisions) {
    decisionMap.set(decision.candidateId, decision);
  }

  const resultEvents: CalendarEvent[] = [...existing];
  const usedIds = new Set<string>(existing.map((event) => event.id));
  const seenKeys = new Set<string>(
    existing.map((event) => duplicateKey(event.date, event.title))
  );

  const baseEpochMs = Temporal.Now.instant().epochMilliseconds;
  let addedCount = 0;

  for (const candidate of candidates.slice(0, MAX_SNAP_CANDIDATES)) {
    const decisionEntry = decisionMap.get(candidate.id);
    if (!decisionEntry || decisionEntry.decision === 'skip') {
      continue;
    }

    const effectiveDate = decisionEntry.confirmedDate ?? candidate.date;
    const effectiveDateConfirmed =
      decisionEntry.confirmedDate !== undefined
        ? true
        : candidate.dateConfirmed === true;

    if (
      !canKeepCandidate({
        confidence: candidate.confidence,
        dateConfirmed: effectiveDateConfirmed,
        date: effectiveDate,
      })
    ) {
      continue;
    }

    const key = duplicateKey(effectiveDate, candidate.title);
    const duplicate = seenKeys.has(key);
    if (duplicate && decisionEntry.decision !== 'keep-both') {
      continue;
    }

    const validTime =
      candidate.time !== undefined && parsePlainTime(candidate.time).ok
        ? candidate.time
        : undefined;

    const newEvent: CalendarEvent = {
      id: allocateUniqueEventId(candidate.id, usedIds),
      title: candidate.title,
      date: effectiveDate,
      ...(validTime !== undefined ? { time: validTime } : {}),
      category: candidate.category,
      createdAt: new Date(baseEpochMs + addedCount).toISOString(),
    };

    resultEvents.push(newEvent);
    seenKeys.add(key);
    addedCount += 1;
  }

  return {
    events: resultEvents,
    lowConfidenceRejected: false,
  };
}
