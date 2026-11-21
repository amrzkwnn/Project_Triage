import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import type {
  Attachment,
  Channel,
  InboxItemDraft,
  Result,
} from '@/lib/types';

export type IngestErrorField =
  | 'source'
  | 'text'
  | 'sender'
  | 'attachments'
  | 'encoding'
  | 'body'
  | 'receivedAt';

export type IngestErrorReason =
  | 'missing'
  | 'too-long'
  | 'malformed'
  | 'unrecognized-source';

export type IngestError = {
  field: IngestErrorField;
  reason: IngestErrorReason;
  message: string;
};

const MAX_SOURCE_LENGTH = 64;
const MAX_TEXT_LENGTH = 10_000;
const MAX_SENDER_LENGTH = 256;
const MAX_ATTACHMENTS = 10;

const CHANNEL_LOOKUP: Record<string, Channel> = {
  email: 'email',
  whatsappforward: 'whatsappForward',
  whatsapp: 'whatsappForward',
  smspaste: 'smsPaste',
  sms: 'smsPaste',
  messengerpaste: 'messengerPaste',
  messenger: 'messengerPaste',
  photos: 'photos',
  photo: 'photos',
};

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

export function normalizeSource(raw: string): Channel | undefined {
  if (typeof raw !== 'string') return undefined;
  return CHANNEL_LOOKUP[raw.trim().toLowerCase()];
}

