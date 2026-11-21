import type { Result, Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { cloneSettingsWithAllChannels } from '@/lib/vault/settings';

export type SafetyHabit = {
  id: 'urgency' | 'secrecy' | 'unusual-payment' | 'hang-up-call-back';
  title: string;
  description: string;
};

export const SAFETY_HABITS: readonly SafetyHabit[] = [
  {
    id: 'urgency',
    title: 'Watch for Urgency',
    description:
      'Scammers try to make you panic and act right now. Real banks and clinics give you time to check.',
  },
  {
    id: 'secrecy',
    title: 'Watch for Secrecy',
    description:
      'Anyone who says "do not tell your family" is trying to isolate you. Always pause and check with someone you trust.',
  },
  {
    id: 'unusual-payment',
    title: 'Watch for Unusual Payment',
    description:
      'Never pay with gift cards, crypto, wire transfers, or share your PIN or OTP code over a call or message.',
  },
  {
    id: 'hang-up-call-back',
    title: 'Hang Up & Call Back',
    description:
      'If a call or message feels strange, hang up and call back using a number already saved in your contacts.',
  },
] as const;

export type ChecklistStep = {
  id: string;
  title: string;
  description: string;
};

export const SAFE_PHONE_CHECKLIST_STEPS: readonly ChecklistStep[] = [
  {
    id: 'whatsapp-profile-contacts',
    title: 'Set WhatsApp profile photo to My Contacts',
    description:
      'In WhatsApp Settings -> Privacy -> Profile Photo, choose My Contacts so strangers cannot see your photo.',
  },
  {
    id: 'silence-unknown-callers',
    title: 'Silence unknown callers',
    description:
      'Turn on Silence Unknown Callers in your phone and WhatsApp settings to cut down scam calls.',
  },
  {
    id: 'set-screen-lock',
    title: 'Set a phone screen lock',
    description:
      'Use a PIN, fingerprint, or face unlock so your messages and photos stay private if your phone is misplaced.',
  },
] as const;

export function validateCodeWord(s: string): Result<string, 'empty' | 'too-long'> {
  if (s.length === 0 || s.trim().length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (s.length > 50) {
    return { ok: false, error: 'too-long' };
  }
  return { ok: true, value: s };
}

export async function saveFamilyCodeWord(
  vault: Vault,
  current: Settings,
  input: string
): Promise<
  Result<
    Settings,
    { reason: 'empty' | 'too-long' | 'store-error'; message: string }
  >
> {
  const validation = validateCodeWord(input);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        reason: validation.error,
        message:
          validation.error === 'empty'
            ? 'Please enter a family code word before saving.'
            : 'Please keep your family code word to 50 characters or fewer.',
      },
    };
  }

  const next = cloneSettingsWithAllChannels(current);
  next.familyCodeWord = validation.value;

  const saved = await vault.saveSettings(next);
  if (!saved.ok) {
    return {
      ok: false,
      error: {
        reason: 'store-error',
        message: saved.error.message,
      },
    };
  }

  return { ok: true, value: next };
}

export function formatChecklistProgress(
  completedMap: Record<string, boolean>,
  totalSteps: readonly { id: string }[] = SAFE_PHONE_CHECKLIST_STEPS
): string {
  let completedCount = 0;
  for (const step of totalSteps) {
    if (completedMap[step.id] === true) {
      completedCount += 1;
    }
  }
  return `${completedCount} of ${totalSteps.length} steps completed`;
}

export async function toggleChecklistStep(
  vault: Vault,
  current: Settings,
  stepId: string,
  done: boolean
): Promise<
  Result<
    { settings: Settings; progressText: string },
    { settings: Settings; message: string }
  >
> {
  const previous = cloneSettingsWithAllChannels(current);
  const next: Settings = {
    ...previous,
    checklist: {
      ...previous.checklist,
      [stepId]: Boolean(done),
    },
  };

  const saved = await vault.saveSettings(next);
  if (!saved.ok) {
    return {
      ok: false,
      error: {
        settings: previous,
        message: saved.error.message,
      },
    };
  }

  return {
    ok: true,
    value: {
      settings: next,
      progressText: formatChecklistProgress(next.checklist),
    },
  };
}
