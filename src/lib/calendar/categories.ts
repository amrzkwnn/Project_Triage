import type { CalendarCategory } from '@/lib/types';

export type { CalendarCategory } from '@/lib/types';

export const CALENDAR_CATEGORIES: readonly CalendarCategory[] = [
  'Medical',
  'Family & Social',
  'Bills & Errands',
  'Daily Routine',
] as const;

export type CategoryMeta = {
  category: CalendarCategory;
  iconName: string;
  label: CalendarCategory;
  badgeClass: string;
  borderClass: string;
};

export const CALENDAR_CATEGORY_META: Record<CalendarCategory, CategoryMeta> = {
  Medical: {
    category: 'Medical',
    iconName: 'Stethoscope',
    label: 'Medical',
    badgeClass: 'bg-rose-50 text-[#BE123C] border-[#BE123C]',
    borderClass: 'border-[#BE123C]',
  },
  'Family & Social': {
    category: 'Family & Social',
    iconName: 'Users',
    label: 'Family & Social',
    badgeClass: 'bg-teal-50 text-[#0F766E] border-[#0F766E]',
    borderClass: 'border-[#0F766E]',
  },
  'Bills & Errands': {
    category: 'Bills & Errands',
    iconName: 'Receipt',
    label: 'Bills & Errands',
    badgeClass: 'bg-amber-50 text-[#B45309] border-[#D97706]',
    borderClass: 'border-[#D97706]',
  },
  'Daily Routine': {
    category: 'Daily Routine',
    iconName: 'Sun',
    label: 'Daily Routine',
    badgeClass: 'bg-emerald-50 text-[#15803D] border-[#15803D]',
    borderClass: 'border-[#15803D]',
  },
};

const CATEGORY_META_MAP = new Map<CalendarCategory, CategoryMeta>(
  CALENDAR_CATEGORIES.map((category) => [
    category,
    CALENDAR_CATEGORY_META[category],
  ])
);

export function getCategoryMeta(category: CalendarCategory): CategoryMeta {
  return CATEGORY_META_MAP.get(category) ?? CALENDAR_CATEGORY_META['Daily Routine'];
}

const MEDICAL_CALENDAR_PATTERN =
  /\b(doctor|dr\.?|clinic|hospital|medical|dentist|dental|pharmacy|medicine|medication|pill|pills|checkup|check-up|check\s+up|lab|x-ray|therapy|physio|vaccine|prescription|nurse|physician|surgeon|health\s*cent(?:er|re))\b/i;

const FAMILY_SOCIAL_CALENDAR_PATTERN =
  /\b(family|dinner|lunch|breakfast|brunch|supper|birthday|anniversary|grandchild|grandchildren|grandson|granddaughter|daughter|son|sister|brother|friend|friends|wedding|party|reunion|coffee|tea|gathering|picnic|potluck|outing|club|church|mosque|temple)\b/i;

const BILLS_ERRANDS_CALENDAR_PATTERN =
  /\b(bill|bills|pay|payment|bank|rent|electric|electricity|tnb|water|utility|utilities|tax|insurance|grocer|grocery|groceries|market|shop|shopping|post\s+office|errand|errands|repair|plumber|electrician|invoice|renew|renewal)\b/i;

const SOCIAL_VISIT_PATTERN = /\bvisit(?:ing)?\b/i;

export function inferCalendarCategory(text: string): CalendarCategory {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'Daily Routine';
  }
  if (MEDICAL_CALENDAR_PATTERN.test(text)) {
    return 'Medical';
  }
  if (FAMILY_SOCIAL_CALENDAR_PATTERN.test(text)) {
    return 'Family & Social';
  }
  if (BILLS_ERRANDS_CALENDAR_PATTERN.test(text)) {
    return 'Bills & Errands';
  }
  if (SOCIAL_VISIT_PATTERN.test(text)) {
    return 'Family & Social';
  }
  return 'Daily Routine';
}
