import {
  ALL_CHANNELS,
  type Channel,
  type ClaritySummary,
  type GroupCategory,
  type PriorityType,
} from '@/lib/types';
import { hasLoneSurrogate, parseIngest } from '@/lib/inbox/parse';
import { classify } from '@/lib/inbox/classify';
import { detectEvent } from '@/lib/inbox/events';
import { buildClaritySummary } from '@/lib/ai/summary';
import type { TokenRegistry } from '@/lib/server/auth';
import type { RateLimiter } from '@/lib/server/rateLimit';
import type { EncryptedRelayStore } from '@/lib/server/relay';
import type { SafeLogger } from '@/lib/server/safeLog';

export const MAX_INGEST_BYTES = 10 * 1024 * 1024;
export const MAX_DECIDE_BYTES = 64 * 1024;
const MAX_DECIDE_TEXT_LENGTH = 10_000;

const VALID_CHANNELS = new Set<string>(ALL_CHANNELS);
const VALID_GROUPS = new Set<GroupCategory>(['Personal', 'Family', 'Others']);
const VALID_PRIORITIES = new Set<PriorityType>([
  'Important',
  'Social',
  'Promotion',
]);

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
};

export type DecideAiProvider = (
  item: { channel: Channel; text: string },
  apiKey: string
) => Promise<DecideOutput>;

export type DecideRouteDeps = {
  logger: SafeLogger;
  now?: () => number;
  env?: Record<string, string | undefined>;
  aiProvider?: DecideAiProvider;
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

function deterministicDecide(item: {
  channel: Channel;
  text: string;
}): DecideOutput {
  const classification = classify({
    source: item.channel,
    text: item.text,
  });
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

  return {
    summary,
    group: classification.group,
    priority: classification.priority,
    confidence,
  };
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

  return { summary, group, priority, confidence };
}

export function createDecidePostHandler(
  deps: DecideRouteDeps
): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const route = '/api/decide';

  return async function POST(req: Request): Promise<Response> {
    const startMs = now();
    try {
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
