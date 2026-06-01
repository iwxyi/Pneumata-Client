import type { GroupChat } from '../types/chat';
import type { AICharacter } from '../types/character';
import { projectWorldCalendar } from './worldRuntimeProjection';
import { buildWorldCalendarPatchApplyPlan } from './worldCalendarPatchPlanner';
import { applyWorldCalendarPatchPlanToChats } from './worldCalendarPatchExecutor';

export type WorldCalendarPatchTrigger = 'manual' | 'auto_runtime' | 'sidebar_projection' | 'action_panel';

export interface ApplyWorldCalendarPatchDraftQueueParams {
  chats: GroupChat[];
  characters: AICharacter[];
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
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

export async function applyWorldCalendarPatchDraftQueue(params: ApplyWorldCalendarPatchDraftQueueParams): Promise<ApplyWorldCalendarPatchDraftQueueResult> {
  const projection = projectWorldCalendar(params.chats, params.characters, { conversationId: params.conversationId });
  const plan = buildWorldCalendarPatchApplyPlan(projection);
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
