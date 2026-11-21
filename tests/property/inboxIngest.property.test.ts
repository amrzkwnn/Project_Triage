import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  type Attachment,
  type Channel,
  type InboxItem,
  type InboxItemDraft,
} from '@/lib/types';
import {
  DEDUP_WINDOW_MS,
  isDuplicate,
} from '@/lib/inbox/dedup';
import {
  type IngestErrorField,
  type IngestErrorReason,
  parseIngest,
  parseIngestQuery,
} from '@/lib/inbox/parse';
import { printIngest } from '@/lib/inbox/print';

const channelArb: fc.Arbitrary<Channel> = fc.constantFrom(...ALL_CHANNELS);

const channelAliasArb: fc.Arbitrary<{ input: string; canonical: Channel }> =
  fc.constantFrom(
    { input: 'email', canonical: 'email' as Channel },
    { input: 'whatsappForward', canonical: 'whatsappForward' as Channel },
    { input: 'whatsapp', canonical: 'whatsappForward' as Channel },
    { input: 'smsPaste', canonical: 'smsPaste' as Channel },
    { input: 'sms', canonical: 'smsPaste' as Channel },
    { input: 'messengerPaste', canonical: 'messengerPaste' as Channel },
    { input: 'messenger', canonical: 'messengerPaste' as Channel },
    { input: 'photos', canonical: 'photos' as Channel },
    { input: 'photo', canonical: 'photos' as Channel }
  );

const specialTextSnippetArb = fc.constantFrom(
  '<script>alert("xss")</script>',
  '<div class="msg">Hello &amp; welcome</div>',
  'Line 1\nLine 2\r\n"Quoted" & \'single\'',
  '你好世界 👵🏽 Terima kasih — RM50 + 100% = ?&',
  '  leading and trailing spaces  ',
  '\t\n '
);

const validTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 500 }),
  fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 100 }),
      specialTextSnippetArb,
      fc.string({ minLength: 0, maxLength: 100 })
    )
    .map(([a, b, c]) => `${a}${b}${c}`)
);

const validSenderArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.oneof(
    fc.string({ minLength: 0, maxLength: 256 }),
    fc.constantFrom(
      'Dr. Tan <clinic@health.example>',
      'Amina 🌸',
      '""',
      ''
    )
  ),
  { nil: undefined }
);

const attachmentArb: fc.Arbitrary<Attachment> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 32 }),
    mime: fc.constantFrom(
      'image/png',
      'image/jpeg',
      'application/pdf',
      'text/plain'
    ),
    name: fc.string({ minLength: 1, maxLength: 64 }),
    size: fc.option(fc.integer({ min: 0, max: 5_000_000 }), { nil: undefined }),
    dataBase64: fc.option(fc.base64String({ minLength: 0, maxLength: 64 }), {
      nil: undefined,
    }),
  })
  .map((raw) => {
    const att: Attachment = { id: raw.id, mime: raw.mime, name: raw.name };
    if (raw.size !== undefined) att.size = raw.size;
    if (raw.dataBase64 !== undefined) att.dataBase64 = raw.dataBase64;
    return att;
  });

const isoUtcArb: fc.Arbitrary<string> = fc
  .integer({ min: 1_577_836_800_000, max: 1_893_456_000_000 })
  .map((ms) => new Date(ms).toISOString());

const validDraftArb: fc.Arbitrary<InboxItemDraft> = fc
  .record({
    source: channelArb,
    text: validTextArb,
    sender: validSenderArb,
    attachments: fc.array(attachmentArb, { minLength: 0, maxLength: 10 }),
    receivedAt: isoUtcArb,
  })
  .map((raw) => {
    const draft: InboxItemDraft = {
      source: raw.source,
      text: raw.text,
      attachments: raw.attachments,
      receivedAt: raw.receivedAt,
    };
    if (raw.sender !== undefined) {
      draft.sender = raw.sender;
    }
    return draft;
  });

