import type { AuditEntry, Channel, Result } from '../types';

export const AUDIT_EMPTY_MESSAGE = 'The AI has not read anything.';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateTimeToSecond(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

let auditCounter = 0;

export function buildAuditEntry(input: {
  id?: string;
  at?: string;
  kind: 'ai-read' | 'family-share';
  channel?: Channel;
  description: string;
  purpose?: string;
  itemId?: string;
  recipient?: string;
}): Result<AuditEntry, { message: string }> {
  if (typeof input.description !== 'string') {
    return {
      ok: false,
      error: {
        message:
          'Please provide a description between 1 and 200 characters.',
      },
    };
  }

  const trimmedDescription = input.description.trim();
  if (
    trimmedDescription.length < 1 ||
    trimmedDescription.length > 200 ||
    input.description.length > 200
  ) {
    return {
      ok: false,
      error: {
        message:
          'Please provide a description between 1 and 200 characters.',
      },
    };
  }

  if (input.purpose !== undefined) {
    if (typeof input.purpose !== 'string') {
      return {
        ok: false,
        error: {
          message: 'Please provide a purpose between 1 and 200 characters.',
        },
      };
    }
    const trimmedPurpose = input.purpose.trim();
    if (
      trimmedPurpose.length < 1 ||
      trimmedPurpose.length > 200 ||
      input.purpose.length > 200
    ) {
      return {
        ok: false,
        error: {
          message: 'Please provide a purpose between 1 and 200 characters.',
        },
      };
    }
  }

  auditCounter += 1;
  const id =
    typeof input.id === 'string' && input.id.trim().length > 0
      ? input.id
      : `audit-${Date.now()}-${auditCounter}`;
  const at =
    typeof input.at === 'string' && input.at.trim().length > 0
      ? input.at
      : formatLocalDateTimeToSecond();

  const entry: AuditEntry = {
    id,
    at,
    kind: input.kind,
    description: input.description,
  };

  if (input.channel !== undefined) {
    entry.channel = input.channel;
  }
  if (input.purpose !== undefined) {
    entry.purpose = input.purpose;
  }
  if (input.itemId !== undefined) {
    entry.itemId = input.itemId;
  }
  if (input.recipient !== undefined) {
    entry.recipient = input.recipient;
  }

  return { ok: true, value: entry };
}

export function listAuditNewestFirst(
  entries: readonly AuditEntry[]
): AuditEntry[] {
  return entries
    .map((entry) => ({ ...entry }))
    .sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}
