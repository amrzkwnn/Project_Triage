import type { CalendarCategory } from '@/lib/types';

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
