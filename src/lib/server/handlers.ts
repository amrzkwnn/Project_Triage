import {
  ALL_CHANNELS,
  type CalendarCategory,
  type Channel,
  type ClaritySummary,
  type DetectedEvent,
  type GroupCategory,
  type PriorityType,
  type RedFlagCategory,
  type Verdict,
  type VerdictValue,
} from '@/lib/types';
import { hasLoneSurrogate, parseIngest } from '@/lib/inbox/parse';
import { classify } from '@/lib/inbox/classify';
import { detectEvent } from '@/lib/inbox/events';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import {
  extractCalendarCandidatesFromText,
  type Candidate,
} from '@/lib/calendar/ocr';
import { normalizeTitle } from '@/lib/calendar/snap';
import { buildClaritySummary } from '@/lib/ai/summary';
import { inspectProvenance } from '@/lib/media/provenance';
import { mediaResult, type MediaCheckOutcome } from '@/lib/media/result';
import { checkText, type ScamCheckOutput } from '@/lib/scam/verdict';
import { TokenRegistry } from '@/lib/server/auth';
import { didGeminiPlannerFail } from '@/lib/server/geminiProvider';
import { createRateLimiter, type RateLimiter } from '@/lib/server/rateLimit';
import type { EncryptedRelayStore } from '@/lib/server/relay';
import type { SafeLogger } from '@/lib/server/safeLog';

const defaultTokenRegistry = new TokenRegistry();
const defaultRateLimiter = createRateLimiter();

export const MAX_INGEST_BYTES = 10 * 1024 * 1024;
export const MAX_DECIDE_BYTES = 64 * 1024;
export const MAX_SCAM_CHECK_BYTES = 32 * 1024;
export const MAX_SCAM_CHECK_WITH_IMAGE_BYTES = 14 * 1024 * 1024;
export const MAX_MEDIA_CHECK_BYTES = 14 * 1024 * 1024;
export const MAX_DECODED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CALENDAR_PLAN_BYTES = 128 * 1024;
export const MAX_CALENDAR_PLAN_ITEMS = 20;
const MAX_DECIDE_TEXT_LENGTH = 10_000;
const MAX_SCAM_CHECK_TEXT_LENGTH = 5_000;
const MAX_CALENDAR_PLAN_ITEM_TEXT_LENGTH = 5_000;

const VALID_IMAGE_MIMES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const VALID_MEDIA_RESULTS = new Set<MediaCheckOutcome['result']>([
  'AI signal found',
  'Camera signal found',
  'Cannot tell',
]);

const FORBIDDEN_CERTAINTY_PATTERN =
  /100%\s*real|certainly\s+authentic|guaranteed\s+real|proven\s+real/gi;

const VALID_CHANNELS = new Set<string>(ALL_CHANNELS);
const VALID_GROUPS = new Set<GroupCategory>(['Personal', 'Family', 'Others']);
const VALID_PRIORITIES = new Set<PriorityType>([
  'Important',
  'Social',
  'Promotion',
]);
const VALID_VERDICT_VALUES = new Set<VerdictValue>([
  'safe',
  'caution',
  'danger',
]);
const VALID_RED_FLAGS = new Set<RedFlagCategory>([
  'urgency',
  'secrecy',
  'payment',
  'domain-mismatch',
]);
const VALID_CALENDAR_CATEGORIES = new Set<CalendarCategory>([
  'Medical',
  'Family & Social',
  'Bills & Errands',
  'Daily Routine',
]);
const VERDICT_SEVERITY: Record<VerdictValue, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

export type IngestRouteDeps = {
  tokenRegistry: TokenRegistry;
  rateLimiter: RateLimiter;
  relay: EncryptedRelayStore;
  logger: SafeLogger;
  now?: () => number;
};

export type DecideOutput = {
  summary: ClaritySummary;
  group: GroupCategory;
  priority: PriorityType;
  confidence: number;
  scamWarning?: Verdict;
  detectedEvent?: DetectedEvent;
};

export type DecideAiProvider = (
  item: { channel: Channel; text: string },
  apiKey: string
) => Promise<DecideOutput>;

export type ScamCheckProviderInput =
  | string
  | { text: string; imageBase64?: string; imageMime?: string };

export type ScamCheckAiProvider = (
  input: ScamCheckProviderInput,
  apiKey: string
) => Promise<Partial<ScamCheckOutput>>;

export type MediaCheckAiProvider = (
  params: { imageBase64: string; mimeType: string; fileName?: string },
  apiKey: string
) => Promise<Partial<MediaCheckOutcome> & { scamWarning?: Verdict }>;

export type MediaCheckRouteResponse = MediaCheckOutcome & {
  source: 'ai' | 'device';
  scamWarning?: Verdict;
};

export type MediaCheckRouteDeps = {
  logger: SafeLogger;
  tokenRegistry?: TokenRegistry;
  rateLimiter?: RateLimiter;
  requireAuth?: boolean;
  now?: () => number;
  env?: Record<string, string | undefined>;
  mediaChecker?: MediaCheckAiProvider;
};

export type CalendarPlanInputItem = {
  id?: string;
  text: string;
  sender?: string;
  receivedAt?: string;
};

export type CalendarPlanAiProvider = (
  params: { items: readonly CalendarPlanInputItem[]; todayIso: string },
  apiKey: string
) => Promise<Candidate[]>;

