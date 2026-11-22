import type { CalendarCategory, Channel } from '@/lib/types';
import type { Candidate } from '@/lib/calendar/ocr';
import type { ScamCheckOutput } from '@/lib/scam/verdict';
import type {
  CalendarPlanAiProvider,
  CalendarPlanInputItem,
  DecideAiProvider,
  DecideOutput,
  ScamCheckAiProvider,
} from '@/lib/server/handlers';

export type {
  CalendarPlanAiProvider,
  CalendarPlanInputItem,
  ScamCheckAiProvider,
} from '@/lib/server/handlers';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_GEMINI_TIMEOUT_MS = 8000;

const DEFAULT_GEMINI_PROVIDER_SYMBOL = Symbol.for(
  'senior-companion.default-gemini-provider'
);

const DEFAULT_GEMINI_SCAM_CHECKER_SYMBOL = Symbol.for(
  'senior-companion.default-gemini-scam-checker'
);

const DEFAULT_GEMINI_CALENDAR_PLANNER_SYMBOL = Symbol.for(
  'senior-companion.default-gemini-calendar-planner'
);

const GEMINI_PLANNER_FAILED_SYMBOL = Symbol.for(
  'senior-companion.gemini-planner-failed'
);

function createFailedPlannerResult(): Candidate[] {
  const empty: Candidate[] = [];
  Object.defineProperty(empty, GEMINI_PLANNER_FAILED_SYMBOL, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return empty;
}

export function didGeminiPlannerFail(result: unknown): boolean {
  return (
    Array.isArray(result) &&
    (result as unknown as Record<symbol, unknown>)[
      GEMINI_PLANNER_FAILED_SYMBOL
    ] === true
  );
}

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'OBJECT',
      properties: {
        fromApp: { type: 'STRING' },
        whoSent: { type: 'STRING' },
        actionNeeded: { type: 'STRING' },
        text: { type: 'STRING' },
      },
      required: ['fromApp', 'whoSent', 'actionNeeded', 'text'],
    },
    group: {
      type: 'STRING',
      enum: ['Personal', 'Family', 'Others'],
    },
    priority: {
      type: 'STRING',
      enum: ['Important', 'Social', 'Promotion'],
    },
    confidence: {
      type: 'NUMBER',
    },
    scamWarning: {
      type: 'OBJECT',
      properties: {
        value: {
          type: 'STRING',
          enum: ['safe', 'caution', 'danger'],
        },
        flags: {
          type: 'ARRAY',
          items: {
            type: 'STRING',
            enum: ['urgency', 'secrecy', 'payment', 'domain-mismatch'],
          },
        },
        reasons: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
      },
      required: ['value', 'flags', 'reasons'],
    },
    detectedEvent: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING' },
        time: { type: 'STRING' },
        title: { type: 'STRING' },
        location: { type: 'STRING' },
      },
      required: ['date', 'time', 'title'],
    },
  },
  required: ['summary', 'group', 'priority', 'confidence'],
} as const;

const GEMINI_SCAM_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    value: {
      type: 'STRING',
      enum: ['safe', 'caution', 'danger'],
    },
    flags: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
        enum: ['urgency', 'secrecy', 'payment', 'domain-mismatch'],
      },
    },
    reasons: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    instruction: { type: 'STRING' },
    showAskFamily: { type: 'BOOLEAN' },
  },
  required: ['value', 'flags', 'reasons', 'showAskFamily'],
} as const;

const GEMINI_CALENDAR_PLAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          date: { type: 'STRING' },
          time: { type: 'STRING' },
          location: { type: 'STRING' },
          category: {
            type: 'STRING',
            enum: [
              'Medical',
              'Family & Social',
              'Bills & Errands',
              'Daily Routine',
            ],
          },
          confidence: { type: 'NUMBER' },
        },
        required: ['title', 'date', 'category', 'confidence'],
      },
    },
  },
  required: ['candidates'],
} as const;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function getEnvVar(key: string): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  const value = g.process?.env?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildGeminiPrompt(item: { channel: Channel; text: string }): string {
  const todayIso = getTodayIsoDate();
  return [
    'You are a calm, helpful companion summarizing an incoming message for an older adult.',
    `Today's date is ${todayIso}.`,
    'Write in warm, clear, plain language that is easy to understand at a glance.',
    'Never use technical jargon (do not use words like sync, token, api, cache, oauth, webhook, server, payload, or endpoint).',
    'Return JSON matching the required schema:',
    '- summary.fromApp: friendly source name (for example "Email", "WhatsApp", "Text Message", "Messenger", or "Photo").',
    '- summary.whoSent: plain-language name or description of who sent the message.',
    '- summary.actionNeeded: short, clear next step, or "No action needed".',
    '- summary.text: concise 1 to 2 sentence plain-language summary (under 300 characters).',
    '- group: one of "Personal", "Family", or "Others".',
    '- priority: one of "Important", "Social", or "Promotion".',
    '- confidence: number between 0 and 1.',
    '- scamWarning (optional): include when the message shows any scam, phishing, impersonation, urgency, secrecy, or suspicious payment trick, with value ("safe", "caution", or "danger"), flags, and 1 to 3 short plain-language reasons.',
    '- detectedEvent (optional): include only when the message mentions a real appointment, visit, or event with a date and time. Convert relative dates like "tomorrow" or "next Tuesday" using today\'s date into YYYY-MM-DD and 24-hour HH:MM.',
    '',
    `Channel: ${item.channel}`,
    'Message:',
    item.text,
  ].join('\n');
}

