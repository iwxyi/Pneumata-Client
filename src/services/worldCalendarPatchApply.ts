import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { APIConfig } from '../types/settings';
import { projectWorldCalendar } from './worldRuntimeProjection';
import { buildWorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';
import { applyWorldCalendarPatchPlanToChats } from './worldCalendarPatchExecutor';
import { generateJsonResponse } from './aiClient';

export type WorldCalendarPatchTrigger = 'manual' | 'auto_runtime' | 'sidebar_projection' | 'action_panel';

export interface ApplyWorldCalendarPatchDraftQueueParams {
  chats: GroupChat[];
  characters: AICharacter[];
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
  textApiConfig?: APIConfig | null;
  conversationId?: string | null;
  trigger?: WorldCalendarPatchTrigger;
  continueOnPersistError?: boolean;
}

export interface ApplyWorldCalendarPatchDraftQueueResult {
  appliedCount: number;
  skippedCount: number;
  queueCount: number;
  persistedCount: number;
  failedCount: number;
  failures: Array<{ chatId: string; reason: string }>;
  appliedItems: Array<{
    chatId: string;
    calendarItemId: string;
    idempotencyKey: string;
    reason: string;
  }>;
  skippedItems: Array<{
    calendarItemId: string;
    idempotencyKey: string;
    reason: 'missing_target_conversation' | 'target_chat_not_found' | 'duplicate_idempotency';
  }>;
}

function triggerToSource(trigger: WorldCalendarPatchTrigger | undefined) {
  if (trigger === 'auto_runtime') return 'world_calendar_auto_patch_runtime';
  if (trigger === 'sidebar_projection') return 'world_calendar_sidebar_projection';
  if (trigger === 'action_panel') return 'world_calendar_action_panel';
  return 'world_calendar_patch_executor';
}

export async function reorderPlanQueueWithModel(
  queue: WorldCalendarPatchApplyPlan['queue'],
  textApiConfig?: APIConfig | null,
) {
  if (!textApiConfig || queue.length <= 1) return queue;
  const independent = queue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.dependsOnItemId);
  if (independent.length <= 1) return queue;
  try {
    const prompt = [
      '你是日历冲突修正执行顺序裁决器。',
      '目标：优先减少冲突扩散与用户感知打扰。',
      '只输出 JSON: {"orderedIndices":[number,...]}',
      '必须只使用给定索引，且不重复，不得新增。',
    ].join('\n');
    const raw = await generateJsonResponse(
      textApiConfig,
      prompt,
      [{
        role: 'user',
        content: JSON.stringify({
          candidates: independent.map(({ item, index }) => ({
            index,
            calendarItemId: item.calendarItemId,
            dependsOnItemId: item.dependsOnItemId || null,
            reason: item.reason,
            startAt: item.patch.startAt,
            endAt: item.patch.endAt || null,
            durationMinutes: item.patch.durationMinutes || null,
          })),
        }),
      }],
    );
    const parsed = JSON.parse(raw) as { orderedIndices?: number[] };
    const ordered = Array.isArray(parsed.orderedIndices) ? parsed.orderedIndices.filter((value) => Number.isInteger(value) && value >= 0 && value < independent.length) : [];
    if (!ordered.length) return queue;
    const seen = new Set<number>();
    const reordered = ordered
      .filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      })
      .map((value) => independent[value]?.item)
      .filter((item): item is WorldCalendarPatchApplyPlan['queue'][number] => Boolean(item));
    const remaining = independent
      .map(({ item }, idx) => ({ item, idx }))
      .filter(({ idx }) => !seen.has(idx))
      .map(({ item }) => item);
    const reorderedIndependent = [...reordered, ...remaining];
    let cursor = 0;
    return queue.map((item) => {
      if (item.dependsOnItemId) return item;
      const next = reorderedIndependent[cursor] || item;
      cursor += 1;
      return next;
    });
  } catch {
    return queue;
  }
}

export async function applyWorldCalendarPatchDraftQueue(params: ApplyWorldCalendarPatchDraftQueueParams): Promise<ApplyWorldCalendarPatchDraftQueueResult> {
  const projection = projectWorldCalendar(params.chats, params.characters, { conversationId: params.conversationId });
  const basePlan = buildWorldCalendarPatchApplyPlan(projection);
  const reorderedQueue = await reorderPlanQueueWithModel(basePlan.queue, params.textApiConfig || null);
  const plan = { queue: reorderedQueue };
  const execution = applyWorldCalendarPatchPlanToChats(params.chats, projection, plan, {
    fallbackConversationId: params.conversationId,
    source: triggerToSource(params.trigger),
  });
  const changedChats = execution.chats.filter((chat, index) => {
    const before = params.chats[index];
    return (chat.runtimeEventsV2?.length || 0) !== (before?.runtimeEventsV2?.length || 0);
  });
  const failures: Array<{ chatId: string; reason: string }> = [];
  let persistedCount = 0;
  for (const chat of changedChats) {
    try {
      await params.updateChat(chat.id, { runtimeEventsV2: chat.runtimeEventsV2 });
      persistedCount += 1;
    } catch (error) {
      failures.push({ chatId: chat.id, reason: error instanceof Error ? error.message : 'unknown error' });
      if (!params.continueOnPersistError) throw error;
    }
  }
  return {
    appliedCount: execution.appliedCount,
    skippedCount: execution.skippedCount,
    queueCount: plan.queue.length,
    persistedCount,
    failedCount: failures.length,
    failures,
    appliedItems: execution.appliedItems,
    skippedItems: execution.skippedItems,
  };
}