export type CalendarPlanRouteResponse = {
  candidates: Candidate[];
  source: 'ai' | 'device';
};

export type DecideRouteDeps = {
  logger: SafeLogger;
  tokenRegistry?: TokenRegistry;
  rateLimiter?: RateLimiter;
  requireAuth?: boolean;
  now?: () => number;
  env?: Record<string, string | undefined>;
  aiProvider?: DecideAiProvider;
};

export type ScamCheckRouteDeps = {
  logger: SafeLogger;
  tokenRegistry?: TokenRegistry;
  rateLimiter?: RateLimiter;
  requireAuth?: boolean;
  now?: () => number;
  env?: Record<string, string | undefined>;
  scamChecker?: ScamCheckAiProvider;
};

export type CalendarPlanRouteDeps = {
  logger: SafeLogger;
  tokenRegistry?: TokenRegistry;
  rateLimiter?: RateLimiter;
  requireAuth?: boolean;
  now?: () => number;
  env?: Record<string, string | undefined>;
  calendarPlanner?: CalendarPlanAiProvider;
};

function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env ?? {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

type ReadBodyResult =
  | { ok: true; text: string }
  | { ok: false; kind: 'too-large' | 'invalid-encoding' };

async function readUtf8BodyWithLimit(
  req: Request,
  maxBytes: number
): Promise<ReadBodyResult> {
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const parsedLen = Number(contentLengthHeader.trim());
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return { ok: false, kind: 'too-large' };
    }
  }

  if (req.body && typeof req.body.getReader === 'function') {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // ignore cancel failures
            }
            return { ok: false, kind: 'too-large' };
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore lock release failures
      }
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
      return { ok: true, text };
    } catch {
      return { ok: false, kind: 'invalid-encoding' };
    }
  }

  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return { ok: false, kind: 'too-large' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { ok: true, text };
  } catch {
    return { ok: false, kind: 'invalid-encoding' };
  }
}

function logAndReturn(
  logger: SafeLogger,
  route: string,
  startMs: number,
  now: () => number,
  response: Response
): Response {
  logger.log({
    route,
    status: response.status,
    durationMs: Math.max(0, now() - startMs),
  });
  return response;
}

export function createIngestPostHandler(
  deps: IngestRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/ingest';

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      const auth = deps.tokenRegistry.verifyToken(req);
      if (!auth.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(auth.body, auth.status)
        );
      }

      const rl = deps.rateLimiter.check(auth.tokenHash, now());
      if (!rl.allowed) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(rl.body, rl.status)
        );
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_INGEST_BYTES);
      if (!bodyRead.ok) {
        if (bodyRead.kind === 'too-large') {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              { error: 'This item is too large to send. Please keep it under 10 MB.' },
              413
            )
          );
        }
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The message encoding could not be read. (field: encoding)',
              field: 'encoding',
              reason: 'malformed',
            },
            400
          )
        );
      }

      const parsed = parseIngest(bodyRead.text);
      if (!parsed.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: `${parsed.error.message} (field: ${parsed.error.field})`,
              field: parsed.error.field,
              reason: parsed.error.reason,
            },
            400
          )
        );
      }

      const envelope = deps.relay.enqueue(auth.seniorId, parsed.value, now());
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ ok: true, id: envelope.id }, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

function normalizeEmailPayload(raw: unknown): unknown {
  if (!isPlainObject(raw)) {
    return raw;
  }

  let text: unknown = raw.text;
  if (text === undefined) {
    const hasSubject = raw.subject !== undefined;
    const hasBody = raw.body !== undefined;
    if (hasSubject || hasBody) {
      if (hasSubject && typeof raw.subject !== 'string') {
        text = raw.subject;
      } else if (hasBody && typeof raw.body !== 'string') {
        text = raw.body;
      } else {
        const subjectStr = typeof raw.subject === 'string' ? raw.subject.trim() : '';
        const bodyStr = typeof raw.body === 'string' ? raw.body : '';
        if (subjectStr.length > 0 && bodyStr.length > 0) {
          text = `${subjectStr}\n\n${bodyStr}`;
        } else if (subjectStr.length > 0) {
          text = subjectStr;
        } else {
          text = bodyStr;
        }
      }
    }
  }

  const sender = raw.sender !== undefined ? raw.sender : raw.from;

  const normalized: Record<string, unknown> = {
    source: 'email',
    text,
  };
  if (sender !== undefined) {
    normalized.sender = sender;
  }
  if (raw.attachments !== undefined) {
    normalized.attachments = raw.attachments;
  }
  if (raw.receivedAt !== undefined) {
    normalized.receivedAt = raw.receivedAt;
  }
  return normalized;
}

export function createIngestEmailPostHandler(
  deps: IngestRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/ingest/email';

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      const auth = deps.tokenRegistry.verifyToken(req);
      if (!auth.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(auth.body, auth.status)
        );
      }

      const rl = deps.rateLimiter.check(auth.tokenHash, now());
      if (!rl.allowed) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(rl.body, rl.status)
        );
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_INGEST_BYTES);
      if (!bodyRead.ok) {
        if (bodyRead.kind === 'too-large') {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              { error: 'This item is too large to send. Please keep it under 10 MB.' },
              413
            )
          );
        }
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The message encoding could not be read. (field: encoding)',
              field: 'encoding',
              reason: 'malformed',
            },
            400
          )
        );
      }

      if (bodyRead.text.trim().length === 0) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'No message details were provided. (field: body)',
              field: 'body',
              reason: 'missing',
            },
            400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The message format could not be read. Please try again. (field: body)',
              field: 'body',
              reason: 'malformed',
            },
            400
          )
        );
      }

      const parsed = parseIngest(normalizeEmailPayload(rawJson));
      if (!parsed.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: `${parsed.error.message} (field: ${parsed.error.field})`,
              field: parsed.error.field,
              reason: parsed.error.reason,
            },
            400
          )
        );
      }

      const envelope = deps.relay.enqueue(auth.seniorId, parsed.value, now());
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ ok: true, id: envelope.id }, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

