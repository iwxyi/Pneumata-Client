import type { AICharacter, CharacterSoulState, InnerImpulse } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getRelationshipWeight } from './relationshipEngine';
import { getExpressionFeedbackSignal, summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';

export type InnerLifeTone = 'casual' | 'defensive' | 'teasing' | 'serious' | 'tired' | 'vulnerable';
export type InnerLifeLength = 'micro' | 'short' | 'normal' | 'long';

export interface InnerLifeExpressionPlan {
  tone: InnerLifeTone;
  length: InnerLifeLength;
  messageCount: number;
  typoLevel: number;
  delayMs: number;
  allowWithdraw: boolean;
}

export interface InnerLifeProjection {
  actorId: string;
  impulse: InnerImpulse;
  tone: InnerLifeTone;
  reason: string;
  pressure: number;
  evidence: string[];
  state: CharacterSoulState;
  expressionPlan: InnerLifeExpressionPlan;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number) {
  return Math.round(clamp(value));
}

function buildExpressionFeedbackBias(character: AICharacter) {
  const signals = summarizeExpressionFeedbackInfluence(character.layeredMemories || []);
  const tooLong = getExpressionFeedbackSignal(signals, 'too_long');
  const tooFormal = getExpressionFeedbackSignal(signals, 'too_formal');
  const tooAssistant = getExpressionFeedbackSignal(signals, 'too_assistant');
  const outOfCharacter = getExpressionFeedbackSignal(signals, 'out_of_character');
  return {
    shorter: (tooLong?.strength || 0) >= 0.34 || (tooAssistant?.strength || 0) >= 0.46,
    strongShorter: (tooLong?.strength || 0) >= 0.72 || (tooAssistant?.strength || 0) >= 0.78,
    lessFormal: (tooFormal?.strength || 0) >= 0.34,
    lessAssistant: (tooAssistant?.strength || 0) >= 0.34,
    closerToRole: (outOfCharacter?.strength || 0) >= 0.34,
    hasAny: signals.length > 0,
  };
}

function shortenLength(length: InnerLifeLength, strong = false): InnerLifeLength {
  if (strong && (length === 'long' || length === 'normal')) return 'short';
  if (length === 'long') return 'normal';
  if (length === 'normal') return 'short';
  return length;
}

function createDefaultSoulState(character: AICharacter): CharacterSoulState {
  const emotional = character.emotionalState;
  return {
    mood: {
      pleasure: clamp((emotional?.affection || 0) + (emotional?.excitement || 0) * 0.35 - (emotional?.irritation || 0) * 0.45 - (emotional?.insecurity || 0) * 0.25, -100, 100),
      arousal: clamp((emotional?.excitement || 0) + (emotional?.irritation || 0) * 0.6 + (emotional?.embarrassment || 0) * 0.25, 0, 100),
      dominance: clamp((character.personality.assertiveness || 50) - (emotional?.embarrassment || 0) * 0.35 - (emotional?.insecurity || 0) * 0.2, 0, 100),
    },
    energy: clamp((character.personality.extroversion || 50) * 0.55 + (character.behavior.proactivity || 50) * 0.35 + (emotional?.excitement || 0) * 0.2),
    attention: clamp(45 + (character.behavior.proactivity || 50) * 0.35),
    loneliness: 0,
    repression: clamp((emotional?.insecurity || 0) * 0.25 + (emotional?.embarrassment || 0) * 0.2),
    shame: clamp((emotional?.embarrassment || 0) * 0.65 + (emotional?.insecurity || 0) * 0.25),
    envy: 0,
    trustInRoom: clamp(55 + (character.personality.agreeableness || 50) * 0.25 - (emotional?.irritation || 0) * 0.25),
    ignoredStreak: 0,
    updatedAt: Date.now(),
  };
}

function countIgnoredTurns(character: AICharacter, messages: Message[]) {
  const active = messages.filter((message) => !message.isDeleted);
  const lastOwnIndex = [...active].reverse().findIndex((message) => message.type === 'ai' && message.senderId === character.id);
  if (lastOwnIndex < 0) return character.soulState?.ignoredStreak || 0;
  const ownAbsoluteIndex = active.length - 1 - lastOwnIndex;
  const tail = active.slice(ownAbsoluteIndex + 1);
  const wasAcknowledged = tail.some((message) => message.content.includes(character.name) || message.senderId === character.id);
  if (wasAcknowledged) return 0;
  return Math.min(5, tail.filter((message) => message.type === 'ai' || message.type === 'user').length);
}

function latestOtherMessage(character: AICharacter, messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.senderId !== character.id).at(-1) || null;
}

