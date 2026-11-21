import type { Attachment, InboxItemDraft } from '@/lib/types';
import { normalizeSource } from '@/lib/inbox/parse';

function canonicalAttachment(att: Attachment): Attachment {
  const out: Attachment = {
    id: att.id,
    mime: att.mime,
    name: att.name,
  };
  if (att.size !== undefined) {
    out.size = att.size;
  }
  if (att.dataBase64 !== undefined) {
    out.dataBase64 = att.dataBase64;
  }
  return out;
}

export function printIngest(draft: InboxItemDraft): string {
  const canonicalSource = normalizeSource(draft.source) ?? draft.source;
  const canonical: Record<string, unknown> = {
    source: canonicalSource,
    text: draft.text,
  };

  if (draft.sender !== undefined) {
    canonical.sender = draft.sender;
  }

  canonical.attachments = (draft.attachments ?? []).map(canonicalAttachment);
  canonical.receivedAt = draft.receivedAt;

  return JSON.stringify(canonical);
}