export function createIngestPullGetHandler(
  deps: IngestRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/ingest/pull';

  return async function GET(req: Request): Promise<Response> {
    const startMs = now();
    try {
      const auth = deps.tokenRegistry.verifyToken(req);
      if (!auth.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(auth.body, auth.status)
        );
      }

      const rl = deps.rateLimiter.check(auth.tokenHash, now());
      if (!rl.allowed) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(rl.body, rl.status)
        );
      }

      const items = deps.relay.pull(auth.seniorId, now());
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ items }, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

export function createIngestAckPostHandler(
  deps: IngestRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/ingest/ack';

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      const auth = deps.tokenRegistry.verifyToken(req);
      if (!auth.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(auth.body, auth.status)
        );
      }

      const rl = deps.rateLimiter.check(auth.tokenHash, now());
      if (!rl.allowed) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(rl.body, rl.status)
        );
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_INGEST_BYTES);
      if (!bodyRead.ok) {
        if (bodyRead.kind === 'too-large') {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              { error: 'This item is too large to send. Please keep it under 10 MB.' },
              413
            )
          );
        }
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request encoding could not be read. (field: encoding)',
              field: 'encoding',
            },
            400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request format could not be read. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (
        !isPlainObject(rawJson) ||
        !Array.isArray(rawJson.ids) ||
        !rawJson.ids.every((id) => typeof id === 'string' && id.length > 0)
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please provide a list of item IDs. (field: ids)',
              field: 'ids',
            },
            400
          )
        );
      }

      deps.relay.ack(auth.seniorId, rawJson.ids as string[]);
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        new Response(null, { status: 204 })
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

function sanitizeDetectedEvent(raw: unknown): DetectedEvent | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (
    typeof raw.date !== 'string' ||
    typeof raw.time !== 'string' ||
    typeof raw.title !== 'string' ||
    raw.title.trim().length === 0
  ) {
    return undefined;
  }
  const date = raw.date.trim();
  const time = raw.time.trim();
  if (!parsePlainDate(date).ok || !parsePlainTime(time).ok) {
    return undefined;
  }
  const event: DetectedEvent = {
    date,
    time,
    title: raw.title.trim().slice(0, 100),
  };
  if (typeof raw.location === 'string' && raw.location.trim().length > 0) {
    event.location = raw.location.trim().slice(0, 100);
  }
  return event;
}

function sanitizeVerdict(raw: unknown): Verdict | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (
    typeof raw.value !== 'string' ||
    !VALID_VERDICT_VALUES.has(raw.value as VerdictValue)
  ) {
    return undefined;
  }
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim().slice(0, 150))
        .slice(0, 3)
    : [];
  if (reasons.length === 0) {
    return undefined;
  }
  const flags = Array.isArray(raw.flags)
    ? Array.from(
        new Set(
          raw.flags.filter(
            (f): f is RedFlagCategory =>
              typeof f === 'string' &&
              VALID_RED_FLAGS.has(f as RedFlagCategory)
          )
        )
      )
    : [];
  return {
    value: raw.value as VerdictValue,
    flags,
    reasons,
  };
}

function deterministicDecide(item: {
  channel: Channel;
  text: string;
}): DecideOutput {
  const classification = classify({
    source: item.channel,
    text: item.text,
  });
  const scamCheck = checkText(item.text);
  const detectedEvent = detectEvent(item.text);
  const summary = buildClaritySummary(
    { source: item.channel, text: item.text },
    {
      detectedEvent,
      scamWarning: classification.scamWarning,
    }
  );
  const confidence =
    classification.scamWarning ||
    detectedEvent !== undefined ||
    classification.priority === 'Important' ||
    classification.priority === 'Promotion'
      ? 0.85
      : 0.75;

  const output: DecideOutput = {
    summary,
    group: classification.group,
    priority: classification.priority,
    confidence,
  };

  if (detectedEvent !== undefined) {
    output.detectedEvent = detectedEvent;
  }

  if (scamCheck.value === 'danger') {
    output.scamWarning = {
      value: 'danger',
      reasons: scamCheck.reasons,
      flags: scamCheck.flags,
    };
  } else if (classification.scamWarning) {
    output.scamWarning = {
      value: 'danger',
      reasons:
        scamCheck.value === 'caution'
          ? scamCheck.reasons
          : ['Urgent message with payment link from unknown sender'],
      flags:
        scamCheck.flags.length > 0 ? scamCheck.flags : ['urgency', 'payment'],
    };
  } else if (scamCheck.value === 'caution') {
    output.scamWarning = {
      value: 'caution',
      reasons: scamCheck.reasons,
      flags: scamCheck.flags,
    };
  }

  return output;
}

