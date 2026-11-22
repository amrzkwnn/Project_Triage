import { inferCalendarCategory } from '@/lib/calendar/categories';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import {
  LOW_CONFIDENCE_THRESHOLD,
  type CalendarCategory,
  type Result,
} from '@/lib/types';

export type Candidate = {
  id: string;
  title: string;
  date: string;
  time?: string;
  location?: string;
  category: CalendarCategory;
  confidence: number;
  dateConfirmed?: boolean;
};

export type OcrError = {
  reason: 'low-confidence' | 'no-events';
  message: string;
};

export const MAX_SNAP_CANDIDATES = 100;

export const LOW_CONFIDENCE_RETAKE_MESSAGE =
  'The photo is hard to read. Please retake the photo in brighter light at a flat angle.';

const NO_EVENTS_MESSAGE =
  'No dates or events were found in this photo. Please try another photo or add the event by hand.';

const DATE_PATTERN = /(?<!\d)(\d{4})[-/](\d{2})[-/](\d{2})(?!\d)/g;
const TIME_24H_PATTERN = /(?<!\d:)(?<!\d)(\d{2}:\d{2})(?::[0-5]\d)?(?!\d)/g;
const TIME_12H_PATTERN = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi;

function extractFirstValidDate(
  line: string
): { date: string; rawMatch: string } | undefined {
  for (const match of line.matchAll(DATE_PATTERN)) {
    const normalized = `${match[1]}-${match[2]}-${match[3]}`;
    if (parsePlainDate(normalized).ok) {
      return { date: normalized, rawMatch: match[0] };
    }
  }
  return undefined;
}

function extractFirstValidTime(
  line: string
): { time: string; rawMatch: string } | undefined {
  for (const match of line.matchAll(TIME_12H_PATTERN)) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? '0');
    const meridiem = match[3].toLowerCase();
    if (meridiem === 'am') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
    const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (parsePlainTime(formatted).ok) {
      return { time: formatted, rawMatch: match[0] };
    }
  }

  for (const match of line.matchAll(TIME_24H_PATTERN)) {
    const candidate = match[1];
    if (parsePlainTime(candidate).ok) {
      return { time: candidate, rawMatch: match[0] };
    }
  }

  return undefined;
}

function cleanCandidateTitle(
  line: string,
  matchedDateRaw: string,
  matchedTimeRaw?: string
): string {
  let cleaned = line.replace(matchedDateRaw, ' ');
  if (matchedTimeRaw) {
    cleaned = cleaned.replace(matchedTimeRaw, ' ');
  }

  cleaned = cleaned
    .replace(/^[\s\-–—:|•*,]+/, '')
    .replace(/[\s\-–—:|•*,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) {
    return 'Calendar event';
  }

  return cleaned.slice(0, 100).trim() || 'Calendar event';
}

export function extractCalendarCandidatesFromText(
  rawText: string,
  pageConfidence?: number
): Result<Candidate[], OcrError> {
  const effectiveConfidence = pageConfidence ?? 0.85;

  if (
    !Number.isFinite(effectiveConfidence) ||
    effectiveConfidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return {
      ok: false,
      error: {
        reason: 'low-confidence',
        message: LOW_CONFIDENCE_RETAKE_MESSAGE,
      },
    };
  }

  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return {
      ok: false,
      error: {
        reason: 'no-events',
        message: NO_EVENTS_MESSAGE,
      },
    };
  }

  const clampedConfidence = Math.min(1, Math.max(0, effectiveConfidence));
  const lines = rawText.split(/\r?\n/);
  const candidates: Candidate[] = [];

  for (const rawLine of lines) {
    if (candidates.length >= MAX_SNAP_CANDIDATES) {
      break;
    }

    const line = rawLine.trim();
    if (line.length === 0) continue;

    const dateMatch = extractFirstValidDate(line);
    if (!dateMatch) continue;

    const lineWithoutDate = line.replace(dateMatch.rawMatch, ' ');
    const timeMatch = extractFirstValidTime(lineWithoutDate);
    const title = cleanCandidateTitle(
      line,
      dateMatch.rawMatch,
      timeMatch?.rawMatch
    );

    const candidate: Candidate = {
      id: `cand-${candidates.length + 1}`,
      title,
      date: dateMatch.date,
      ...(timeMatch ? { time: timeMatch.time } : {}),
      category: inferCalendarCategory(title),
      confidence: clampedConfidence,
    };

    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      error: {
        reason: 'no-events',
        message: NO_EVENTS_MESSAGE,
      },
    };
  }

  return { ok: true, value: candidates };
}
