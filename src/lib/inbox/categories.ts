import type { Settings } from '@/lib/types';

export const PROTECTED_INBOX_CATEGORIES = ['All', 'Personal'] as const;

export const DEFAULT_INBOX_CATEGORIES = [
  'Personal',
  'Family',
  'Others',
  'Promotion',
] as const;

export const MAX_INBOX_CATEGORY_LENGTH = 24;

function normalizeCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isProtectedInboxCategory(name: string): boolean {
  const normalized = normalizeCategoryName(name).toLowerCase();
  return PROTECTED_INBOX_CATEGORIES.some(
    (protectedName) => protectedName.toLowerCase() === normalized
  );
}

function getStoredCategories(settings?: Settings): string[] {
  if (settings && Array.isArray(settings.inboxCategories)) {
    const seen = new Set<string>(['personal', 'all']);
    const cleaned: string[] = ['Personal'];
    for (const entry of settings.inboxCategories) {
      if (typeof entry !== 'string') continue;
      const name = normalizeCategoryName(entry);
      if (!name) continue;
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      cleaned.push(name);
    }
    return cleaned;
  }
  return [...DEFAULT_INBOX_CATEGORIES];
}

export function getVisibleInboxCategories(settings?: Settings): string[] {
  if (!settings || settings.inboxCategories === undefined) {
    return ['Personal', 'Family', 'Others', 'All', 'Promotion'];
  }
  const stored = getStoredCategories(settings);
  const others = stored.filter((cat) => !isProtectedInboxCategory(cat));
  return ['Personal', ...others, 'All'];
}

export function addInboxCategory(
  settings: Settings,
  rawName: string
):
  | { ok: true; category: string; settings: Settings }
  | { ok: false; errorMessage: string } {
  const trimmed = normalizeCategoryName(rawName);
  if (trimmed.length === 0) {
    return {
      ok: false,
      errorMessage: 'Please enter a category name first.',
    };
  }
  if (trimmed.length > MAX_INBOX_CATEGORY_LENGTH) {
    return {
      ok: false,
      errorMessage: `Please keep category names to ${MAX_INBOX_CATEGORY_LENGTH} letters or fewer.`,
    };
  }

  const current = getStoredCategories(settings);
  const existingLower = new Set<string>([
    ...PROTECTED_INBOX_CATEGORIES.map((c) => c.toLowerCase()),
    ...current.map((c) => c.toLowerCase()),
  ]);

  if (existingLower.has(trimmed.toLowerCase())) {
    return {
      ok: false,
      errorMessage: `The category "${trimmed}" already exists.`,
    };
  }

  const nextCategories = [...current, trimmed];
  return {
    ok: true,
    category: trimmed,
    settings: {
      ...settings,
      inboxCategories: nextCategories,
    },
  };
}

export function deleteInboxCategory(
  settings: Settings,
  name: string
): { ok: true; settings: Settings } | { ok: false; errorMessage: string } {
  const trimmed = normalizeCategoryName(name);
  if (trimmed.length === 0) {
    return {
      ok: false,
      errorMessage: 'Please choose a category to delete.',
    };
  }

  if (isProtectedInboxCategory(trimmed)) {
    return {
      ok: false,
      errorMessage:
        'Personal and All are built-in categories and cannot be deleted.',
    };
  }

  const current = getStoredCategories(settings);
  const targetLower = trimmed.toLowerCase();
  const exists = current.some((c) => c.toLowerCase() === targetLower);
  if (!exists) {
    return {
      ok: false,
      errorMessage: `The category "${trimmed}" was not found.`,
    };
  }

  const nextCategories = current.filter(
    (c) => c.toLowerCase() !== targetLower
  );

  return {
    ok: true,
    settings: {
      ...settings,
      inboxCategories: nextCategories,
    },
  };
}
