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
  baseline: ScamCheckOutput
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

  // Safety monotonicity: never downgrade a deterministic danger or caution verdict
  if (candidateSeverity < baselineSeverity) {
    return { verdict: baseline, checkedBy: 'device' };
  }

  const mergedFlags = Array.from(new Set([...baseline.flags, ...flags]));
  const instruction =
    typeof raw.instruction === 'string' && raw.instruction.trim().length > 0
      ? raw.instruction.trim().slice(0, 150)
      : candidateValue === 'danger'
        ? 'Do not click or pay'
        : candidateValue === 'caution'
          ? 'Hang up and call back using a number saved in your contacts'
          : undefined;

  const showAskFamily =
    candidateValue === 'danger'
      ? true
      : typeof raw.showAskFamily === 'boolean'
        ? raw.showAskFamily
        : baseline.showAskFamily;

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
  const baseline = checkText(params.text);

  // Consent gate: AI Reading OFF -> zero network calls, zero audit writes
  if (!mayCallAi(params.settings)) {
    return {
      ok: true,
      verdict: baseline,
      checkedBy: 'device',
    };
  }

  // Audit BEFORE external read (Property 7)
  const builtAudit = buildAuditEntry({
    kind: 'ai-read',
    description: 'Checked one message in Scam Shield',
    purpose: 'Check message for scam warning signs',
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
    const fetchPromise = Promise.resolve().then(() =>
      fetchFn(DEFAULT_SCAM_CHECK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_CLIENT_AUTH}`,
        },
        body: JSON.stringify({ text: params.text }),
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
    const resolved = parseServerScamVerdict(parsed, baseline);
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