function sanitizeDecideOutput(
  candidate: DecideOutput,
  fallback: DecideOutput
): DecideOutput {
  const group = VALID_GROUPS.has(candidate.group)
    ? candidate.group
    : fallback.group;
  const priority = VALID_PRIORITIES.has(candidate.priority)
    ? candidate.priority
    : fallback.priority;
  const confidence =
    typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1
      ? candidate.confidence
      : fallback.confidence;

  const s = candidate.summary;
  const summary: ClaritySummary =
    isPlainObject(s) &&
    typeof s.fromApp === 'string' &&
    s.fromApp.trim().length > 0 &&
    typeof s.whoSent === 'string' &&
    s.whoSent.trim().length > 0 &&
    typeof s.actionNeeded === 'string' &&
    s.actionNeeded.trim().length > 0 &&
    typeof s.text === 'string' &&
    s.text.trim().length > 0
      ? {
          fromApp: s.fromApp,
          whoSent: s.whoSent,
          actionNeeded: s.actionNeeded,
          text: s.text.slice(0, 300),
        }
      : fallback.summary;

  const sanitizedEvent = sanitizeDetectedEvent(candidate.detectedEvent);
  const detectedEvent = sanitizedEvent ?? fallback.detectedEvent;

  const sanitizedScam = sanitizeVerdict(candidate.scamWarning);
  let scamWarning: Verdict | undefined = fallback.scamWarning;
  if (sanitizedScam !== undefined) {
    const fallbackSeverity = fallback.scamWarning
      ? VERDICT_SEVERITY[fallback.scamWarning.value]
      : 0;
    const candidateSeverity = VERDICT_SEVERITY[sanitizedScam.value];

    if (
      fallback.scamWarning?.value === 'danger' &&
      sanitizedScam.value !== 'danger'
    ) {
      // Safety monotonicity: never downgrade deterministic danger
      scamWarning = fallback.scamWarning;
    } else if (
      candidateSeverity > fallbackSeverity ||
      (candidateSeverity === fallbackSeverity && candidateSeverity > 0)
    ) {
      const mergedFlags = Array.from(
        new Set([...(fallback.scamWarning?.flags ?? []), ...sanitizedScam.flags])
      );
      scamWarning = {
        value: sanitizedScam.value,
        flags: mergedFlags,
        reasons: sanitizedScam.reasons,
      };
    }
  }

  const result: DecideOutput = { summary, group, priority, confidence };
  if (detectedEvent !== undefined) {
    result.detectedEvent = detectedEvent;
  }
  if (scamWarning !== undefined) {
    result.scamWarning = scamWarning;
  }
  return result;
}

function mergeScamCheckResult(
  candidate: Partial<ScamCheckOutput> | unknown,
  baseline: ScamCheckOutput,
  enforceBaselineMonotonicity = true
): ScamCheckOutput & { source: 'ai' | 'device' } {
  const sanitized = sanitizeVerdict(candidate);
  if (!sanitized) {
    return { ...baseline, source: 'device' };
  }

  const baselineSeverity = VERDICT_SEVERITY[baseline.value];
  const candidateSeverity = VERDICT_SEVERITY[sanitized.value];

  // Safety monotonicity: never downgrade a deterministic text danger or caution verdict
  if (enforceBaselineMonotonicity && candidateSeverity < baselineSeverity) {
    return { ...baseline, source: 'device' };
  }

  const raw = candidate as Record<string, unknown>;
  const mergedFlags = enforceBaselineMonotonicity
    ? Array.from(new Set([...baseline.flags, ...sanitized.flags]))
    : sanitized.flags;
  const instruction =
    typeof raw.instruction === 'string' && raw.instruction.trim().length > 0
      ? raw.instruction.trim().slice(0, 150)
      : sanitized.value === 'danger'
        ? 'Do not click or pay'
        : sanitized.value === 'caution'
          ? 'Hang up and call back using a number saved in your contacts'
          : undefined;

  const showAskFamily =
    sanitized.value === 'danger'
      ? true
      : typeof raw.showAskFamily === 'boolean'
        ? raw.showAskFamily
        : enforceBaselineMonotonicity
          ? baseline.showAskFamily
          : sanitized.value === 'caution';

  const merged: ScamCheckOutput & { source: 'ai' | 'device' } = {
    value: sanitized.value,
    flags: mergedFlags,
    reasons: sanitized.reasons,
    showAskFamily,
    source: 'ai',
  };
  if (instruction !== undefined) {
    merged.instruction = instruction;
  }
  return merged;
}

