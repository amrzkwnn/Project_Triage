import type { InboxItem, InboxItemDraft, Settings } from '@/lib/types';
import {
  EMAIL_RECONNECT_MESSAGE,
  processEmailBatch,
  validateReadOnlyScopes,
  type RawIncomingEmail,
} from '@/lib/inbox/emailChannel';
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

function defaultFallbackEmail(provider: EmailProvider): string {
  return provider === 'Outlook'
    ? 'connected.outlook@outlook.com'
    : 'connected.gmail@gmail.com';
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }
  return new Date(parsedMs).toISOString();
}

function formatNewEmailMessage(count: number): string {
  if (count === 0) {
    return 'Checked for new emails. You are all caught up.';
  }
  if (count === 1) {
    return '1 new email arrived in your Unified Inbox.';
  }
  return `${count} new emails arrived in your Unified Inbox.`;
}

export async function connectReadOnlyEmailAccount(params: {
  vault?: Pick<Vault, 'saveOAuthToken' | 'saveSettings'>;
  settings: Settings;
  emailAddress: string;
  provider: EmailProvider;
  scopes?: readonly string[];
  accessToken?: string;
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

  const resolvedToken = params.accessToken?.trim() || 'readonly-session';

  const record: OAuthTokenRecord = {
    id: 'email-account-primary',
    account: trimmedEmail,
    provider: params.provider,
    token: resolvedToken,
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

function readEnvVar(name: string): string | undefined {
  try {
    const metaEnv = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env;
    const val = metaEnv?.[name]?.trim();
    return val && val.length > 0 ? val : undefined;
  } catch {
    return undefined;
  }
}

export function buildCloudLoginRedirectUrl(params: {
  provider: EmailProvider;
  emailAddress?: string;
  clientId?: string;
  redirectUri?: string;
}):
  | { ok: true; url: string; scopes: readonly string[] }
  | { ok: false; errorMessage: string } {
  const scopes =
    params.provider === 'Gmail'
      ? (['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'] as const)
      : (['https://graph.microsoft.com/mail.read', 'openid', 'email'] as const);

  const scopeValidation = validateReadOnlyScopes(scopes);
  if (!scopeValidation.ok) {
    return {
      ok: false,
      errorMessage: scopeValidation.error.message,
    };
  }

  const resolvedClientId =
    params.clientId !== undefined
      ? params.clientId.trim()
      : params.provider === 'Gmail'
        ? readEnvVar('VITE_GOOGLE_CLIENT_ID')
        : readEnvVar('VITE_MICROSOFT_CLIENT_ID');

  if (!resolvedClientId) {
    return {
      ok: false,
      errorMessage: `To open the ${params.provider} sign-in page, please add VITE_${params.provider === 'Gmail' ? 'GOOGLE' : 'MICROSOFT'}_CLIENT_ID to your .env.local file first.`,
    };
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:5173';
  const redirectUri = params.redirectUri?.trim() || `${origin}/my-data`;
  const trimmedEmail = params.emailAddress?.trim() ?? '';
  const statePayload = new URLSearchParams({
    provider: params.provider,
    ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
  }).toString();

  if (params.provider === 'Gmail') {
    const query = new URLSearchParams({
      client_id: resolvedClientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: scopes.join(' '),
      prompt: 'consent',
      state: statePayload,
      ...(trimmedEmail.length > 0 ? { login_hint: trimmedEmail } : {}),
    });
    return {
      ok: true,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`,
      scopes,
    };
  }

  const query = new URLSearchParams({
    client_id: resolvedClientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: scopes.join(' '),
    prompt: 'select_account',
    state: statePayload,
    ...(trimmedEmail.length > 0 ? { login_hint: trimmedEmail } : {}),
  });
  return {
    ok: true,
    url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query.toString()}`,
    scopes,
  };
}

export function parseCloudLoginCallback(
  search = '',
  hash = ''
):
  | {
      accessToken: string;
      provider: EmailProvider;
      emailAddress: string;
      grantedScopes?: string[];
      emailHint?: string;
    }
  | undefined {
  const hashClean = hash.startsWith('#') ? hash.slice(1) : hash;
  const searchClean = search.startsWith('?') ? search.slice(1) : search;

  if (hashClean.trim().length === 0 && searchClean.trim().length === 0) {
    return undefined;
  }

  const hashParams = new URLSearchParams(hashClean);
  const searchParams = new URLSearchParams(searchClean);

  const hashToken = hashParams.get('access_token')?.trim();
  const searchToken =
    searchParams.get('access_token')?.trim() || searchParams.get('code')?.trim();

  const accessToken = hashToken || searchToken;
  if (!accessToken) {
    return undefined;
  }

  const primaryParams = hashToken ? hashParams : searchParams;
  const fallbackParams = hashToken ? searchParams : hashParams;

  const rawState =
    primaryParams.get('state') ?? fallbackParams.get('state') ?? '';
  const stateParams = new URLSearchParams(rawState);
  const rawProvider = stateParams.get('provider');
  const provider: EmailProvider =
    rawProvider === 'Outlook' ? 'Outlook' : 'Gmail';

  const rawEmailHint = stateParams.get('email')?.trim();
  const emailHint =
    rawEmailHint && rawEmailHint.length > 0 ? rawEmailHint : undefined;

  const emailAddress =
    emailHint && isValidEmailAddress(emailHint)
      ? emailHint
      : defaultFallbackEmail(provider);

  const rawScope = (
    primaryParams.get('scope') ??
    fallbackParams.get('scope') ??
    ''
  ).trim();
  const grantedScopes =
    rawScope.length > 0 ? rawScope.split(/\s+/).filter(Boolean) : undefined;

  return {
    accessToken,
    provider,
    emailAddress,
    ...(grantedScopes ? { grantedScopes } : {}),
    ...(emailHint ? { emailHint } : {}),
  };
}

export async function completeCloudLoginCallback(params: {
  vault?: Pick<Vault, 'saveOAuthToken' | 'saveSettings'>;
  settings: Settings;
  search?: string;
  hash?: string;
  fetchFn?: typeof fetch;
}): Promise<
  | { ok: true; record: OAuthTokenRecord; settings: Settings; message: string }
  | { ok: false; errorMessage: string }
> {
  const parsed = parseCloudLoginCallback(params.search, params.hash);
  if (!parsed) {
    return {
      ok: false,
      errorMessage: 'Sign-in could not be completed. Please try again.',
    };
  }

  const defaultScopes =
    parsed.provider === 'Gmail'
      ? (['https://www.googleapis.com/auth/gmail.readonly'] as const)
      : (['https://graph.microsoft.com/mail.read'] as const);
  const scopesToValidate =
    parsed.grantedScopes && parsed.grantedScopes.length > 0
      ? parsed.grantedScopes
      : defaultScopes;

  const scopeValidation = validateReadOnlyScopes(scopesToValidate);
  if (!scopeValidation.ok) {
    return {
      ok: false,
      errorMessage: scopeValidation.error.message,
    };
  }

  let resolvedEmail: string | undefined;
  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn === 'function') {
    try {
      const profileUrl =
        parsed.provider === 'Gmail'
          ? 'https://www.googleapis.com/oauth2/v3/userinfo'
          : 'https://graph.microsoft.com/v1.0/me';
      const profileRes = await fetchFn(profileUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${parsed.accessToken}`,
        },
      });
      if (profileRes.ok) {
        const data = (await profileRes.json()) as {
          email?: unknown;
          mail?: unknown;
          userPrincipalName?: unknown;
        };
        const candidate =
          parsed.provider === 'Gmail'
            ? data?.email
            : data?.mail || data?.userPrincipalName;
        if (typeof candidate === 'string' && isValidEmailAddress(candidate)) {
          resolvedEmail = candidate.trim();
        }
      }
    } catch {
      // Fall back to emailHint or default email address
    }
  }

  const emailAddress =
    resolvedEmail ??
    (parsed.emailHint && isValidEmailAddress(parsed.emailHint)
      ? parsed.emailHint
      : defaultFallbackEmail(parsed.provider));

  return connectReadOnlyEmailAccount({
    vault: params.vault,
    settings: params.settings,
    emailAddress,
    provider: parsed.provider,
    scopes: scopesToValidate,
    accessToken: parsed.accessToken,
  });
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

type CloudFetchOutcome =
  | { status: 'ok'; stored: InboxItem[] }
  | { status: 'expired' }
  | { status: 'error' };

async function fetchCloudProviderEmails(params: {
  record: OAuthTokenRecord;
  vault: Vault;
  settings: Settings;
  fetchFn: typeof fetch;
}): Promise<CloudFetchOutcome> {
  const { record, vault, settings, fetchFn } = params;
  const authHeaders = {
    Authorization: `Bearer ${record.token}`,
  };

  try {
    if (record.provider === 'Outlook') {
      const response = await fetchFn(
        'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,subject,from,receivedDateTime,bodyPreview',
        {
          method: 'GET',
          headers: authHeaders,
        }
      );

      if (response.status === 401 || response.status === 403) {
        await processEmailBatch({
          settings,
          tokenStatus: 'expired',
          emails: [],
          vault,
        });
        return { status: 'expired' };
      }

      if (!response.ok) {
        return { status: 'error' };
      }

      const data = (await response.json()) as {
        value?: Array<{
          id?: unknown;
          subject?: unknown;
          from?: {
            emailAddress?: {
              name?: unknown;
              address?: unknown;
            };
          };
          receivedDateTime?: unknown;
          bodyPreview?: unknown;
        }>;
      };

      const rawEmails: RawIncomingEmail[] = [];
      const list = Array.isArray(data?.value) ? data.value : [];
      for (const msg of list) {
        if (!msg || typeof msg !== 'object') continue;
        const id =
          typeof msg.id === 'string' && msg.id.trim().length > 0
            ? msg.id.trim()
            : `outlook-${Date.now()}-${rawEmails.length}`;
        const name =
          typeof msg.from?.emailAddress?.name === 'string'
            ? msg.from.emailAddress.name.trim()
            : '';
        const address =
          typeof msg.from?.emailAddress?.address === 'string'
            ? msg.from.emailAddress.address.trim()
            : '';
        const from =
          name && address
            ? `${name} <${address}>`
            : address || name || undefined;
        const receivedAt = toIsoTimestamp(msg.receivedDateTime);

        rawEmails.push({
          id,
          ...(from ? { from: from.slice(0, 256) } : {}),
          ...(typeof msg.subject === 'string' ? { subject: msg.subject } : {}),
          ...(typeof msg.bodyPreview === 'string'
            ? { body: msg.bodyPreview }
            : {}),
          ...(receivedAt ? { receivedAt } : {}),
        });
      }

      const batchResult = await processEmailBatch({
        settings,
        tokenStatus: 'valid',
        emails: rawEmails,
        vault,
      });

      return { status: 'ok', stored: batchResult.processed };
    }

    if (record.provider === 'Gmail') {
      const listResponse = await fetchFn(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10',
        {
          method: 'GET',
          headers: authHeaders,
        }
      );

      if (listResponse.status === 401 || listResponse.status === 403) {
        await processEmailBatch({
          settings,
          tokenStatus: 'expired',
          emails: [],
          vault,
        });
        return { status: 'expired' };
      }

      if (!listResponse.ok) {
        return { status: 'error' };
      }

      const listData = (await listResponse.json()) as {
        messages?: Array<{ id?: unknown }>;
      };
      const messageRefs = Array.isArray(listData?.messages)
        ? listData.messages
        : [];
      const rawEmails: RawIncomingEmail[] = [];

      for (const ref of messageRefs) {
        if (!ref || typeof ref.id !== 'string' || ref.id.trim().length === 0) {
          continue;
        }
        const msgId = ref.id.trim();
        const detailRes = await fetchFn(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
            msgId
          )}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          {
            method: 'GET',
            headers: authHeaders,
          }
        );

        if (detailRes.status === 401 || detailRes.status === 403) {
          await processEmailBatch({
            settings,
            tokenStatus: 'expired',
            emails: [],
            vault,
          });
          return { status: 'expired' };
        }

        if (!detailRes.ok) {
          continue;
        }

        const detail = (await detailRes.json()) as {
          id?: unknown;
          snippet?: unknown;
          internalDate?: unknown;
          payload?: {
            headers?: Array<{ name?: unknown; value?: unknown }>;
          };
        };

        const headers = Array.isArray(detail?.payload?.headers)
          ? detail.payload.headers
          : [];
        const findHeader = (target: string): string | undefined => {
          const found = headers.find(
            (h) =>
              typeof h?.name === 'string' &&
              h.name.toLowerCase() === target.toLowerCase() &&
              typeof h?.value === 'string'
          );
          return typeof found?.value === 'string' ? found.value.trim() : undefined;
        };

        const fromHeader = findHeader('From');
        const subjectHeader = findHeader('Subject');
        const dateHeader = findHeader('Date');
        const receivedAt =
          toIsoTimestamp(dateHeader) ?? toIsoTimestamp(detail?.internalDate);

        rawEmails.push({
          id: typeof detail?.id === 'string' && detail.id.trim().length > 0 ? detail.id.trim() : msgId,
          ...(fromHeader ? { from: fromHeader.slice(0, 256) } : {}),
          ...(subjectHeader ? { subject: subjectHeader } : {}),
          ...(typeof detail?.snippet === 'string'
            ? { body: detail.snippet }
            : {}),
          ...(receivedAt ? { receivedAt } : {}),
        });
      }

      const batchResult = await processEmailBatch({
        settings,
        tokenStatus: 'valid',
        emails: rawEmails,
        vault,
      });

      return { status: 'ok', stored: batchResult.processed };
    }

    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

function deduplicateItemsById(items: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  const merged: InboxItem[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export async function syncEmailsFromRelay(params: {
  vault: Vault;
  settings: Settings;
  fetchFn?: typeof fetch;
  bearerToken?: string;
}): Promise<
  | {
      ok: true;
      stored: InboxItem[];
      message: string;
      reconnectRequired?: boolean;
      reconnectMessage?: string;
    }
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

  let cloudStored: InboxItem[] = [];
  let cloudFetchSucceeded = false;

  if (typeof params.vault.listOAuthTokens === 'function') {
    const tokensRes = await params.vault.listOAuthTokens();
    if (tokensRes.ok) {
      const cloudRecord = tokensRes.value.find(
        (rec) =>
          (rec.provider === 'Gmail' || rec.provider === 'Outlook') &&
          typeof rec.token === 'string' &&
          rec.token.trim().length > 0 &&
          rec.token.trim() !== 'readonly-session'
      );

      if (cloudRecord) {
        const cloudOutcome = await fetchCloudProviderEmails({
          record: cloudRecord,
          vault: params.vault,
          settings: params.settings,
          fetchFn,
        });

        if (cloudOutcome.status === 'expired') {
          return {
            ok: true,
            stored: [],
            message: EMAIL_RECONNECT_MESSAGE,
            reconnectRequired: true,
            reconnectMessage: EMAIL_RECONNECT_MESSAGE,
          };
        }

        if (cloudOutcome.status === 'ok') {
          cloudStored = cloudOutcome.stored;
          cloudFetchSucceeded = true;
        }
      }
    }
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
      if (cloudFetchSucceeded) {
        const deduped = deduplicateItemsById(cloudStored);
        return {
          ok: true,
          stored: deduped,
          message: formatNewEmailMessage(deduped.length),
        };
      }
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

    const merged = deduplicateItemsById([...cloudStored, ...result.stored]);

    return {
      ok: true,
      stored: merged,
      message: formatNewEmailMessage(merged.length),
    };
  } catch {
    if (cloudFetchSucceeded) {
      const deduped = deduplicateItemsById(cloudStored);
      return {
        ok: true,
        stored: deduped,
        message: formatNewEmailMessage(deduped.length),
      };
    }
    return {
      ok: false,
      errorMessage:
        'We could not check for new emails right now. Please try again.',
    };
  }
}
