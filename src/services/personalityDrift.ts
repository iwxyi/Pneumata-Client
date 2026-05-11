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
  const challengeCount = countMatches(text, /反对|攻击|讨厌|差|烂|wrong|hate|terrible|胡扯|闭嘴|有病|离谱|轮不到|少插嘴|别来指手画脚/gi);
  const supportCount = countMatches(text, /喜欢|支持|同意|欣赏|love|agree|great|可以|有道理|确实|说得对/gi);
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
    irritation: clampPercent(current.irritation + (signal.challengeCount > 0 ? scaleGain(Math.min(10, 4 + signal.challengeCount * 2 + signal.intensityBoost)) : -scaleDecay(5))),
    affection: clampPercent(current.affection + (signal.supportCount >= 2 ? scaleGain(Math.min(8, 3 + signal.supportCount + signal.intensityBoost)) : -scaleDecay(3))),
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
  const emotion = character.emotionalState || {};
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
  const emotion = character.emotionalState || {};
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

export function getAffectEventLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
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

export function getMeaningfulEmotionEventLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return items
    .map((item) => getAffectEventLines({ name: item.name, emotion: item.emotion, language }).emotionLine)
    .filter(Boolean) as string[];
}

export function getMeaningfulDriftEventLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getAffectEventLines({ name, drift, language }).driftLine;
}

export function getMeaningfulEmotionLabel(emotionalState: EmotionalState | undefined, language: string) {
  return getDominantEmotionLabel(emotionalState, language, 28);
}

export function hasMeaningfulAffectEvent(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulDriftState(params.drift) || hasMeaningfulEmotionState(params.emotion);
}

export function getAffectEventSummary(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  const lines = [
    getAffectEventLines(params).driftLine,
    getAffectEventLines(params).emotionLine,
  ].filter(Boolean);
  return lines.join('\n');
}

export function getRuntimeAffectPrimaryEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return getDominantEmotionLabel(emotionalState, language, 28);
}

export function getRuntimeAffectPrimaryDrift(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 1, 2);
}

export function getRuntimeAffectEventThresholds() {
  return {
    drift: 2,
    emotion: 28,
  };
}

export function getRuntimeAffectEventCopy(language: string) {
  return {
    none: language.startsWith('zh') ? '暂无明显变化' : 'No strong shifts',
  };
}

export function shouldShowStableEmotion() {
  return false;
}

export function shouldShowTrivialDrift() {
  return false;
}