function stripForbiddenCertainty(text: string): string {
  return text
    .replace(FORBIDDEN_CERTAINTY_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function decodeBase64ToBytes(rawBase64: string): Uint8Array | null {
  const cleaned = rawBase64.replace(/\s+/g, '');
  if (
    cleaned.length === 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) ||
    cleaned.length % 4 === 1
  ) {
    return null;
  }
  const padded =
    cleaned.length % 4 === 0
      ? cleaned
      : cleaned + '='.repeat(4 - (cleaned.length % 4));
  try {
    if (typeof atob === 'function') {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    const nodeBuf = (
      globalThis as unknown as {
        Buffer?: { from(data: string, encoding: 'base64'): Uint8Array };
      }
    ).Buffer;
    if (nodeBuf) {
      return new Uint8Array(nodeBuf.from(padded, 'base64'));
    }
    return null;
  } catch {
    return null;
  }
}

export function createScamCheckPostHandler(
  deps: ScamCheckRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/scam-check';
  const requireAuth = deps.requireAuth !== false;
  const tokenRegistry = deps.tokenRegistry ?? defaultTokenRegistry;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      if (requireAuth) {
        const auth = tokenRegistry.verifyToken(req);
        if (!auth.ok) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(auth.body, auth.status)
          );
        }

        const rl = rateLimiter.check(auth.tokenHash, now());
        if (!rl.allowed) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(rl.body, rl.status)
          );
        }
      }

      const bodyRead = await readUtf8BodyWithLimit(
        req,
        MAX_SCAM_CHECK_WITH_IMAGE_BYTES
      );
      if (!bodyRead.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                bodyRead.kind === 'too-large'
                  ? 'This message or screenshot is too large to check. Please keep screenshots under 10 MB. (field: imageBase64)'
                  : 'The message encoding could not be read. (field: encoding)',
              field: bodyRead.kind === 'too-large' ? 'imageBase64' : 'encoding',
            },
            bodyRead.kind === 'too-large' ? 413 : 400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request format could not be read. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (!isPlainObject(rawJson)) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'Please send message text or a screenshot to check. (field: text)',
              field: 'text',
            },
            400
          )
        );
      }

      const hasTextField = rawJson.text !== undefined;
      if (hasTextField) {
        if (
          typeof rawJson.text !== 'string' ||
          rawJson.text.length > MAX_SCAM_CHECK_TEXT_LENGTH ||
          hasLoneSurrogate(rawJson.text)
        ) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'Please send message text up to 5,000 characters to check. (field: text)',
                field: 'text',
              },
              400
            )
          );
        }
      }

      const text = typeof rawJson.text === 'string' ? rawJson.text : '';
      const hasText = text.trim().length > 0;

      const hasImageFields =
        rawJson.imageBase64 !== undefined || rawJson.imageMime !== undefined;
      let cleanImageBase64: string | undefined;
      let cleanImageMime: string | undefined;

      if (hasImageFields) {
        if (
          typeof rawJson.imageMime !== 'string' ||
          !VALID_IMAGE_MIMES.has(rawJson.imageMime.trim().toLowerCase())
        ) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'Please send a JPEG, PNG, or WebP screenshot image. (field: imageMime)',
                field: 'imageMime',
              },
              400
            )
          );
        }

        if (
          typeof rawJson.imageBase64 !== 'string' ||
          rawJson.imageBase64.trim().length === 0
        ) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'The screenshot image could not be read. (field: imageBase64)',
                field: 'imageBase64',
              },
              400
            )
          );
        }

        const decoded = decodeBase64ToBytes(rawJson.imageBase64);
        if (!decoded || decoded.byteLength === 0) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'The screenshot image format could not be read. (field: imageBase64)',
                field: 'imageBase64',
              },
              400
            )
          );
        }

        if (decoded.byteLength > MAX_DECODED_IMAGE_BYTES) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'That screenshot is larger than 10 MB. Please choose a smaller image. (field: imageBase64)',
                field: 'imageBase64',
              },
              413
            )
          );
        }

        cleanImageBase64 = rawJson.imageBase64.replace(/\s+/g, '');
        cleanImageMime = rawJson.imageMime.trim().toLowerCase();
      } else if (bodyRead.text.length > MAX_SCAM_CHECK_BYTES) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'This message is longer than 5,000 characters. Please shorten it and check again. (field: text)',
              field: 'text',
            },
            400
          )
        );
      }

      if (!hasText && !cleanImageBase64) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'Please send message text up to 5,000 characters to check. (field: text)',
              field: 'text',
            },
            400
          )
        );
      }

      const baseline: ScamCheckOutput = hasText
        ? checkText(text)
        : {
            value: 'caution',
            flags: [],
            reasons: [
              'We could not read the words in this screenshot right now. Please paste the message text or ask a trusted family member before clicking or paying.',
            ],
            instruction: 'Be careful and verify before clicking or paying',
            showAskFamily: true,
          };
      let output: ScamCheckOutput & { source: 'ai' | 'device' } = {
        ...baseline,
        source: 'device',
      };

      const envSource = deps.env ?? getProcessEnv();
      const apiKey = envSource.AI_API_KEY || envSource.GEMINI_API_KEY;

      if (apiKey && deps.scamChecker) {
        try {
          const checkerInput: ScamCheckProviderInput = cleanImageBase64
            ? {
                text,
                imageBase64: cleanImageBase64,
                imageMime: cleanImageMime,
              }
            : text;
          const aiCandidate = await deps.scamChecker(checkerInput, apiKey);
          output = mergeScamCheckResult(aiCandidate, baseline, hasText);
        } catch {
          output = { ...baseline, source: 'device' };
        }
      }

      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse(output, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

function mergeMediaCheckResult(
  candidate: (Partial<MediaCheckOutcome> & { scamWarning?: Verdict }) | unknown,
  baseline: MediaCheckOutcome
): MediaCheckRouteResponse {
  if (!isPlainObject(candidate)) {
    return { ...baseline, source: 'device' };
  }

  const rawResult = candidate.result;
  if (
    typeof rawResult !== 'string' ||
    !VALID_MEDIA_RESULTS.has(rawResult as MediaCheckOutcome['result'])
  ) {
    return { ...baseline, source: 'device' };
  }

  const rawNote =
    typeof candidate.note === 'string'
      ? stripForbiddenCertainty(candidate.note)
      : '';
  const safeNote =
    rawNote.length > 0
      ? rawNote.slice(0, 300)
      : 'Visual clues were reviewed, but no tool can prove a photo is authentic.';

  const rawSignal =
    typeof candidate.signalName === 'string'
      ? stripForbiddenCertainty(candidate.signalName).slice(0, 120)
      : '';

  // Never downgrade deterministic AI provenance marker
  const resolvedResult: MediaCheckOutcome['result'] =
    baseline.result === 'AI signal found'
      ? 'AI signal found'
      : rawResult === 'Cannot tell' && baseline.result === 'Camera signal found'
        ? 'Camera signal found'
        : (rawResult as MediaCheckOutcome['result']);

  const resolvedSignalName =
    baseline.result === 'AI signal found'
      ? baseline.signalName ?? (rawSignal.length > 0 ? rawSignal : undefined)
      : rawSignal.length > 0
        ? rawSignal
        : baseline.signalName;

  const sanitizedScam = sanitizeVerdict(candidate.scamWarning);
  const scamWarning =
    sanitizedScam && sanitizedScam.value !== 'safe'
      ? {
          ...sanitizedScam,
          reasons: sanitizedScam.reasons
            .map((r) => stripForbiddenCertainty(r))
            .filter((r) => r.length > 0),
        }
      : undefined;

  return {
    result: resolvedResult,
    ...(resolvedSignalName ? { signalName: resolvedSignalName } : {}),
    note: safeNote,
    ...(scamWarning && scamWarning.reasons.length > 0 ? { scamWarning } : {}),
    source: 'ai',
  };
}

export function createMediaCheckPostHandler(
  deps: MediaCheckRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/media-check';
  const requireAuth = deps.requireAuth !== false;
  const tokenRegistry = deps.tokenRegistry ?? defaultTokenRegistry;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      if (requireAuth) {
        const auth = tokenRegistry.verifyToken(req);
        if (!auth.ok) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(auth.body, auth.status)
          );
        }

        const rl = rateLimiter.check(auth.tokenHash, now());
        if (!rl.allowed) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(rl.body, rl.status)
          );
        }
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_MEDIA_CHECK_BYTES);
      if (!bodyRead.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                bodyRead.kind === 'too-large'
                  ? 'This photo is larger than 10 MB. Please choose a smaller photo. (field: imageBase64)'
                  : 'The photo request encoding could not be read. (field: encoding)',
              field: bodyRead.kind === 'too-large' ? 'imageBase64' : 'encoding',
            },
            bodyRead.kind === 'too-large' ? 413 : 400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request format could not be read. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (!isPlainObject(rawJson)) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please send a photo to check. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (
        typeof rawJson.mimeType !== 'string' ||
        !VALID_IMAGE_MIMES.has(rawJson.mimeType.trim().toLowerCase())
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'Please choose a JPEG, PNG, or WebP photo. (field: mimeType)',
              field: 'mimeType',
            },
            400
          )
        );
      }

      if (
        typeof rawJson.imageBase64 !== 'string' ||
        rawJson.imageBase64.trim().length === 0
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please include the photo data to check. (field: imageBase64)',
              field: 'imageBase64',
            },
            400
          )
        );
      }

      const decodedBytes = decodeBase64ToBytes(rawJson.imageBase64);
      if (!decodedBytes || decodedBytes.byteLength === 0) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'The photo data format could not be read. (field: imageBase64)',
              field: 'imageBase64',
            },
            400
          )
        );
      }

      if (decodedBytes.byteLength > MAX_DECODED_IMAGE_BYTES) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                'This photo is larger than 10 MB. Please choose a smaller photo. (field: imageBase64)',
              field: 'imageBase64',
            },
            413
          )
        );
      }

      const cleanBase64 = rawJson.imageBase64.replace(/\s+/g, '');
      const mimeType = rawJson.mimeType.trim().toLowerCase();
      const fileName =
        typeof rawJson.fileName === 'string' &&
        rawJson.fileName.trim().length > 0 &&
        !hasLoneSurrogate(rawJson.fileName)
          ? rawJson.fileName.trim().slice(0, 200)
          : undefined;

      const provenance = await inspectProvenance(decodedBytes);
      const baseline = mediaResult(provenance);
      let output: MediaCheckRouteResponse = {
        ...baseline,
        source: 'device',
      };

      const envSource = deps.env ?? getProcessEnv();
      const apiKey = envSource.AI_API_KEY || envSource.GEMINI_API_KEY;

      if (apiKey && deps.mediaChecker) {
        try {
          const aiCandidate = await deps.mediaChecker(
            {
              imageBase64: cleanBase64,
              mimeType,
              ...(fileName ? { fileName } : {}),
            },
            apiKey
          );
          output = mergeMediaCheckResult(aiCandidate, baseline);
        } catch {
          output = { ...baseline, source: 'device' };
        }
      }

      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse(output, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

const PLAN_MEDICAL_PATTERN =
  /\b(doctor|dr\.?|clinic|hospital|dentist|pharmacy|medicine|medication|pill|checkup|check-up|lab|x-ray|therapy|physio|vaccine|appointment)\b/i;
const PLAN_FAMILY_PATTERN =
  /\b(family|dinner|lunch|breakfast|birthday|visit|grandchild|grandchildren|daughter|son|sister|brother|friend|wedding|party|reunion|coffee|tea|club|church|mosque|temple)\b/i;
const PLAN_BILLS_PATTERN =
  /\b(bill|pay|payment|bank|rent|electric|electricity|water|phone|tax|insurance|grocer|grocery|groceries|market|shop|shopping|post office|errand|repair|plumber)\b/i;

function inferPlanCategory(title: string): CalendarCategory {
  if (PLAN_MEDICAL_PATTERN.test(title)) return 'Medical';
  if (PLAN_FAMILY_PATTERN.test(title)) return 'Family & Social';
  if (PLAN_BILLS_PATTERN.test(title)) return 'Bills & Errands';
  return 'Daily Routine';
}

function sanitizeCalendarCandidate(
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
      : inferPlanCategory(title);

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

function deduplicatePlanCandidates(candidates: readonly Candidate[]): Candidate[] {
  const seenDateTimeTitle = new Set<string>();
  const seenDateTitle = new Set<string>();
  const usedIds = new Set<string>();
  const deduped: Candidate[] = [];

  for (const candidate of candidates) {
    const normTitle = normalizeTitle(candidate.title);
    const fullKey = `${candidate.date}\u0000${candidate.time ?? ''}\u0000${normTitle}`;
    const dateTitleKey = `${candidate.date}\u0000${normTitle}`;

    if (seenDateTimeTitle.has(fullKey)) {
      continue;
    }
    if (candidate.time === undefined && seenDateTitle.has(dateTitleKey)) {
      continue;
    }

    const overlapsExistingSlot = deduped.some((kept) => {
      if (kept.date !== candidate.date || kept.time !== candidate.time) {
        return false;
      }
      const keptNorm = normalizeTitle(kept.title);
      if (keptNorm.length === 0 || normTitle.length === 0) {
        return false;
      }
      return keptNorm.includes(normTitle) || normTitle.includes(keptNorm);
    });
    if (overlapsExistingSlot) {
      continue;
    }

    let uniqueId = candidate.id;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${candidate.id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(uniqueId);
    seenDateTimeTitle.add(fullKey);
    seenDateTitle.add(dateTitleKey);

    deduped.push(
      uniqueId === candidate.id ? candidate : { ...candidate, id: uniqueId }
    );
  }

  return deduped;
}

function extractDeterministicPlanCandidates(
  items: readonly CalendarPlanInputItem[]
): Candidate[] {
  const raw: Candidate[] = [];
  let counter = 1;

  for (const item of items) {
    const itemCandidates: Candidate[] = [];
    const ocrResult = extractCalendarCandidatesFromText(item.text, 0.85);
    if (ocrResult.ok) {
      for (const c of ocrResult.value) {
        const sanitized = sanitizeCalendarCandidate(
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
        const sanitized = sanitizeCalendarCandidate(
          {
            id: `device-event-${counter}`,
            title: detected.title,
            date: detected.date,
            time: detected.time,
            ...(detected.location ? { location: detected.location } : {}),
            category: inferPlanCategory(detected.title),
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

    raw.push(...itemCandidates);
  }

  return deduplicatePlanCandidates(raw);
}

export function createCalendarPlanPostHandler(
  deps: CalendarPlanRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/calendar-plan';
  const requireAuth = deps.requireAuth !== false;
  const tokenRegistry = deps.tokenRegistry ?? defaultTokenRegistry;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      if (requireAuth) {
        const auth = tokenRegistry.verifyToken(req);
        if (!auth.ok) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(auth.body, auth.status)
          );
        }

        const rl = rateLimiter.check(auth.tokenHash, now());
        if (!rl.allowed) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(rl.body, rl.status)
          );
        }
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_CALENDAR_PLAN_BYTES);
      if (!bodyRead.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                bodyRead.kind === 'too-large'
                  ? 'Too much message text was sent at once. Please scan fewer messages. (field: items)'
                  : 'The message encoding could not be read. (field: encoding)',
              field: bodyRead.kind === 'too-large' ? 'items' : 'encoding',
            },
            400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request format could not be read. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (!isPlainObject(rawJson)) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please provide messages and today\'s date. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (
        typeof rawJson.todayIso !== 'string' ||
        !parsePlainDate(rawJson.todayIso.trim()).ok
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please provide a valid date in YYYY-MM-DD format. (field: todayIso)',
              field: 'todayIso',
            },
            400
          )
        );
      }

      if (
        !Array.isArray(rawJson.items) ||
        rawJson.items.length > MAX_CALENDAR_PLAN_ITEMS
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Please send up to 20 messages at a time. (field: items)',
              field: 'items',
            },
            400
          )
        );
      }

      const items: CalendarPlanInputItem[] = [];
      for (const rawItem of rawJson.items) {
        if (
          !isPlainObject(rawItem) ||
          typeof rawItem.text !== 'string' ||
          rawItem.text.trim().length === 0 ||
          rawItem.text.length > MAX_CALENDAR_PLAN_ITEM_TEXT_LENGTH ||
          hasLoneSurrogate(rawItem.text)
        ) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(
              {
                error:
                  'Each message must include readable text up to 5,000 characters. (field: items)',
                field: 'items',
              },
              400
            )
          );
        }

        const cleanItem: CalendarPlanInputItem = {
          text: rawItem.text,
        };
        if (typeof rawItem.id === 'string' && rawItem.id.trim().length > 0) {
          cleanItem.id = rawItem.id.trim().slice(0, 100);
        }
        if (
          typeof rawItem.sender === 'string' &&
          rawItem.sender.trim().length > 0 &&
          !hasLoneSurrogate(rawItem.sender)
        ) {
          cleanItem.sender = rawItem.sender.trim().slice(0, 200);
        }
        if (
          typeof rawItem.receivedAt === 'string' &&
          rawItem.receivedAt.trim().length > 0
        ) {
          cleanItem.receivedAt = rawItem.receivedAt.trim().slice(0, 100);
        }
        items.push(cleanItem);
      }

      const todayIso = rawJson.todayIso.trim();
      const baseline = extractDeterministicPlanCandidates(items);

      let output: CalendarPlanRouteResponse = {
        candidates: baseline,
        source: 'device',
      };

      const envSource = deps.env ?? getProcessEnv();
      const apiKey = envSource.AI_API_KEY || envSource.GEMINI_API_KEY;

      if (apiKey && deps.calendarPlanner && items.length > 0) {
        try {
          const aiRaw = await deps.calendarPlanner({ items, todayIso }, apiKey);
          if (Array.isArray(aiRaw) && !didGeminiPlannerFail(aiRaw)) {
            const sanitizedAi: Candidate[] = [];
            for (let i = 0; i < aiRaw.length; i += 1) {
              const sanitized = sanitizeCalendarCandidate(
                aiRaw[i],
                `ai-plan-${i + 1}`
              );
              if (sanitized) {
                sanitizedAi.push(sanitized);
              }
            }

            if (sanitizedAi.length > 0) {
              output = {
                candidates: deduplicatePlanCandidates([
                  ...sanitizedAi,
                  ...baseline,
                ]),
                source: 'ai',
              };
            } else if (baseline.length === 0) {
              output = {
                candidates: [],
                source: 'ai',
              };
            }
          }
        } catch {
          output = {
            candidates: baseline,
            source: 'device',
          };
        }
      }

      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse(output, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}

