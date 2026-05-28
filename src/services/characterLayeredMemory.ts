import type { AICharacter } from '../types/character';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';

function buildSourceEventId(sourceTag: string, ownerId: string, targetId: string | null | undefined, text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ').slice(0, 48);
  return `${sourceTag}:${ownerId}:${targetId || 'self'}:${normalized}`;
}

function normalizeContentSnippet(content: string, maxLength = 72) {
  return content
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function describeRelationshipTone(content: string, isPositive: boolean) {
  if (/支持|站你|说得对|帮|维护|谢谢|放心|开心|好啊|可以|喜欢|关心/.test(content)) {
    return '表现出支持、亲近或愿意配合';
  }
  if (/别|闭嘴|管得|挑刺|抬杠|嫌弃|笑死|不服|凭什么|懒|炸|摔|丢脸|嘲/.test(content)) {
    return '表现出挑衅、防备、嘲弄或不满';
  }
  if (/？|\?|怎么|是不是|为什么|吗/.test(content)) {
    return isPositive ? '以试探和关心的方式互动' : '以追问、试探或质疑的方式互动';
  }
  return isPositive ? '互动倾向更友好或信任' : '互动倾向更紧张或戒备';
}

function describeSelfExpression(content: string) {
  if (/我|自己|怕|想|喜欢|讨厌|不想|要|希望|觉得/.test(content)) return '表达了自我立场、偏好或情绪需求';
  if (/别|闭嘴|管|凭什么|不服|挑刺/.test(content)) return '表达方式带有防御、反驳或控制倾向';
  if (/哈哈|笑死|好玩|开心|有趣/.test(content)) return '表达方式偏轻松、玩笑或兴奋';
  return '在近期对话中展现出新的表达倾向';
}

function buildRelationshipMemoryCandidate(character: AICharacter, targetId: string, targetName: string, content: string, sourceEventTag?: string): MemoryCandidate {
  const relation = character.relationships.find((item) => item.characterId === targetId);
  const isPositive = (relation?.warmth || 0) + (relation?.competence || 0) + (relation?.trust || 0) >= (relation?.threat || 0) + 12;
  const sourceTag = sourceEventTag || 'interaction';
  const tone = describeRelationshipTone(content, isPositive);
  const evidence = normalizeContentSnippet(content);
  const text = `对 ${targetName} 的关系倾向：${tone}${evidence ? `；证据是近期发言“${evidence}”` : ''}`;
  return {
    scope: 'relationship',
    layerHint: 'episodic',
    kind: isPositive ? 'bond' : 'resentment',
    ownerId: character.id,
    subjectIds: [character.id, targetId],
    text,
    evidenceText: content,
    sourceEventIds: [buildSourceEventId(sourceTag, character.id, targetId, text)],
    sourceTag,
    scoreBreakdown: { stability: 0.65, recurrence: 0.55, impact: 0.8, specificity: 0.7, durability: 0.65 },
  };
}

function buildSelfStateMemoryCandidate(character: AICharacter, content: string): MemoryCandidate {
  const summary = describeSelfExpression(content);
  const evidence = normalizeContentSnippet(content);
  const text = `近期表达倾向：${summary}${evidence ? `；证据是“${evidence}”` : ''}`;
  return {
    scope: 'character_self',
    layerHint: 'working',
    kind: 'trait_evidence',
    ownerId: character.id,
    text,
    evidenceText: content,
    sourceEventIds: [buildSourceEventId('self_expression', character.id, null, text)],
    sourceTag: 'self_expression',
    scoreBreakdown: { stability: 0.45, recurrence: 0.45, impact: 0.6, specificity: 0.68, durability: 0.45 },
  };
}

function createSoulMemoryCandidate(params: {
  character: AICharacter;
  targetId?: string;
  targetName?: string;
  content: string;
  scope: MemoryCandidate['scope'];
  layerHint: MemoryCandidate['layerHint'];
  kind: MemoryCandidate['kind'];
  text: string;
  sourceTag: string;
  scoreBreakdown?: MemoryCandidate['scoreBreakdown'];
}): MemoryCandidate {
  return {
    scope: params.scope,
    layerHint: params.layerHint,
    kind: params.kind,
    ownerId: params.character.id,
    subjectIds: params.scope === 'relationship' && params.targetId ? [params.character.id, params.targetId] : undefined,
    text: params.text,
    evidenceText: params.content,
    sourceEventIds: [buildSourceEventId(params.sourceTag, params.character.id, params.targetId, params.text)],
    sourceTag: params.sourceTag,
    scoreBreakdown: params.scoreBreakdown || { stability: 0.52, recurrence: 0.48, impact: 0.68, specificity: 0.72, durability: 0.5 },
  };
}

function buildSoulStateMemoryCandidates(character: AICharacter, targetId: string | undefined, targetName: string | undefined, content: string): MemoryCandidate[] {
  const soul = character.soulState;
  if (!soul?.lastImpulse) return [];
  const evidence = normalizeContentSnippet(content);
  const evidenceLine = evidence ? `；证据是“${evidence}”` : '';
  const candidates: MemoryCandidate[] = [];

  if (soul.lastImpulse === 'repair') {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'character_self',
      layerHint: 'episodic',
      kind: 'trait_evidence',
      text: `近期表达余波：话说重或嘴硬之后，会出现别扭找补、缓和关系的倾向${evidenceLine}`,
      sourceTag: 'inner_life_repair',
      scoreBreakdown: { stability: 0.56, recurrence: 0.5, impact: 0.72, specificity: 0.76, durability: 0.55 },
    }));
    if (targetId && targetName) {
      candidates.push(createSoulMemoryCandidate({
        character,
        targetId,
        targetName,
        content,
        scope: 'relationship',
        layerHint: 'episodic',
        kind: 'bond',
        text: `对 ${targetName} 的关系余波：前面留下刺感后，仍有找补或缓和的倾向${evidenceLine}`,
        sourceTag: 'inner_life_repair',
        scoreBreakdown: { stability: 0.56, recurrence: 0.48, impact: 0.76, specificity: 0.74, durability: 0.54 },
      }));
    }
  }

  if (soul.lastImpulse === 'seek_attention' && (soul.ignoredStreak >= 2 || soul.loneliness >= 58)) {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'character_self',
      layerHint: 'working',
      kind: 'status_shift',
      text: `近期群内状态：发言没被接住时，会用半句玩笑或侧面插话试探存在感${evidenceLine}`,
      sourceTag: 'inner_life_attention',
    }));
  }

  if (soul.lastImpulse === 'defend_face' && (soul.shame >= 52 || soul.repression >= 56)) {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'character_self',
      layerHint: 'working',
      kind: 'trait_evidence',
      text: `近期面子反应：被戳到或压住话时，更容易嘴硬、岔开或把语气收尖${evidenceLine}`,
      sourceTag: 'inner_life_face',
      scoreBreakdown: { stability: 0.5, recurrence: 0.48, impact: 0.7, specificity: 0.72, durability: 0.5 },
    }));
  }

  if (soul.lastImpulse === 'mock' && targetId && targetName && soul.repression >= 42) {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'relationship',
      layerHint: 'episodic',
      kind: 'resentment',
      text: `对 ${targetName} 的关系刺感：压着不满时，容易用调侃、反驳或挑刺保持距离${evidenceLine}`,
      sourceTag: 'inner_life_mock',
      scoreBreakdown: { stability: 0.54, recurrence: 0.5, impact: 0.74, specificity: 0.74, durability: 0.52 },
    }));
  }

  if (soul.lastImpulse === 'comfort' && targetId && targetName && soul.trustInRoom >= 48) {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'relationship',
      layerHint: 'episodic',
      kind: 'bond',
      text: `对 ${targetName} 的关系暖意：在房间安全感足够时，会倾向接住或照顾对方${evidenceLine}`,
      sourceTag: 'inner_life_comfort',
      scoreBreakdown: { stability: 0.54, recurrence: 0.46, impact: 0.72, specificity: 0.72, durability: 0.52 },
    }));
  }

  if (soul.repression >= 68 && !['repair', 'defend_face'].includes(soul.lastImpulse)) {
    candidates.push(createSoulMemoryCandidate({
      character,
      targetId,
      targetName,
      content,
      scope: 'character_self',
      layerHint: 'working',
      kind: 'status_shift',
      text: `近期内在余波：有些话被压住，后续表达更容易带一点边缘感或迟疑${evidenceLine}`,
      sourceTag: 'inner_life_repression',
    }));
  }

  return candidates;
}

function buildCoreProfileMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  if (!character.coreProfile?.coreDesire && !character.coreProfile?.coreFear) return [];
  const text = [character.coreProfile?.coreDesire ? `欲望:${character.coreProfile.coreDesire}` : '', character.coreProfile?.coreFear ? `恐惧:${character.coreProfile.coreFear}` : ''].filter(Boolean).join(' / ');
  return [{
    scope: 'character_self',
    layerHint: 'long_term',
    kind: 'bias',
    ownerId: character.id,
    text,
    sourceEventIds: [buildSourceEventId('core_profile', character.id, null, text)],
    sourceTag: 'core_profile',
    scoreBreakdown: { stability: 0.8, recurrence: 0.5, impact: 0.7, specificity: 0.75, durability: 0.85 },
  }];
}

function buildTraitMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  if (character.background?.trim()) {
    const text = `背景线索：${character.background.slice(0, 80)}`;
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text,
      sourceEventIds: [buildSourceEventId('background', character.id, null, text)],
      sourceTag: 'background',
      scoreBreakdown: { stability: 0.75, recurrence: 0.35, impact: 0.55, specificity: 0.75, durability: 0.8 },
    });
  }
  if (character.speakingStyle?.trim()) {
    const text = `说话风格：${character.speakingStyle.slice(0, 60)}`;
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text,
      sourceEventIds: [buildSourceEventId('speaking_style', character.id, null, text)],
      sourceTag: 'speaking_style',
      scoreBreakdown: { stability: 0.72, recurrence: 0.35, impact: 0.5, specificity: 0.7, durability: 0.78 },
    });
  }
  if (character.expertise?.length) {
    const text = `专长：${character.expertise.join(' / ').slice(0, 80)}`;
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: 'trait_evidence',
      ownerId: character.id,
      text,
      sourceEventIds: [buildSourceEventId('expertise', character.id, null, text)],
      sourceTag: 'expertise',
      scoreBreakdown: { stability: 0.78, recurrence: 0.4, impact: 0.58, specificity: 0.76, durability: 0.82 },
    });
  }
  return candidates;
}

export function updateCharacterLayeredMemories(params: {
  character: AICharacter;
  targetId?: string;
  targetName?: string;
  content: string;
  personalityDrift: Partial<AICharacter['personality']>;
  sourceEventTag?: string;
}) {
  const primaryCandidate = params.targetId && params.targetName
    ? buildRelationshipMemoryCandidate(params.character, params.targetId, params.targetName, params.content, params.sourceEventTag)
    : buildSelfStateMemoryCandidate(params.character, params.content);

  const candidates: MemoryCandidate[] = [
    primaryCandidate,
    ...buildSoulStateMemoryCandidates(params.character, params.targetId, params.targetName, params.content),
    ...buildCoreProfileMemoryCandidates(params.character),
    ...buildTraitMemoryCandidates(params.character),
  ];

  return consolidateMemoryCandidates(params.character.layeredMemories || [], candidates);
}

export function getCharacterLayeredMemories(character: AICharacter): MemoryItem[] {
  return character.layeredMemories || [];
}