function buildGeminiScamPrompt(text: string): string {
  return [
    'You are a calm, protective scam-safety companion helping an older adult check a suspicious message.',
    'Check carefully for obvious AND subtle scams: fake relatives ("Hi Mum, new number"), bank or parcel impersonation, romance or lottery tricks, urgent pressure, secrecy requests, unusual payment demands, or mismatched web links.',
    'Write in warm, clear, plain language. Never use technical jargon (never use words like sync, token, api, cache, oauth, webhook, regex, payload, or endpoint).',
    'Return JSON matching the required schema:',
    '- value: "danger" for likely scams or clear manipulation, "caution" when something feels suspicious and should be verified first, or "safe" when no warning signs appear.',
    '- flags: matching categories from ["urgency", "secrecy", "payment", "domain-mismatch"].',
    '- reasons: 1 to 3 short, clear plain-language sentences (each under 150 characters) explaining why.',
    '- instruction: clear next step (for example "Do not click or pay" for danger, or "Hang up and call back using a number saved in your contacts" for caution).',
    '- showAskFamily: true for danger or when checking with a trusted family member is helpful, otherwise false.',
    '',
    'Message to check:',
    text,
  ].join('\n');
}

function buildGeminiCalendarPlanPrompt(params: {
  items: readonly CalendarPlanInputItem[];
  todayIso: string;
}): string {
  const formattedItems = params.items
    .map((item, idx) => {
      const meta: string[] = [];
      if (item.sender && item.sender.trim().length > 0) {
        meta.push(`Sender: ${item.sender.trim()}`);
      }
      if (item.receivedAt && item.receivedAt.trim().length > 0) {
        meta.push(`Received: ${item.receivedAt.trim()}`);
      }
      const header =
        meta.length > 0 ? `Item ${idx + 1} (${meta.join(', ')}):` : `Item ${idx + 1}:`;
      return `${header}\n${item.text}`;
    })
    .join('\n\n');

  return [
    'You are a calm, helpful calendar assistant for an older adult.',
    `Today's date is ${params.todayIso}.`,
    'Read the emails, messages, or paper calendar notes below and extract real appointments, medical visits, bills due, family gatherings, or routines.',
    'Convert relative and natural-language dates (such as "tomorrow", "next Tuesday at 2:30 PM", or "Dr. Tan next Thursday 2pm") using today\'s date into exact YYYY-MM-DD dates and 24-hour HH:MM times.',
    'Write short, clear plain-language titles (under 100 characters). Never use technical jargon.',
    'Return JSON matching the required schema with a "candidates" array:',
    '- title: short plain-language event title.',
    '- date: exact calendar date in YYYY-MM-DD format.',
    '- time (optional): 24-hour HH:MM time if mentioned; omit if all-day or no time was given.',
    '- location (optional): clinic, room, or place name if mentioned; omit otherwise.',
    '- category: one of "Medical", "Family & Social", "Bills & Errands", or "Daily Routine".',
    '- confidence: number between 0 and 1 (use below 0.6 if the date was uncertain or unclear).',
    'If no real calendar events are mentioned, return {"candidates": []}.',
    '',
    formattedItems,
  ].join('\n');
}

export function isDefaultGeminiAiProvider(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_PROVIDER_SYMBOL
    ] === true
  );
}

export function isDefaultGeminiScamChecker(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_SCAM_CHECKER_SYMBOL
    ] === true
  );
}

export function isDefaultGeminiCalendarPlanner(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_CALENDAR_PLANNER_SYMBOL
    ] === true
  );
}

