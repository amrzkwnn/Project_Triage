import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import type {
  DetectedEvent,
  InboxItemDraft,
  ProposalKind,
} from '@/lib/types';

const DATE_CANDIDATE_PATTERN = /(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/g;
const TIME_CANDIDATE_PATTERN = /(?<!\d:)(?<!\d)(\d{2}:\d{2})(?!\d)/g;
const LINK_PATTERN = /https?:\/\/\S+/i;

const LOCATION_LABEL_PATTERN = /\bLocation:\s*([^\n.,;!?]{1,100})/i;
const ROOM_PATTERN = /\b(Room\s+[A-Za-z0-9][A-Za-z0-9\s-]{0,40})/i;
const AT_LOCATION_PATTERN =
  /\bat\s+(?!\d{1,2}(?::\d{2}|\s*(?:am|pm)\b))([A-Za-z][A-Za-z0-9'& -]{1,80})/i;

function extractLocation(text: string): string | undefined {
  const labeled = LOCATION_LABEL_PATTERN.exec(text);
  if (labeled && labeled[1].trim().length > 0) {
    return labeled[1].trim().slice(0, 100);
  }

  const room = ROOM_PATTERN.exec(text);
  if (room && room[1].trim().length > 0) {
    return room[1].trim().slice(0, 100);
  }

  const atMatch = AT_LOCATION_PATTERN.exec(text);
  if (atMatch) {
    const cleaned = atMatch[1]
      .replace(/\s+(?:on\s+\d{4}-\d{2}-\d{2}|at\s+\d{2}:\d{2}).*$/i, '')
      .trim();
    if (cleaned.length > 0) {
      return cleaned.slice(0, 100);
    }
  }

  return undefined;
}

function extractTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

  const normalized = firstLine
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return 'Upcoming event';
  }

  return normalized.slice(0, 100).trim() || 'Upcoming event';
}

export function detectEvent(text: string): DetectedEvent | undefined {
  if (typeof text !== 'string' || text.length === 0) {
    return undefined;
  }

  let matchedDate: string | undefined;
  for (const match of text.matchAll(DATE_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (parsePlainDate(candidate).ok) {
      matchedDate = candidate;
      break;
    }
  }
  if (!matchedDate) {
    return undefined;
  }

  let matchedTime: string | undefined;
  for (const match of text.matchAll(TIME_CANDIDATE_PATTERN)) {
    const candidate = match[1];
    if (parsePlainTime(candidate).ok) {
      matchedTime = candidate;
      break;
    }
  }
  if (!matchedTime) {
    return undefined;
  }

  const event: DetectedEvent = {
    date: matchedDate,
    time: matchedTime,
    title: extractTitle(text),
  };

  const location = extractLocation(text);
  if (location !== undefined) {
    event.location = location;
  }

  return event;
}

export function availableForwardActions(
  item: Pick<InboxItemDraft, 'text' | 'attachments'>,
  detectedEvent?: DetectedEvent
): ProposalKind[] {
  const actions: ProposalKind[] = [];

  if (detectedEvent !== undefined) {
    actions.push('forwardToCalendar');
  }

  if (typeof item.text === 'string' && LINK_PATTERN.test(item.text)) {
    actions.push('checkScam');
  }

  if (
    Array.isArray(item.attachments) &&
    item.attachments.some(
      (att) => typeof att.mime === 'string' && att.mime.startsWith('image/')
    )
  ) {
    actions.push('checkAiImage');
  }

  actions.push('shareWithFamily');

  return actions;
}
