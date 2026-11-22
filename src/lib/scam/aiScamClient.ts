import type { RedFlagCategory, Settings, VerdictValue } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { mayCallAi } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
import { checkText, type ScamCheckOutput } from '@/lib/scam/verdict';

const DEFAULT_SCAM_CHECK_ENDPOINT = '/api/scam-check';
const DEFAULT_SCAM_CHECK_TIMEOUT_MS = 10_000;
const DEFAULT_CLIENT_AUTH = 'dev-senior-token-1';

const FALLBACK_NOTICE = 'A simpler on-device check was used.';
const AUDIT_FAILED_MESSAGE =
  'This message was not checked with AI Helper because the activity record could not be saved.';

const VALID_VERDICT_VALUES = new Set<VerdictValue>([
  'safe',
  'caution',
  'danger',
]);

const VALID_RED_FLAGS = new Set<RedFlagCategory>([
  'urgency',
  'secrecy',
  'payment',
  'domain-mismatch',
]);

const VERDICT_SEVERITY: Record<VerdictValue, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseServerScamVerdict(
  raw: unknown,
  baseline: ScamCheckOutput,
  enforceBaselineMonotonicity = true
): { verdict: ScamCheckOutput; checkedBy: 'ai' | 'device' } | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  if (
    typeof raw.value !== 'string' ||
    !VALID_VERDICT_VALUES.has(raw.value as VerdictValue)
  ) {
    return null;
  }

  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim().slice(0, 150))
        .slice(0, 3)
    : [];

  if (reasons.length === 0) {
    return null;
  }

  const flags = Array.isArray(raw.flags)
    ? Array.from(
        new Set(
          raw.flags.filter(
            (f): f is RedFlagCategory =>
              typeof f === 'string' &&
              VALID_RED_FLAGS.has(f as RedFlagCategory)
          )
        )
      )
    : [];

  const candidateValue = raw.value as VerdictValue;
  const baselineSeverity = VERDICT_SEVERITY[baseline.value];
  const candidateSeverity = VERDICT_SEVERITY[candidateValue];

  // Safety monotonicity: never downgrade a deterministic text danger or caution verdict
  if (enforceBaselineMonotonicity && candidateSeverity < baselineSeverity) {
    return { verdict: baseline, checkedBy: 'device' };
  }

  // On screenshot-only checks, never accept an uninspected device-level 'safe' response
  if (
    !enforceBaselineMonotonicity &&
    raw.source !== 'ai' &&
    candidateValue === 'safe'
  ) {
    return { verdict: baseline, checkedBy: 'device' };
  }

  const mergedFlags = enforceBaselineMonotonicity
    ? Array.from(new Set([...baseline.flags, ...flags]))
    : flags;
  const instruction =
    typeof raw.instruction === 'string' && raw.instruction.trim().length > 0
      ? raw.instruction.trim().slice(0, 150)
      : candidateValue === 'danger'
        ? 'Do not click or pay'
        : candidateValue === 'caution'
          ? 'Be careful and verify before clicking or paying'
          : undefined;

  const showAskFamily =
    candidateValue === 'danger'
      ? true
      : typeof raw.showAskFamily === 'boolean'
        ? raw.showAskFamily
        : enforceBaselineMonotonicity
          ? baseline.showAskFamily
          : candidateValue === 'caution';

  const verdict: ScamCheckOutput = {
    value: candidateValue,
    flags: mergedFlags,
    reasons,
    showAskFamily,
  };
  if (instruction !== undefined) {
    verdict.instruction = instruction;
  }

  return {
    verdict,
    checkedBy: raw.source === 'ai' ? 'ai' : 'device',
  };
}

export async function checkMessageWithAi(params: {
  text: string;
  imageBase64?: string;
  imageMime?: string;
  settings: Settings;
  vault?: Pick<Vault, 'appendAudit'>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      verdict: ScamCheckOutput;
      checkedBy: 'ai' | 'device';
      notice?: string;
    }
  | { ok: false; message: string }
> {
  const hasText = params.text.trim().length > 0;
  const hasImage =
    typeof params.imageBase64 === 'string' &&
    params.imageBase64.trim().length > 0 &&
    typeof params.imageMime === 'string' &&
    params.imageMime.trim().length > 0;

  const aiAllowed = mayCallAi(params.settings);
  const baseline: ScamCheckOutput = hasText
    ? checkText(params.text)
    : {
        value: 'caution',
        flags: [],
        reasons: [
          aiAllowed
            ? 'We could not read the words in this screenshot right now. Please paste the message text or ask a trusted family member before clicking or paying.'
            : 'This screenshot was not read because AI scanning is OFF. Paste the message text, turn on AI scanning, or ask a trusted family member before clicking or paying.',
        ],
        instruction: 'Be careful and verify before clicking or paying',
        showAskFamily: true,
      };

  // Consent gate: AI Reading OFF -> zero network calls, zero audit writes
  if (!aiAllowed) {
    return {
      ok: true,
      verdict: baseline,
      checkedBy: 'device',
    };
  }

  // Audit BEFORE external read (Property 7)
  const builtAudit = buildAuditEntry({
    kind: 'ai-read',
    description: hasImage
      ? 'Checked one screenshot in Scam Shield'
      : 'Checked one message in Scam Shield',
    purpose: hasImage
      ? 'Check screenshot for scam warning signs'
      : 'Check message for scam warning signs',
  });

  if (!builtAudit.ok || !params.vault) {
    return {
      ok: false,
      message: AUDIT_FAILED_MESSAGE,
    };
  }

  const auditWrite = await params.vault.appendAudit(builtAudit.value);
  if (!auditWrite.ok) {
    return {
      ok: false,
      message: AUDIT_FAILED_MESSAGE,
    };
  }

  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: true,
      verdict: baseline,
      checkedBy: 'device',
      notice: FALLBACK_NOTICE,
    };
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_SCAM_CHECK_TIMEOUT_MS;
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      const err = new Error('Request timed out');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);
  });

  try {
    const requestPayload: Record<string, string> = { text: params.text };
    if (hasImage && params.imageBase64 && params.imageMime) {
      requestPayload.imageBase64 = params.imageBase64.trim();
      requestPayload.imageMime = params.imageMime.trim();
    }

    const fetchPromise = Promise.resolve().then(() =>
      fetchFn(DEFAULT_SCAM_CHECK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_CLIENT_AUTH}`,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })
    );
    fetchPromise.catch(() => {});

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    if (!response.ok) {
      return {
        ok: true,
        verdict: baseline,
        checkedBy: 'device',
        notice: FALLBACK_NOTICE,
      };
    }

    const parsed: unknown = await response.json();
    const resolved = parseServerScamVerdict(parsed, baseline, hasText);
    if (!resolved) {
      return {
        ok: true,
        verdict: baseline,
        checkedBy: 'device',
        notice: FALLBACK_NOTICE,
      };
    }

    return {
      ok: true,
      verdict: resolved.verdict,
      checkedBy: resolved.checkedBy,
    };
  } catch {
    return {
      ok: true,
      verdict: baseline,
      checkedBy: 'device',
      notice: FALLBACK_NOTICE,
    };
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}
