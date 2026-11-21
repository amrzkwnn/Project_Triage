import type {
  Channel,
  ClaritySummary,
  DecisionTier,
  InboxItem,
  Result,
  Settings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { mayShare } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
import { buildClaritySummary } from '@/lib/ai/summary';
import {
  type Confirmation,
  isValidConfirmation,
} from '@/lib/actions/confirmation';

export type FamilySharePayload = {
  itemId: string;
  source: Channel;
  sender?: string;
  text: string;
  summary: ClaritySummary;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripFamilyCodeWord(value: string, familyCodeWord?: string): string {
  if (!familyCodeWord || familyCodeWord.trim().length === 0) {
    return value;
  }
  const pattern = new RegExp(escapeRegExp(familyCodeWord.trim()), 'gi');
  let result = value;
  for (let i = 0; i < 20; i += 1) {
    const next = result.replace(pattern, '');
    if (next === result) {
      break;
    }
    result = next;
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

export function canShowAskFamily(settings: Settings): boolean {
  return mayShare(settings);
}

export function shouldOfferEnableSharing(
  settings: Settings,
  tier: DecisionTier
): boolean {
  return !mayShare(settings) && tier === 3;
}

export function buildFamilySharePayload(
  item: Pick<InboxItem, 'id' | 'source' | 'sender' | 'text' | 'summary'>,
  settings: Settings
): FamilySharePayload {
  const codeWord = settings.familyCodeWord;
  const rawSummary = item.summary ?? buildClaritySummary(item);

  const sanitizedSummary: ClaritySummary = {
    fromApp: stripFamilyCodeWord(rawSummary.fromApp, codeWord),
    whoSent: stripFamilyCodeWord(rawSummary.whoSent, codeWord),
    actionNeeded: stripFamilyCodeWord(rawSummary.actionNeeded, codeWord),
    text: stripFamilyCodeWord(rawSummary.text, codeWord),
  };

  const payload: FamilySharePayload = {
    itemId: item.id,
    source: item.source,
    text: stripFamilyCodeWord(item.text, codeWord),
    summary: sanitizedSummary,
  };

  if (typeof item.sender === 'string') {
    const cleanedSender = stripFamilyCodeWord(item.sender, codeWord);
    if (cleanedSender.length > 0) {
      payload.sender = cleanedSender;
    }
  }

  return payload;
}

export async function shareItemWithFamily(params: {
  item: InboxItem;
  recipient: string;
  settings: Settings;
  confirmation: Confirmation | undefined;
  actionId: string;
  vault: Pick<Vault, 'appendAudit'>;
  sendTransport: (
    payload: ReturnType<typeof buildFamilySharePayload>,
    recipient: string
  ) => Promise<Result<void, string>>;
}): Promise<
  Result<
    { sent: true },
    {
      code: 'sharing-off' | 'unconfirmed' | 'send-failed';
      message: string;
      canRetry: boolean;
    }
  >
> {
  if (!mayShare(params.settings)) {
    return {
      ok: false,
      error: {
        code: 'sharing-off',
        message: 'Family sharing is turned off.',
        canRetry: false,
      },
    };
  }

  if (!isValidConfirmation(params.confirmation, params.actionId)) {
    return {
      ok: false,
      error: {
        code: 'unconfirmed',
        message: 'Please confirm before sharing this item with family.',
        canRetry: false,
      },
    };
  }

  const payload = buildFamilySharePayload(params.item, params.settings);
  const sendRes = await params.sendTransport(payload, params.recipient);

  if (!sendRes.ok) {
    return {
      ok: false,
      error: {
        code: 'send-failed',
        message:
          sendRes.error ||
          'We could not send this item to your family. Please try again.',
        canRetry: true,
      },
    };
  }

  const safeRecipient =
    stripFamilyCodeWord(params.recipient, params.settings.familyCodeWord).slice(
      0,
      80
    ) || 'family';
  const builtAudit = buildAuditEntry({
    kind: 'family-share',
    channel: params.item.source,
    itemId: params.item.id,
    recipient: params.recipient,
    description: `Shared one item with ${safeRecipient}`.slice(0, 200),
  });

  if (builtAudit.ok) {
    await params.vault.appendAudit(builtAudit.value);
  }

  return {
    ok: true,
    value: { sent: true },
  };
}
