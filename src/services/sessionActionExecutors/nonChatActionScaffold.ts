import type { GroupChat } from '../../types/chat';
import type { DirectorInterventionPayload, RuntimeEventV2 } from '../../types/runtimeEvent';
import type { SessionActionDefinition, SessionActionExecutionResult } from '../../types/sessionEngine';
import { buildStartPrivateThreadExecutionResult } from '../directSessionRuntime';
import { buildActionRuntimeContract } from '../sessionRuntimeContract';

function truncate(text: string, maxLength: number) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getTargetLabel(chat: GroupChat, action: SessionActionDefinition) {
  const targetId = typeof action.payload?.targetId === 'string' ? action.payload.targetId : action.targetIds?.[0];
  if (!targetId) return '';
  const index = chat.memberIds.indexOf(targetId);
  if (index === -1) return '';
  return ` → 对象#${index + 1}`;
}

function buildActionResult(chat: GroupChat, action: SessionActionDefinition, title: string, summary: string, eventType = 'session_action_scaffold', metrics?: unknown): SessionActionExecutionResult {
  return {
    chatPatch: {
      worldState: {
        ...chat.worldState,
        recentEvent: summary,
      },
    },
    runtimeEvents: [buildActionRuntimeContract(chat, action.type, action.payload || {}, action.actorId, {
      eventType,
      title,
      summary,
      metrics,
      visibilityScope: action.visibility || 'public',
    })],
  };
}

function getPrompt(action: SessionActionDefinition) {
  return typeof action.payload?.prompt === 'string' ? action.payload.prompt : '';
}

function readNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function prepareAction(action: SessionActionDefinition) {
  const targetId = typeof action.payload?.targetId === 'string' ? action.payload.targetId : undefined;
  return {
    ...action,
    targetIds: action.targetIds?.length ? action.targetIds : targetId ? [targetId] : [],
  };
}

function validateAction(action: SessionActionDefinition) {
  if ((action.type === 'ask_question' || action.type === 'director_intervention') && !getPrompt(action)) return false;
  if (['ask_question', 'start_private_thread', 'wolf_vote', 'inspect_player', 'vote_player'].includes(action.type) && !(action.targetIds?.length)) return false;
  return true;
}

function buildPhasePatch(chat: GroupChat, phase: GroupChat['worldState']['phase'], recentEvent: string) {
  return {
    worldState: {
      ...chat.worldState,
      phase,
      recentEvent,
    },
  };
}

function resolveDirectorInterventionIntent(value: unknown): DirectorInterventionPayload['intent'] {
  const allowed: DirectorInterventionPayload['intent'][] = ['force_reply', 'escalate', 'cool_down', 'inject_event', 'summarize', 'reveal', 'redirect'];
  if (typeof value === 'string' && allowed.includes(value as DirectorInterventionPayload['intent'])) return value as DirectorInterventionPayload['intent'];
  return 'inject_event';
}

function buildDirectorInterventionRuntimeEvent(chat: GroupChat, action: SessionActionDefinition, summary: string): RuntimeEventV2 {
  const prompt = getPrompt(action);
  const targetActorIds = action.targetIds || [];
  const now = Date.now();
  const requestedMaxTurns = readNumber(action.payload?.maxTurns);
  const maxTurns = typeof requestedMaxTurns === 'number' ? Math.max(1, Math.min(5, Math.round(requestedMaxTurns))) : 1;
  const requestedExpiresAt = readNumber(action.payload?.expiresAt);
  const requestedPressure = readNumber(action.payload?.pressure);
  const payload: DirectorInterventionPayload = {
    intent: resolveDirectorInterventionIntent(action.payload?.intent),
    targetActorIds,
    targetLineId: typeof action.payload?.targetLineId === 'string' ? action.payload.targetLineId : undefined,
    pressure: typeof requestedPressure === 'number' ? Math.max(0, Math.min(1, requestedPressure)) : 0.9,
    text: prompt || summary,
    maxTurns,
    expiresAt: typeof requestedExpiresAt === 'number' ? requestedExpiresAt : now + 10 * 60_000,
  };
  return {
    id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: chat.id,
    kind: 'director_intervention',
    createdAt: now,
    actorIds: action.actorId ? [action.actorId] : ['user'],
    targetIds: targetActorIds,
    summary,
    channelId: 'moderator',
    eventClass: 'action',
    visibility: action.visibility || 'moderator_only',
    payload,
  };
}

