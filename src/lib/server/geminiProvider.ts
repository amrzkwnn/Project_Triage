import type { Channel } from '@/lib/types';
import type { DecideAiProvider, DecideOutput } from '@/lib/server/handlers';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_GEMINI_TIMEOUT_MS = 8000;

const DEFAULT_GEMINI_PROVIDER_SYMBOL = Symbol.for(
  'senior-companion.default-gemini-provider'
);

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
  },
  required: ['summary', 'group', 'priority', 'confidence'],
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

function buildGeminiPrompt(item: { channel: Channel; text: string }): string {
  return [
    'You are a calm, helpful companion summarizing an incoming message for an older adult.',
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
    '',
    `Channel: ${item.channel}`,
    'Message:',
    item.text,
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