export function createDecidePostHandler(
  deps: DecideRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/decide';
  const requireAuth = deps.requireAuth !== false;
  const tokenRegistry = deps.tokenRegistry ?? defaultTokenRegistry;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
      if (requireAuth) {
        const auth = tokenRegistry.verifyToken(req);
        if (!auth.ok) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(auth.body, auth.status)
          );
        }

        const rl = rateLimiter.check(auth.tokenHash, now());
        if (!rl.allowed) {
          return logAndReturn(
            deps.logger,
            route,
            startMs,
            now,
            jsonResponse(rl.body, rl.status)
          );
        }
      }

      const bodyRead = await readUtf8BodyWithLimit(req, MAX_DECIDE_BYTES);
      if (!bodyRead.ok) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error:
                bodyRead.kind === 'too-large'
                  ? 'The item is too large to check at once. (field: item)'
                  : 'The message encoding could not be read. (field: encoding)',
              field: bodyRead.kind === 'too-large' ? 'item' : 'encoding',
            },
            400
          )
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(bodyRead.text);
      } catch {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The request format could not be read. (field: body)',
              field: 'body',
            },
            400
          )
        );
      }

      if (!isPlainObject(rawJson)) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'A single item object is required. (field: item)',
              field: 'item',
            },
            400
          )
        );
      }

      const topKeys = Object.keys(rawJson);
      if (topKeys.length !== 1 || topKeys[0] !== 'item') {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Only a single item may be sent for checking. (field: item)',
              field: 'item',
            },
            400
          )
        );
      }

      const rawItem = rawJson.item;
      if (!isPlainObject(rawItem)) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The item details could not be read. (field: item)',
              field: 'item',
            },
            400
          )
        );
      }

      const itemKeys = Object.keys(rawItem);
      if (
        itemKeys.length !== 2 ||
        !itemKeys.includes('channel') ||
        !itemKeys.includes('text')
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'Item must include only channel and text. (field: item)',
              field: 'item',
            },
            400
          )
        );
      }

      if (
        typeof rawItem.channel !== 'string' ||
        !VALID_CHANNELS.has(rawItem.channel)
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The message channel is not recognized. (field: channel)',
              field: 'channel',
            },
            400
          )
        );
      }

      if (
        typeof rawItem.text !== 'string' ||
        rawItem.text.length === 0 ||
        rawItem.text.length > MAX_DECIDE_TEXT_LENGTH ||
        hasLoneSurrogate(rawItem.text)
      ) {
        return logAndReturn(
          deps.logger,
          route,
          startMs,
          now,
          jsonResponse(
            {
              error: 'The message text is missing or too long. (field: text)',
              field: 'text',
            },
            400
          )
        );
      }

      const item = {
        channel: rawItem.channel as Channel,
        text: rawItem.text,
      };

      const envSource = deps.env ?? getProcessEnv();
      const apiKey = envSource.AI_API_KEY || envSource.GEMINI_API_KEY;

      const baseline = deterministicDecide(item);
      let output: DecideOutput = baseline;

      if (apiKey && deps.aiProvider) {
        const providerResult = await deps.aiProvider(item, apiKey);
        output = sanitizeDecideOutput(providerResult, baseline);
      }

      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse(output, 200)
      );
    } catch {
      return logAndReturn(
        deps.logger,
        route,
        startMs,
        now,
        jsonResponse({ error: 'Could not process request.' }, 500)
      );
    }
  };
}
