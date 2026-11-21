import type {
  Channel,
  ClaritySummary,
  DecisionTier,
  GroupCategory,
  InboxItemDraft,
  PriorityType,
  Result,
  Settings,
  Verdict,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { CHANNEL_LABELS, mayCallAi } from '@/lib/vault/consent';
import { buildAuditEntry } from '@/lib/vault/audit';
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

function mergeProxyResponse(
  baseline: Analysis,
  response: DecideProxyResponse
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

  return {
    ...baseline,
    group: nextGroup,
    priority: nextPriority,
    confidence: nextConfidence,
    summary: nextSummary,
  };
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

  const merged = mergeProxyResponse(rulesAnalysis, proxyRes.value);
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
