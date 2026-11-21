import type { GroupCategory, InboxItem } from '@/lib/types';

function receivedAtMs(item: InboxItem): number {
  const ms = Date.parse(item.receivedAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const aImportant = a.priority === 'Important' ? 0 : 1;
    const bImportant = b.priority === 'Important' ? 0 : 1;
    if (aImportant !== bImportant) {
      return aImportant - bImportant;
    }
    return receivedAtMs(b) - receivedAtMs(a);
  });
}

export function filterByTab(
  items: readonly InboxItem[],
  tab: GroupCategory | 'All'
): InboxItem[] {
  const filtered =
    tab === 'All' ? items : items.filter((item) => item.group === tab);
  return sortInbox(filtered);
}

export function filterPromotions(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter((item) => item.priority === 'Promotion')
    .sort((a, b) => receivedAtMs(b) - receivedAtMs(a));
}
