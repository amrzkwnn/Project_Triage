import type { CalendarCategory, CalendarEvent, Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { mayCallAi } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
import { inferCalendarCategory } from '@/lib/calendar/categories';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import {
  extractCalendarCandidatesFromText,
  type Candidate,
} from '@/lib/calendar/ocr';
import { isDuplicateEvent, normalizeTitle } from '@/lib/calendar/snap';
import { detectEvent } from '@/lib/inbox/events';

export type CalendarPlanInputItem = {
  id?: string;
  text: string;
  sender?: string;
  receivedAt?: string;
};

const DEFAULT_CALENDAR_PLAN_ENDPOINT = '/api/calendar-plan';
const DEFAULT_CALENDAR_PLAN_TIMEOUT_MS = 12_000;
const DEFAULT_CLIENT_AUTH = 'dev-senior-token-1';
const MAX_ITEMS_PER_SCAN = 20;

const AUDIT_FAILED_MESSAGE =
  'Calendar planning with AI Helper was cancelled because the activity record could not be saved.';

const VALID_CALENDAR_CATEGORIES = new Set<CalendarCategory>([
  'Medical',
  'Family & Social',
  'Bills & Errands',
  'Daily Routine',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function sanitizeCandidate(
  raw: unknown,
  fallbackId: string
): Candidate | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (typeof raw.title !== 'string' || typeof raw.date !== 'string') {
    return undefined;
  }
  const title = raw.title.trim().slice(0, 100).trim();
  const date = raw.date.trim();
  if (title.length === 0 || !parsePlainDate(date).ok) {
    return undefined;
  }

  let time: string | undefined;
  if (raw.time !== undefined && raw.time !== null && raw.time !== '') {
    if (typeof raw.time !== 'string') {
      return undefined;
    }
    const trimmedTime = raw.time.trim();
    if (!parsePlainTime(trimmedTime).ok) {
      return undefined;
    }
    time = trimmedTime;
  }

  const category: CalendarCategory =
    typeof raw.category === 'string' &&
    VALID_CALENDAR_CATEGORIES.has(raw.category as CalendarCategory)
      ? (raw.category as CalendarCategory)
      : inferCalendarCategory(title);

  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0.75;

  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim().slice(0, 80)
      : fallbackId;

  const candidate: Candidate = {
    id,
    title,
    date,
    ...(time !== undefined ? { time } : {}),
    category,
    confidence,
  };

  if (typeof raw.location === 'string' && raw.location.trim().length > 0) {
    candidate.location = raw.location.trim().slice(0, 100);
  }

  return candidate;
}

function deduplicateAgainstSelfAndExisting(
  candidates: readonly Candidate[],
  existingEvents: readonly CalendarEvent[]
): Candidate[] {
  const seenKeys = new Set<string>();
  const usedIds = new Set<string>();
  const result: Candidate[] = [];

  for (const candidate of candidates) {
    if (isDuplicateEvent(candidate, existingEvents)) {
      continue;
    }
    const key = `${candidate.date}\u0000${candidate.time ?? ''}\u0000${normalizeTitle(candidate.title)}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    let uniqueId = candidate.id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${candidate.id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);

    result.push(
      uniqueId === candidate.id ? candidate : { ...candidate, id: uniqueId }
    );
  }

  return result;
}

function extractDeviceCandidates(
  items: readonly CalendarPlanInputItem[],
  existingEvents: readonly CalendarEvent[]
): Candidate[] {
  const found: Candidate[] = [];
  let counter = 1;

  for (const item of items) {
    const itemCandidates: Candidate[] = [];
    const ocrResult = extractCalendarCandidatesFromText(item.text, 0.85);
    if (ocrResult.ok) {
      for (const c of ocrResult.value) {
        const sanitized = sanitizeCandidate(
          { ...c, id: `device-plan-${counter}` },
          `device-plan-${counter}`
        );
        if (sanitized) {
          itemCandidates.push(sanitized);
          counter += 1;
        }
      }
    }

    const detected = detectEvent(item.text);
    if (detected) {
      const sameSlot = itemCandidates.find(
        (c) =>
          c.date === detected.date &&
          (c.time === undefined || c.time === detected.time)
      );
      if (sameSlot) {
        if (!sameSlot.time && detected.time) {
          sameSlot.time = detected.time;
        }
        if (!sameSlot.location && detected.location) {
          sameSlot.location = detected.location;
        }
      } else {
        const sanitized = sanitizeCandidate(
          {
            id: `device-event-${counter}`,
            title: detected.title,
            date: detected.date,
            time: detected.time,
            ...(detected.location ? { location: detected.location } : {}),
            category: detected.category ?? inferCalendarCategory(detected.title),
            confidence: 0.85,
          },
          `device-event-${counter}`
        );
        if (sanitized) {
          itemCandidates.push(sanitized);
          counter += 1;
        }
      }
    }

    found.push(...itemCandidates);
  }

  return deduplicateAgainstSelfAndExisting(found, existingEvents);
}

function buildResultMessage(
  count: number,
  checkedBy: 'ai' | 'device',
  usedFallback = false
): string {
  if (usedFallback) {
    return count > 0
      ? `Found ${count} new calendar ${count === 1 ? 'item' : 'items'} using on-device scan to review one by one.`
      : 'No new calendar events were found using on-device scan.';
  }
  if (checkedBy === 'ai') {
    return count > 0
      ? `AI Helper found ${count} new calendar ${count === 1 ? 'item' : 'items'} for you to review one by one.`
      : 'AI Helper checked your messages and found no new calendar events to add.';
  }
  return count > 0
    ? `Found ${count} new calendar ${count === 1 ? 'item' : 'items'} on this device to review one by one.`
    : 'No new calendar events were found on this device.';
}

export async function autoPlanCalendarFromItems(params: {
  items: readonly CalendarPlanInputItem[];
  existingEvents: readonly CalendarEvent[];
  todayIso: string;
  settings: Settings;
  vault?: Pick<Vault, 'appendAudit'>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      candidates: Candidate[];
      checkedBy: 'ai' | 'device';
      message: string;
    }
  | { ok: false; message: string }
> {
  const validItems = params.items
    .filter(
      (item) => typeof item.text === 'string' && item.text.trim().length > 0
    )
    .slice(0, MAX_ITEMS_PER_SCAN);

  if (validItems.length === 0) {
    return {
      ok: true,
      candidates: [],
      checkedBy: 'device',
      message: 'There are no messages or notes to scan yet.',
    };
  }

  const deviceCandidates = extractDeviceCandidates(
    validItems,
    params.existingEvents
  );

  // Consent gate: AI Reading OFF -> zero network calls, zero audit writes
  if (!mayCallAi(params.settings)) {
    return {
      ok: true,
      candidates: deviceCandidates,
      checkedBy: 'device',
      message: buildResultMessage(deviceCandidates.length, 'device'),
    };
  }

  // Audit BEFORE external read (Property 7)
  const builtAudit = buildAuditEntry({
    kind: 'ai-read',
    description: `Scanned ${validItems.length} ${validItems.length === 1 ? 'item' : 'items'} for calendar events`,
    purpose: 'Find appointments and plans to review for your calendar',
  });

  if (!builtAudit.ok || !params.vault) {
    return {
      ok: false,
      message: AUDIT_FAILED_MESSAGE,
    };
  }

  const auditWrite = await params.vault.appendAudit(builtAudit.value);
  if (!auditWrite.ok) {
    return {
      ok: false,
      message: AUDIT_FAILED_MESSAGE,
    };
  }

  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: true,
      candidates: deviceCandidates,
      checkedBy: 'device',
      message: buildResultMessage(deviceCandidates.length, 'device', true),
    };
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_CALENDAR_PLAN_TIMEOUT_MS;
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      const err = new Error('Request timed out');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });

  try {
    const fetchPromise = Promise.resolve().then(() =>
      fetchFn(DEFAULT_CALENDAR_PLAN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_CLIENT_AUTH}`,
        },
        body: JSON.stringify({
          items: validItems,
          todayIso: params.todayIso,
        }),
        signal: controller.signal,
      })
    );
    fetchPromise.catch(() => {});

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    if (!response.ok) {
      return {
        ok: true,
        candidates: deviceCandidates,
        checkedBy: 'device',
        message: buildResultMessage(deviceCandidates.length, 'device', true),
      };
    }

    const parsed: unknown = await response.json();
    if (!isPlainObject(parsed) || !Array.isArray(parsed.candidates)) {
      return {
        ok: true,
        candidates: deviceCandidates,
        checkedBy: 'device',
        message: buildResultMessage(deviceCandidates.length, 'device', true),
      };
    }

    const sanitizedList: Candidate[] = [];
    for (let i = 0; i < parsed.candidates.length; i += 1) {
      const sanitized = sanitizeCandidate(
        parsed.candidates[i],
        `plan-cand-${i + 1}`
      );
      if (sanitized) {
        sanitizedList.push(sanitized);
      }
    }

    const filteredCandidates = deduplicateAgainstSelfAndExisting(
      sanitizedList,
      params.existingEvents
    );
    const checkedBy: 'ai' | 'device' =
      parsed.source === 'ai' ? 'ai' : 'device';

    return {
      ok: true,
      candidates: filteredCandidates,
      checkedBy,
      message: buildResultMessage(filteredCandidates.length, checkedBy),
    };
  } catch {
    return {
      ok: true,
      candidates: deviceCandidates,
      checkedBy: 'device',
      message: buildResultMessage(deviceCandidates.length, 'device', true),
    };
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}
