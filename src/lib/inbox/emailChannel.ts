import {
  type Attachment,
  type InboxItem,
  type InboxItemDraft,
  type Result,
  type Settings,
  type Verdict,
  type VerdictValue,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { admit, mayCallAi } from '@/lib/vault/consent';
import { parseIngest } from '@/lib/inbox/parse';
import { isDuplicate } from '@/lib/inbox/dedup';
import { analyze } from '@/lib/ai/engine';
import { checkMediaWithAi } from '@/lib/media/aiMediaClient';

const MAX_SCAN_EMAIL_IMAGE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_SCAN_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const VERDICT_SEVERITY: Record<VerdictValue, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

function decodeBase64Bytes(base64: string): Uint8Array | undefined {
  try {
    const cleaned = base64.replace(/\s+/g, '');
    if (!cleaned) return undefined;
    if (typeof atob === 'function') {
      const binary = atob(cleaned);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    const nodeBuf = (
      globalThis as unknown as {
        Buffer?: { from(data: string, encoding: 'base64'): Uint8Array };
      }
    ).Buffer;
    return nodeBuf ? new Uint8Array(nodeBuf.from(cleaned, 'base64')) : undefined;
  } catch {
    return undefined;
  }
}

function mergeEmailScamWarnings(
  existing: Verdict | undefined,
  incoming: Verdict | undefined
): Verdict | undefined {
  if (!incoming || incoming.value === 'safe') {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const existingSev = VERDICT_SEVERITY[existing.value];
  const incomingSev = VERDICT_SEVERITY[incoming.value];
  if (incomingSev < existingSev) {
    return existing;
  }
  const mergedFlags = Array.from(new Set([...existing.flags, ...incoming.flags]));
  const mergedReasons = Array.from(
    new Set([...incoming.reasons, ...existing.reasons])
  ).slice(0, 3);
  return {
    value: incomingSev > existingSev ? incoming.value : existing.value,
    flags: mergedFlags,
    reasons: mergedReasons,
  };
}

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
  fetchMediaFn?: typeof fetch;
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
    let mediaCheck: InboxItem['mediaCheck'];
    let mergedScamWarning: Verdict | undefined = analysis.verdict;
    let resolvedTier = tier;
    let resolvedProposals = [...analysis.proposals];

    if (mayCallAi(params.settings) && draft.attachments.length > 0) {
      const firstImage = draft.attachments.find(
        (att) =>
          SUPPORTED_SCAN_IMAGE_MIMES.has(att.mime.toLowerCase()) &&
          typeof att.dataBase64 === 'string' &&
          att.dataBase64.trim().length > 0
      );
      if (firstImage && firstImage.dataBase64) {
        const bytes = decodeBase64Bytes(firstImage.dataBase64);
        if (
          bytes &&
          bytes.byteLength > 0 &&
          bytes.byteLength <= MAX_SCAN_EMAIL_IMAGE_BYTES
        ) {
          const mediaScan = await checkMediaWithAi({
            bytes,
            mimeType: firstImage.mime.toLowerCase(),
            fileName: firstImage.name,
            settings: params.settings,
            vault: params.vault,
            fetchFn: params.fetchMediaFn,
          });
          if (mediaScan.ok) {
            mediaCheck = mediaScan.outcome;
            mergedScamWarning = mergeEmailScamWarnings(
              mergedScamWarning,
              mediaScan.scamWarning
            );
            if (mergedScamWarning?.value === 'danger') {
              resolvedTier = 3;
            }
            if (
              mergedScamWarning &&
              (mergedScamWarning.value === 'danger' ||
                mergedScamWarning.value === 'caution') &&
              !resolvedProposals.some((p) => p.kind === 'checkScam')
            ) {
              resolvedProposals = [
                ...resolvedProposals,
                {
                  id: `${itemId}:checkScam`,
                  kind: 'checkScam',
                  label: 'Forward to Scam Check',
                  itemId,
                },
              ];
            }
          }
        }
      }
    }

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
      ...(mergedScamWarning ? { scamWarning: mergedScamWarning } : {}),
      ...(mediaCheck ? { mediaCheck } : {}),
      tier: resolvedTier,
      confidence: analysis.confidence,
      status: 'ok',
      proposals: resolvedProposals,
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
