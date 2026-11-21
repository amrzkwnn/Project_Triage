import {
  ALL_CHANNELS,
  type InboxItem,
  type Settings,
} from '@/lib/types';

export type HomeSectionCard = {
  readonly id:
    | 'scam-shield'
    | 'photo-helper'
    | 'inbox'
    | 'media-check'
    | 'calendar';
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

export const HOME_SECTION_CARDS: readonly HomeSectionCard[] = [
  {
    id: 'scam-shield',
    title: 'Scam Shield',
    href: '/scam-shield',
    description: 'Check suspicious messages, links, or screenshots safely.',
  },
  {
    id: 'photo-helper',
    title: 'Photo Helper',
    href: '/photo-helper',
    description: 'Make old or dark family photos clearer in one tap.',
  },
  {
    id: 'inbox',
    title: 'Unified Inbox',
    href: '/inbox',
    description: 'Read important emails, messages, and photo notes in one place.',
  },
  {
    id: 'media-check',
    title: 'AI Media Check',
    href: '/media-check',
    description: 'Check photos for AI signs and learn easy eye checks.',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    href: '/calendar',
    description: 'See your plans and turn paper calendars into reminders.',
  },
] as const;

export const HOME_DECISIONS_EMPTY_MESSAGE =
  'Nothing needs your attention today' as const;

export const DEFAULT_VISIBLE_DECISIONS = 5;

export type HomeDecisionsSelection = {
  visible: InboxItem[];
  totalAwaiting: number;
  hasMore: boolean;
  remainingCount: number;
  emptyMessage?: 'Nothing needs your attention today';
};

function compareReceivedAtAsc(a: InboxItem, b: InboxItem): number {
  const timeA = Date.parse(a.receivedAt);
  const timeB = Date.parse(b.receivedAt);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  const rawCmp = a.receivedAt.localeCompare(b.receivedAt);
  if (rawCmp !== 0) {
    return rawCmp;
  }
  return a.id.localeCompare(b.id);
}

export function selectHomeDecisions(
  items: readonly InboxItem[],
  showAll = false
): HomeDecisionsSelection {
  const qualified = items
    .filter((item) => item.tier === 2 || item.tier === 3)
    .slice()
    .sort((a, b) => {
      // Tier 3 items always come before Tier 2 items
      if (a.tier !== b.tier) {
        return b.tier - a.tier;
      }
      // Within each tier, oldest item first
      return compareReceivedAtAsc(a, b);
    });

  const totalAwaiting = qualified.length;

  if (totalAwaiting === 0) {
    return {
      visible: [],
      totalAwaiting: 0,
      hasMore: false,
      remainingCount: 0,
      emptyMessage: HOME_DECISIONS_EMPTY_MESSAGE,
    };
  }

  if (!showAll && totalAwaiting > DEFAULT_VISIBLE_DECISIONS) {
    return {
      visible: qualified.slice(0, DEFAULT_VISIBLE_DECISIONS),
      totalAwaiting,
      hasMore: true,
      remainingCount: totalAwaiting - DEFAULT_VISIBLE_DECISIONS,
    };
  }

  return {
    visible: qualified,
    totalAwaiting,
    hasMore: false,
    remainingCount: 0,
  };
}

export function countEnabledChannels(settings: Settings): number {
  let count = 0;
  for (const channel of ALL_CHANNELS) {
    if (settings.channels?.[channel] === true) {
      count += 1;
    }
  }
  return count;
}