function latestOwnMessage(character: AICharacter, messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type === 'ai' && message.senderId === character.id).at(-1) || null;
}

function looksLikeRelationshipBruise(text: string) {
  return /(不是|你这|凭什么|离谱|算了|懒得|闭嘴|别装|急什么|就这|呵|笑死|无语|算我多嘴|当我没说)/i.test(text);
}

function inferRepairPressure(character: AICharacter, lastOwn: Message | null, lastMessage: Message | null, state: CharacterSoulState) {
  if (!lastOwn || !lastMessage) return 0;
  const ownBruise = looksLikeRelationshipBruise(lastOwn.content);
  const shameRepair = state.shame >= 42 || state.repression >= 52;
  const roomSafeEnough = state.trustInRoom >= 38;
  const relationWarmth = lastMessage.senderId !== 'user' ? Math.max(0, getRelationshipWeight(character, lastMessage.senderId)) : 0;
  if (!ownBruise && !shameRepair) return 0;
  return (ownBruise ? 26 : 0) + (shameRepair ? 18 : 0) + (roomSafeEnough ? 10 : -8) + relationWarmth * 24;
}

function isAddressed(character: AICharacter, message: Message | null) {
  if (!message) return false;
  const candidate = message as Message & { addressedTargetIds?: string[] | null; primaryAddressedTargetId?: string | null };
  return message.content.includes(character.name)
    || candidate.primaryAddressedTargetId === character.id
    || Boolean(candidate.addressedTargetIds?.includes(character.id));
}

function inferTopicAttention(character: AICharacter, message: Message | null) {
  if (!message) return 0;
  const text = message.content.toLowerCase();
  return character.expertise.some((keyword) => keyword && text.includes(keyword.toLowerCase())) ? 16 : 0;
}

function inferRelationshipPressure(character: AICharacter, lastMessage: Message | null) {
  if (!lastMessage || lastMessage.senderId === 'user' || lastMessage.senderId === character.id) return 0;
  const relation = getRelationshipWeight(character, lastMessage.senderId);
  const safe = Number.isFinite(relation) ? relation : 0;
  return Math.min(22, Math.abs(safe) * 18);
}

function chooseImpulse(params: {
  character: AICharacter;
  state: CharacterSoulState;
  addressed: boolean;
  relationPressure: number;
  repairPressure: number;
  lastMessage: Message | null;
}): { impulse: InnerImpulse; reason: string; pressure: number } {
  const { character, state, addressed, relationPressure, repairPressure, lastMessage } = params;
  if (addressed) return { impulse: 'answer', reason: '被点名或被直接接话，需要先回应。', pressure: 0.86 };
  if (repairPressure >= 38) return { impulse: 'repair', reason: '前面的刺或嘴硬留下了关系余波，现在有一点找补、缓和或别扭靠近的冲动。', pressure: 0.57 };
  if (state.loneliness >= 62 && character.behavior.proactivity >= 45) return { impulse: 'seek_attention', reason: '最近发言没有被接住，想确认自己仍被看见。', pressure: 0.58 };
  if (state.shame >= 58 || state.repression >= 64) return { impulse: 'defend_face', reason: '面子风险和压抑感较高，容易嘴硬或找补。', pressure: 0.62 };
  if ((character.emotionalState?.affection || 0) >= 62 && lastMessage) return { impulse: 'comfort', reason: '对当前对象有温和牵挂，倾向接住对方。', pressure: 0.5 };
  if ((character.emotionalState?.irritation || 0) >= 58 || relationPressure >= 14) return { impulse: 'mock', reason: '关系张力或烦躁感在推动反驳、调侃或挑刺。', pressure: 0.54 };
  if (state.energy < 28 || state.trustInRoom < 26) return { impulse: 'avoid', reason: '当前能量或房间安全感偏低，更倾向短句回避。', pressure: 0.42 };
  if (character.behavior.proactivity >= 72) return { impulse: 'show_off', reason: '主动性较高，想争取解释权或表现自己。', pressure: 0.46 };
  return { impulse: 'stay_silent', reason: '没有强触发，内在动机暂时不足。', pressure: 0.24 };
}

