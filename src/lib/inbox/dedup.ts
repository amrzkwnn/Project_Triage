import type { InboxItem, InboxItemDraft } from '@/lib/types';
import { normalizeSource } from '@/lib/inbox/parse';

export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isDuplicate(
  draft: Pick<InboxItemDraft, 'source' | 'text' | 'receivedAt'>,
  existing: readonly Pick<InboxItem, 'source' | 'text' | 'receivedAt'>[],
  nowMs?: number
): boolean {
  const refMs = nowMs ?? Date.parse(draft.receivedAt);
  if (!Number.isFinite(refMs)) {
    return false;
  }

  const draftSource = normalizeSource(draft.source) ?? draft.source;

  return existing.some((item) => {
    const itemSource = normalizeSource(item.source) ?? item.source;
    if (itemSource !== draftSource) return false;
    if (item.text !== draft.text) return false;

    const itemMs = Date.parse(item.receivedAt);
    if (!Number.isFinite(itemMs)) return false;

    const diff = refMs - itemMs;
    return diff >= 0 && diff <= DEDUP_WINDOW_MS;
  });
}
