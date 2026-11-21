import type {
  Channel,
  InboxItem,
  InboxItemDraft,
  Settings,
} from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';
import { admit } from '@/lib/vault/consent';
import { normalizeSource } from '@/lib/inbox/parse';
import { isDuplicate } from '@/lib/inbox/dedup';
import { analyze } from '@/lib/ai/engine';

export async function pullAndIngestFromRelay(params: {
  vault: Vault;
  settings: Settings;
  pulledItems: ReadonlyArray<{ id: string; draft: InboxItemDraft }>;
  ackFn: (ids: string[]) => Promise<void>;
  fetchDecideFn?: typeof fetch;
  nowMs?: number;
}): Promise<{
  stored: InboxItem[];
  discardedChannels: Channel[];
  duplicatesSkipped: number;
  fallbackUsedCount: number;
}> {
  const existingRes = await params.vault.listItems();
  const existing: InboxItem[] = existingRes.ok ? [...existingRes.value] : [];

  const stored: InboxItem[] = [];
  const discardedChannels: Channel[] = [];
  const ackIds: string[] = [];
  let duplicatesSkipped = 0;
  let fallbackUsedCount = 0;

  for (const pulled of params.pulledItems) {
    const source = normalizeSource(pulled.draft.source);
    if (!source) {
      ackIds.push(pulled.id);
      continue;
    }

    // 1. ConsentGate check: discard OFF channels without storing, still acknowledge/clear from relay
    const decision = admit(params.settings, { source });
    if (!decision.admit) {
      if (!discardedChannels.includes(source)) {
        discardedChannels.push(source);
      }
      ackIds.push(pulled.id);
      continue;
    }

    // 2. Duplicate check within 24h
    const normalizedDraft: InboxItemDraft = {
      ...pulled.draft,
      source,
    };
    if (isDuplicate(normalizedDraft, existing, params.nowMs)) {
      duplicatesSkipped += 1;
      ackIds.push(pulled.id);
      continue;
    }

    // 3. Analyze (rules or AI with audit-first + fallback) and assign tier
    const analysisRes = await analyze(
      {
        ...normalizedDraft,
        id: pulled.id,
        source,
      },
      params.settings,
      {
        vault: params.vault,
        fetchFn: params.fetchDecideFn,
        ruleCtx: { familyMembers: params.settings.familyMembers },
      }
    );

    if (!analysisRes.ok) {
      // Audit write failed; do not store and do not ack so item is not silently dropped
      continue;
    }

    if (analysisRes.value.usedFallback) {
      fallbackUsedCount += 1;
    }

    const { analysis, tier } = analysisRes.value;
    const item: InboxItem = {
      id: pulled.id,
      source,
      ...(normalizedDraft.sender !== undefined
        ? { sender: normalizedDraft.sender }
        : {}),
      text: normalizedDraft.text,
      attachments: normalizedDraft.attachments,
      receivedAt: normalizedDraft.receivedAt,
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

    // 4. Write to vault and record id for relay acknowledgement
    const putRes = await params.vault.putItem(item);
    if (putRes.ok) {
      stored.push(item);
      existing.push(item);
      ackIds.push(pulled.id);
    }
  }

  if (ackIds.length > 0) {
    await params.ackFn(ackIds);
  }

  return {
    stored,
    discardedChannels,
    duplicatesSkipped,
    fallbackUsedCount,
  };
}