function buildExpressionPlan(impulse: InnerImpulse, state: CharacterSoulState, character: AICharacter): InnerLifeExpressionPlan {
  const defensive = impulse === 'defend_face' || impulse === 'mock';
  const vulnerable = impulse === 'comfort' || impulse === 'repair' || (state.loneliness >= 70 && impulse === 'seek_attention');
  const feedback = buildExpressionFeedbackBias(character);
  const baseLength: InnerLifeLength = impulse === 'answer' ? 'short' : impulse === 'show_off' ? 'normal' : state.energy < 30 || impulse === 'avoid' ? 'micro' : 'short';
  const length = feedback.shorter || feedback.lessAssistant ? shortenLength(baseLength, feedback.strongShorter) : baseLength;
  const baseMessageCount = impulse === 'show_off' && character.speechProfile?.sentenceLengthBias !== 'long' ? 2 : 1;
  return {
    tone: feedback.lessFormal || feedback.lessAssistant ? 'casual' : defensive ? (impulse === 'mock' ? 'teasing' : 'defensive') : vulnerable ? 'vulnerable' : state.energy < 30 ? 'tired' : 'casual',
    length,
    messageCount: feedback.shorter || feedback.lessAssistant ? 1 : baseMessageCount,
    typoLevel: round((character.speechProfile?.sarcasmBias || 0) * 0.06 + (state.mood.arousal || 0) * 0.08),
    delayMs: Math.round(500 + (100 - state.energy) * 22 + (state.repression || 0) * 12),
    allowWithdraw: state.repression >= 56 || state.shame >= 62 || impulse === 'withdraw',
  };
}

export function projectInnerLife(params: {
  chat?: GroupChat | null;
  character: AICharacter;
  messages: Message[];
  now?: number;
}): InnerLifeProjection {
  const now = params.now || Date.now();
  const previous = params.character.soulState || createDefaultSoulState(params.character);
  const lastMessage = latestOtherMessage(params.character, params.messages);
  const lastOwnMessage = latestOwnMessage(params.character, params.messages);
  const addressed = isAddressed(params.character, lastMessage);
  const ignoredStreak = countIgnoredTurns(params.character, params.messages);
  const relationPressure = inferRelationshipPressure(params.character, lastMessage);
  const topicAttention = inferTopicAttention(params.character, lastMessage);
  const emotional = params.character.emotionalState;
  const room = params.chat?.worldState.structuredRoomState;
  const state: CharacterSoulState = {
    ...previous,
    mood: {
      pleasure: clamp((previous.mood?.pleasure || 0) * 0.65 + (emotional?.affection || 0) * 0.18 + (emotional?.excitement || 0) * 0.1 - (emotional?.irritation || 0) * 0.16, -100, 100),
      arousal: clamp((previous.mood?.arousal || 0) * 0.55 + (emotional?.excitement || 0) * 0.22 + (emotional?.irritation || 0) * 0.18 + (addressed ? 12 : 0)),
      dominance: clamp((previous.mood?.dominance || 45) * 0.7 + (params.character.personality.assertiveness || 50) * 0.2 - (emotional?.embarrassment || 0) * 0.12),
    },
    energy: clamp((previous.energy || 45) * 0.72 + (params.character.personality.extroversion || 50) * 0.12 + (params.character.behavior.proactivity || 50) * 0.12 + (emotional?.excitement || 0) * 0.08 - ignoredStreak * 2),
    attention: clamp((previous.attention || 45) * 0.6 + (addressed ? 28 : 0) + topicAttention + (room?.heat || 0) * 0.08),
    loneliness: clamp((previous.loneliness || 0) * 0.55 + ignoredStreak * 17 - (addressed ? 22 : 0)),
    repression: clamp((previous.repression || 0) * 0.72 + (emotional?.irritation || 0) * 0.08 + (emotional?.insecurity || 0) * 0.08 + (addressed ? 0 : relationPressure * 0.4)),
    shame: clamp((previous.shame || 0) * 0.66 + (emotional?.embarrassment || 0) * 0.18 + (emotional?.insecurity || 0) * 0.08),
    envy: clamp((previous.envy || 0) * 0.72 + Math.max(0, relationPressure - 12) * 0.5),
    trustInRoom: clamp((previous.trustInRoom || 50) * 0.7 + (params.character.personality.agreeableness || 50) * 0.12 + (room?.cohesion || 0) * 0.08 - (emotional?.irritation || 0) * 0.08),
    ignoredStreak,
    updatedAt: now,
  };
  const repairPressure = inferRepairPressure(params.character, lastOwnMessage, lastMessage, state);
  const impulse = chooseImpulse({ character: params.character, state, addressed, relationPressure, repairPressure, lastMessage });
  const expressionPlan = buildExpressionPlan(impulse.impulse, state, params.character);
  const evidence = [
    addressed ? '最近消息直接提到或指向该角色' : '',
    ignoredStreak ? `最近 ${ignoredStreak} 轮未被明显接住` : '',
    relationPressure >= 10 ? '与上一位发言者存在关系张力' : '',
    repairPressure >= 38 ? '前一次尖锐表达留下关系修复压力' : '',
    topicAttention ? '当前话题命中角色关注领域' : '',
    state.repression >= 56 ? '压抑值偏高' : '',
    buildExpressionFeedbackBias(params.character).hasAny ? '存在用户表达反馈记忆' : '',
  ].filter(Boolean);
  return {
    actorId: params.character.id,
    impulse: impulse.impulse,
    tone: expressionPlan.tone,
    reason: impulse.reason,
    pressure: clamp01(impulse.pressure + Math.max(0, state.attention - 50) / 260 + Math.max(0, state.loneliness - 55) / 320),
    evidence,
    state: {
      ...state,
      lastImpulse: impulse.impulse,
      lastImpulseReason: impulse.reason,
    },
    expressionPlan,
  };
}

