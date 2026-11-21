import { Temporal } from 'temporal-polyfill';
import type { Result } from '@/lib/types';

export type DateError = {
  code: 'invalid-date' | 'invalid-time';
  message: string;
};

const STRICT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STRICT_TIME_PATTERN = /^\d{2}:\d{2}$/;

const INVALID_DATE_MESSAGE =
  'Please confirm the date using a real calendar day, such as 2025-03-15.';

const INVALID_TIME_MESSAGE =
  'Please confirm the time using hours and minutes, such as 09:30.';

export function parsePlainDate(
  s: string
): Result<Temporal.PlainDate, DateError> {
  if (typeof s !== 'string' || !STRICT_DATE_PATTERN.test(s)) {
    return {
      ok: false,
      error: {
        code: 'invalid-date',
        message: INVALID_DATE_MESSAGE,
      },
    };
  }

  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));

  if (year < 1 || year > 9999) {
    return {
      ok: false,
      error: {
        code: 'invalid-date',
        message: INVALID_DATE_MESSAGE,
      },
    };
  }

  try {
    const date = Temporal.PlainDate.from(
      { year, month, day },
      { overflow: 'reject' }
    );
    return { ok: true, value: date };
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid-date',
        message: INVALID_DATE_MESSAGE,
      },
    };
  }
}

export function formatPlainDate(d: Temporal.PlainDate): string {
  const year = String(d.year).padStart(4, '0');
  const month = String(d.month).padStart(2, '0');
  const day = String(d.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parsePlainTime(
  s: string
): Result<Temporal.PlainTime, DateError> {
  if (typeof s !== 'string' || !STRICT_TIME_PATTERN.test(s)) {
    return {
      ok: false,
      error: {
        code: 'invalid-time',
        message: INVALID_TIME_MESSAGE,
      },
    };
  }

  const hour = Number(s.slice(0, 2));
  const minute = Number(s.slice(3, 5));

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {
      ok: false,
      error: {
        code: 'invalid-time',
        message: INVALID_TIME_MESSAGE,
      },
    };
  }

  try {
    const time = Temporal.PlainTime.from(
      { hour, minute },
      { overflow: 'reject' }
    );
    return { ok: true, value: time };
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid-time',
        message: INVALID_TIME_MESSAGE,
      },
    };
  }
}

export function formatPlainTime(t: Temporal.PlainTime): string {
  const hour = String(t.hour).padStart(2, '0');
  const minute = String(t.minute).padStart(2, '0');
  return `${hour}:${minute}`;
}
