import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import type { MemoryItem } from './memoryTypes';
import { projectFactionClusters } from './factionProjection';
import { formatScenarioBoardKind, formatScenarioRoleLabel } from './scenarioPresentation';

export type NarrativeLineType = 'conflict' | 'relationship' | 'topic' | 'goal' | 'mystery' | 'faction' | 'growth' | 'scenario';
export type NarrativeLineStatus = 'latent' | 'active' | 'escalating' | 'cooling' | 'resolved' | 'abandoned';
export type NarrativeBeatType = 'answer' | 'challenge' | 'defend' | 'escalate' | 'cool_down' | 'reveal' | 'deflect' | 'summarize' | 'invite';

export interface NarrativeBeat {
  beatType: NarrativeBeatType;
  targetActorIds: string[];
  pressure: number;
  reason: string;
}

export interface NarrativeLineProjection {
  id: string;
  conversationId: string;
  type: NarrativeLineType;
  title: string;
  summary: string;
  participantIds: string[];
  hiddenParticipantIds?: string[];
  visibility: 'public' | 'role_private' | 'moderator_only' | 'derived_public';
  status: NarrativeLineStatus;
  tension: number;
  momentum: number;
  salience: number;
  sourceEventIds: string[];
  lastTouchedAt: number;
  openQuestions: string[];
  possibleNextBeats: NarrativeBeat[];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function unique(ids: Array<string | null | undefined>) {
  return ids.filter((id, index, array): id is string => Boolean(id) && array.indexOf(id) === index);
}

function characterName(id: string | undefined, characters: AICharacter[]) {
  if (!id) return '成员';
  return characters.find((character) => character.id === id)?.name || '成员';
}

function clipText(text: string, max = 88) {
  const normalized = text.replace(/\s{2,}/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function looksLikeSystemPayload(text: string) {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^\{[\s\S]*"eventType"\s*:/.test(normalized)) return true;
  if (/^\{[\s\S]*"(kind|payload|timelineType)"\s*:/.test(normalized)) return true;
  return false;
}

function describeRelationshipState(entry: RelationshipLedgerEntry, characters: AICharacter[]) {
  const actor = characterName(entry.actorId, characters);
  const target = characterName(entry.targetId, characters);
  const axes = [
    entry.current.trust <= -20 ? '信任偏低' : entry.current.trust >= 20 ? '信任偏高' : '',
    entry.current.warmth <= -20 ? '亲和偏低' : entry.current.warmth >= 20 ? '亲和偏高' : '',
    entry.current.threat >= 35 ? '威胁感较强' : entry.current.threat >= 12 ? '有戒备感' : '',
    entry.current.competence <= -20 ? '能力判断偏低' : entry.current.competence >= 20 ? '能力判断偏高' : '',
  ].filter(Boolean);
  return axes.length ? `${actor} 对 ${target}：${axes.slice(0, 2).join('，')}。` : `${actor} 和 ${target} 的互动正在形成新的关系倾向。`;
}

function findCharacter(id: string | undefined, characters: AICharacter[]) {
  return id ? characters.find((character) => character.id === id) || null : null;
}

function hasRepairImpulse(entry: RelationshipLedgerEntry, characters: AICharacter[]) {
  const actor = findCharacter(entry.actorId, characters);
  const target = findCharacter(entry.targetId, characters);
  return actor?.soulState?.lastImpulse === 'repair' || target?.soulState?.lastImpulse === 'repair';
}

function describeRelationshipLineSummary(entry: RelationshipLedgerEntry, characters: AICharacter[]) {
  const semantic = entry.derived?.semantic;
  if (hasRepairImpulse(entry, characters)) {
    return semantic?.summary
      ? `${semantic.summary}，但最近出现了找补或缓和的冲动。`
      : `${characterName(entry.actorId, characters)}与${characterName(entry.targetId, characters)}的拉扯后出现了找补或缓和的冲动。`;
  }
  return semantic?.summary || describeRelationshipState(entry, characters);
}

function relationshipNextBeat(entry: RelationshipLedgerEntry, tension: number, characters: AICharacter[]): NarrativeBeatType {
  if (hasRepairImpulse(entry, characters)) return 'defend';
  return tension > 0.5 ? 'challenge' : 'invite';
}

function relationshipOpenQuestion(entry: RelationshipLedgerEntry, tension: number, characters: AICharacter[]) {
  if (hasRepairImpulse(entry, characters)) return '这段关系会被别扭地找补、缓和，还是继续嘴硬？';
  return tension > 0.38 ? '这段关系会继续拉扯、缓和还是破裂？' : '';
}

function mapConflictStatus(stage?: string): NarrativeLineStatus {
  if (stage === 'resolved') return 'resolved';
  if (stage === 'cooling') return 'cooling';
  if (stage === 'escalating' || stage === 'fragmented') return 'escalating';
  if (stage === 'latent') return 'latent';
  return 'active';
}

function mapConflictBeat(nextPressure?: string): NarrativeBeatType {
  if (nextPressure === 'cool') return 'cool_down';
  if (nextPressure === 'divert') return 'deflect';
  if (nextPressure === 'spread') return 'invite';
  if (nextPressure === 'stabilize') return 'defend';
  return 'escalate';
}

function relationshipTension(entry: RelationshipLedgerEntry) {
  const current = entry.current;
  return clamp01((Math.max(0, current.threat) + Math.max(0, -current.trust) + Math.max(0, -current.warmth) * 0.6) / 100);
}

function relationshipMomentum(entry: RelationshipLedgerEntry, now: number) {
  const ageHours = Math.max(0, now - entry.lastUpdatedAt) / 3_600_000;
  const recency = clamp01(1 - ageHours / 24);
  const salience = clamp01((entry.derived?.salience || 0) / 100);
  return clamp01(recency * 0.65 + salience * 0.35);
}

function buildConflictLines(chat: GroupChat, now: number): NarrativeLineProjection[] {
  const conflicts = [
    chat.worldState.conflictState?.primaryConflict,
    ...(chat.worldState.conflictState?.activeConflicts || []),
  ].filter(Boolean);
  const seen = new Set<string>();
  return conflicts
    .filter((conflict): conflict is NonNullable<typeof conflict> => {
      if (!conflict || seen.has(conflict.id)) return false;
      seen.add(conflict.id);
      return conflict.stage !== 'resolved';
    })
    .map((conflict) => {
      const targetActorIds = unique([...(conflict.targetIds || []), ...(conflict.participantIds || [])]);
      const tension = clamp01(conflict.severity);
      const momentum = clamp01(conflict.stage === 'escalating' ? 0.9 : conflict.stage === 'open' ? 0.72 : conflict.stage === 'cooling' ? 0.36 : 0.52);
      return {
        id: conflict.id,
        conversationId: chat.id,
        type: 'conflict',
        title: '当前矛盾',
        summary: conflict.summary,
        participantIds: targetActorIds,
        visibility: 'public',
        status: mapConflictStatus(conflict.stage),
        tension,
        momentum,
        salience: clamp01(tension * 0.62 + momentum * 0.38),
        sourceEventIds: conflict.sourceEventIds || [],
        lastTouchedAt: conflict.updatedAt || now,
        openQuestions: conflict.developmentHooks.includes('invite_target_response') ? ['被点名或被攻击的一方是否回应？'] : [],
        possibleNextBeats: [{
          beatType: mapConflictBeat(conflict.nextPressure),
          targetActorIds,
          pressure: clamp01(0.46 + conflict.severity * 0.42),
          reason: conflict.summary || '当前矛盾需要有人回应。',
        }],
      } satisfies NarrativeLineProjection;
    });
}

function buildRoomLines(chat: GroupChat, now: number): NarrativeLineProjection[] {
  const room = chat.worldState.structuredRoomState;
  if (!room) return [];
  const lines: NarrativeLineProjection[] = [];
  if (room.pileOnTarget) {
    const tension = clamp01(room.heat / 100);
    lines.push({
      id: `room:pile-on:${room.pileOnTarget}`,
      conversationId: chat.id,
      type: 'conflict',
      title: '围攻压力',
      summary: '房间里出现了持续指向同一角色的压力。',
      participantIds: [room.pileOnTarget],
      visibility: 'public',
      status: tension > 0.68 ? 'escalating' : 'active',
      tension,
      momentum: tension,
      salience: clamp01(0.42 + tension * 0.45),
      sourceEventIds: [],
      lastTouchedAt: now,
      openQuestions: ['被围攻者会反击、沉默还是有人出面缓和？'],
      possibleNextBeats: [{
        beatType: tension > 0.68 ? 'cool_down' : 'defend',
        targetActorIds: [room.pileOnTarget],
        pressure: clamp01(0.48 + tension * 0.34),
        reason: '房间里出现了持续指向同一角色的压力。',
      }],
    });
  }
  if (room.topicDrift > 62) {
    const drift = clamp01(room.topicDrift / 100);
    lines.push({
      id: 'room:topic-drift',
      conversationId: chat.id,
      type: 'topic',
      title: '话题漂移',
      summary: '当前讨论已经偏离原本焦点。',
      participantIds: [],
      visibility: 'public',
      status: 'active',
      tension: drift * 0.35,
      momentum: drift,
      salience: clamp01(0.34 + drift * 0.4),
      sourceEventIds: [],
      lastTouchedAt: now,
      openQuestions: ['是否需要有人收束或重新定义讨论焦点？'],
      possibleNextBeats: [{
        beatType: 'summarize',
        targetActorIds: [],
        pressure: clamp01(0.44 + drift * 0.28),
        reason: '当前话题漂移较高，需要有人收束。',
      }],
    });
  }
  return lines;
}

function buildRelationshipLines(chat: GroupChat, characters: AICharacter[], now: number): NarrativeLineProjection[] {
  return (chat.relationshipLedger || [])
    .map((entry) => {
      const tension = relationshipTension(entry);
      const momentum = relationshipMomentum(entry, now);
      const semantic = entry.derived?.semantic;
      const actor = characterName(entry.actorId, characters);
      const target = characterName(entry.targetId, characters);
      const salience = clamp01((entry.derived?.salience || 0) / 100 * 0.42 + tension * 0.38 + momentum * 0.2);
      const summary = describeRelationshipLineSummary(entry, characters);
      const nextBeat = relationshipNextBeat(entry, tension, characters);
      return {
        id: `relationship:${entry.pairKey}`,
        conversationId: chat.id,
        type: 'relationship',
        title: semantic?.stage || `${actor}与${target}`,
        summary,
        participantIds: unique([entry.actorId, entry.targetId]),
        visibility: 'public',
        status: tension > 0.58 ? 'escalating' : salience > 0.3 ? 'active' : 'latent',
        tension,
        momentum,
        salience,
        sourceEventIds: entry.recentEvents.map((event) => event.id),
        lastTouchedAt: entry.lastUpdatedAt || now,
        openQuestions: [relationshipOpenQuestion(entry, tension, characters)].filter(Boolean),
        possibleNextBeats: [{
          beatType: nextBeat,
          targetActorIds: unique([entry.actorId, entry.targetId]),
          pressure: clamp01((nextBeat === 'defend' ? 0.38 : 0.32) + salience * 0.44),
          reason: summary || '关系账本中的变化已经足够显著。',
        }],
      } satisfies NarrativeLineProjection;
    })
    .filter((line) => line.salience >= 0.28)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 4);
}

function buildTopicLine(chat: GroupChat, messages: Message[], now: number): NarrativeLineProjection | null {
  const latest = messages
    .filter((message) => !message.isDeleted && (message.type === 'ai' || message.type === 'user' || message.type === 'god') && !looksLikeSystemPayload(message.content || ''))
    .at(-1);
  if (!latest) return null;
  const summary = latest.type === 'user'
    ? `用户刚刚提到：${clipText(latest.content, 72)}`
    : clipText(latest.content, 80) || '当前话题仍在延续。';
  return {
    id: 'topic:latest',
    conversationId: chat.id,
    type: 'topic',
    title: chat.topic || '当前话题',
    summary,
    participantIds: latest.type === 'ai' ? [latest.senderId] : [],
    visibility: 'public',
    status: 'active',
    tension: 0.12,
    momentum: 0.36,
    salience: latest.type === 'user' ? 0.7 : 0.3,
    sourceEventIds: [],
    lastTouchedAt: latest.timestamp || now,
    openQuestions: latest.type === 'user' ? ['用户刚刚改变了房间焦点，谁来接住？'] : [],
    possibleNextBeats: [{
      beatType: latest.type === 'user' ? 'invite' : 'invite',
      targetActorIds: latest.type === 'ai' ? [latest.senderId] : [],
      pressure: latest.type === 'user' ? 0.5 : 0.34,
      reason: latest.type === 'user' ? '用户消息正在改变下一轮回应方向。' : '延续当前正在进行的话题。',
    }],
  };
}

function buildFactionLines(chat: GroupChat, characters: AICharacter[], now: number): NarrativeLineProjection[] {
  return projectFactionClusters({ chat, characters })
    .map((cluster) => {
      const tension = clamp01(cluster.averageSuspicion);
      const salience = clamp01(cluster.salience);
      return {
        id: `faction:${cluster.factionId}`,
        conversationId: chat.id,
        type: 'faction',
        title: `${cluster.label}倾向`,
        summary: cluster.averageSuspicion >= 0.35
          ? `${cluster.label}内部或外部出现了怀疑与立场压力。`
          : `${cluster.label}正在形成可感知的立场靠拢。`,
        participantIds: cluster.memberIds,
        visibility: 'public',
        status: tension > 0.5 ? 'escalating' : 'active',
        tension,
        momentum: salience,
        salience,
        sourceEventIds: cluster.evidenceEventIds,
        lastTouchedAt: now,
        openQuestions: cluster.averageSuspicion >= 0.35 ? ['阵营内部会互相保护、怀疑还是切割？'] : ['这组角色会继续靠拢还是出现裂痕？'],
        possibleNextBeats: [{
          beatType: cluster.averageSuspicion >= 0.35 ? 'challenge' : 'defend',
          targetActorIds: cluster.memberIds,
          pressure: clamp01(0.34 + salience * 0.38),
          reason: `${cluster.label}已经形成可感知的阵营压力。`,
        }],
      } satisfies NarrativeLineProjection;
    })
    .filter((line) => line.salience >= 0.3)
    .slice(0, 3);
}

function isGrowthMemory(item: MemoryItem) {
  if (item.archivedAt) return false;
  if (item.sourceTag === 'llm_memory_growth_signal') return true;
  if (item.origin === 'distilled' && item.scope === 'character_self' && ['trait_evidence', 'status_shift', 'decision', 'bias', 'obsession'].includes(item.kind)) return true;
  return false;
}

function buildGrowthLines(chat: GroupChat, characters: AICharacter[], now: number): NarrativeLineProjection[] {
  const lines: NarrativeLineProjection[] = [];
  characters.forEach((character) => {
    const memories = (character.layeredMemories || [])
      .filter(isGrowthMemory)
      .slice()
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 3);
    const newest = memories[0];
    if (!newest) return;
    const ageHours = Math.max(0, now - (newest.updatedAt || newest.createdAt || now)) / 3_600_000;
    const recency = clamp01(1 - ageHours / 72);
    const salience = clamp01(0.24 + Math.max(...memories.map((item) => item.salience || 0)) * 0.42 + recency * 0.26 + Math.min(0.08, memories.length * 0.03));
    lines.push({
      id: `growth:${character.id}`,
      conversationId: chat.id,
      type: 'growth',
      title: `${character.name}的成长线`,
      summary: newest.summary || newest.text,
      participantIds: [character.id],
      visibility: 'derived_public',
      status: salience > 0.58 ? 'active' : 'latent',
      tension: clamp01(memories.some((item) => item.kind === 'bias' || item.kind === 'obsession') ? 0.42 : 0.18),
      momentum: recency,
      salience,
      sourceEventIds: memories.flatMap((item) => item.sourceEventIds || []).slice(-8),
      lastTouchedAt: newest.updatedAt || newest.createdAt || now,
      openQuestions: ['这个角色会继续坚持旧模式，还是在下一次互动中表现出变化？'],
      possibleNextBeats: [{
        beatType: 'invite',
        targetActorIds: [character.id],
        pressure: clamp01(0.28 + salience * 0.34),
        reason: `${character.name}最近出现了成长信号。`,
      }],
    });
  });
  return lines
    .filter((line) => line.salience >= 0.34)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 2);
}

function buildGoalLines(chat: GroupChat, characters: AICharacter[], now: number): NarrativeLineProjection[] {
  const knownIds = new Set(characters.map((character) => character.id));
  const lines: NarrativeLineProjection[] = [];
  (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'director_intervention')
    .slice(-6)
    .reverse()
    .forEach((event) => {
      const payload = event.payload as Record<string, unknown>;
      const intent = typeof payload.intent === 'string' ? payload.intent : '';
      const text = typeof payload.text === 'string' ? payload.text : event.summary;
      if (!text || !['inject_event', 'summarize', 'redirect', 'force_reply'].includes(intent)) return;
      const targetActorIds = Array.isArray(payload.targetActorIds)
        ? payload.targetActorIds.filter((id, index, array): id is string => typeof id === 'string' && knownIds.has(id) && array.indexOf(id) === index)
        : [];
      const ageMinutes = Math.max(0, now - event.createdAt) / 60_000;
      const recency = clamp01(1 - ageMinutes / 45);
      const pressure = typeof payload.pressure === 'number' ? clamp01(payload.pressure) : 0.72;
      const salience = clamp01(0.2 + pressure * 0.46 + recency * 0.26);
      lines.push({
        id: `goal:${event.id}`,
        conversationId: chat.id,
        type: 'goal',
        title: intent === 'summarize' ? '收束目标' : intent === 'redirect' ? '转向目标' : intent === 'force_reply' ? '回应目标' : '推进目标',
        summary: text,
        participantIds: targetActorIds,
        visibility: event.visibility === 'moderator_only' ? 'moderator_only' : 'derived_public',
        status: salience > 0.52 ? 'active' : 'latent',
        tension: intent === 'force_reply' ? 0.42 : 0.22,
        momentum: recency,
        salience,
        sourceEventIds: [event.id],
        lastTouchedAt: event.createdAt,
        openQuestions: ['这个目标会被接住、转向还是被新的互动覆盖？'],
        possibleNextBeats: [{
          beatType: intent === 'summarize' ? 'summarize' : intent === 'redirect' ? 'deflect' : intent === 'force_reply' ? 'answer' : 'invite',
          targetActorIds,
          pressure,
          reason: text || '导演目标正在影响下一轮走向。',
        }],
      });
    });
  return lines
    .filter((line) => line.salience >= 0.34)
    .slice(0, 2);
}

function buildMysteryLines(chat: GroupChat, now: number): NarrativeLineProjection[] {
  const privateEvents = (chat.runtimeEventsV2 || [])
    .filter((event) => event.visibility === 'role_private' || event.visibility === 'moderator_only' || event.visibility === 'pair_private')
    .slice(-8);
  const hiddenRoles = (chat.scenarioState?.roleAssignments || []).filter((assignment) => assignment.summary || assignment.factionId || assignment.roleId);
  if (!privateEvents.length && chat.mode !== 'murder_mystery' && chat.mode !== 'werewolf') return [];
  const newest = privateEvents.at(-1);
  const ageMinutes = newest ? Math.max(0, now - newest.createdAt) / 60_000 : 0;
  const recency = newest ? clamp01(1 - ageMinutes / 90) : 0.36;
  const salience = clamp01(0.28 + Math.min(0.22, privateEvents.length * 0.04) + Math.min(0.18, hiddenRoles.length * 0.03) + recency * 0.28);
  if (salience < 0.34) return [];
  return [{
    id: 'mystery:hidden-pressure',
    conversationId: chat.id,
    type: 'mystery',
    title: '未公开线索',
    summary: '当前会话存在未公开信息或私密行动，可能影响公开讨论的走向。',
    participantIds: [],
    hiddenParticipantIds: Array.from(new Set(privateEvents.flatMap((event) => [...(event.actorIds || []), ...(event.targetIds || [])]))),
    visibility: 'derived_public',
    status: salience > 0.56 ? 'active' : 'latent',
    tension: clamp01(0.24 + Math.min(0.4, privateEvents.length * 0.06)),
    momentum: recency,
    salience,
    sourceEventIds: privateEvents.map((event) => event.id).slice(-8),
    lastTouchedAt: newest?.createdAt || now,
    openQuestions: ['这些未公开信息会被揭示、误导他人，还是继续隐藏？'],
    possibleNextBeats: [{
      beatType: 'reveal',
      targetActorIds: [],
      pressure: clamp01(0.32 + salience * 0.36),
      reason: '未公开线索正在形成悬念压力。',
    }],
  }];
}

function buildScenarioLine(chat: GroupChat, characters: AICharacter[], now: number): NarrativeLineProjection | null {
  const scenario = chat.scenarioState;
  if (!scenario) return null;
  const roleAssignments = (scenario.roleAssignments || []).filter((item) => item.actorId || item.roleId || item.factionId);
  const roleCount = roleAssignments.length;
  const factionCount = (scenario.factions || []).length;
  const seatCount = (scenario.seats || []).filter((item) => item.actorId || item.roleId || item.teamId).length;
  const hasBoard = Boolean(scenario.board?.schema?.kind);
  if (chat.mode === 'open_chat' && !roleCount && !factionCount && !hasBoard && !scenario.currentTurnActorId) return null;
  if (!roleCount && !factionCount && !seatCount && !hasBoard && !scenario.currentTurnActorId) return null;
  const salience = clamp01(0.26 + Math.min(0.22, roleCount * 0.05) + Math.min(0.18, factionCount * 0.05) + Math.min(0.14, seatCount * 0.03) + (hasBoard ? 0.12 : 0) + (scenario.currentTurnActorId ? 0.08 : 0));
  const actorNameFromId = (id?: string | null) => {
    if (!id) return '成员';
    return characterName(id, characters);
  };
  const title = hasBoard ? '棋盘进程' : factionCount > 0 ? '阵营局势' : scenario.currentTurnActorId ? '固定轮次' : '角色分工';
  const summaryParts = [
    roleAssignments.slice(0, 3).map((item) => `${actorNameFromId(item.actorId)}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId)}` : ''}`).join(' / '),
    factionCount ? `阵营：${(scenario.factions || []).slice(0, 3).map((item) => item.label).join(' / ')}` : '',
    scenario.currentTurnActorId ? `当前轮到 ${actorNameFromId(scenario.currentTurnActorId)}` : '',
    hasBoard ? `棋盘 ${formatScenarioBoardKind(scenario.board?.schema.kind)}` : '',
  ].filter(Boolean);
  return {
    id: 'scenario:structure',
    conversationId: chat.id,
    type: 'scenario',
    title,
    summary: summaryParts.join(' / '),
    participantIds: unique([
      ...(scenario.roleAssignments || []).map((item) => item.actorId),
      scenario.currentTurnActorId || null,
      ...(scenario.seats || []).map((item) => item.actorId || null),
    ]),
    visibility: 'public',
    status: 'active',
    tension: clamp01((scenario.currentTurnActorId ? 0.2 : 0.08) + (hasBoard ? 0.12 : 0)),
    momentum: salience,
    salience,
    sourceEventIds: [],
    lastTouchedAt: now,
    openQuestions: ['这套规则或分工会继续约束下一轮互动吗？'],
    possibleNextBeats: [{
      beatType: 'summarize',
      targetActorIds: scenario.currentTurnActorId ? [scenario.currentTurnActorId] : [],
      pressure: clamp01(0.24 + salience * 0.24),
      reason: '当前场景结构正在影响下一步互动。',
    }],
  };
}

export function projectNarrativeLines(params: {
  chat: GroupChat;
  characters?: AICharacter[];
  messages: Message[];
  now?: number;
}): NarrativeLineProjection[] {
  const now = params.now || Date.now();
  const topicLine = buildTopicLine(params.chat, params.messages, now);
  const scenarioLine = buildScenarioLine(params.chat, params.characters || [], now);
  return [
    ...buildConflictLines(params.chat, now),
    ...buildRoomLines(params.chat, now),
    ...buildRelationshipLines(params.chat, params.characters || [], now),
    ...buildFactionLines(params.chat, params.characters || [], now),
    ...buildGrowthLines(params.chat, params.characters || [], now),
    ...buildGoalLines(params.chat, params.characters || [], now),
    ...buildMysteryLines(params.chat, now),
    ...(scenarioLine ? [scenarioLine] : []),
    ...(topicLine ? [topicLine] : []),
  ]
    .filter((line) => line.status !== 'resolved' && line.status !== 'abandoned')
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 16);
}

export function selectPrimaryNarrativeLine(lines: NarrativeLineProjection[]) {
  return lines.find((line) => line.salience >= 0.32) || null;
}
