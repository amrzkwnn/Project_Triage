import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toPlainMessage } from '@/lib/errors/plainMessage';

const BANNED_JARGON =
  /\b(sync|token|api|cache|error code|exception|stack|json|indexeddb)\b/i;

const BANNED_TECH_PATTERNS = [
  /\b(TypeError|RangeError|QuotaExceededError|SyntaxError|ReferenceError|URIError)\b/,
  /\bError:/,
  /\bECONNREFUSED\b/,
  /\bENOENT\b/,
  /\bERR_[A-Z0-9_]+\b/,
  /\b(404|500|502|503|504)\b/,
  /\bat\s+\S+\s*\(/,
  /\.(ts|js):\d+/,
];

const ERROR_CODES = [
  'ECONNREFUSED',
  'ENOENT',
  'ERR_NETWORK_TIMEOUT',
  'ERR_HTTP_500',
  'ERR_QUOTA_EXCEEDED',
  'HTTP_500',
  '404',
  '500',
  '503',
];

const ERROR_NAMES = [
  'TypeError',
  'RangeError',
  'QuotaExceededError',
  'SyntaxError',
  'ReferenceError',
  'AbortError',
  'NetworkError',
];

const SAFE_WORDS = [
  'save',
  'open',
  'load',
  'send',
  'check',
  'share',
  'update',
  'remove',
  'your',
  'calendar',
  'event',
  'message',
  'photo',
  'settings',
  'family',
  'list',
];

const actionArb = fc.oneof(
  fc.constantFrom(
    'save your event',
    'open your messages',
    'check that photo',
    'share with family',
    'load your calendar',
    'update your settings',
    '',
    '   '
  ),
  fc
    .array(fc.constantFrom(...SAFE_WORDS), { minLength: 1, maxLength: 5 })
    .map((words) => words.join(' '))
);

const errorInputArb = fc.oneof(
  // Error instance with code, custom name, noisy message, and stack trace
  fc
    .record({
      name: fc.constantFrom(...ERROR_NAMES),
      code: fc.constantFrom(...ERROR_CODES),
      message: fc.oneof(
        fc.constant('Cannot read properties of undefined (reading JSON token)'),
        fc.constant('HTTP 500 Internal Server Error from API cache'),
        fc.constant('IndexedDB transaction failed with QuotaExceededError'),
        fc.constant('fetch failed: ECONNREFUSED 127.0.0.1:3000'),
        fc.string({ minLength: 1, maxLength: 80 })
      ),
      file: fc.constantFrom(
        'src/lib/storage/db.ts:42:11',
        'src/app/api/route.ts:19:5',
        'node_modules/next/dist/server.js:108:3'
      ),
    })
    .map(({ name, code, message, file }) => {
      const err = new Error(message) as Error & { code?: string };
      err.name = name;
      err.code = code;
      err.stack = `${name}: ${message}\n    at runAction (${file})\n    at async handler.js:12:4`;
      return { raw: err as unknown, code, name, stackFile: file };
    }),
  // Plain object with technical fields
  fc
    .record({
      name: fc.constantFrom(...ERROR_NAMES),
      code: fc.constantFrom(...ERROR_CODES),
      message: fc.constant('API sync token expired: HTTP 500'),
      stack: fc.constant('Error: fail\n    at doSync (src/lib/sync.ts:88:9)'),
    })
    .map((obj) => ({
      raw: obj as unknown,
      code: obj.code,
      name: obj.name,
      stackFile: 'src/lib/sync.ts:88:9',
    })),
  // Raw technical strings
  fc
    .oneof(
      fc.constant('ERR_CONNECTION_REFUSED at src/lib/net.ts:14:2'),
      fc.constant('TypeError: JSON parse failed with status 500'),
      fc.constant('QuotaExceededError: IndexedDB cache full'),
      fc.string()
    )
    .map((str) => ({
      raw: str as unknown,
      code: undefined as string | undefined,
      name: undefined as string | undefined,
      stackFile: undefined as string | undefined,
    })),
  // Non-object primitives
  fc.constantFrom(null, undefined, 500, 404, false, {}).map((val) => ({
    raw: val as unknown,
    code: undefined as string | undefined,
    name: undefined as string | undefined,
    stackFile: undefined as string | undefined,
  }))
);

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

describe('Plain-language error formatting', () => {
  // Feature: senior-digital-companion, Property 41: Plain error messages
  it('Property 41: formats any error into <= 25 plain words naming the action and a next step with no technical leaks', () => {
    fc.assert(
      fc.property(errorInputArb, actionArb, (errCase, action) => {
        const message = toPlainMessage(errCase.raw, action);

        expect(typeof message).toBe('string');
        expect(message.trim().length).toBeGreaterThan(0);

        // At most 25 words
        expect(wordCount(message)).toBeLessThanOrEqual(25);

        // Names the action or falls back to "that step"
        const expectedAction = action.trim().toLowerCase() || 'that step';
        expect(message.toLowerCase()).toContain(expectedAction);

        // Includes one clear next step
        expect(message).toMatch(/try again|check your connection|wait a moment/i);

        // Never leaks error code, exception name, stack file, or tech jargon
        if (errCase.code) {
          expect(message).not.toContain(errCase.code);
        }
        if (errCase.name) {
          expect(message).not.toContain(errCase.name);
        }
        if (errCase.stackFile) {
          expect(message).not.toContain(errCase.stackFile);
        }
        expect(message).not.toMatch(BANNED_JARGON);
        for (const pattern of BANNED_TECH_PATTERNS) {
          expect(message).not.toMatch(pattern);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('sanitizes overly long or jargon-containing action inputs while staying <= 25 words', () => {
    const longAction =
      'save your very long appointment details to the personal family schedule for next week and also remind everyone twice';
    const message = toPlainMessage(new TypeError('boom'), longAction);
    expect(wordCount(message)).toBeLessThanOrEqual(25);
    expect(message).toMatch(/try again|check your connection/i);
    expect(message).not.toMatch(BANNED_JARGON);
  });
});
