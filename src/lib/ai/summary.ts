import type {
  Channel,
  ClaritySummary,
  DetectedEvent,
  InboxItemDraft,
} from '@/lib/types';
import { normalizeSource } from '@/lib/inbox/parse';

const SOURCE_LABELS = new Map<Channel, string>([
  ['email', 'From Email'],
  ['whatsappForward', 'From WhatsApp'],
  ['smsPaste', 'From SMS'],
  ['messengerPaste', 'From Messenger'],
  ['photos', 'From Photo'],
]);

const MAX_SUMMARY_LENGTH = 300;

function formatFromApp(source: string): string {
  const canonical = normalizeSource(source);
  return (canonical ? SOURCE_LABELS.get(canonical) : undefined) ?? 'From Message';
}

function toSafeClause(raw: string, maxLen: number): string {
  const cleaned = raw
    .replace(/[.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  return cleaned.slice(0, maxLen).trim();
}

function buildSummaryText(
  whoSent: string,
  rawText: string,
  opts?: { detectedEvent?: DetectedEvent; scamWarning?: boolean }
): string {
  const safeSender = toSafeClause(whoSent, 60) || 'Someone';

  if (opts?.scamWarning) {
    return `${safeSender} sent an urgent message that may be a scam. Do not click any link or pay money before checking it.`.slice(
      0,
      MAX_SUMMARY_LENGTH
    );
  }

  if (opts?.detectedEvent) {
    const { date, time } = opts.detectedEvent;
    return `${safeSender} shared an event on ${date} at ${time}. Please review the details before adding it to your calendar.`.slice(
      0,
      MAX_SUMMARY_LENGTH
    );
  }

  const normalized = rawText.replace(/\s+/g, ' ').trim();
  const rawClauses = normalized
    .split(/[.!?]+/)
    .map((part) => toSafeClause(part, 130))
    .filter((part) => part.length > 0);

  if (rawClauses.length === 0) {
    return `${safeSender} sent a message.`.slice(0, MAX_SUMMARY_LENGTH);
  }

  if (rawClauses.length === 1) {
    return `${rawClauses[0]}.`.slice(0, MAX_SUMMARY_LENGTH);
  }

  const twoSentences = `${rawClauses[0]}. ${rawClauses[1]}.`;
  if (twoSentences.length <= MAX_SUMMARY_LENGTH) {
    return twoSentences;
  }

  return `${rawClauses[0]}.`.slice(0, MAX_SUMMARY_LENGTH);
}

export function buildClaritySummary(
  item: Pick<InboxItemDraft, 'source' | 'sender' | 'text'>,
  opts?: { detectedEvent?: DetectedEvent; scamWarning?: boolean }
): ClaritySummary {
  const fromApp = formatFromApp(item.source);
  const trimmedSender =
    typeof item.sender === 'string' ? item.sender.trim() : '';
  const whoSent = trimmedSender.length > 0 ? trimmedSender : 'Unknown sender';

  let actionNeeded: string;
  if (opts?.scamWarning) {
    actionNeeded = 'Do not click link — check for scam';
  } else if (opts?.detectedEvent) {
    actionNeeded = 'Confirm calendar date';
  } else {
    actionNeeded = 'No action needed';
  }

  const text = buildSummaryText(whoSent, item.text ?? '', opts);

  return {
    fromApp,
    whoSent,
    actionNeeded,
    text,
  };
}
