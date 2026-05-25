import type { AICharacter, PersonalityParams, EmotionalState } from '../types/character';

export const DRIFT_DISPLAY_AXES = ['assertiveness', 'empathy', 'openness', 'humor', 'neuroticism'] as const;
export const EMOTION_DISPLAY_AXES = ['irritation', 'affection', 'insecurity', 'excitement', 'embarrassment'] as const;

function clamp(value: number) {
  return Math.max(-30, Math.min(30, value));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function scaleDelta(value: number, multiplier: number) {
  return value === 0 ? 0 : Math.round(value * multiplier);
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) || []).length;
}

function hasAny(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function buildSocialSignal(text: string) {
  const challengeCount = countMatches(text, /反对|攻击|讨厌|差|烂|wrong|hate|terrible|胡扯|闭嘴|有病|离谱|轮不到|少插嘴|别来指手画脚|急什么|你急什么|不靠谱|哪里不靠谱|就这|也配|少来|别装|阴阳怪气|凭什么|审批一下|火气|怼|嘲讽/gi);
  const supportCount = countMatches(text, /喜欢|支持|同意|欣赏|love|agree|great|可以|有道理|确实|说得对|对呀|对啊|没错|我站|挺你|你真好|你最好|靠谱|赞同/gi);
  const questionCount = countMatches(text, /[?？]|吗|咋|怎么|为什么|是不是|要不|凭什么/gi);
  const excitementCount = countMatches(text, /！|!|太好了|太棒|amazing|great|哈哈|笑死|绝了|离大谱|哟|欸/gi);
  const embarrassmentCount = countMatches(text, /尴尬|丢脸|embarrassed|社死|无语|好吧算了/gi);
  const uncertaintyCount = countMatches(text, /可能|也许|大概|不知道|不懂|不行|fail|wrong|算了|未必/gi);
  const redirectCount = countMatches(text, /先别|重点|所以|扯远|换个说法|说回来|先说这个|别岔开|回到重点/gi);
  const playfulCount = countMatches(text, /哈哈|笑死|离大谱|不是吧|你这也|这都行|哎呀|行啊你|当空调使/gi);
  const intensityBoost = Math.min(2, Math.floor(text.trim().length / 28));
  const isLightRemark = text.trim().length <= 22 && challengeCount === 0 && supportCount === 0 && excitementCount <= 1 && playfulCount <= 1;
  const hasStrongSignal = challengeCount >= 1 || supportCount >= 2 || excitementCount >= 2 || embarrassmentCount >= 1 || redirectCount >= 1;
  const isSparseWorthy = hasStrongSignal || (!isLightRemark && (questionCount >= 2 || playfulCount >= 2));
  return {
    challengeCount,
    supportCount,
    questionCount,
    excitementCount,
    embarrassmentCount,
    uncertaintyCount,
    redirectCount,
    playfulCount,
    intensityBoost,
    isLightRemark,
    hasStrongSignal,
    isSparseWorthy,
    isShortBurst: text.trim().length > 0 && text.trim().length <= 18,
    hasExclamation: hasAny(text, /[!！]/),
    hasQuestion: hasAny(text, /[?？]|吗|咋|怎么|为什么|是不是|要不|凭什么/),
  };
}

export function getRuntimeAxisLabel(key: string, language: string) {
  const isZh = language.startsWith('zh');
  const labels: Record<string, string> = {
    openness: isZh ? '开放性' : 'Openness',
    extroversion: isZh ? '外向性' : 'Extroversion',
    agreeableness: isZh ? '宜人性' : 'Agreeableness',
    neuroticism: isZh ? '敏感度' : 'Sensitivity',
    humor: isZh ? '幽默感' : 'Humor',
    creativity: isZh ? '创造力' : 'Creativity',
    assertiveness: isZh ? '进攻性' : 'Assertiveness',
    empathy: isZh ? '共情力' : 'Empathy',
    irritation: isZh ? '烦躁' : 'Irritation',
    affection: isZh ? '亲近' : 'Affinity',
    insecurity: isZh ? '戒备' : 'Guardedness',
    excitement: isZh ? '兴奋' : 'Excitement',
    embarrassment: isZh ? '尴尬' : 'Embarrassment',
  };
  return labels[key] || key;
}

export function formatEmotionStateLabel(key: string, value: number, language: string) {
  const intensity = value >= 55 ? 'high' : value >= 28 ? 'mid' : 'low';
  const isZh = language.startsWith('zh');
  const zhLabels: Record<string, Record<typeof intensity, string>> = {
    irritation: { high: '明显烦躁', mid: '有点烦躁', low: '略有刺感' },
    affection: { high: '明显亲近', mid: '更亲近', low: '有些靠近' },
    insecurity: { high: '明显戒备', mid: '有点防备', low: '略微不安' },
    excitement: { high: '兴致很高', mid: '有兴致', low: '被带动' },
    embarrassment: { high: '明显尴尬', mid: '有点尴尬', low: '略不自在' },
  };
  const enLabels: Record<string, Record<typeof intensity, string>> = {
    irritation: { high: 'Clearly irritated', mid: 'A little irritated', low: 'Slightly sharp' },
    affection: { high: 'Clearly warm', mid: 'Warmer', low: 'Slightly closer' },
    insecurity: { high: 'Clearly guarded', mid: 'A little guarded', low: 'Slightly uneasy' },
    excitement: { high: 'Highly engaged', mid: 'Interested', low: 'Drawn in' },
    embarrassment: { high: 'Clearly awkward', mid: 'A little awkward', low: 'Slightly uneasy' },
  };
  return (isZh ? zhLabels : enLabels)[key]?.[intensity] || `${getRuntimeAxisLabel(key, language)} ${Math.round(value)}`;
}

export function getEmotionalBaseline(): EmotionalState {
  return { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
}

export function derivePersonalityDrift(character: AICharacter, messageContent: string, multiplier: number = 1) {
  const text = messageContent.toLowerCase();
  const current = character.personalityDrift || {};
  const next: Partial<PersonalityParams> = { ...current };
  const signal = buildSocialSignal(text);
  if (!signal.isSparseWorthy) return current;

  if (signal.challengeCount > 0) {
    next.neuroticism = clamp((current.neuroticism || 0) + scaleDelta(Math.min(2, signal.challengeCount + signal.intensityBoost), multiplier));
    next.extroversion = clamp((current.extroversion || 0) - scaleDelta(1, multiplier));
    next.assertiveness = clamp((current.assertiveness || 0) + scaleDelta(1, multiplier));
  }

  if (signal.supportCount >= 2) {
    next.agreeableness = clamp((current.agreeableness || 0) + scaleDelta(1, multiplier));
    next.empathy = clamp((current.empathy || 0) + scaleDelta(1, multiplier));
  }

  if (signal.redirectCount > 0 || (signal.questionCount >= 2 && signal.isShortBurst)) {
    next.openness = clamp((current.openness || 0) + scaleDelta(1, multiplier));
  }

  if (signal.playfulCount >= 2 || signal.excitementCount >= 2) {
    next.humor = clamp((current.humor || 0) + scaleDelta(1, multiplier));
    next.creativity = clamp((current.creativity || 0) + scaleDelta(1, multiplier));
  }

  if (signal.uncertaintyCount >= 2 && signal.challengeCount === 0) {
    next.assertiveness = clamp((current.assertiveness || 0) - scaleDelta(1, multiplier));
  }

  return next;
}

export function deriveEmotionalState(character: AICharacter, messageContent: string, multiplier: number = 1, decayBias: number = 1): EmotionalState {
  const current = character.emotionalState || getEmotionalBaseline();
  const text = messageContent.toLowerCase();
  const signal = buildSocialSignal(text);
  const scaleGain = (value: number) => Math.round(value * multiplier);
  const scaleDecay = (value: number) => Math.max(1, Math.round(value * decayBias));
  return {
    irritation: clampPercent(current.irritation + (signal.challengeCount > 0 ? scaleGain(Math.min(14, 9 + signal.challengeCount * 2 + signal.intensityBoost)) : -scaleDecay(5))),
    affection: clampPercent(current.affection + (signal.supportCount > 0 ? scaleGain(Math.min(14, 8 + signal.supportCount * 2 + signal.intensityBoost)) : -scaleDecay(3))),
    insecurity: clampPercent(current.insecurity + ((signal.uncertaintyCount >= 2 || signal.embarrassmentCount > 0) ? scaleGain(Math.min(8, 3 + signal.uncertaintyCount + signal.embarrassmentCount)) : -scaleDecay(3))),
    excitement: clampPercent(current.excitement + ((signal.excitementCount >= 2 || signal.playfulCount >= 2 || (signal.hasQuestion && signal.hasExclamation && !signal.isLightRemark)) ? scaleGain(Math.min(9, 3 + signal.excitementCount + signal.playfulCount)) : -scaleDecay(4))),
    embarrassment: clampPercent(current.embarrassment + (signal.embarrassmentCount > 0 ? scaleGain(Math.min(9, 4 + signal.embarrassmentCount)) : -scaleDecay(3))),
  };
}

export function applyDriftToBehavior(character: AICharacter) {
  const drift = character.personalityDrift || {};
  return {
    ...character.behavior,
    proactivity: clampPercent(character.behavior.proactivity + Math.round((drift.extroversion || 0) * 0.6) + Math.round((drift.assertiveness || 0) * 0.35)),
    empathyLevel: clampPercent(character.behavior.empathyLevel + Math.round((drift.empathy || 0) * 0.8) + Math.round((drift.agreeableness || 0) * 0.35)),
    aggressiveness: clampPercent(character.behavior.aggressiveness + Math.round((drift.neuroticism || 0) * 0.5) + Math.round((drift.assertiveness || 0) * 0.3)),
    summarizing: clampPercent(character.behavior.summarizing + Math.round((drift.openness || 0) * 0.35)),
    humorIntensity: clampPercent(character.behavior.humorIntensity + Math.round((drift.humor || 0) * 0.45) + Math.round((drift.creativity || 0) * 0.25)),
    offTopic: clampPercent(character.behavior.offTopic + Math.round((drift.openness || 0) * 0.25) + Math.round((drift.creativity || 0) * 0.2)),
  };
}

export function summarizeRuntimeAffect(character: AICharacter, language: string) {
  const drift = character.personalityDrift || {};
  const emotion = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  const driftItems = DRIFT_DISPLAY_AXES
    .map((key) => ({ key, value: Number(drift[key] || 0) }))
    .filter((item) => Math.abs(item.value) >= 6)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map((item) => `${getRuntimeAxisLabel(item.key, language)} ${item.value > 0 ? '+' : ''}${item.value}`);
  const emotionItems = EMOTION_DISPLAY_AXES
    .map((key) => ({ key, value: Number(emotion[key] || 0) }))
    .filter((item) => item.value >= 28)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((item) => `${getRuntimeAxisLabel(item.key, language)} ${Math.round(item.value)}`);
  return { driftItems, emotionItems };
}

export function getAffectSummaryLines(character: AICharacter, language: string) {
  const summary = summarizeRuntimeAffect(character, language);
  return [...summary.driftItems, ...summary.emotionItems];
}

export function buildRuntimeAffectRadarValues(character: AICharacter) {
  const drift = character.personalityDrift || {};
  const emotion = character.emotionalState || { irritation: 0, affection: 0, insecurity: 0, excitement: 0, embarrassment: 0 };
  return {
    assertiveness: Math.max(0, Math.min(100, 40 + Number(drift.assertiveness || 0) * 1.8 + Number(emotion.irritation || 0) * 0.18)),
    empathy: Math.max(0, Math.min(100, 40 + Number(drift.empathy || 0) * 1.8 + Number(emotion.affection || 0) * 0.22)),
    openness: Math.max(0, Math.min(100, 40 + Number(drift.openness || 0) * 1.7 + Number(emotion.excitement || 0) * 0.16)),
    humor: Math.max(0, Math.min(100, 40 + Number(drift.humor || 0) * 1.7 + Number(emotion.excitement || 0) * 0.18 - Number(emotion.embarrassment || 0) * 0.08)),
    guardedness: Math.max(0, Math.min(100, 34 + Number(drift.neuroticism || 0) * 1.7 + Number(emotion.insecurity || 0) * 0.22 + Number(emotion.embarrassment || 0) * 0.1)),
  };
}

export function buildRuntimeAffectRadarEntry(character: AICharacter) {
  const current = buildRuntimeAffectRadarValues(character);
  return {
    pairKey: `affect:${character.id}`,
    actorId: character.id,
    targetId: character.id,
    current: {
      warmth: current.empathy,
      competence: current.openness,
      trust: current.humor,
      threat: current.guardedness,
    },
    derived: {},
    axisReasons: {},
    trend: 'flat' as const,
    recentEvents: [],
    lastUpdatedAt: Date.now(),
  };
}

export function hasMeaningfulRuntimeAffect(character: AICharacter) {
  const { driftItems, emotionItems } = summarizeRuntimeAffect(character, 'zh');
  return driftItems.length > 0 || emotionItems.length > 0;
}

export function getRuntimeAffectCompact(character: AICharacter, language: string) {
  return {
    visible: hasMeaningfulRuntimeAffect(character),
    lines: getAffectSummaryLines(character, language).slice(0, 2),
    radar: buildRuntimeAffectRadarEntry(character),
  };
}

export function hasRuntimeAffectIndicators(character: AICharacter) {
  return hasMeaningfulRuntimeAffect(character);
}

export function getRuntimeAffectMemberIndicators(character: AICharacter, language: string) {
  return getRuntimeAffectCompact(character, language).lines;
}

export function getRuntimeAffectMemberShape(character: AICharacter) {
  return buildRuntimeAffectRadarEntry(character);
}

export function formatLocalizedDriftSummary(drift: Partial<PersonalityParams>, language: string, limit: number = 2, threshold: number = 2) {
  return Object.entries(drift)
    .filter(([, value]) => typeof value === 'number' && Math.abs(value) >= threshold)
    .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)))
    .slice(0, limit)
    .map(([key, value]) => `${getRuntimeAxisLabel(key, language)}${Number(value) > 0 ? '+' : ''}${value}`)
    .join('，');
}

