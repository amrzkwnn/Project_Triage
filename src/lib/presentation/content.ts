export type ProblemPointIcon = 'smartphone' | 'shield' | 'calendar';
export type SolutionFeatureIcon = 'sun' | 'inbox' | 'shieldCheck' | 'sparkles';

export interface PresentationContent {
  brand: {
    name: string;
    tagline: string;
  };
  problem: {
    heading: string;
    copy: string;
    points: ReadonlyArray<{ icon: ProblemPointIcon; label: string }>;
  };
  solution: {
    heading: string;
    features: ReadonlyArray<{
      icon: SolutionFeatureIcon;
      label: string;
      sub: string;
    }>;
    note: string;
  };
}

export const presentationContent: PresentationContent = {
  brand: {
    name: 'Triage Companion',
    tagline: 'Calm daily helper for messages, safety, photos, and plans.',
  },
  problem: {
    heading: 'Daily phone life can feel overwhelming.',
    copy: 'Important clinic dates, family notes, prescriptions, and suspicious links arrive scattered across WhatsApp, SMS, email, and paper calendars.',
    points: [
      { icon: 'smartphone', label: 'Messages scattered across apps' },
      { icon: 'shield', label: 'Hard-to-spot scam & AI tricks' },
      { icon: 'calendar', label: 'Paper dates & photos easy to miss' },
    ],
  },
  solution: {
    heading: 'One calm place. You stay in charge.',
    features: [
      {
        icon: 'sun',
        label: 'Today at a glance',
        sub: 'Important decisions and upcoming plans',
      },
      {
        icon: 'inbox',
        label: 'Unified Inbox & summaries',
        sub: 'Clear source badges and 1-tap actions',
      },
      {
        icon: 'shieldCheck',
        label: 'Scam Shield & AI Media Check',
        sub: 'Traffic-light safety checks before you act',
      },
      {
        icon: 'sparkles',
        label: '1-Tap Photo & Calendar Helpers',
        sub: 'Originals stay safe; nothing saved without Confirm',
      },
    ],
    note: 'Designed for seniors · Private on your device · You confirm every action',
  },
};
