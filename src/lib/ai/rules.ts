import type {
  ClaritySummary,
  DetectedEvent,
  GroupCategory,
  InboxItemDraft,
  PriorityType,
  Proposal,
  ProposalKind,
  Verdict,
} from '@/lib/types';
import { classify, type ClassifyContext } from '@/lib/inbox/classify';
import { availableForwardActions, detectEvent } from '@/lib/inbox/events';
import { buildClaritySummary } from '@/lib/ai/summary';

export type Analysis = {
  group: GroupCategory;
  priority: PriorityType;
  summary: ClaritySummary;
  detectedEvent?: DetectedEvent;
  verdict?: Verdict;
  scamWarning?: boolean;
  confidence: number;
  proposals: Proposal[];
};

const PROPOSAL_LABELS = new Map<ProposalKind, string>([
  ['forwardToCalendar', 'Add to Calendar'],
  ['checkScam', 'Check for Scam'],
  ['checkAiImage', 'Check Photo'],
  ['shareWithFamily', 'Ask Family'],
]);

const DEFAULT_RULES_CONFIDENCE = 0.85;

export function analyzeWithRules(
  draft: InboxItemDraft,
  ctx?: ClassifyContext & {
    itemId?: string;
    confidenceOverride?: number;
    verdictOverride?: Verdict;
  }
): Analysis {
  const classification = classify(draft, ctx);
  const detectedEvent = detectEvent(draft.text);
  const summary = buildClaritySummary(draft, {
    detectedEvent,
    scamWarning: classification.scamWarning,
  });

  const itemId =
    typeof ctx?.itemId === 'string' && ctx.itemId.trim().length > 0
      ? ctx.itemId
      : 'draft';

  const actionKinds = availableForwardActions(draft, detectedEvent);
  const proposals: Proposal[] = actionKinds.map((kind) => {
    const proposal: Proposal = {
      id: `${itemId}:${kind}`,
      kind,
      label: PROPOSAL_LABELS.get(kind) ?? kind,
      itemId,
    };
    if (kind === 'forwardToCalendar' && detectedEvent !== undefined) {
      proposal.event = detectedEvent;
    }
    return proposal;
  });

  let verdict: Verdict | undefined;
  if (ctx?.verdictOverride !== undefined) {
    verdict = ctx.verdictOverride;
  } else if (classification.scamWarning) {
    verdict = {
      value: 'danger',
      reasons: ['Urgent message with payment link from unknown sender'],
      flags: ['urgency', 'payment'],
    };
  }

  const confidence = ctx?.confidenceOverride ?? DEFAULT_RULES_CONFIDENCE;

  const analysis: Analysis = {
    group: classification.group,
    priority: classification.priority,
    summary,
    scamWarning: classification.scamWarning,
    confidence,
    proposals,
  };

  if (detectedEvent !== undefined) {
    analysis.detectedEvent = detectedEvent;
  }
  if (verdict !== undefined) {
    analysis.verdict = verdict;
  }

  return analysis;
}
