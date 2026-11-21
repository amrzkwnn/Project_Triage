import {
  ALL_CHANNELS,
  type Channel,
  type Settings,
  createDefaultSettings,
} from '../types';
import { type StoreError, type Vault } from './schema';

export function cloneSettingsWithAllChannels(input: Settings): Settings {
  const defaults = createDefaultSettings();
  const channels = { ...defaults.channels };
  for (const ch of ALL_CHANNELS) {
    channels[ch] = Boolean(input.channels?.[ch]);
  }
  const next: Settings = {
    ...input,
    channels,
    allowAiReading: Boolean(input.allowAiReading),
    caregiverShareEnabled: Boolean(input.caregiverShareEnabled),
    pushEnabled: Boolean(input.pushEnabled),
    reminderLead: input.reminderLead ?? defaults.reminderLead,
    checklist: { ...(input.checklist ?? {}) },
    familyMembers: (input.familyMembers ?? []).map((m) => ({ ...m })),
  };
  if (input.timeFormat !== undefined) {
    next.timeFormat = input.timeFormat;
  } else {
    delete next.timeFormat;
  }
  if (input.familyCodeWord !== undefined) {
    next.familyCodeWord = input.familyCodeWord;
  } else {
    delete next.familyCodeWord;
  }
  return next;
}

export async function setChannelToggle(
  vault: Vault,
  current: Settings,
  channel: Channel,
  enabled: boolean
): Promise<
  | { ok: true; settings: Settings }
  | { ok: false; settings: Settings; error: StoreError }
> {
  const previous = cloneSettingsWithAllChannels(current);
  const candidate: Settings = {
    ...previous,
    channels: {
      ...previous.channels,
      [channel]: Boolean(enabled),
    },
  };

  const result = await vault.saveSettings(candidate);
  if (!result.ok) {
    return {
      ok: false,
      settings: previous,
      error: result.error,
    };
  }

  return {
    ok: true,
    settings: candidate,
  };
}