export function getDominantEmotionLabel(emotionalState: EmotionalState | undefined, language: string, threshold: number = 28) {
  if (!emotionalState) return null;
  const top = Object.entries(emotionalState).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  if (!top || Number(top[1]) < threshold) return null;
  return getRuntimeAxisLabel(top[0], language);
}

export function formatLocalizedEmotionSummary(emotionalState: EmotionalState | undefined, language: string, limit: number = 2, threshold: number = 28) {
  if (!emotionalState) return '';
  return Object.entries(emotionalState)
    .filter(([, value]) => typeof value === 'number' && Number(value) >= threshold)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([key, value]) => `${getRuntimeAxisLabel(key, language)} ${Math.round(Number(value))}`)
    .join('，');
}

export function hasMeaningfulEmotionState(emotionalState: EmotionalState | undefined, threshold: number = 28) {
  if (!emotionalState) return false;
  return Object.values(emotionalState).some((value) => typeof value === 'number' && value >= threshold);
}

export function hasMeaningfulDriftState(drift: Partial<PersonalityParams> | undefined, threshold: number = 2) {
  if (!drift) return false;
  return Object.values(drift).some((value) => typeof value === 'number' && Math.abs(value) >= threshold);
}

function getAffectEventLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  const driftLine = hasMeaningfulDriftState(params.drift)
    ? `${params.name}：${formatLocalizedDriftSummary(params.drift || {}, params.language, 2, 2)}`
    : null;
  const emotionLine = hasMeaningfulEmotionState(params.emotion)
    ? `${params.name}：${formatLocalizedEmotionSummary(params.emotion, params.language, 2, 28)}`
    : null;
  return {
    driftLine,
    emotionLine,
  };
}

function getMeaningfulEmotionEventLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return items
    .map((item) => getAffectEventLines({ name: item.name, emotion: item.emotion, language }).emotionLine)
    .filter(Boolean) as string[];
}

function getMeaningfulDriftEventLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getAffectEventLines({ name, drift, language }).driftLine;
}

export function getRuntimeAffectEventDriftLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getMeaningfulDriftEventLine(name, drift, language);
}

export function getRuntimeAffectEventEmotionLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return getMeaningfulEmotionEventLines(items, language);
}

export function getAffectChipColor(label: string) {
  if (/烦躁|戒备|尴尬|Irritation|Guardedness|Embarrassment/.test(label)) return 'warning' as const;
  if (/亲近|共情|幽默|兴奋|Affinity|Empathy|Humor|Excitement/.test(label)) return 'success' as const;
  return 'default' as const;
}
