import { LOW_CONFIDENCE_THRESHOLD, type DecisionTier } from '@/lib/types';
import type { Analysis } from '@/lib/ai/rules';

export function assignTier(
  a: Pick<Analysis, 'verdict' | 'confidence' | 'proposals'>
): DecisionTier {
  if (
    a.verdict?.value === 'danger' ||
    !Number.isFinite(a.confidence) ||
    a.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return 3;
  }

  if (a.proposals.length > 0) {
    return 2;
  }

  return 1;
}