export function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
      } else {
        return true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isValidIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const datePart = match[1];
  const hmPart = match[2];
  const seconds = Number(match[3]);
  if (seconds < 0 || seconds > 59) return false;

  if (!parsePlainDate(datePart).ok) return false;
  if (!parsePlainTime(hmPart).ok) return false;

  if (match[4] !== 'Z') {
    const offHours = Number(match[6]);
    const offMinutes = Number(match[7]);
    if (offHours > 23 || offMinutes > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

function parseAttachment(raw: unknown): Attachment | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.length === 0) return undefined;
  if (typeof rec.mime !== 'string' || rec.mime.length === 0) return undefined;
  if (typeof rec.name !== 'string' || rec.name.length === 0) return undefined;
  if (
    hasLoneSurrogate(rec.id) ||
    hasLoneSurrogate(rec.mime) ||
    hasLoneSurrogate(rec.name)
  ) {
    return undefined;
  }

  const att: Attachment = {
    id: rec.id,
    mime: rec.mime,
    name: rec.name,
  };

  if (rec.size !== undefined) {
    if (
      typeof rec.size !== 'number' ||
      !Number.isFinite(rec.size) ||
      rec.size < 0
    ) {
      return undefined;
    }
    att.size = rec.size;
  }

  if (rec.dataBase64 !== undefined) {
    if (typeof rec.dataBase64 !== 'string' || hasLoneSurrogate(rec.dataBase64)) {
      return undefined;
    }
    att.dataBase64 = rec.dataBase64;
  }

  return att;
}

function fail(
  field: IngestErrorField,
  reason: IngestErrorReason,
  message: string
): Result<InboxItemDraft, IngestError> {
  return { ok: false, error: { field, reason, message } };
}

export function parseIngest(raw: unknown): Result<InboxItemDraft, IngestError> {
  if (raw === undefined || raw === null) {
    return fail('body', 'missing', 'No message details were provided.');
  }

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) {
      return fail('body', 'missing', 'No message details were provided.');
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(
        'body',
        'malformed',
        'The message format could not be read. Please try again.'
      );
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(
      'body',
      'malformed',
      'The message format could not be read. Please try again.'
    );
  }

  const record = parsed as Record<string, unknown>;

  // Validate source
  if (record.source === undefined || record.source === null) {
    return fail('source', 'missing', 'Please choose where this message came from.');
  }
  if (typeof record.source !== 'string') {
    return fail(
      'source',
      'malformed',
      'The message source could not be read. Please try again.'
    );
  }
  if (record.source.length === 0) {
    return fail('source', 'missing', 'Please choose where this message came from.');
  }
  if (record.source.length > MAX_SOURCE_LENGTH) {
    return fail(
      'source',
      'too-long',
      'The message source name is too long. Please choose a supported app.'
    );
  }
  if (record.source.trim().length === 0) {
    return fail('source', 'missing', 'Please choose where this message came from.');
  }
  const canonicalSource = normalizeSource(record.source);
  if (!canonicalSource) {
    return fail(
      'source',
      'unrecognized-source',
      'This message app is not recognized. Please pick Email, WhatsApp, SMS, Messenger, or Photos.'
    );
  }

  // Validate text (preserve byte-for-byte; never strip or mutate)
  if (record.text === undefined || record.text === null) {
    return fail('text', 'missing', 'Please include the message text.');
  }
  if (typeof record.text !== 'string') {
    return fail('text', 'malformed', 'The message text could not be read.');
  }
  if (record.text.length === 0) {
    return fail('text', 'missing', 'Please include the message text.');
  }
  if (hasLoneSurrogate(record.text)) {
    return fail(
      'encoding',
      'malformed',
      'The message text contains unsupported characters and could not be read.'
    );
  }
  if (record.text.length > MAX_TEXT_LENGTH) {
    return fail(
      'text',
      'too-long',
      'This message is too long to add at once. Please shorten it to 10,000 characters or fewer.'
    );
  }

  // Validate optional sender
  let sender: string | undefined;
  if (record.sender !== undefined) {
    if (typeof record.sender !== 'string') {
      return fail('sender', 'malformed', 'The sender name could not be read.');
    }
    if (hasLoneSurrogate(record.sender)) {
      return fail(
        'encoding',
        'malformed',
        'The sender name contains unsupported characters and could not be read.'
      );
    }
    if (record.sender.length > MAX_SENDER_LENGTH) {
      return fail(
        'sender',
        'too-long',
        'The sender name is too long. Please keep it to 256 characters or fewer.'
      );
    }
    sender = record.sender;
  }

  // Validate optional attachments
  const attachments: Attachment[] = [];
  if (record.attachments !== undefined) {
    if (!Array.isArray(record.attachments)) {
      return fail(
        'attachments',
        'malformed',
        'The attached files could not be read.'
      );
    }
    if (record.attachments.length > MAX_ATTACHMENTS) {
      return fail(
        'attachments',
        'too-long',
        'Too many attachments were included. Please keep it to 10 or fewer.'
      );
    }
    for (const rawAtt of record.attachments) {
      const parsedAtt = parseAttachment(rawAtt);
      if (!parsedAtt) {
        return fail(
          'attachments',
          'malformed',
          'One of the attachments could not be read.'
        );
      }
      attachments.push(parsedAtt);
    }
  }

  // Validate optional receivedAt
  let receivedAt: string;
  if (record.receivedAt === undefined) {
    receivedAt = new Date().toISOString();
  } else {
    if (
      typeof record.receivedAt !== 'string' ||
      !isValidIsoTimestamp(record.receivedAt)
    ) {
      return fail(
        'receivedAt',
        'malformed',
        'The time this message arrived could not be read.'
      );
    }
    receivedAt = record.receivedAt;
  }

  const draft: InboxItemDraft = {
    source: canonicalSource,
    text: record.text,
    attachments,
    receivedAt,
  };
  if (sender !== undefined) {
    draft.sender = sender;
  }

  return { ok: true, value: draft };
}

export function parseIngestQuery(
  params: URLSearchParams | string
): Result<InboxItemDraft, IngestError> {
  const payload: Record<string, string> = {};

  if (typeof params === 'string') {
    const query = params.startsWith('?') ? params.slice(1) : params;
    if (query.length > 0) {
      const parts = query.split('&');
      for (const part of parts) {
        if (part.length === 0) continue;
        const eqIdx = part.indexOf('=');
        const rawKey = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
        const rawVal = eqIdx >= 0 ? part.slice(eqIdx + 1) : '';
        let key: string;
        let val: string;
        try {
          key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
          val = decodeURIComponent(rawVal.replace(/\+/g, ' '));
        } catch {
          return fail(
            'encoding',
            'malformed',
            'The shared link contains invalid text encoding and could not be read.'
          );
        }
        if (
          (key === 'source' ||
            key === 'text' ||
            key === 'sender' ||
            key === 'receivedAt') &&
          !(key in payload)
        ) {
          payload[key] = val;
        }
      }
    }
  } else {
    for (const key of ['source', 'text', 'sender', 'receivedAt'] as const) {
      if (params.has(key)) {
        const value = params.get(key);
        if (value !== null) {
          payload[key] = value;
        }
      }
    }
  }

  return parseIngest(payload);
}
