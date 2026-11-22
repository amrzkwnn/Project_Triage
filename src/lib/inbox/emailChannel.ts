import {
  type Attachment,
  type InboxItem,
  type InboxItemDraft,
  type Result,
  type Settings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { admit } from '@/lib/vault/consent';
import { parseIngest } from '@/lib/inbox/parse';
import { isDuplicate } from '@/lib/inbox/dedup';
import { analyze } from '@/lib/ai/engine';

export const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

export const EMAIL_RECONNECT_MESSAGE =
  'Your email connection has ended. Your saved emails are still here. Please reconnect your email account when you are ready.';

export const EMAIL_TOO_LARGE_NOTICE =
  'One email was larger than 25 MB and was skipped. Other emails were still checked.';

export const EMAIL_MALFORMED_NOTICE =
  'One email could not be read and was skipped. Other emails were still checked.';

const ALLOWED_READONLY_SCOPES = new Set<string>([
  'gmail.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'mail.read',
  'https://graph.microsoft.com/mail.read',
  'user.read',
  'https://graph.microsoft.com/user.read',
  'email.readonly',
  'openid',
  'email',
  'profile',
  'offline_access',
]);

const FORBIDDEN_WRITE_SCOPE_PATTERN =
  /(send|modify|delete|write|compose|insert|update|labels|settings|full|https?:\/\/mail\.google\.com\/?)/i;

export function validateReadOnlyScopes(
  scopes: readonly string[]
): Result<
  readonly string[],
  {
    code: 'empty-scopes' | 'write-scope-rejected';
    rejectedScopes: string[];
    message: string;
  }
> {
  const cleaned = scopes
    .map((scope) => (typeof scope === 'string' ? scope.trim() : ''))
    .filter((scope) => scope.length > 0);

  if (cleaned.length === 0) {
    return {
      ok: false,
      error: {
        code: 'empty-scopes',
        rejectedScopes: [],
        message:
          'Please choose read-only email permission before connecting your email.',
      },
    };
  }

  const rejectedScopes: string[] = [];
  for (const scope of cleaned) {
    const normalized = scope.toLowerCase();
    if (
      FORBIDDEN_WRITE_SCOPE_PATTERN.test(normalized) ||
      !ALLOWED_READONLY_SCOPES.has(normalized)
    ) {
      rejectedScopes.push(scope);
    }
  }

  if (rejectedScopes.length > 0) {
    return {
      ok: false,
      error: {
        code: 'write-scope-rejected',
        rejectedScopes,
        message:
          'Only read-only email access is allowed so this helper can never send, change, or delete your emails.',
      },
    };
  }

  return { ok: true, value: cleaned };
}

export type RawIncomingEmail = {
  id: string;
  from?: string;
  subject?: string;
  body?: string;
  receivedAt?: string;
  sizeBytes?: number;
  attachments?: Attachment[];
  malformed?: boolean;
};

export type EmailBatchResult = {
  processed: InboxItem[];
  skippedCount: number;
  notices: string[];
  stoppedBecauseOff: boolean;
  reconnectRequired: boolean;
  reconnectMessage?: string;
};

function computeEmailSizeBytes(
  email: RawIncomingEmail,
  combinedText: string
): number {
  if (
    typeof email.sizeBytes === 'number' &&
    Number.isFinite(email.sizeBytes) &&
    email.sizeBytes >= 0
  ) {
    return email.sizeBytes;
  }
  const textBytes = new TextEncoder().encode(combinedText).byteLength;
  const attachmentBytes = Array.isArray(email.attachments)
    ? email.attachments.reduce(
        (acc, att) => acc + (typeof att.size === 'number' ? att.size : 0),
        0
      )
    : 0;
  return textBytes + attachmentBytes;
}

export async function processEmailBatch(params: {
  settings: Settings;
  tokenStatus?: 'valid' | 'expired' | 'revoked';
  emails: ReadonlyArray<RawIncomingEmail>;
  vault: Vault;
  fetchDecideFn?: typeof fetch;
  nowMs?: number;
}): Promise<EmailBatchResult> {
  // 1. Respect ConsentGate: stop immediately if email channel is OFF
  const consent = admit(params.settings, { source: 'email' });
  if (!consent.admit) {
    return {
      processed: [],
      skippedCount: 0,
      notices: [],
      stoppedBecauseOff: true,
      reconnectRequired: false,
    };
  }

  // 2. Expired or revoked connection -> keep existing emails, ask user to reconnect
  if (params.tokenStatus === 'expired' || params.tokenStatus === 'revoked') {
    return {
      processed: [],
      skippedCount: 0,
      notices: [],
      stoppedBecauseOff: false,
      reconnectRequired: true,
      reconnectMessage: EMAIL_RECONNECT_MESSAGE,
    };
  }

  const existingRes = await params.vault.listItems();
  const existing: InboxItem[] = existingRes.ok ? [...existingRes.value] : [];
  const dismissedIds = new Set(params.settings.dismissedItemIds ?? []);

  const processed: InboxItem[] = [];
  const notices: string[] = [];
  let skippedCount = 0;

  for (const email of params.emails) {
    if (!email || typeof email !== 'object' || email.malformed) {
      skippedCount += 1;
      notices.push(EMAIL_MALFORMED_NOTICE);
      continue;
    }

    const rawEmailId = typeof email.id === 'string' ? email.id.trim() : '';
    if (
      (rawEmailId.length > 0 && dismissedIds.has(rawEmailId)) ||
      (typeof email.id === 'string' && dismissedIds.has(email.id))
    ) {
      continue;
    }

    const subject = typeof email.subject === 'string' ? email.subject.trim() : '';
    const body = typeof email.body === 'string' ? email.body : '';
    const combinedText =
      subject.length > 0 && body.length > 0
        ? `${subject}\n${body}`
        : subject.length > 0
          ? subject
          : body;

    if (combinedText.trim().length === 0) {
      skippedCount += 1;
      notices.push(EMAIL_MALFORMED_NOTICE);
      continue;
    }

    const totalSize = computeEmailSizeBytes(email, combinedText);
    if (totalSize > MAX_EMAIL_BYTES) {
      skippedCount += 1;
      notices.push(EMAIL_TOO_LARGE_NOTICE);
      continue;
    }

    const draftCandidate: Record<string, unknown> = {
      source: 'email',
      text: combinedText,
      attachments: Array.isArray(email.attachments) ? email.attachments : [],
      ...(typeof email.from === 'string' ? { sender: email.from } : {}),
      ...(typeof email.receivedAt === 'string'
        ? { receivedAt: email.receivedAt }
        : {}),
    };

    const parsed = parseIngest(draftCandidate);
    if (!parsed.ok) {
      skippedCount += 1;
      notices.push(EMAIL_MALFORMED_NOTICE);
      continue;
    }

    const draft: InboxItemDraft = parsed.value;
    if (isDuplicate(draft, existing, params.nowMs)) {
      continue;
    }

    const itemId =
      typeof email.id === 'string' && email.id.trim().length > 0
        ? email.id
        : `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const analyzed = await analyze(
      { ...draft, id: itemId, source: 'email' },
      params.settings,
      {
        vault: params.vault,
        fetchFn: params.fetchDecideFn,
        ruleCtx: { familyMembers: params.settings.familyMembers },
      }
    );

    if (!analyzed.ok) {
      skippedCount += 1;
      notices.push(analyzed.error.message);
      continue;
    }

    const { analysis, tier } = analyzed.value;
    const item: InboxItem = {
      id: itemId,
      source: 'email',
      ...(draft.sender !== undefined ? { sender: draft.sender } : {}),
      text: draft.text,
      attachments: draft.attachments,
      receivedAt: draft.receivedAt,
      group: analysis.group,
      priority: analysis.priority,
      summary: analysis.summary,
      ...(analysis.detectedEvent
        ? { detectedEvent: analysis.detectedEvent }
        : {}),
      ...(analysis.verdict ? { scamWarning: analysis.verdict } : {}),
      tier,
      confidence: analysis.confidence,
      status: 'ok',
      proposals: analysis.proposals,
    };

    const putRes = await params.vault.putItem(item);
    if (putRes.ok) {
      processed.push(item);
      existing.push(item);
    } else {
      skippedCount += 1;
      notices.push(putRes.error.message);
    }
  }

  return {
    processed,
    skippedCount,
    notices,
    stoppedBecauseOff: false,
    reconnectRequired: false,
  };
}
