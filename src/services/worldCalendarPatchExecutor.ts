import type { GroupChat } from '../types/chat';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { WorldCalendarProjectionResult } from './worldRuntimeProjection';
import type { WorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';

export interface WorldCalendarPatchExecutionResult {
  chats: GroupChat[];
  appliedCount: number;
  skippedCount: number;
  appliedItems: Array<{
    chatId: string;
    calendarItemId: string;
    idempotencyKey: string;
    reason: string;
  }>;
  skippedItems: Array<{
    calendarItemId: string;
    idempotencyKey: string;
    reason: 'missing_target_conversation' | 'target_chat_not_found' | 'duplicate_idempotency' | 'chain_group_blocked';
  }>;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function resolveTargetConversationId(
  calendarItemId: string,
  projection: Pick<WorldCalendarProjectionResult, 'items'>,
  fallbackConversationId?: string | null,
) {
  const item = projection.items.find((entry) => entry.id === calendarItemId);
  if (!item?.sourceRefs.length) return fallbackConversationId || null;
  const best = [...item.sourceRefs].sort((left, right) => {
    if (left.weight !== right.weight) return right.weight - left.weight;
    return right.lastEvidenceAt - left.lastEvidenceAt;
  })[0];
  return best?.conversationId || fallbackConversationId || null;
}

function hasIdempotencyKey(chat: GroupChat, idempotencyKey: string) {
  return (chat.runtimeEventsV2 || []).some((event) => getString((event.payload as Record<string, unknown>)?.idempotencyKey) === idempotencyKey);
}

function stablePatchEventSeed(parts: Array<string | number | undefined>) {
  const joined = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 31 + joined.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function buildPatchEvent(
  conversationId: string,
  planItem: WorldCalendarPatchApplyPlan['queue'][number],
  source: string,
  createdAt?: number,
): RuntimeEventV2 {
  const now = typeof createdAt === 'number' && Number.isFinite(createdAt) ? Math.round(createdAt) : Date.now();
  const seed = stablePatchEventSeed([
    conversationId,
    planItem.idempotencyKey,
    planItem.calendarItemId,
    planItem.patch.startAt,
    planItem.patch.endAt ?? undefined,
    planItem.patch.durationMinutes ?? undefined,
    source,
  ]);
  return {
    id: `calendar-patch-${now}-${seed}`,
    conversationId,
    kind: 'calendar_item_patch',
    createdAt: now,
    summary: planItem.reason,
    visibility: 'derived_public',
    payload: {
      calendarItemId: planItem.calendarItemId,
      basedOnItemId: planItem.dependsOnItemId || null,
      startAt: planItem.patch.startAt,
      endAt: planItem.patch.endAt ?? null,
      durationMinutes: planItem.patch.durationMinutes ?? null,
      reason: planItem.reason,
      idempotencyKey: planItem.idempotencyKey,
      source,
    },
  };
}

export function applyWorldCalendarPatchPlanToChats(
  chats: GroupChat[],
  projection: Pick<WorldCalendarProjectionResult, 'items'>,
  plan: WorldCalendarPatchApplyPlan,
  options: { fallbackConversationId?: string | null; source?: string; now?: number } = {},
): WorldCalendarPatchExecutionResult {
  const nextChats = chats.map((chat) => ({ ...chat, runtimeEventsV2: [...(chat.runtimeEventsV2 || [])] }));
  const byId = new Map(nextChats.map((chat) => [chat.id, chat]));
  let appliedCount = 0;
  let skippedCount = 0;
  const appliedItems: WorldCalendarPatchExecutionResult['appliedItems'] = [];
  const skippedItems: WorldCalendarPatchExecutionResult['skippedItems'] = [];
  const blockedChainGroups = new Set<string>();

  const source = options.source || 'world_calendar_patch_executor';
  const baseNow = typeof options.now === 'number' && Number.isFinite(options.now) ? Math.round(options.now) : Date.now();
  plan.queue.forEach((item, index) => {
    if (item.chainGroupId && blockedChainGroups.has(item.chainGroupId)) {
      skippedCount += 1;
      skippedItems.push({
        calendarItemId: item.calendarItemId,
        idempotencyKey: item.idempotencyKey,
        reason: 'chain_group_blocked',
      });
      return;
    }

    const conversationId = resolveTargetConversationId(item.calendarItemId, projection, options.fallbackConversationId);
    if (!conversationId) {
      if (item.chainGroupId) blockedChainGroups.add(item.chainGroupId);
      skippedCount += 1;
      skippedItems.push({
        calendarItemId: item.calendarItemId,
        idempotencyKey: item.idempotencyKey,
        reason: 'missing_target_conversation',
      });
      return;
    }
    const chat = byId.get(conversationId);
    if (!chat) {
      if (item.chainGroupId) blockedChainGroups.add(item.chainGroupId);
      skippedCount += 1;
      skippedItems.push({
        calendarItemId: item.calendarItemId,
        idempotencyKey: item.idempotencyKey,
        reason: 'target_chat_not_found',
      });
      return;
    }
    if (hasIdempotencyKey(chat, item.idempotencyKey)) {
      if (item.chainGroupId) blockedChainGroups.add(item.chainGroupId);
      skippedCount += 1;
      skippedItems.push({
        calendarItemId: item.calendarItemId,
        idempotencyKey: item.idempotencyKey,
        reason: 'duplicate_idempotency',
      });
      return;
    }
    chat.runtimeEventsV2 = [...(chat.runtimeEventsV2 || []), buildPatchEvent(chat.id, item, source, baseNow + index)];
    appliedCount += 1;
    appliedItems.push({
      chatId: chat.id,
      calendarItemId: item.calendarItemId,
      idempotencyKey: item.idempotencyKey,
      reason: item.reason,
    });
  });

  return {
    chats: nextChats,
    appliedCount,
    skippedCount,
    appliedItems,
    skippedItems,
  };
}