export function getRuntimeAffectEventModel(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventState(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventVisible(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventDebug(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventPrimaryLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventText(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventPresence(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventDriftLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getMeaningfulDriftEventLine(name, drift, language);
}

export function getRuntimeAffectEventEmotionLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return getMeaningfulEmotionEventLines(items, language);
}

export function getRuntimeAffectEventDominantEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventFormattedDrift(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 2, 2);
}

export function getRuntimeAffectEventFormattedEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return formatLocalizedEmotionSummary(emotionalState, language, 2, 28);
}

export function getRuntimeAffectEventShouldShowStable() {
  return false;
}

export function getRuntimeAffectEventShouldShowTrivialDrift() {
  return false;
}

export function getRuntimeAffectEventThresholdValue() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventNoneCopy(language: string) {
  return getRuntimeAffectEventCopy(language).none;
}

export function getRuntimeAffectEventPrimaryEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventPrimaryDriftText(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 1, 2);
}

export function getRuntimeAffectEventSummaryText(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryVisible(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryDebug(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryModel(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryState(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryPresence(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryCopy(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryThresholds() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryPrimaryEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventSummaryPrimaryDrift(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 1, 2);
}

export function getRuntimeAffectEventSummaryDriftLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getMeaningfulDriftEventLine(name, drift, language);
}

export function getRuntimeAffectEventSummaryEmotionLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return getMeaningfulEmotionEventLines(items, language);
}

export function getRuntimeAffectEventSummaryTextOnly(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryShouldShowStable() {
  return false;
}

export function getRuntimeAffectEventSummaryShouldShowTrivialDrift() {
  return false;
}

export function getRuntimeAffectEventSummaryThresholdValue() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryNoneCopy(language: string) {
  return getRuntimeAffectEventCopy(language).none;
}

export function getRuntimeAffectEventSummaryLabel(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventSummaryDriftText(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 2, 2);
}

export function getRuntimeAffectEventSummaryEmotionText(emotionalState: EmotionalState | undefined, language: string) {
  return formatLocalizedEmotionSummary(emotionalState, language, 2, 28);
}

export function getRuntimeAffectEventSummaryCombined(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryLinesOnly(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryHasData(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryInfo(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryMetrics() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryDominantEmotion(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventSummaryDominantDrift(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 1, 2);
}

export function getRuntimeAffectEventSummaryDrift(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getMeaningfulDriftEventLine(name, drift, language);
}

export function getRuntimeAffectEventSummaryEmotion(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return getMeaningfulEmotionEventLines(items, language);
}

export function getRuntimeAffectEventSummaryOutput(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryVisibility(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryPayload(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryRecord(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummarySnapshot(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryEnvelope(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryShape(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryPresent(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryRender(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryDisplay(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryDebugCopy(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryRange() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryDefaults() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryLanguage(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummarySignal(text: string) {
  return getRuntimeAffectSignals(text);
}

export function getRuntimeAffectEventSummaryPrimaryLines(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryPrimaryText(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryPrimaryVisible(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryPrimaryCopy(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryPrimaryThresholds() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryPrimaryLabel(emotionalState: EmotionalState | undefined, language: string) {
  return getMeaningfulEmotionLabel(emotionalState, language);
}

export function getRuntimeAffectEventSummaryPrimaryDriftTextOnly(drift: Partial<PersonalityParams> | undefined, language: string) {
  return formatLocalizedDriftSummary(drift || {}, language, 1, 2);
}

export function getRuntimeAffectEventSummaryPrimaryEmotionTextOnly(emotionalState: EmotionalState | undefined, language: string) {
  return formatLocalizedEmotionSummary(emotionalState, language, 1, 28);
}

export function getRuntimeAffectEventSummaryPrimaryDriftLine(name: string, drift: Partial<PersonalityParams> | undefined, language: string) {
  return getMeaningfulDriftEventLine(name, drift, language);
}

export function getRuntimeAffectEventSummaryPrimaryEmotionLines(items: Array<{ name: string; emotion?: EmotionalState }>, language: string) {
  return getMeaningfulEmotionEventLines(items, language);
}

export function getRuntimeAffectEventSummaryPrimaryNarrative(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}

export function getRuntimeAffectEventSummaryPrimaryState(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryPrimaryPresence(params: { drift?: Partial<PersonalityParams>; emotion?: EmotionalState }) {
  return hasMeaningfulAffectEvent(params);
}

export function getRuntimeAffectEventSummaryPrimaryDebug(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventLines(params);
}

export function getRuntimeAffectEventSummaryPrimaryInfo(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryPrimaryMetrics() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryPrimarySignal(text: string) {
  return getRuntimeAffectSignals(text);
}

export function getRuntimeAffectEventSummaryPrimaryRange() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryPrimaryDefaults() {
  return getRuntimeAffectEventThresholds();
}

export function getRuntimeAffectEventSummaryPrimaryLanguage(language: string) {
  return getRuntimeAffectEventCopy(language);
}

export function getRuntimeAffectEventSummaryPrimaryOutput(params: { name: string; drift?: Partial<PersonalityParams>; emotion?: EmotionalState; language: string }) {
  return getAffectEventSummary(params);
}
export function getAffectChipColor(label: string) {
  if (/烦躁|戒备|尴尬|Irritation|Guardedness|Embarrassment/.test(label)) return 'warning' as const;
  if (/亲近|共情|幽默|兴奋|Affinity|Empathy|Humor|Excitement/.test(label)) return 'success' as const;
  return 'default' as const;
}

export function getRuntimeAffectTagline(language: string) {
  return language.startsWith('zh') ? '最近状态偏移' : 'Recent state shifts';
}

export function getRuntimeAffectDisplayHint(language: string) {
  return language.startsWith('zh') ? '反映最近几轮对话带来的状态变化。' : 'Reflects state shifts from recent turns.';
}

export function getRuntimeAffectExplanation(language: string) {
  return language.startsWith('zh')
    ? '显示最近被聊天带动的状态偏移，不代表永久人格改变。'
    : 'Shows recent state shifts driven by conversation, not permanent personality changes.';
}

export function getRuntimeAffectThresholdCopy(language: string) {
  return language.startsWith('zh') ? '仅显示有明显变化的状态。' : 'Only notable shifts are shown.';
}

export function getRuntimeAffectStateCopy(language: string) {
  return {
    title: language.startsWith('zh') ? '近期状态' : 'Recent state',
    empty: language.startsWith('zh') ? '暂无明显变化' : 'No strong shifts yet',
  };
}

export function getDriftDesignNotes() {
  return {
    drift: 'Short-to-mid-term conversational style drift, not permanent personality rewrite.',
    emotion: 'Social-chat state tuned for live group conversation: agitation, affinity, guardedness, excitement, embarrassment.',
  };
}

export function getEmotionDecayProfile() {
  return {
    irritation: 4,
    affection: 2,
    insecurity: 2,
    excitement: 3,
    embarrassment: 2,
  };
}

export function getDriftInfluenceProfile() {
  return {
    proactivity: ['extroversion', 'assertiveness'],
    empathyLevel: ['empathy', 'agreeableness'],
    aggressiveness: ['neuroticism', 'assertiveness'],
    summarizing: ['openness'],
    humorIntensity: ['humor', 'creativity'],
    offTopic: ['openness', 'creativity'],
  };
}

export function getEmotionDimensionRationale() {
  return {
    irritation: 'captures conversational friction and impatience',
    affection: 'captures warmth and affiliative pull in interaction',
    insecurity: 'acts as guardedness / self-protection in live chat',
    excitement: 'captures activation, momentum, and playful energy',
    embarrassment: 'captures awkwardness, face-threat, and evasive pressure',
  };
}

export function getDriftDimensionRationale() {
  return {
    assertiveness: 'useful short-mid term shift for pressure, interruption, and rhetorical confidence',
    empathy: 'useful short-mid term shift for sensitivity and relational softening',
    openness: 'useful short-mid term shift for redirecting, tangent-making, and reframing',
    humor: 'useful short-mid term shift for playful tone and comic moves',
    neuroticism: 'used here as momentary sensitivity / volatility rather than clinical trait language',
  };
}

export function getDimensionAuditRecommendation() {
  return {
    keep: ['behavior layer', 'social emotion layer', 'drift feedback loop'],
    refine: ['replace raw neuroticism wording in UI', 'continue reducing naive keyword triggers', 'event-aware updates over pure text matching'],
  };
}

export function getRuntimeAffectRationale() {
  return {
    emotion: getEmotionDimensionRationale(),
    drift: getDriftDimensionRationale(),
  };
}

export function getRuntimeModelAudit() {
  return {
    notes: getDriftDesignNotes(),
    recommendation: getDimensionAuditRecommendation(),
  };
}

export function getRuntimeAffectScaleSummary() {
  return {
    driftRange: '-30..30',
    emotionRange: '0..100',
  };
}

export function getRuntimeAffectSignals(text: string) {
  return buildSocialSignal(text.toLowerCase());
}

export function readRuntimeSignal(messageContent: string) {
  return buildSocialSignal(messageContent.toLowerCase());
}
