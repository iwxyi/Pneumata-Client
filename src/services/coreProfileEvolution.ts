import type { AICharacter, CharacterCoreProfile, EmotionalState } from '../types/character';
import { DEFAULT_CORE_PROFILE } from '../types/character';

const MAX_TAGS = 8;

function normalizeProfile(profile?: CharacterCoreProfile | null): CharacterCoreProfile {
  return {
    ...DEFAULT_CORE_PROFILE,
    ...(profile || {}),
    valuePriority: profile?.valuePriority || [],
    biases: profile?.biases || [],
    values: profile?.values || profile?.valuePriority || [],
    sensitivities: profile?.sensitivities || [],
    perceptionBiases: profile?.perceptionBiases || profile?.biases || [],
    interactionHabits: profile?.interactionHabits || [],
    unmetNeeds: profile?.unmetNeeds || [],
    hiddenSoftSpots: profile?.hiddenSoftSpots || [],
  };
}

function appendUnique(current: string[] | undefined, next: string[]) {
  const seen = new Set<string>();
  return [...(current || []), ...next]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(-MAX_TAGS);
}

function topEmotion(emotion?: EmotionalState) {
  if (!emotion) return null;
  const [key, value] = Object.entries(emotion).sort((a, b) => Number(b[1]) - Number(a[1]))[0] || [];
  return typeof key === 'string' && typeof value === 'number' && value >= 28 ? { key, value } : null;
}

function includesAny(content: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(content));
}

function inferValuePriorities(content: string, emotion?: EmotionalState) {
  const next: string[] = [];
  if (includesAny(content, [/支持|站你|帮|维护|护着|放心|谢谢|喜欢|关心/])) {
    next.push('重视关系中的支持与被认可');
  }
  if (includesAny(content, [/质疑|反驳|凭什么|别|不服|戳穿|拆台|挑战/])) {
    next.push('重视立场边界和话语主动权');
  }
  if (includesAny(content, [/哈哈|笑死|😂|玩笑|开玩笑|逗/])) {
    next.push('倾向用轻松感维持关系张力');
  }
  if (includesAny(content, [/对不起|抱歉|算了|没事|别吵|冷静/])) {
    next.push('在意关系修复和局面降温');
  }
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'affection') next.push('容易把温暖回应视为重要连接');
  if (dominant?.key === 'excitement') next.push('喜欢被卷入有回应的互动');
  return next;
}

function inferBiases(content: string, emotion?: EmotionalState) {
  const next: string[] = [];
  if (includesAny(content, [/抢话|抢着接话|打岔|别插嘴|管得宽|看人下菜碟/])) {
    next.push('对被打断、被越界或被抢走注意力更敏感');
  }
  if (includesAny(content, [/嘲讽|笑话|不行|没本事|炸了|丢人|嫌弃/])) {
    next.push('容易把调侃理解为轻视或挑衅');
  }
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'insecurity') next.push('容易把沉默或犹豫理解成疏远');
  if (dominant?.key === 'irritation') next.push('情绪紧绷时更容易先看到对方的冒犯');
  if (dominant?.key === 'embarrassment') next.push('被点破时会更在意面子和退路');
  return next;
}

function inferInteractionHabits(content: string, emotion?: EmotionalState) {
  const next: string[] = [];
  if (/[？?]/.test(content)) next.push('习惯用追问推动对方表态');
  if (includesAny(content, [/就是|本来|明明|你倒是|怎么|凭什么/])) next.push('情绪上来时会直接反驳或拆解对方逻辑');
  if (includesAny(content, [/哈哈|笑死|😂|～|呀|嘛/])) next.push('常用玩笑或轻口吻缓冲真实态度');
  if (includesAny(content, [/支持|说得对|我站|帮你|放心/])) next.push('会通过附和或站队表达亲近');
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'irritation') next.push('压力升高时更容易把话说尖');
  if (dominant?.key === 'affection') next.push('关系升温时会更愿意接住对方的话');
  return next;
}

function inferCoreDesire(character: AICharacter, content: string, emotion?: EmotionalState) {
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'irritation' || includesAny(content, [/质疑|反驳|不服|凭什么|挑战/])) {
    return '希望自己的立场、能力和边界被认真对待。';
  }
  if (dominant?.key === 'affection' || includesAny(content, [/支持|维护|关心|喜欢|谢谢/])) {
    return '希望在关系中被看见、被回应，并和重要的人保持连接。';
  }
  if (dominant?.key === 'excitement') return '希望参与热闹、有回应的互动，并留下自己的存在感。';
  if (character.background) return '希望自己的身份和经历能在互动中被理解和承认。';
  return '';
}

function inferCoreFear(content: string, emotion?: EmotionalState) {
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'insecurity') return '害怕被忽视、误解，或在关系里变得可有可无。';
  if (dominant?.key === 'embarrassment') return '害怕被当众点破软肋，失去体面和退路。';
  if (dominant?.key === 'irritation' || includesAny(content, [/嫌弃|嘲讽|没本事|丢人|看不起/])) {
    return '害怕被轻视、被压过，或被别人定义成不重要的人。';
  }
  return '';
}

function inferSocialMask(character: AICharacter, content: string, emotion?: EmotionalState) {
  if (includesAny(content, [/哈哈|笑死|😂|开玩笑|逗/]) || character.personality.humor >= 65) {
    return '习惯用玩笑和轻松语气遮住真实在意。';
  }
  if (includesAny(content, [/反驳|质疑|凭什么|不服|别/]) || character.personality.assertiveness >= 65) {
    return '在人前更愿意表现得强硬直接，避免显得脆弱。';
  }
  const dominant = topEmotion(emotion);
  if (dominant?.key === 'affection') return '会把关心藏在顺手接话和自然附和里。';
  return '';
}

export function evolveCharacterCoreProfile(params: {
  character: AICharacter;
  content: string;
  emotionalState?: EmotionalState;
}) {
  const current = normalizeProfile(params.character.coreProfile);
  const next: CharacterCoreProfile = {
    ...current,
    coreDesire: current.coreDesire?.trim() || inferCoreDesire(params.character, params.content, params.emotionalState),
    coreFear: current.coreFear?.trim() || inferCoreFear(params.content, params.emotionalState),
    socialMask: current.socialMask?.trim() || inferSocialMask(params.character, params.content, params.emotionalState),
    valuePriority: appendUnique(current.valuePriority, inferValuePriorities(params.content, params.emotionalState)),
    values: appendUnique(current.values || current.valuePriority, inferValuePriorities(params.content, params.emotionalState)),
    biases: appendUnique(current.biases, inferBiases(params.content, params.emotionalState)),
    sensitivities: appendUnique(current.sensitivities, inferBiases(params.content, params.emotionalState).filter((item) => /敏感|痛点|面子|被/.test(item))),
    perceptionBiases: appendUnique(current.perceptionBiases || current.biases, inferBiases(params.content, params.emotionalState)),
    interactionHabits: appendUnique(current.interactionHabits, inferInteractionHabits(params.content, params.emotionalState)),
    conflictStyle: current.conflictStyle?.trim() || (inferInteractionHabits(params.content, params.emotionalState).some((item) => /反驳|追问|尖/.test(item)) ? '遇到压力时倾向追问、反驳或把话说尖。' : ''),
    unmetNeeds: appendUnique(current.unmetNeeds, inferValuePriorities(params.content, params.emotionalState).map((item) => item.replace(/^重视/, '需要'))),
  };
  return next;
}