export function createGeminiAiProvider(deps?: {
  fetchFn?: typeof fetch;
  model?: string;
  timeoutMs?: number;
}): DecideAiProvider {
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  const provider: DecideAiProvider = async (item, apiKey) => {
    const fetchFn = deps?.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function' || !apiKey) {
      return {} as DecideOutput;
    }

    const model =
      deps?.model?.trim() || getEnvVar('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: buildGeminiPrompt(item) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {} as DecideOutput;
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof rawText !== 'string' || rawText.trim().length === 0) {
        return {} as DecideOutput;
      }

      const parsed: unknown = JSON.parse(rawText);
      if (!isPlainObject(parsed)) {
        return {} as DecideOutput;
      }

      return parsed as unknown as DecideOutput;
    } catch {
      return {} as DecideOutput;
    } finally {
      clearTimeout(timer);
    }
  };

  if (!deps?.model && !deps?.fetchFn && !deps?.timeoutMs) {
    (provider as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_PROVIDER_SYMBOL
    ] = true;
  }

  return provider;
}

export function createGeminiScamChecker(deps?: {
  fetchFn?: typeof fetch;
  model?: string;
  timeoutMs?: number;
}): ScamCheckAiProvider {
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  const checker: ScamCheckAiProvider = async (text, apiKey) => {
    const fetchFn = deps?.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function' || !apiKey) {
      return {};
    }

    const model =
      deps?.model?.trim() || getEnvVar('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: buildGeminiScamPrompt(text) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_SCAM_RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {};
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof rawText !== 'string' || rawText.trim().length === 0) {
        return {};
      }

      const parsed: unknown = JSON.parse(rawText);
      if (!isPlainObject(parsed)) {
        return {};
      }

      return parsed as Partial<ScamCheckOutput>;
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  };

  if (!deps?.model && !deps?.fetchFn && !deps?.timeoutMs) {
    (checker as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_SCAM_CHECKER_SYMBOL
    ] = true;
  }

  return checker;
}

export function createGeminiCalendarPlanner(deps?: {
  fetchFn?: typeof fetch;
  model?: string;
  timeoutMs?: number;
}): CalendarPlanAiProvider {
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  const planner: CalendarPlanAiProvider = async (params, apiKey) => {
    if (!Array.isArray(params.items) || params.items.length === 0) {
      return [];
    }
    const fetchFn = deps?.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function' || !apiKey) {
      return createFailedPlannerResult();
    }

    const model =
      deps?.model?.trim() || getEnvVar('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: buildGeminiCalendarPlanPrompt(params) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_CALENDAR_PLAN_RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return createFailedPlannerResult();
      }

      const data = (await response.json()) as GeminiGenerateContentResponse;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof rawText !== 'string' || rawText.trim().length === 0) {
        return createFailedPlannerResult();
      }

      const parsed: unknown = JSON.parse(rawText);
      const rawList = Array.isArray(parsed)
        ? parsed
        : isPlainObject(parsed) && Array.isArray(parsed.candidates)
          ? parsed.candidates
          : null;

      if (!rawList) {
        return createFailedPlannerResult();
      }

      const results: Candidate[] = [];
      for (let i = 0; i < rawList.length; i += 1) {
        const entry = rawList[i];
        if (!isPlainObject(entry)) continue;
        if (
          typeof entry.title !== 'string' ||
          typeof entry.date !== 'string'
        ) {
          continue;
        }
        const candidate: Candidate = {
          id:
            typeof entry.id === 'string' && entry.id.trim().length > 0
              ? entry.id.trim()
              : `ai-plan-${i + 1}`,
          title: entry.title.trim(),
          date: entry.date.trim(),
          category:
            typeof entry.category === 'string'
              ? (entry.category as CalendarCategory)
              : 'Daily Routine',
          confidence:
            typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
              ? entry.confidence
              : 0.8,
        };
        if (typeof entry.time === 'string' && entry.time.trim().length > 0) {
          candidate.time = entry.time.trim();
        }
        if (
          typeof entry.location === 'string' &&
          entry.location.trim().length > 0
        ) {
          candidate.location = entry.location.trim();
        }
        results.push(candidate);
      }

      return results;
    } catch {
      return createFailedPlannerResult();
    } finally {
      clearTimeout(timer);
    }
  };

  if (!deps?.model && !deps?.fetchFn && !deps?.timeoutMs) {
    (planner as unknown as Record<symbol, unknown>)[
      DEFAULT_GEMINI_CALENDAR_PLANNER_SYMBOL
    ] = true;
  }

  return planner;
}
