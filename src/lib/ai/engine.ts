import type {
  Channel,
  ClaritySummary,
  DecisionTier,
  DetectedEvent,
  GroupCategory,
  InboxItemDraft,
  PriorityType,
  Proposal,
  RedFlagCategory,
  Result,
  Settings,
  Verdict,
  VerdictValue,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { CHANNEL_LABELS, mayCallAi } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
import { parsePlainDate, parsePlainTime } from '@/lib/calendar/dates';
import type { ClassifyContext } from '@/lib/inbox/classify';
import { analyzeWithRules, type Analysis } from '@/lib/ai/rules';
import { assignTier } from '@/lib/ai/tiering';
import {
  callDecideProxy,
  type DecideProxyResponse,
} from '@/lib/ai/proxyClient';

export type { Analysis } from '@/lib/ai/rules';

const VALID_GROUPS = new Set<GroupCategory>(['Personal', 'Family', 'Others']);
const VALID_PRIORITIES = new Set<PriorityType>([
  'Important',
  'Social',
  'Promotion',
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
const VERDICT_SEVERITY: Record<VerdictValue, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

const FALLBACK_NOTICE = 'A simpler on-device check was used.';
const AUDIT_WRITE_FAILED_MESSAGE =
  'This item was not read because the record could not be saved.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeOptionalDetectedEvent(raw: unknown): DetectedEvent | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (
    typeof raw.date !== 'string' ||
    typeof raw.time !== 'string' ||
    !isNonEmptyString(raw.title)
  ) {
    return undefined;
  }
  const date = raw.date.trim();
  const time = raw.time.trim();
  if (!parsePlainDate(date).ok || !parsePlainTime(time).ok) {
    return undefined;
  }
  const event: DetectedEvent = {
    date,
    time,
    title: raw.title.trim().slice(0, 100),
  };
  if (isNonEmptyString(raw.location)) {
    event.location = raw.location.trim().slice(0, 100);
  }
  return event;
}

function sanitizeOptionalVerdict(raw: unknown): Verdict | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  if (
    typeof raw.value !== 'string' ||
    !VALID_VERDICT_VALUES.has(raw.value as VerdictValue)
  ) {
    return undefined;
  }
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons
        .filter((r): r is string => isNonEmptyString(r))
        .map((r) => r.trim().slice(0, 150))
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
  return {
    value: raw.value as VerdictValue,
    flags,
    reasons,
  };
}

function mergeProxyResponse(
  baseline: Analysis,
  response: DecideProxyResponse,
  itemId?: string
): Analysis | null {
  const raw = response as Record<string, unknown>;

  let nextGroup = baseline.group;
  if (raw.group !== undefined) {
    if (
      typeof raw.group !== 'string' ||
      !VALID_GROUPS.has(raw.group as GroupCategory)
    ) {
      return null;
    }
    nextGroup = raw.group as GroupCategory;
  }

  let nextPriority = baseline.priority;
  if (raw.priority !== undefined) {
    if (
      typeof raw.priority !== 'string' ||
      !VALID_PRIORITIES.has(raw.priority as PriorityType)
    ) {
      return null;
    }
    nextPriority = raw.priority as PriorityType;
  }

  let nextConfidence = baseline.confidence;
  if (raw.confidence !== undefined) {
    if (
      typeof raw.confidence !== 'number' ||
      !Number.isFinite(raw.confidence) ||
      raw.confidence < 0 ||
      raw.confidence > 1
    ) {
      return null;
    }
    nextConfidence = raw.confidence;
  }

  let nextSummary: ClaritySummary = baseline.summary;
  if (raw.summary !== undefined) {
    if (!isPlainObject(raw.summary)) {
      return null;
    }

    const s = raw.summary;
    const summaryKeys = ['fromApp', 'whoSent', 'actionNeeded', 'text'] as const;
    for (const key of summaryKeys) {
      if (s[key] !== undefined && !isNonEmptyString(s[key])) {
        return null;
      }
    }

    nextSummary = {
      fromApp: isNonEmptyString(s.fromApp)
        ? s.fromApp
        : baseline.summary.fromApp,
      whoSent: isNonEmptyString(s.whoSent)
        ? s.whoSent
        : baseline.summary.whoSent,
      actionNeeded: isNonEmptyString(s.actionNeeded)
        ? s.actionNeeded
        : baseline.summary.actionNeeded,
      text: isNonEmptyString(s.text)
        ? s.text.slice(0, 300)
        : baseline.summary.text,
    };
  }

  const nextProposals: Proposal[] = baseline.proposals.map((p) => ({ ...p }));
  const resolvedItemId =
    nextProposals[0]?.itemId ??
    (isNonEmptyString(itemId) ? itemId.trim() : 'draft');

  // Optional AI detectedEvent enrichment (validated with parsePlainDate + parsePlainTime)
  let nextDetectedEvent = baseline.detectedEvent;
  if (raw.detectedEvent !== undefined) {
    const validEvent = sanitizeOptionalDetectedEvent(raw.detectedEvent);
    if (validEvent !== undefined) {
      nextDetectedEvent = validEvent;
      const existingIdx = nextProposals.findIndex(
        (p) => p.kind === 'forwardToCalendar'
      );
      if (existingIdx >= 0) {
        nextProposals[existingIdx] = {
          ...nextProposals[existingIdx],
          event: validEvent,
        };
      } else {
        nextProposals.unshift({
          id: `${resolvedItemId}:forwardToCalendar`,
          kind: 'forwardToCalendar',
          label: 'Add to Calendar',
          itemId: resolvedItemId,
          event: validEvent,
        });
      }
    }
  }

  // Optional AI scamWarning enrichment (strict safety monotonicity: never downgrade danger)
  let nextVerdict = baseline.verdict;
  let nextScamWarning = baseline.scamWarning;
  if (raw.scamWarning !== undefined) {
    const incoming = sanitizeOptionalVerdict(raw.scamWarning);
    if (incoming !== undefined) {
      const baseSeverity = baseline.verdict
        ? VERDICT_SEVERITY[baseline.verdict.value]
        : 0;
      const incomingSeverity = VERDICT_SEVERITY[incoming.value];

      if (
        baseline.verdict?.value === 'danger' &&
        incoming.value !== 'danger'
      ) {
        // Safety monotonicity: never downgrade deterministic danger
        nextVerdict = baseline.verdict;
        nextScamWarning = baseline.scamWarning;
      } else if (
        incomingSeverity > baseSeverity ||
        (incomingSeverity === baseSeverity && incomingSeverity > 0)
      ) {
        const mergedFlags = Array.from(
          new Set([...(baseline.verdict?.flags ?? []), ...incoming.flags])
        );
        nextVerdict = {
          value: incoming.value,
          flags: mergedFlags,
          reasons: incoming.reasons,
        };
        nextScamWarning = true;

        if (!nextProposals.some((p) => p.kind === 'checkScam')) {
          nextProposals.push({
            id: `${resolvedItemId}:checkScam`,
            kind: 'checkScam',
            label: 'Check for Scam',
            itemId: resolvedItemId,
          });
        }
      }
    }
  }

  const merged: Analysis = {
    ...baseline,
    group: nextGroup,
    priority: nextPriority,
    confidence: nextConfidence,
    summary: nextSummary,
    scamWarning: nextScamWarning,
    proposals: nextProposals,
  };

  if (nextDetectedEvent !== undefined) {
    merged.detectedEvent = nextDetectedEvent;
  }
  if (nextVerdict !== undefined) {
    merged.verdict = nextVerdict;
  }

  return merged;
}

