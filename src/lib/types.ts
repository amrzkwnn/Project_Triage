export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Channel =
  | 'email'
  | 'whatsappForward'
  | 'smsPaste'
  | 'messengerPaste'
  | 'photos';

export const ALL_CHANNELS: readonly Channel[] = [
  'email',
  'whatsappForward',
  'smsPaste',
  'messengerPaste',
  'photos',
] as const;

export type GroupCategory = 'Personal' | 'Family' | 'Others' | (string & {});

export type PriorityType = 'Important' | 'Social' | 'Promotion';

export type CalendarCategory =
  | 'Medical'
  | 'Family & Social'
  | 'Bills & Errands'
  | 'Daily Routine';

export type DecisionTier = 1 | 2 | 3;

export type ReminderLead = '15m' | '30m' | '1h' | '2h' | '1d';

export type FamilyMember = {
  id: string;
  name: string;
  address: string;
};

export type Settings = {
  channels: Record<Channel, boolean>;
  allowAiReading: boolean;
  caregiverShareEnabled: boolean;
  pushEnabled: boolean;
  reminderLead: ReminderLead;
  timeFormat?: '12h' | '24h';
  familyCodeWord?: string;
  checklist: Record<string, boolean>;
  familyMembers: FamilyMember[];
  dismissedItemIds?: string[];
  shortcutSetupCompleted?: boolean;
  inboxCategories?: string[];
};

export function createDefaultSettings(): Settings {
  return {
    channels: {
      email: false,
      whatsappForward: false,
      smsPaste: false,
      messengerPaste: false,
      photos: false,
    },
    allowAiReading: false,
    caregiverShareEnabled: false,
    pushEnabled: false,
    reminderLead: '1h',
    timeFormat: '12h',
    checklist: {},
    familyMembers: [],
  };
}

export const DEFAULT_SETTINGS: Settings = createDefaultSettings();

export type ClaritySummary = {
  fromApp: string;
  whoSent: string;
  actionNeeded: string;
  text: string;
};

export type DetectedEvent = {
  date: string;
  time: string;
  location?: string;
  title: string;
  category?: CalendarCategory;
};

export type Attachment = {
  id: string;
  mime: string;
  name: string;
  size?: number;
  dataBase64?: string;
};

export type VerdictValue = 'safe' | 'caution' | 'danger';

export type RedFlagCategory =
  | 'urgency'
  | 'secrecy'
  | 'payment'
  | 'domain-mismatch';

export type Verdict = {
  value: VerdictValue;
  reasons: string[];
  flags: RedFlagCategory[];
};

export type ProposalKind =
  | 'forwardToCalendar'
  | 'checkScam'
  | 'checkAiImage'
  | 'shareWithFamily';

export type Proposal = {
  id: string;
  kind: ProposalKind;
  label: string;
  itemId: string;
  event?: DetectedEvent;
};

export type InboxItem = {
  id: string;
  source: Channel;
  sender?: string;
  senderEmail?: string;
  homeHandled?: boolean;
  text: string;
  attachments: Attachment[];
  receivedAt: string;
  group: GroupCategory;
  priority: PriorityType;
  summary?: ClaritySummary;
  detectedEvent?: DetectedEvent;
  scamWarning?: Verdict;
  mediaCheck?: {
    result: 'AI signal found' | 'Camera signal found' | 'Cannot tell';
    signalName?: string;
    note: string;
  };
  tier: DecisionTier;
  confidence: number;
  status: 'ok' | 'uncategorized-failed';
  proposals?: Proposal[];
};

export type InboxItemDraft = {
  source: string;
  text: string;
  sender?: string;
  attachments: Attachment[];
  receivedAt: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time?: string;
  location?: string;
  category: CalendarCategory;
  sourceItemId?: string;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  kind: 'ai-read' | 'family-share';
  channel?: Channel;
  description: string;
  purpose?: string;
  itemId?: string;
  recipient?: string;
};

export type ExportDocument = {
  schemaVersion: number;
  settings: Settings;
  items: InboxItem[];
  events: CalendarEvent[];
  audit: AuditEntry[];
};

export const LOW_CONFIDENCE_THRESHOLD = 0.6;