function handleAskQuestion(chat: GroupChat, action: SessionActionDefinition) {
  const summary = `提问${getTargetLabel(chat, action)}：${truncate(getPrompt(action), 48)}`;
  return buildActionResult(chat, action, '面试官发起提问', summary, 'interview_question', {
    targetIds: action.targetIds || [],
    round: action.payload?.round,
  });
}

function handleDirectorIntervention(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = prompt ? `导演推进：${truncate(prompt, 48)}` : '执行了导演推进';
  const result = buildActionResult(chat, action, '面试阶段推进', summary, 'interview_phase_control', {
    prompt,
  });
  const event = buildDirectorInterventionRuntimeEvent(chat, action, summary);
  return {
    ...result,
    chatPatch: {
      ...result.chatPatch,
      runtimeEventsV2: [...(chat.runtimeEventsV2 || []), event].slice(-160),
    },
  };
}

function handleStartPrivateThread(chat: GroupChat, action: SessionActionDefinition) {
  const targetId = typeof action.payload?.targetId === 'string' ? action.payload.targetId : action.targetIds?.[0] || '';
  const actorId = typeof action.payload?.actorId === 'string' ? action.payload.actorId : action.actorId || '';
  return buildStartPrivateThreadExecutionResult(chat, actorId, targetId, getPrompt(action));
}

function handleWolfVote(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = `狼人夜晚刀口${getTargetLabel(chat, action)}${prompt ? `：${truncate(prompt, 32)}` : ''}`;
  return {
    chatPatch: buildPhasePatch(chat, 'debating', summary),
    runtimeEvents: [buildActionRuntimeContract(chat, action.type, action.payload || {}, action.actorId, { eventType: 'werewolf_night_action', title: '狼人夜晚袭击结算', summary, metrics: { targetIds: action.targetIds || [], prompt }, visibilityScope: action.visibility || 'pair_private' })],
  };
}

function handleInspectPlayer(chat: GroupChat, action: SessionActionDefinition) {
  const summary = `预言家查验${getTargetLabel(chat, action)}`;
  return {
    chatPatch: buildPhasePatch(chat, 'debating', summary),
    runtimeEvents: [buildActionRuntimeContract(chat, action.type, action.payload || {}, action.actorId, { eventType: 'werewolf_inspection', title: '预言家夜晚查验', summary, metrics: { targetIds: action.targetIds || [] }, visibilityScope: action.visibility || 'role_private' })],
  };
}

function handleVotePlayer(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = `白天投票${getTargetLabel(chat, action)}${prompt ? `：${truncate(prompt, 32)}` : ''}`;
  return {
    chatPatch: buildPhasePatch(chat, 'aligned', summary),
    runtimeEvents: [buildActionRuntimeContract(chat, action.type, action.payload || {}, action.actorId, { eventType: 'werewolf_vote', title: '白天投票推进', summary, metrics: { targetIds: action.targetIds || [], prompt }, visibilityScope: action.visibility || 'public' })],
  };
}

function getHandler(action: SessionActionDefinition) {
  if (action.type === 'ask_question') return handleAskQuestion;
  if (action.type === 'director_intervention') return handleDirectorIntervention;
  if (action.type === 'start_private_thread') return handleStartPrivateThread;
  if (action.type === 'wolf_vote') return handleWolfVote;
  if (action.type === 'inspect_player') return handleInspectPlayer;
  if (action.type === 'vote_player') return handleVotePlayer;
  return null;
}

export function executeNonChatActionScaffold(chat: GroupChat, action: SessionActionDefinition) {
  const prepared = prepareAction(action);
  if (!validateAction(prepared)) return null;
  const handler = getHandler(prepared);
  if (!handler) return null;
  return handler(chat, prepared);
}