export async function analyze(
  item: InboxItemDraft & { id?: string; source: Channel },
  settings: Settings,
  deps: {
    vault: Pick<Vault, 'appendAudit'>;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    ruleCtx?: ClassifyContext & {
      confidenceOverride?: number;
      verdictOverride?: Verdict;
    };
  }
): Promise<
  Result<
    {
      analysis: Analysis;
      tier: DecisionTier;
      usedFallback: boolean;
      notice?: string;
    },
    { code: 'audit-write-failed'; message: string }
  >
> {
  // 1. Baseline deterministic on-device rules
  const rulesAnalysis = analyzeWithRules(item, {
    ...deps.ruleCtx,
    itemId: item.id,
  });

  // 2. Consent gate: AI reading OFF -> zero network calls, zero audit writes
  if (!mayCallAi(settings)) {
    return {
      ok: true,
      value: {
        analysis: rulesAnalysis,
        tier: assignTier(rulesAnalysis),
        usedFallback: false,
      },
    };
  }

  // 3. Audit BEFORE external read (Property 7)
  const channelLabel = Object.prototype.hasOwnProperty.call(
    CHANNEL_LABELS,
    item.source
  )
    ? CHANNEL_LABELS[item.source]
    : 'Message';
  const builtAudit = buildAuditEntry({
    kind: 'ai-read',
    channel: item.source,
    itemId: item.id,
    description: `Read one ${channelLabel} message`.slice(0, 200),
    purpose: 'Summarize message and check for safety',
  });

  if (!builtAudit.ok) {
    return {
      ok: false,
      error: {
        code: 'audit-write-failed',
        message: AUDIT_WRITE_FAILED_MESSAGE,
      },
    };
  }

  const auditWrite = await deps.vault.appendAudit(builtAudit.value);
  if (!auditWrite.ok) {
    return {
      ok: false,
      error: {
        code: 'audit-write-failed',
        message: AUDIT_WRITE_FAILED_MESSAGE,
      },
    };
  }

  // 4. Call /api/decide once (zero retries)
  const proxyRes = await callDecideProxy(
    { source: item.source, text: item.text },
    { fetchFn: deps.fetchFn, timeoutMs: deps.timeoutMs }
  );

  if (!proxyRes.ok) {
    return {
      ok: true,
      value: {
        analysis: rulesAnalysis,
        tier: assignTier(rulesAnalysis),
        usedFallback: true,
        notice: FALLBACK_NOTICE,
      },
    };
  }

  const merged = mergeProxyResponse(rulesAnalysis, proxyRes.value, item.id);
  if (merged === null) {
    return {
      ok: true,
      value: {
        analysis: rulesAnalysis,
        tier: assignTier(rulesAnalysis),
        usedFallback: true,
        notice: FALLBACK_NOTICE,
      },
    };
  }

  const tier = assignTier(merged);
  return {
    ok: true,
    value: {
      analysis: merged,
      tier,
      usedFallback: false,
    },
  };
}
