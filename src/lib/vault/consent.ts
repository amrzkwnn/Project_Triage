import type { Channel, InboxItem, Settings } from '../types';
import type { Vault } from './schema';

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  whatsappForward: 'WhatsApp',
  smsPaste: 'SMS',
  messengerPaste: 'Messenger',
  photos: 'Photos',
};

export function admit(
  settings: Settings,
  item: { source: Channel }
):
  | { admit: true }
  | {
      admit: false;
      channel: Channel;
      offer: 'turn-on-channel';
      message: string;
    } {
  const channel = item.source;
  if (settings?.channels?.[channel] === true) {
    return { admit: true };
  }

  const label = CHANNEL_LABELS[channel] ?? channel;
  return {
    admit: false,
    channel,
    offer: 'turn-on-channel',
    message: `${label} is turned off. Would you like to turn on ${label}?`,
  };
}

export function mayCallAi(settings: Settings): boolean {
  return settings?.allowAiReading === true;
}

export function mayShare(settings: Settings): boolean {
  return settings?.caregiverShareEnabled === true;
}

export type AiToggleMachineState = {
  allowAiReading: boolean;
  awaitingConfirm: boolean;
};

export type AiToggleEvent = 'request-on' | 'confirm' | 'dismiss' | 'turn-off';

export function createAiToggleState(initial = false): AiToggleMachineState {
  return {
    allowAiReading: Boolean(initial),
    awaitingConfirm: false,
  };
}

export function stepAiToggle(
  state: AiToggleMachineState,
  event: AiToggleEvent
): AiToggleMachineState {
  switch (event) {
    case 'request-on': {
      if (!state.allowAiReading) {
        return { allowAiReading: false, awaitingConfirm: true };
      }
      return { allowAiReading: true, awaitingConfirm: false };
    }
    case 'confirm': {
      if (state.awaitingConfirm) {
        return { allowAiReading: true, awaitingConfirm: false };
      }
      return {
        allowAiReading: state.allowAiReading,
        awaitingConfirm: false,
      };
    }
    case 'dismiss': {
      if (state.awaitingConfirm) {
        return { allowAiReading: false, awaitingConfirm: false };
      }
      return {
        allowAiReading: state.allowAiReading,
        awaitingConfirm: false,
      };
    }
    case 'turn-off': {
      return { allowAiReading: false, awaitingConfirm: false };
    }
  }
}

export async function ingestWithConsent(
  vault: Vault,
  settings: Settings,
  item: InboxItem
): Promise<
  | { admitted: true }
  | {
      admitted: false;
      channel: Channel;
      offer: 'turn-on-channel';
      message: string;
    }
> {
  const decision = admit(settings, item);
  if (!decision.admit) {
    return {
      admitted: false,
      channel: decision.channel,
      offer: decision.offer,
      message: decision.message,
    };
  }

  await vault.putItem(item);
  return { admitted: true };
}
