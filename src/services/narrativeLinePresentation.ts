import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { MemoryItem } from './memoryTypes';
import type { NarrativeLineProjection, NarrativeLineType } from './narrativeProjection';
import { formatKnownReason } from './runtimeInsightPresentation';

export function cleanNarrativeText(text: string) {
  return text
    .replace(/\{[\s\S]*"eventType"[\s\S]*\}/g, '系统事件')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clip(text: string, max = 96) {
  const normalized = cleanNarrativeText(text);
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function formatNarrativeLineText(text: string, members: AICharacter[]) {
  let next = cleanNarrativeText(text);
  members.forEach((member) => {
    if (!member.id) return;
    const escaped = member.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = member.id.length < 8
      ? new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'gu')
      : new RegExp(escaped, 'g');
    next = next.replace(pattern, (match, prefix = '') => `${prefix}${member.name || '成员'}`);
  });
  return next
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '成员')
    .trim();
}

export function getNarrativeLineParticipantNames(line: NarrativeLineProjection, members: AICharacter[]) {
  return line.participantIds
    .map((id) => members.find((member) => member.id === id)?.name || '成员')
    .filter(Boolean);
}

function formatRuntimeEventKind(kind: RuntimeEventV2['kind']) {
  const labels: Record<RuntimeEventV2['kind'], string> = {
    message_generated: '消息生成',
    interaction: '互动',
    relationship_delta: '关系变化',
    room_shift: '房间态势',
    memory_candidate: '记忆候选',
    artifact: '产物',
    event_candidate: '事件候选',
    director_intervention: '导演干预',
    decision_trace: '决策痕迹',
    phase_transition: '阶段切换',
    action_resolution: '动作结算',
    board_state: '棋盘状态',
    score_update: '分数更新',
  };
  return labels[kind] || kind;
}

function formatRuntimeEventEvidence(event: RuntimeEventV2, members: AICharacter[]) {
  const actorNames = (event.actorIds || []).map((id) => members.find((member) => member.id === id)?.name || id);
  const targetNames = (event.targetIds || []).map((id) => members.find((member) => member.id === id)?.name || id);
  const participants = [actorNames.join('、'), targetNames.length ? `→ ${targetNames.join('、')}` : ''].filter(Boolean).join(' ');
  const summary = formatNarrativeLineText(event.summary || '', members);
  return `${formatRuntimeEventKind(event.kind)}${participants ? ` · ${participants}` : ''}${summary ? `：${clip(summary, 110)}` : ''}`;
}

function findSourceRuntimeEvent(line: NarrativeLineProjection, chat: GroupChat) {
  const sourceIds = new Set(line.sourceEventIds || []);
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => sourceIds.has(event.id)) || null;
}

function findConflictEvidence(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[]) {
  const conflicts = [
    chat.worldState.conflictState?.primaryConflict,
    ...(chat.worldState.conflictState?.activeConflicts || []),
  ].filter(Boolean);
  const conflict = conflicts.find((item) => item?.id === line.id) || null;
  if (conflict?.summary) return `最近矛盾：${formatNarrativeLineText(conflict.summary, members)}`;
  const event = findSourceRuntimeEvent(line, chat);
  return event ? `最近证据：${formatRuntimeEventEvidence(event, members)}` : null;
}

function findRelationshipEvidence(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[]) {
  const pairKey = line.id.startsWith('relationship:') ? line.id.slice('relationship:'.length) : '';
  const entry = (chat.relationshipLedger || []).find((item) => item.pairKey === pairKey);
  if (!entry) return null;
  const axisEvidence = Object.values(entry.axisReasons || {}).flat().slice(-1)[0]?.evidence;
  const recentSummary = entry.recentEvents?.at(-1)?.summary;
  const semantic = entry.derived?.semantic?.summary;
  const evidence = axisEvidence || recentSummary || semantic;
  return evidence ? `最近关系证据：${formatNarrativeLineText(evidence, members)}` : null;
}

function isGrowthMemory(item: MemoryItem) {
  if (item.archivedAt) return false;
  if (item.sourceTag === 'llm_memory_growth_signal') return true;
  return item.origin === 'distilled' && item.scope === 'character_self' && ['trait_evidence', 'status_shift', 'decision', 'bias', 'obsession'].includes(item.kind);
}

function findGrowthEvidence(line: NarrativeLineProjection, members: AICharacter[]) {
  if (!line.id.startsWith('growth:')) return null;
  const actorId = line.id.slice('growth:'.length);
  const character = members.find((member) => member.id === actorId);
  const memory = ((character?.layeredMemories || []) as MemoryItem[])
    .filter(isGrowthMemory)
    .slice()
    .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0))[0];
  return memory ? `最近成长证据：${formatNarrativeLineText(memory.summary || memory.text, members)}` : null;
}