export function getInnerLifeSpeakerBias(projection: InnerLifeProjection) {
  const impulseBias: Record<InnerImpulse, number> = {
    answer: 0.34,
    show_off: 0.14,
    defend_face: 0.22,
    seek_attention: 0.18,
    comfort: 0.14,
    repair: 0.17,
    mock: 0.16,
    avoid: -0.12,
    change_topic: 0.06,
    stay_silent: -0.18,
    send_emoji: 0.04,
    withdraw: -0.08,
  };
  const stateBias = (projection.state.attention - 50) * 0.003 + (projection.state.loneliness - 50) * 0.002 + (projection.state.repression - 50) * 0.0015;
  return {
    bias: clamp((impulseBias[projection.impulse] || 0) * projection.pressure + stateBias, -0.22, 0.38),
    reason: `inner:${projection.impulse}`,
  };
}

export function buildInnerLifePromptBlock(projection: InnerLifeProjection) {
  const residue = [
    projection.state.loneliness >= 62 ? 'unanswered loneliness' : '',
    projection.state.repression >= 62 ? 'suppressed words' : '',
    projection.state.shame >= 62 ? 'face-saving shame' : '',
    projection.impulse === 'repair' ? 'awkward repair impulse' : '',
    projection.state.trustInRoom <= 34 ? 'low room safety' : '',
  ].filter(Boolean).join(', ');
  const rhythm = projection.expressionPlan.messageCount > 1
    ? `${projection.expressionPlan.messageCount} quick beats are possible if the thought truly lands as separate sends`
    : 'one beat is likely, but it can be a tiny reaction, a normal answer, or a fuller explanation if the latest request earns it';
  return `\n## Inner Life\n- Current impulse: ${projection.impulse}; tone: ${projection.tone}; pressure: ${projection.pressure.toFixed(2)}.\n- Inner reason: ${projection.reason}\n- Inner residue: ${residue || 'none strong enough to foreground'}.\n- Expression rhythm: ${rhythm}. This is a rhythm cue, not a word-count cap; use a line break only when the thought truly lands as separate quick messages.\n- Let this shape omissions, timing, defensiveness, vulnerability, and messiness. Do not explain these fields in the reply.\n- Only let wistfulness or fragile hope leak into the message when the current residue or conversation actually earns it; never turn every turn into poetry or farewell.`;
}

export function buildInnerLifeMetadata(projection: InnerLifeProjection): NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['innerLife'] {
  return {
    impulse: projection.impulse,
    tone: projection.tone,
    reason: projection.reason,
    pressure: Number(projection.pressure.toFixed(3)),
    evidence: projection.evidence.slice(0, 4),
    state: {
      energy: round(projection.state.energy),
      attention: round(projection.state.attention),
      loneliness: round(projection.state.loneliness),
      repression: round(projection.state.repression),
      shame: round(projection.state.shame),
      envy: round(projection.state.envy),
      trustInRoom: round(projection.state.trustInRoom),
      ignoredStreak: projection.state.ignoredStreak,
    },
    expressionPlan: {
      length: projection.expressionPlan.length,
      messageCount: projection.expressionPlan.messageCount,
      typoLevel: projection.expressionPlan.typoLevel,
      delayMs: projection.expressionPlan.delayMs,
      allowWithdraw: projection.expressionPlan.allowWithdraw,
    },
  };
}
