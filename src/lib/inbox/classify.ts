import type {
  FamilyMember,
  GroupCategory,
  InboxItemDraft,
  PriorityType,
} from '@/lib/types';
import { normalizeSource } from '@/lib/inbox/parse';

export type ClassifyContext = {
  familyMembers?: readonly FamilyMember[];
};

export type ClassificationResult = {
  group: GroupCategory;
  priority: PriorityType;
  scamWarning: boolean;
  proposeCheckScam: boolean;
};

const MEDICAL_PATTERN =
  /\b(clinic|doctor|dr\.?|hospital|medical|dentist|dental|physician|health\s*cent(?:er|re))\b/i;

const APPOINTMENT_PATTERN = /\b(appointment|check-?up|check\s+up)\b/i;

const VISIT_PATTERN = /\bvisit\b/i;

const URGENT_PATTERN =
  /\b(urgent|emergency|immediately|right\s+now|hospital|accident|asap|help\s+me)\b/i;

const PAYMENT_OR_LINK_PATTERN =
  /https?:\/\/\S+|\$|\b(?:pay|payment|bank|transfer|verify\s+account|gift\s+card|fee)\b|\brm(?:\s*\d|\b)/i;

const PROMO_PATTERN =
  /\b(unsubscribe|sale|discount|promo|newsletter|limited\s+time\s+offer|deal)\b|%\s*off\b/i;

function isFamilySender(
  sender: string | undefined,
  familyMembers: readonly FamilyMember[] | undefined
): boolean {
  if (!sender || !familyMembers || familyMembers.length === 0) {
    return false;
  }

  const normalized = sender.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return familyMembers.some((member) => {
    const name = member.name.trim().toLowerCase();
    const address = member.address.trim().toLowerCase();
    if (name.length > 0 && normalized === name) return true;
    if (address.length > 0 && normalized === address) return true;
    if (address.length > 0 && normalized.includes(`<${address}>`)) return true;
    return false;
  });
}

export function classify(
  draft: Pick<InboxItemDraft, 'source' | 'text' | 'sender'>,
  ctx?: ClassifyContext
): ClassificationResult {
  const text = typeof draft.text === 'string' ? draft.text : '';
  const sender = typeof draft.sender === 'string' ? draft.sender : '';
  const senderAndText = `${sender} ${text}`;
  const canonicalSource = normalizeSource(draft.source) ?? draft.source;

  // Rule 2: Saved family sender (checked before generic email/visit matching so family messages stay in Family)
  if (isFamilySender(draft.sender, ctx?.familyMembers)) {
    const isUrgent = URGENT_PATTERN.test(text);
    return {
      group: 'Family',
      priority: isUrgent ? 'Important' : 'Social',
      scamWarning: false,
      proposeCheckScam: false,
    };
  }

  const hasMedical = MEDICAL_PATTERN.test(senderAndText);
  const hasAppointment = APPOINTMENT_PATTERN.test(text);
  const hasVisit = VISIT_PATTERN.test(text);
  const isUrgentPayment =
    URGENT_PATTERN.test(text) && PAYMENT_OR_LINK_PATTERN.test(text);
  const isPromo = PROMO_PATTERN.test(senderAndText);

  // Rule 1: Clinic / doctor appointment email (or medical appointment/visit on any channel)
  if (
    (hasMedical && (hasAppointment || hasVisit)) ||
    (canonicalSource === 'email' &&
      !isUrgentPayment &&
      (hasAppointment || (hasVisit && !isPromo)))
  ) {
    return {
      group: 'Personal',
      priority: 'Important',
      scamWarning: false,
      proposeCheckScam: false,
    };
  }

  // Rule 3: Unknown sender with urgency + payment/money request or link
  if (isUrgentPayment) {
    return {
      group: 'Others',
      priority: 'Important',
      scamWarning: true,
      proposeCheckScam: true,
    };
  }

  // Rule 4: Promotional email / marketing
  if (isPromo) {
    return {
      group: 'Others',
      priority: 'Promotion',
      scamWarning: false,
      proposeCheckScam: false,
    };
  }

  // Rule 5: Default
  return {
    group: 'Others',
    priority: 'Social',
    scamWarning: false,
    proposeCheckScam: false,
  };
}
