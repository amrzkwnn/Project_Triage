import type { InboxItem, InboxItemDraft, Settings } from '@/lib/types';
import { validateReadOnlyScopes } from '@/lib/inbox/emailChannel';
import { pullAndIngestFromRelay } from '@/lib/inbox/pullPipeline';
import { admit } from '@/lib/vault/consent';
import type { OAuthTokenRecord, Vault } from '@/lib/vault/schema';
import { setChannelToggle } from '@/lib/vault/settings';

export const DEFAULT_DEV_BEARER_TOKEN = 'dev-senior-token-1';

export type EmailProvider = 'Gmail' | 'Outlook';

const DEFAULT_SAMPLE_EMAIL = {
  sender: 'City Clinic <appointments@cityclinic.org>',
  subject: 'Clinic Appointment Reminder',
  body: 'Dear Patient, your checkup at City Clinic is scheduled for 2026-07-24 at 10:30 in Room 3A.',
} as const;

function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return false;
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@')) {
    return false;
  }
  const domain = trimmed.slice(atIndex + 1);
  if (
    domain.length < 3 ||
    !domain.includes('.') ||
    domain.startsWith('.') ||
    domain.endsWith('.')
  ) {
    return false;
  }
  return true;
}

export async function connectReadOnlyEmailAccount(params: {
  vault?: Pick<Vault, 'saveOAuthToken' | 'saveSettings'>;
  settings: Settings;
  emailAddress: string;
  provider: EmailProvider;
  scopes?: readonly string[];
}): Promise<
  | { ok: true; record: OAuthTokenRecord; settings: Settings; message: string }
  | { ok: false; errorMessage: string }
> {
  const trimmedEmail = params.emailAddress.trim();
  if (!isValidEmailAddress(trimmedEmail)) {
    return {
      ok: false,
      errorMessage:
        'Please enter a valid email address, such as grandma@gmail.com.',
    };
  }

  const requestedScopes =
    params.scopes ??
    (params.provider === 'Gmail' ? ['gmail.readonly'] : ['mail.read']);
  const scopeValidation = validateReadOnlyScopes(requestedScopes);
  if (!scopeValidation.ok) {
    return {
      ok: false,
      errorMessage: scopeValidation.error.message,
    };
  }

  const record: OAuthTokenRecord = {
    id: 'email-account-primary',
    account: trimmedEmail,
    provider: params.provider,
    token: 'readonly-session',
  };

  let nextSettings: Settings = {
    ...params.settings,
    channels: {
      ...params.settings.channels,
      email: true,
    },
  };

  if (params.vault) {
    const saveRecordRes = await params.vault.saveOAuthToken(record);
    if (!saveRecordRes.ok) {
      return {
        ok: false,
        errorMessage: saveRecordRes.error.message,
      };
    }

    const toggleRes = await setChannelToggle(
      params.vault as Vault,
      params.settings,
      'email',
      true
    );
    if (!toggleRes.ok) {
      return {
        ok: false,
        errorMessage: toggleRes.error.message,
      };
    }
    nextSettings = toggleRes.settings;
  }

  return {
    ok: true,
    record,
    settings: nextSettings,
    message: `Connected ${trimmedEmail} with read-only email access. Email reading is now ON.`,
  };
}

export async function sendSampleEmailToRelay(params?: {
  fetchFn?: typeof fetch;
  bearerToken?: string;
  sender?: string;
  subject?: string;
  text?: string;
}): Promise<{ ok: true; id: string } | { ok: false; errorMessage: string }> {
  const fetchFn = params?.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: false,
      errorMessage:
        'We could not reach the email helper right now. Please try again.',
    };
  }

  const bearerToken = params?.bearerToken ?? DEFAULT_DEV_BEARER_TOKEN;
  const sender = params?.sender ?? DEFAULT_SAMPLE_EMAIL.sender;
  const subject = params?.subject ?? DEFAULT_SAMPLE_EMAIL.subject;
  const body = params?.text ?? DEFAULT_SAMPLE_EMAIL.body;

  try {
    const response = await fetchFn('/api/ingest/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        sender,
        subject,
        body,
        receivedAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        errorMessage:
          'We could not send the test clinic email right now. Please try again.',
      };
    }

    const data = (await response.json()) as { ok?: unknown; id?: unknown };
    if (typeof data?.id !== 'string' || data.id.length === 0) {
      return {
        ok: false,
        errorMessage:
          'We could not confirm the test clinic email arrived. Please try again.',
      };
    }

    return { ok: true, id: data.id };
  } catch {
    return {
      ok: false,
      errorMessage:
        'We could not reach the email helper right now. Please try again.',
    };
  }
}

export async function syncEmailsFromRelay(params: {
  vault: Vault;
  settings: Settings;
  fetchFn?: typeof fetch;
  bearerToken?: string;
}): Promise<
  | { ok: true; stored: InboxItem[]; message: string }
  | { ok: false; errorMessage: string }
> {
  const consent = admit(params.settings, { source: 'email' });
  if (!consent.admit) {
    return {
      ok: false,
      errorMessage: consent.message,
    };
  }

  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: false,
      errorMessage:
        'We could not check for new emails right now. Please try again.',
    };
  }

  const bearerToken = params.bearerToken ?? DEFAULT_DEV_BEARER_TOKEN;

  try {
    const pullResponse = await fetchFn('/api/ingest/pull', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    if (!pullResponse.ok) {
      return {
        ok: false,
        errorMessage:
          'We could not check for new emails right now. Please try again.',
      };
    }

    const data = (await pullResponse.json()) as {
      items?: Array<{
        id?: unknown;
        draft?: InboxItemDraft;
        payload?: InboxItemDraft;
      }>;
    };

    const rawItems = Array.isArray(data?.items) ? data.items : [];
    const pulledItems: Array<{ id: string; draft: InboxItemDraft }> = [];

    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const draft = entry.draft ?? entry.payload;
      if (typeof entry.id === 'string' && entry.id.length > 0 && draft) {
        pulledItems.push({ id: entry.id, draft });
      }
    }

    const result = await pullAndIngestFromRelay({
      vault: params.vault,
      settings: params.settings,
      pulledItems,
      ackFn: async (ids) => {
        if (ids.length === 0) return;
        await fetchFn('/api/ingest/ack', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bearerToken}`,
          },
          body: JSON.stringify({ ids }),
        });
      },
    });

    const count = result.stored.length;
    const message =
      count === 0
        ? 'Checked for new emails. You are all caught up.'
        : count === 1
          ? '1 new email arrived in your Unified Inbox.'
          : `${count} new emails arrived in your Unified Inbox.`;

    return {
      ok: true,
      stored: result.stored,
      message,
    };
  } catch {
    return {
      ok: false,
      errorMessage:
        'We could not check for new emails right now. Please try again.',
    };
  }
}
