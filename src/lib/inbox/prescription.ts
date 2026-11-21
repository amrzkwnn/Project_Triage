import {
  LOW_CONFIDENCE_THRESHOLD,
  type Attachment,
  type CalendarEvent,
  type DecisionTier,
  type DetectedEvent,
  type InboxItem,
  type Proposal,
  type Result,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { detectEvent } from '@/lib/inbox/events';
import type { Confirmation } from '@/lib/actions/confirmation';
import { execute, type ExecuteError } from '@/lib/actions/executor';

export const PRESCRIPTION_RETAKE_MESSAGE =
  'This prescription photo is hard to read. Please retake the photo in brighter light so the medicine label is clear.';

export const PRESCRIPTION_SAVE_FAILED_MESSAGE =
  'We could not save your prescription photo right now. Please try again.';

export type PrescriptionPhotoInput = {
  id?: string;
  photo: Attachment;
  extractedText: string;
  ocrConfidence: number;
  ocrFailed?: boolean;
  receivedAt?: string;
  vault: Pick<Vault, 'putItem'>;
};

export type PrescriptionItemOutcome = {
  item: InboxItem;
  needsRetake: boolean;
  retakeMessage?: string;
  showOriginalAboveText: true;
};

export async function createPrescriptionItem(
  params: PrescriptionPhotoInput
): Promise<
  Result<
    PrescriptionItemOutcome,
    { code: 'save-failed'; message: string; canRetry: true }
  >
> {
  const id =
    params.id && params.id.trim().length > 0
      ? params.id
      : `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const receivedAt = params.receivedAt ?? new Date().toISOString();
  const trimmedText =
    typeof params.extractedText === 'string' ? params.extractedText.trim() : '';

  const validConfidence =
    Number.isFinite(params.ocrConfidence) && !params.ocrFailed
      ? Math.max(0, Math.min(1, params.ocrConfidence))
      : 0;

  const isLowConfidenceOrFailed =
    Boolean(params.ocrFailed) ||
    trimmedText.length === 0 ||
    validConfidence < LOW_CONFIDENCE_THRESHOLD;

  const detectedEvent = isLowConfidenceOrFailed
    ? undefined
    : detectEvent(trimmedText);

  const proposals: Proposal[] = [];
  if (detectedEvent) {
    proposals.push({
      id: `${id}:forwardToCalendar`,
      kind: 'forwardToCalendar',
      label: 'Forward to Calendar',
      itemId: id,
      event: detectedEvent,
    });
  }
  proposals.push({
    id: `${id}:shareWithFamily`,
    kind: 'shareWithFamily',
    label: 'Forward Summary to Family',
    itemId: id,
  });

  const tier: DecisionTier = isLowConfidenceOrFailed ? 3 : 2;
  const itemText =
    trimmedText.length > 0
      ? params.extractedText
      : 'Prescription photo could not be read clearly.';

  const item: InboxItem = {
    id,
    source: 'photos',
    sender: 'Prescription Photo',
    text: itemText,
    attachments: [params.photo],
    receivedAt,
    group: 'Personal',
    priority: 'Important',
    summary: isLowConfidenceOrFailed
      ? {
          fromApp: 'From Photo',
          whoSent: 'Prescription Photo',
          actionNeeded: 'Retake photo or check the medicine label carefully',
          text: PRESCRIPTION_RETAKE_MESSAGE,
        }
      : {
          fromApp: 'From Photo',
          whoSent: 'Prescription Photo',
          actionNeeded: 'Review medicine details and confirm before adding',
          text: 'Prescription photo saved. Please check the medicine label above before adding any reminder.',
        },
    ...(detectedEvent ? { detectedEvent } : {}),
    tier,
    confidence: validConfidence,
    status: isLowConfidenceOrFailed ? 'uncategorized-failed' : 'ok',
    proposals,
  };

  const putRes = await params.vault.putItem(item);
  if (!putRes.ok) {
    return {
      ok: false,
      error: {
        code: 'save-failed',
        message: putRes.error.message || PRESCRIPTION_SAVE_FAILED_MESSAGE,
        canRetry: true,
      },
    };
  }

  return {
    ok: true,
    value: {
      item,
      needsRetake: isLowConfidenceOrFailed,
      ...(isLowConfidenceOrFailed
        ? { retakeMessage: PRESCRIPTION_RETAKE_MESSAGE }
        : {}),
      showOriginalAboveText: true,
    },
  };
}

export async function commitPrescriptionSchedule(params: {
  actionId: string;
  confirmation: Confirmation | undefined;
  event: DetectedEvent;
  sourceItemId: string;
  vault: Pick<Vault, 'putEvent'>;
  createdAt?: string;
}): Promise<Result<CalendarEvent, ExecuteError>> {
  let savedEvent: CalendarEvent | undefined;

  const execRes = await execute(
    {
      actionId: params.actionId,
      kind: 'commitMedication',
      payload: {
        event: params.event,
        sourceItemId: params.sourceItemId,
      },
    },
    params.confirmation,
    {
      saveCalendarEvent: async () => ({ ok: true, value: undefined }),
      sendFamilyShare: async () => ({ ok: true, value: undefined }),
      runEraseAll: async () => ({ ok: true, value: undefined }),
      runProtectedSideEffect: async () => {
        const nextEvent: CalendarEvent = {
          id: `med-${params.sourceItemId}-${params.event.date}-${params.event.time}`,
          title: params.event.title,
          date: params.event.date,
          time: params.event.time,
          ...(params.event.location ? { location: params.event.location } : {}),
          category: 'Medical',
          sourceItemId: params.sourceItemId,
          createdAt: params.createdAt ?? new Date().toISOString(),
        };
        const putRes = await params.vault.putEvent(nextEvent);
        if (!putRes.ok) {
          return { ok: false, error: putRes.error.message };
        }
        savedEvent = nextEvent;
        return { ok: true, value: undefined };
      },
    }
  );

  if (!execRes.ok) {
    return execRes;
  }

  return { ok: true, value: savedEvent! };
}
