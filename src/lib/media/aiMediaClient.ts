import type { RedFlagCategory, Settings, Verdict, VerdictValue } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { mayCallAi } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
import { inspectProvenance } from '@/lib/media/provenance';
import { mediaResult, type MediaCheckOutcome } from '@/lib/media/result';

const DEFAULT_MEDIA_CHECK_ENDPOINT = '/api/media-check';
const DEFAULT_MEDIA_CHECK_TIMEOUT_MS = 15_000;
const DEFAULT_CLIENT_AUTH = 'dev-senior-token-1';

const FALLBACK_NOTICE = 'A simpler on-device photo check was used.';
const AUDIT_FAILED_MESSAGE =
  'This photo was not checked with AI Helper because the activity record could not be saved.';

const FORBIDDEN_CERTAINTY_PATTERN =
  /100%\s*real|certainly\s+authentic|guaranteed\s+real|proven\s+real/gi;

const VALID_MEDIA_RESULTS = new Set<MediaCheckOutcome['result']>([
  'AI signal found',
  'Camera signal found',
  'Cannot tell',
]);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function stripForbiddenCertainty(text: string): string {
  return text
    .replace(FORBIDDEN_CERTAINTY_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    let chunk = '';
    for (let i = 0; i < slice.length; i += 1) {
      chunk += String.fromCharCode(slice[i]);
    }
    parts.push(chunk);
  }
  const binary = parts.join('');
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  const nodeBuf = (
    globalThis as unknown as {
      Buffer?: {
        from(data: Uint8Array): { toString(encoding: 'base64'): string };
      };
    }
  ).Buffer;
  return nodeBuf ? nodeBuf.from(bytes).toString('base64') : '';
}

function parseScamWarning(raw: unknown): Verdict | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (
    typeof raw.value !== 'string' ||
    !VALID_VERDICT_VALUES.has(raw.value as VerdictValue)
  ) {
    return undefined;
  }
  const value = raw.value as VerdictValue;
  if (value === 'safe') {
    return undefined;
  }
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => stripForbiddenCertainty(r).slice(0, 150))
        .filter((r) => r.length > 0)
        .slice(0, 3)
    : [];
  if (reasons.length === 0) {
    return undefined;
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
  return { value, flags, reasons };
}

function parseServerMediaCheck(
  raw: unknown,
  baseline: MediaCheckOutcome
): {
  outcome: MediaCheckOutcome;
  scamWarning?: Verdict;
  checkedBy: 'ai' | 'device';
} | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (
    typeof raw.result !== 'string' ||
    !VALID_MEDIA_RESULTS.has(raw.result as MediaCheckOutcome['result'])
  ) {
    return null;
  }

  const rawNote = typeof raw.note === 'string' ? stripForbiddenCertainty(raw.note) : '';
  const safeNote =
    rawNote.length > 0
      ? rawNote.slice(0, 300)
      : 'Visual clues were reviewed, but no tool can prove a photo is authentic.';

  const rawSignal =
    typeof raw.signalName === 'string'
      ? stripForbiddenCertainty(raw.signalName).slice(0, 120)
      : '';

  // Never downgrade deterministic AI provenance signal
  const resolvedResult: MediaCheckOutcome['result'] =
    baseline.result === 'AI signal found'
      ? 'AI signal found'
      : (raw.result as MediaCheckOutcome['result']);

  const resolvedSignalName =
    baseline.result === 'AI signal found'
      ? baseline.signalName ?? (rawSignal.length > 0 ? rawSignal : undefined)
      : rawSignal.length > 0
        ? rawSignal
        : baseline.signalName;

  const outcome: MediaCheckOutcome = {
    result: resolvedResult,
    ...(resolvedSignalName ? { signalName: resolvedSignalName } : {}),
    note: safeNote,
  };

  const scamWarning = parseScamWarning(raw.scamWarning);

  return {
    outcome,
    ...(scamWarning ? { scamWarning } : {}),
    checkedBy: raw.source === 'ai' ? 'ai' : 'device',
  };
}

export async function checkMediaWithAi(params: {
  bytes: Uint8Array;
  mimeType: string;
  fileName?: string;
  settings: Settings;
  vault?: Pick<Vault, 'appendAudit'>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<
  | {
      ok: true;
      outcome: MediaCheckOutcome;
      scamWarning?: Verdict;
      checkedBy: 'ai' | 'device';
      notice?: string;
    }
  | { ok: false; message: string }
> {
  const provenance = await inspectProvenance(params.bytes);
  const baseline = mediaResult(provenance);

  // Consent gate: AI Reading OFF -> zero network calls, zero audit writes
  if (!mayCallAi(params.settings)) {
    return {
      ok: true,
      outcome: baseline,
      checkedBy: 'device',
    };
  }

  // Audit BEFORE external read (Property 7)
  const builtAudit = buildAuditEntry({
    kind: 'ai-read',
    description: 'Checked one photo in AI Media Check',
    purpose: 'Check photo for AI clues and scam warning signs',
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
      outcome: baseline,
      checkedBy: 'device',
      notice: FALLBACK_NOTICE,
    };
  }

  const imageBase64 = encodeBytesToBase64(params.bytes);
  if (!imageBase64) {
    return {
      ok: true,
      outcome: baseline,
      checkedBy: 'device',
      notice: FALLBACK_NOTICE,
    };
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_MEDIA_CHECK_TIMEOUT_MS;
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
    const payload: Record<string, string> = {
      imageBase64,
      mimeType: params.mimeType,
    };
    if (params.fileName && params.fileName.trim().length > 0) {
      payload.fileName = params.fileName.trim().slice(0, 200);
    }

    const fetchPromise = Promise.resolve().then(() =>
      fetchFn(DEFAULT_MEDIA_CHECK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_CLIENT_AUTH}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    );
    fetchPromise.catch(() => {});

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    if (!response.ok) {
      return {
        ok: true,
        outcome: baseline,
        checkedBy: 'device',
        notice: FALLBACK_NOTICE,
      };
    }

    const parsed: unknown = await response.json();
    const resolved = parseServerMediaCheck(parsed, baseline);
    if (!resolved) {
      return {
        ok: true,
        outcome: baseline,
        checkedBy: 'device',
        notice: FALLBACK_NOTICE,
      };
    }

    return {
      ok: true,
      outcome: resolved.outcome,
      ...(resolved.scamWarning ? { scamWarning: resolved.scamWarning } : {}),
      checkedBy: resolved.checkedBy,
    };
  } catch {
    return {
      ok: true,
      outcome: baseline,
      checkedBy: 'device',
      notice: FALLBACK_NOTICE,
    };
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}