const RECOGNIZED_SOURCES = new Set([
  'email',
  'whatsappforward',
  'whatsapp',
  'smspaste',
  'sms',
  'messengerpaste',
  'messenger',
  'photos',
  'photo',
]);

describe('Inbox ingest parsing, printing, query decoding, validation, and deduplication', () => {
  // Feature: senior-digital-companion, Property 18: Ingest parse and print round trip
  it('Property 18: round-trips any valid InboxItemDraft through printIngest and parseIngest byte-for-byte', () => {
    fc.assert(
      fc.property(validDraftArb, (draft) => {
        const printed = printIngest(draft);
        const parsed = parseIngest(printed);

        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.value).toEqual(draft);
        expect(parsed.value.text).toBe(draft.text);
        expect(printIngest(parsed.value)).toBe(printed);

        // Also round-trips when passed directly as an object
        const parsedObj = parseIngest(draft);
        expect(parsedObj.ok).toBe(true);
        if (parsedObj.ok) {
          expect(parsedObj.value).toEqual(draft);
        }
      }),
      { numRuns: 100 }
    );

    // Explicitly verify 10,000-char boundary and HTML/script preservation
    const boundaryText = `<script>alert("x")</script>${'a'.repeat(10_000 - 27)}`;
    expect(boundaryText.length).toBe(10_000);
    const boundaryDraft: InboxItemDraft = {
      source: 'email',
      text: boundaryText,
      sender: 's'.repeat(256),
      attachments: [],
      receivedAt: '2025-05-01T10:00:00.000Z',
    };
    const roundTripped = parseIngest(printIngest(boundaryDraft));
    expect(roundTripped.ok).toBe(true);
    if (roundTripped.ok) {
      expect(roundTripped.value).toEqual(boundaryDraft);
    }
  });

  // Feature: senior-digital-companion, Property 19: Query parameter decoding
  it('Property 19: decodes percent-encoded UTF-8 query parameters and normalizes source aliases', () => {
    fc.assert(
      fc.property(
        channelAliasArb,
        validTextArb,
        validSenderArb,
        ({ input: sourceInput, canonical }, text, sender) => {
          const usp = new URLSearchParams();
          usp.set('source', sourceInput);
          usp.set('text', text);
          if (sender !== undefined) {
            usp.set('sender', sender);
          }

          // 1. From URLSearchParams instance
          const fromParams = parseIngestQuery(usp);
          expect(fromParams.ok).toBe(true);
          if (!fromParams.ok) return;
          expect(fromParams.value.source).toBe(canonical);
          expect(fromParams.value.text).toBe(text);
          expect(fromParams.value.sender).toBe(sender);

          // 2. From URLSearchParams serialized string
          const fromUspString = parseIngestQuery(`?${usp.toString()}`);
          expect(fromUspString.ok).toBe(true);
          if (!fromUspString.ok) return;
          expect(fromUspString.value.source).toBe(canonical);
          expect(fromUspString.value.text).toBe(text);
          expect(fromUspString.value.sender).toBe(sender);

          // 3. From encodeURIComponent query string
          let encoded = `source=${encodeURIComponent(sourceInput)}&text=${encodeURIComponent(text)}`;
          if (sender !== undefined) {
            encoded += `&sender=${encodeURIComponent(sender)}`;
          }
          const fromEncoded = parseIngestQuery(encoded);
          expect(fromEncoded.ok).toBe(true);
          if (!fromEncoded.ok) return;
          expect(fromEncoded.value.source).toBe(canonical);
          expect(fromEncoded.value.text).toBe(text);
          expect(fromEncoded.value.sender).toBe(sender);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 20: Malformed ingest is rejected with the failing field
  it('Property 20: rejects malformed payloads with the exact failing field and reason', () => {
    type InvalidCase = {
      raw: unknown;
      expectedField: IngestErrorField;
      expectedReason: IngestErrorReason;
    };

    const invalidCaseArb: fc.Arbitrary<InvalidCase> = fc.oneof(
      // Missing body
      fc.constantFrom<InvalidCase>(
        { raw: undefined, expectedField: 'body', expectedReason: 'missing' },
        { raw: null, expectedField: 'body', expectedReason: 'missing' },
        { raw: '', expectedField: 'body', expectedReason: 'missing' },
        { raw: '   ', expectedField: 'body', expectedReason: 'missing' }
      ),
      // Malformed body
      fc.constantFrom<InvalidCase>(
        { raw: '{not valid json', expectedField: 'body', expectedReason: 'malformed' },
        { raw: '[1, 2, 3]', expectedField: 'body', expectedReason: 'malformed' },
        { raw: '42', expectedField: 'body', expectedReason: 'malformed' },
        { raw: 123, expectedField: 'body', expectedReason: 'malformed' },
        { raw: [], expectedField: 'body', expectedReason: 'malformed' }
      ),
      // Missing source
      fc.constantFrom<InvalidCase>(
        { raw: { text: 'hello' }, expectedField: 'source', expectedReason: 'missing' },
        { raw: { source: '', text: 'hello' }, expectedField: 'source', expectedReason: 'missing' },
        { raw: { source: '   ', text: 'hello' }, expectedField: 'source', expectedReason: 'missing' }
      ),
      // Source > 64 chars
      fc.integer({ min: 65, max: 120 }).map((len) => ({
        raw: { source: 'a'.repeat(len), text: 'hello' },
        expectedField: 'source' as IngestErrorField,
        expectedReason: 'too-long' as IngestErrorReason,
      })),
      // Unrecognized source
      fc
        .string({ minLength: 1, maxLength: 64 })
        .filter(
          (s) =>
            s.trim().length > 0 &&
            !RECOGNIZED_SOURCES.has(s.trim().toLowerCase())
        )
        .map((badSource) => ({
          raw: { source: badSource, text: 'hello' },
          expectedField: 'source' as IngestErrorField,
          expectedReason: 'unrecognized-source' as IngestErrorReason,
        })),
      // Missing text
      fc.constantFrom<InvalidCase>(
        { raw: { source: 'email' }, expectedField: 'text', expectedReason: 'missing' },
        { raw: { source: 'email', text: '' }, expectedField: 'text', expectedReason: 'missing' }
      ),
      // Text > 10,000 chars
      fc.integer({ min: 10_001, max: 10_500 }).map((len) => ({
        raw: { source: 'email', text: 'x'.repeat(len) },
        expectedField: 'text' as IngestErrorField,
        expectedReason: 'too-long' as IngestErrorReason,
      })),
      // Lone UTF-16 surrogates (invalid UTF-8)
      fc
        .constantFrom('\uD800', '\uDBFF', '\uDC00', '\uDFFF', 'hi\uD83Dthere', 'bad\uDE00end')
        .map((badUtf8) => ({
          raw: { source: 'email', text: badUtf8 },
          expectedField: 'encoding' as IngestErrorField,
          expectedReason: 'malformed' as IngestErrorReason,
        })),
      // Sender > 256 chars
      fc.integer({ min: 257, max: 400 }).map((len) => ({
        raw: { source: 'email', text: 'hello', sender: 's'.repeat(len) },
        expectedField: 'sender' as IngestErrorField,
        expectedReason: 'too-long' as IngestErrorReason,
      })),
      // Attachments > 10 items
      fc.integer({ min: 11, max: 15 }).map((count) => ({
        raw: {
          source: 'email',
          text: 'hello',
          attachments: Array.from({ length: count }, (_, idx) => ({
            id: `att-${idx}`,
            mime: 'image/png',
            name: `img-${idx}.png`,
          })),
        },
        expectedField: 'attachments' as IngestErrorField,
        expectedReason: 'too-long' as IngestErrorReason,
      })),
      // Malformed receivedAt
      fc
        .constantFrom(
          'not-a-date',
          '2025-02-30T10:00:00.000Z',
          '2025-13-01T00:00:00Z',
          '2025-05-01',
          ''
        )
        .map((badTime) => ({
          raw: { source: 'email', text: 'hello', receivedAt: badTime },
          expectedField: 'receivedAt' as IngestErrorField,
          expectedReason: 'malformed' as IngestErrorReason,
        }))
    );

    fc.assert(
      fc.property(invalidCaseArb, ({ raw, expectedField, expectedReason }) => {
        const result = parseIngest(raw);
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.field).toBe(expectedField);
        expect(result.error.reason).toBe(expectedReason);
        expect(result.error.message.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );

    // Invalid percent-encoding in query string
    const badQuery = parseIngestQuery('source=email&text=%E0%A4%A');
    expect(badQuery.ok).toBe(false);
    if (!badQuery.ok) {
      expect(badQuery.error.field).toBe('encoding');
      expect(badQuery.error.reason).toBe('malformed');
    }
  });

  // Feature: senior-digital-companion, Property 21: Duplicate ingest within 24 hours
  it('Property 21: detects duplicates iff same canonical source, byte-identical text, and received within preceding 24h', () => {
    expect(DEDUP_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    fc.assert(
      fc.property(
        channelAliasArb,
        channelArb,
        validTextArb,
        fc.integer({ min: 1_650_000_000_000, max: 1_850_000_000_000 }),
        fc.integer({ min: 0, max: DEDUP_WINDOW_MS }),
        fc.integer({ min: DEDUP_WINDOW_MS + 1, max: DEDUP_WINDOW_MS * 3 }),
        (
          { input: draftSource, canonical },
          otherChannel,
          text,
          nowMs,
          withinDelta,
          outsideDelta
        ) => {
          const draft = {
            source: draftSource,
            text,
            receivedAt: new Date(nowMs).toISOString(),
          };

          const existingWithin: Pick<InboxItem, 'source' | 'text' | 'receivedAt'> = {
            source: canonical,
            text,
            receivedAt: new Date(nowMs - withinDelta).toISOString(),
          };

          const existingOutside: Pick<InboxItem, 'source' | 'text' | 'receivedAt'> = {
            source: canonical,
            text,
            receivedAt: new Date(nowMs - outsideDelta).toISOString(),
          };

          const existingFuture: Pick<InboxItem, 'source' | 'text' | 'receivedAt'> = {
            source: canonical,
            text,
            receivedAt: new Date(nowMs + 1000).toISOString(),
          };

          const existingDifferentText: Pick<InboxItem, 'source' | 'text' | 'receivedAt'> = {
            source: canonical,
            text: `${text} `,
            receivedAt: new Date(nowMs - withinDelta).toISOString(),
          };

          // Match within 24 hours -> true
          expect(isDuplicate(draft, [existingWithin])).toBe(true);
          expect(isDuplicate(draft, [existingOutside, existingWithin])).toBe(true);

          // Outside 24 hours -> false
          expect(isDuplicate(draft, [existingOutside])).toBe(false);

          // Future timestamp -> false
          expect(isDuplicate(draft, [existingFuture])).toBe(false);

          // Even 1 extra space makes text not byte-identical -> false
          expect(isDuplicate(draft, [existingDifferentText])).toBe(false);

          // Different canonical source -> false
          if (otherChannel !== canonical) {
            const existingDifferentSource: Pick<
              InboxItem,
              'source' | 'text' | 'receivedAt'
            > = {
              source: otherChannel,
              text,
              receivedAt: new Date(nowMs - withinDelta).toISOString(),
            };
            expect(isDuplicate(draft, [existingDifferentSource])).toBe(false);
          }

          // Explicit nowMs override takes precedence over draft.receivedAt
          expect(
            isDuplicate(
              draft,
              [existingWithin],
              nowMs - withinDelta + DEDUP_WINDOW_MS + 1
            )
          ).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
