import type { GroupChat } from '../../types/chat';
import type { SessionActionDefinition, SessionActionExecutionResult } from '../../types/sessionEngine';

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

function buildActionResult(chat: GroupChat, title: string, summary: string): SessionActionExecutionResult {
  return {
    chatPatch: {
      worldState: {
        ...chat.worldState,
        recentEvent: summary,
      },
    },
    runtimeEvents: [{
      eventType: 'session_action_scaffold',
      title,
      summary,
    }],
  };
}

function getPrompt(action: SessionActionDefinition) {
  return typeof action.payload?.prompt === 'string' ? action.payload.prompt : '';
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

function handleAskQuestion(chat: GroupChat, action: SessionActionDefinition) {
  const summary = `提问${getTargetLabel(chat, action)}：${truncate(getPrompt(action), 48)}`;
  return buildActionResult(chat, '执行了提问动作', summary);
}

function handleDirectorIntervention(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = prompt ? `导演干预：${truncate(prompt, 48)}` : '执行了导演干预';
  return buildActionResult(chat, '执行了导演干预', summary);
}

function handleStartPrivateThread(chat: GroupChat, action: SessionActionDefinition) {
  const summary = `预留动作：发起私聊${getTargetLabel(chat, action)}`;
  return buildActionResult(chat, '执行了私聊派生动作', summary);
}

function handleWolfVote(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = `狼人夜晚刀口${getTargetLabel(chat, action)}${prompt ? `：${truncate(prompt, 32)}` : ''}`;
  return {
    chatPatch: buildPhasePatch(chat, 'debating', summary),
    runtimeEvents: [{ eventType: 'werewolf_night_action', title: '狼人完成夜晚袭击', summary }],
  };
}

function handleInspectPlayer(chat: GroupChat, action: SessionActionDefinition) {
  const summary = `预言家查验${getTargetLabel(chat, action)}`;
  return {
    chatPatch: buildPhasePatch(chat, 'debating', summary),
    runtimeEvents: [{ eventType: 'werewolf_inspection', title: '预言家完成查验', summary }],
  };
}

function handleVotePlayer(chat: GroupChat, action: SessionActionDefinition) {
  const prompt = getPrompt(action);
  const summary = `白天投票${getTargetLabel(chat, action)}${prompt ? `：${truncate(prompt, 32)}` : ''}`;
  return {
    chatPatch: buildPhasePatch(chat, 'aligned', summary),
    runtimeEvents: [{ eventType: 'werewolf_vote', title: '发起白天投票', summary }],
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
