import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { APIConfig } from '../types/settings';
import { projectWorldCalendar } from './worldRuntimeProjection';
import { buildWorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';
import { applyWorldCalendarPatchPlanToChats } from './worldCalendarPatchExecutor';
import { orchestrateWorldDecision } from './worldDecisionOrchestrator';

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
  modelArbitration?: {
    attempted: boolean;
    applied: boolean;
    selectedIndependentCount: number;
  };
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
  if (!textApiConfig || queue.length <= 1) return { queue, meta: { attempted: Boolean(textApiConfig), applied: false, selectedIndependentCount: 0 } };
  const independent = queue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.dependsOnItemId);
  if (independent.length <= 1) return { queue, meta: { attempted: true, applied: false, selectedIndependentCount: independent.length } };
  try {
    const picks: Array<{ item: WorldCalendarPatchApplyPlan['queue'][number]; idx: number }> = [];
    const remaining = independent.map(({ item, index }) => ({ item, idx: index }));
    while (remaining.length > 0) {
      const decision = await orchestrateWorldDecision({
        domain: 'calendar_patch_queue',
        textApiConfig,
        candidates: remaining.map(({ item, idx }) => ({
          id: String(idx),
          kind: 'calendar_item_patch',
          reasonType: 'calendar_conflict_reorder',
          localScore: 1 - (item.priority / 10_000_000_000_000),
          summary: `${item.calendarItemId}|${item.reason}|${item.patch.startAt}`,
        })),
      });
      if (!decision) break;
      const pickPos = remaining.findIndex((entry) => String(entry.idx) === decision.selected.id);
      if (pickPos < 0) break;
      picks.push(remaining[pickPos]!);
      remaining.splice(pickPos, 1);
    }
    const reorderedIndependent = [...picks.map((entry) => entry.item), ...remaining.map((entry) => entry.item)];
    let cursor = 0;
    const reorderedQueue = queue.map((item) => {
      if (item.dependsOnItemId) return item;
      const next = reorderedIndependent[cursor] || item;
      cursor += 1;
      return next;
    });
    const applied = reorderedQueue.some((item, idx) => item !== queue[idx]);
    return { queue: reorderedQueue, meta: { attempted: true, applied, selectedIndependentCount: independent.length } };
  } catch {
    return { queue, meta: { attempted: true, applied: false, selectedIndependentCount: independent.length } };
  }
}

export async function applyWorldCalendarPatchDraftQueue(params: ApplyWorldCalendarPatchDraftQueueParams): Promise<ApplyWorldCalendarPatchDraftQueueResult> {
  const projection = projectWorldCalendar(params.chats, params.characters, { conversationId: params.conversationId });
  const basePlan = buildWorldCalendarPatchApplyPlan(projection);
  const reordered = await reorderPlanQueueWithModel(basePlan.queue, params.textApiConfig || null);
  const plan = { queue: reordered.queue };
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
    modelArbitration: reordered.meta,
  };
}