function findGoalEvidence(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[]) {
  const event = findSourceRuntimeEvent(line, chat);
  if (!event) return null;
  const payload = event.payload as Record<string, unknown>;
  const text = typeof payload.text === 'string' ? payload.text : event.summary;
  return text ? `最近目标证据：${formatNarrativeLineText(text, members)}` : `最近目标证据：${formatRuntimeEventEvidence(event, members)}`;
}

function findMysteryEvidence(line: NarrativeLineProjection, chat: GroupChat) {
  const event = findSourceRuntimeEvent(line, chat);
  if (!event) return line.hiddenParticipantIds?.length ? `隐藏参与者：${line.hiddenParticipantIds.length} 人` : null;
  return `最近未公开事件：${formatRuntimeEventKind(event.kind)} · ${event.visibility || '未标注可见性'}`;
}

function findFactionEvidence(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[]) {
  const event = findSourceRuntimeEvent(line, chat);
  if (event) return `最近阵营证据：${formatRuntimeEventEvidence(event, members)}`;
  const names = getNarrativeLineParticipantNames(line, members);
  return names.length ? `阵营成员：${names.slice(0, 6).join('、')}` : null;
}

function findScenarioEvidence(chat: GroupChat, members: AICharacter[]) {
  const scenario = chat.scenarioState;
  if (!scenario) return null;
  const roleNames = (scenario.roleAssignments || [])
    .slice(0, 4)
    .map((item) => `${members.find((member) => member.id === item.actorId)?.name || item.actorId}·${item.roleId || '角色位'}`);
  const factionNames = (scenario.factions || []).slice(0, 4).map((item) => item.label);
  const boardKind = scenario.board?.schema?.kind;
  const parts = [roleNames.length ? `角色位：${roleNames.join(' / ')}` : '', factionNames.length ? `阵营：${factionNames.join(' / ')}` : '', boardKind ? `棋盘：${boardKind}` : ''].filter(Boolean);
  return parts.length ? `场景证据：${parts.join('；')}` : null;
}

function latestMessageEvidence(line: NarrativeLineProjection, messages: Message[]) {
  if (line.type !== 'topic') return null;
  const latest = messages.filter((message) => !message.isDeleted && (message.type === 'ai' || message.type === 'user' || message.type === 'god')).at(-1);
  return latest ? `${latest.senderName}：${clip(latest.content, 120)}` : null;
}

function findLineEvidence(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[], messages: Message[]) {
  if (line.type === 'conflict') return findConflictEvidence(line, chat, members);
  if (line.type === 'relationship') return findRelationshipEvidence(line, chat, members);
  if (line.type === 'growth') return findGrowthEvidence(line, members);
  if (line.type === 'goal') return findGoalEvidence(line, chat, members);
  if (line.type === 'mystery') return findMysteryEvidence(line, chat);
  if (line.type === 'faction') return findFactionEvidence(line, chat, members);
  if (line.type === 'scenario') return findScenarioEvidence(chat, members);
  return latestMessageEvidence(line, messages);
}

function explainLineType(line: NarrativeLineProjection) {
  const labels: Record<NarrativeLineType, string> = {
    conflict: '矛盾线来自当前仍在生效的矛盾焦点、围压或持续对立。',
    relationship: '关系线来自角色之间的关系账本和最近互动证据。',
    faction: '阵营线来自角色分组、场景阵营和关系靠拢或怀疑。',
    growth: '成长线来自角色沉淀后的成长、偏向或状态变化记忆。',
    goal: '目标线来自用户导演、事件注入、指定回复或转向意图。',
    mystery: '暗线来自未公开信息、私密行动或角色私有线索。',
    scenario: '场景线来自角色位、阵营、固定轮次、棋盘等显式场景结构。',
    topic: '话题线来自最近真实聊天消息，不包含系统运行事件。',
  };
  return labels[line.type];
}

export function buildNarrativeLineTooltip(params: {
  line: NarrativeLineProjection;
  chat: GroupChat;
  members: AICharacter[];
  messages: Message[];
}) {
  const { line, chat, members, messages } = params;
  const names = getNarrativeLineParticipantNames(line, members);
  const evidence = findLineEvidence(line, chat, members, messages);
  const parts = [
    explainLineType(line),
    names.length ? `相关角色：${names.slice(0, 6).join('、')}` : '',
    line.sourceEventIds.length ? `来源事件：${line.sourceEventIds.length} 条` : '',
    evidence,
    line.possibleNextBeats[0]?.reason ? `判断依据：${formatNarrativeLineText(formatKnownReason(line.possibleNextBeats[0].reason), members)}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}
