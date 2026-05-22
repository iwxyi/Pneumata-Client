import { useMemo, useState } from 'react';
import { Box, Button, Chip, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AICharacter } from '../../types/character';
import type { MemoryItem } from '../../services/memoryTypes';
import { useSettingsStore } from '../../stores/useSettingsStore';
import SimpleBarChart from '../common/SimpleBarChart';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import PageSection from '../common/PageSection';
import StatChipRow from '../common/StatChipRow';
import { formatRelationshipNumber, normalizeCurrent } from '../../services/relationshipLedger';
import { useCharacterStore } from '../../stores/useCharacterStore';
import { RelationshipRadar } from '../controls/RelationshipPanel';
import type { RelationshipLedgerEntry } from '../../types/runtimeEvent';
import { applyDriftToBehavior, formatLocalizedDriftSummary, getDominantEmotionLabel, getAffectSummaryLines } from '../../services/personalityDrift';
import LayeredMemoryPanel from '../memory/LayeredMemoryPanel';
import { getPreferredAIProfile } from '../../types/settings';
import {
  buildCharacterExperienceArtifactContext,
  buildLocalCharacterExperienceArtifact,
  generateCharacterExperienceArtifact,
  type CharacterExperienceArtifactKind,
} from '../../services/characterExperienceArtifacts';
import { summarizeExpressionFeedbackInfluence } from '../../services/expressionFeedbackInfluence';
import { buildMemberInnerLifeChips } from '../../services/memberInnerLifePresentation';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';

function buildCharacterLayeredMemories(character: Partial<AICharacter>): MemoryItem[] {
  if (character.layeredMemories?.length) return character.layeredMemories;
  const now = Date.now();
  const items: MemoryItem[] = [];

  for (const item of character.memory?.longTerm || []) {
    items.push({ id: `lt-${item}`, scope: 'character_self', layer: 'long_term', kind: 'trait_evidence', ownerId: character.id || 'character', text: item, salience: 0.8, confidence: 0.75, recency: 0.7, reinforcementCount: 1, sourceEventIds: [], createdAt: now, updatedAt: now });
  }
  for (const item of character.memory?.obsessions || []) {
    items.push({ id: `obs-${item}`, scope: 'character_self', layer: 'long_term', kind: 'obsession', ownerId: character.id || 'character', text: item, salience: 0.85, confidence: 0.8, recency: 0.75, reinforcementCount: 1, sourceEventIds: [], createdAt: now, updatedAt: now });
  }
  for (const item of character.memory?.tabooTopics || []) {
    items.push({ id: `taboo-${item}`, scope: 'character_self', layer: 'long_term', kind: 'taboo', ownerId: character.id || 'character', text: item, salience: 0.8, confidence: 0.78, recency: 0.7, reinforcementCount: 1, sourceEventIds: [], createdAt: now, updatedAt: now });
  }
  for (const item of character.memory?.userMemories || []) {
    items.push({ id: `user-${item}`, scope: 'character_self', layer: 'episodic', kind: 'trait_evidence', ownerId: character.id || 'character', text: item, salience: 0.65, confidence: 0.7, recency: 0.8, reinforcementCount: 1, sourceEventIds: [], createdAt: now, updatedAt: now });
  }

  return items;
}

function buildRelationshipMemoryItems(character: Partial<AICharacter>): MemoryItem[] {
  const now = Date.now();
  return (character.relationships || []).slice(0, 8).map((relation, index) => ({
    id: `rel-${relation.characterId}-${index}`,
    scope: 'relationship',
    layer: 'episodic',
    kind: relation.warmth + relation.competence + relation.trust >= relation.threat + 12 ? 'bond' : 'resentment',
    ownerId: character.id || 'character',
    subjectIds: [character.id || 'character', relation.characterId],
    text: relation.note || relation.characterId,
    salience: 0.7,
    confidence: 0.72,
    recency: 0.75,
    reinforcementCount: 1,
    sourceEventIds: [],
    createdAt: relation.updatedAt || now,
    updatedAt: relation.updatedAt || now,
  }));
}

function getTraitLabel(key: string, language: string) {
  const isZh = language.startsWith('zh');
  const labels: Record<string, string> = {
    openness: isZh ? '开放性' : 'Openness',
    extroversion: isZh ? '外向性' : 'Extroversion',
    agreeableness: isZh ? '宜人性' : 'Agreeableness',
    neuroticism: isZh ? '神经质' : 'Neuroticism',
    humor: isZh ? '幽默感' : 'Humor',
    creativity: isZh ? '创造力' : 'Creativity',
    assertiveness: isZh ? '果断度' : 'Assertiveness',
    empathy: isZh ? '共情力' : 'Empathy',
    irritation: isZh ? '烦躁' : 'Irritation',
    affection: isZh ? '好感' : 'Affection',
    insecurity: isZh ? '不安' : 'Insecurity',
    excitement: isZh ? '兴奋' : 'Excitement',
    embarrassment: isZh ? '尴尬' : 'Embarrassment',
    proactivity: isZh ? '主动性' : 'Proactivity',
    aggressiveness: isZh ? '攻击性' : 'Aggressiveness',
    humorIntensity: isZh ? '幽默感' : 'Humor intensity',
    empathyLevel: isZh ? '共情度' : 'Empathy level',
    summarizing: isZh ? '总结倾向' : 'Summarizing',
    offTopic: isZh ? '跑题倾向' : 'Off-topic',
  };
  return labels[key] || key;
}

function describeDriftValue(key: string, value: number, language: string) {
  const isZh = language.startsWith('zh');
  const abs = Math.abs(value);
  if (abs < 2) return '';
  const intensity = abs >= 10 ? 'strong' : abs >= 5 ? 'mid' : 'low';
  const zhLabels: Record<string, { up: string; down: string }> = {
    openness: { up: intensity === 'strong' ? '明显更开放' : '更开放', down: intensity === 'strong' ? '明显更保守' : '更保守' },
    extroversion: { up: intensity === 'strong' ? '明显更外放' : '更外放', down: intensity === 'strong' ? '明显更收敛' : '更收敛' },
    agreeableness: { up: intensity === 'strong' ? '明显更好说话' : '更好说话', down: intensity === 'strong' ? '明显更不让步' : '更不让步' },
    neuroticism: { up: intensity === 'strong' ? '明显更敏感' : '更敏感', down: intensity === 'strong' ? '明显更稳定' : '更稳定' },
    humor: { up: intensity === 'strong' ? '明显更爱开玩笑' : '更爱开玩笑', down: intensity === 'strong' ? '明显更少玩笑' : '更少玩笑' },
    creativity: { up: intensity === 'strong' ? '明显更发散' : '更发散', down: intensity === 'strong' ? '明显更按部就班' : '更按部就班' },
    assertiveness: { up: intensity === 'strong' ? '明显更强势' : '更主动出击', down: intensity === 'strong' ? '明显更退让' : '更退让' },
    empathy: { up: intensity === 'strong' ? '明显更会接住别人' : '更会接住别人', down: intensity === 'strong' ? '明显更少共情' : '更少共情' },
  };
  const enLabels: Record<string, { up: string; down: string }> = {
    openness: { up: 'More open', down: 'More guarded' },
    extroversion: { up: 'More outgoing', down: 'More reserved' },
    agreeableness: { up: 'More agreeable', down: 'Less yielding' },
    neuroticism: { up: 'More sensitive', down: 'More steady' },
    humor: { up: 'More playful', down: 'Less playful' },
    creativity: { up: 'More divergent', down: 'More conventional' },
    assertiveness: { up: 'More assertive', down: 'More yielding' },
    empathy: { up: 'More empathetic', down: 'Less empathetic' },
  };
  const labels = isZh ? zhLabels : enLabels;
  const label = labels[key]?.[value > 0 ? 'up' : 'down'];
  return label || `${getTraitLabel(key, language)}${value > 0 ? '+' : ''}${value}`;
}

function buildDriftChips(drift: Partial<AICharacter['personality']>, language: string, developerMode: boolean) {
  return Object.entries(drift)
    .filter(([, value]) => typeof value === 'number' && Math.abs(value) >= 2)
    .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)))
    .slice(0, developerMode ? 6 : 3)
    .map(([key, value]) => developerMode
      ? `${getTraitLabel(key, language)} ${Number(value) > 0 ? '+' : ''}${value}`
      : describeDriftValue(key, Number(value), language))
    .filter(Boolean);
}

function describeEmotionValue(key: string, value: number, language: string) {
  const isZh = language.startsWith('zh');
  if (value < 12) return '';
  const intensity = value >= 58 ? 'high' : value >= 28 ? 'mid' : 'low';
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
  return (isZh ? zhLabels : enLabels)[key]?.[intensity] || `${getTraitLabel(key, language)} ${value}`;
}

function buildEmotionChips(character: Partial<AICharacter>, language: string) {
  const emotional = character.emotionalState;
  if (!emotional) return [];
  return [
    ['irritation', emotional.irritation],
    ['affection', emotional.affection],
    ['insecurity', emotional.insecurity],
    ['excitement', emotional.excitement],
    ['embarrassment', emotional.embarrassment],
  ]
    .map(([key, value]) => ({ key: String(key), value: Number(value) }))
    .filter((item) => item.value >= 12)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((item) => ({
      label: describeEmotionValue(item.key, item.value, language),
      hint: `${getTraitLabel(item.key, language)} ${item.value}`,
    }));
}

function EmotionPanel({ character, developerMode }: { character: Partial<AICharacter>; developerMode: boolean }) {
  const { i18n } = useTranslation();
  const emotional = character.emotionalState;
  if (!emotional) return <Typography variant="caption" color="text.secondary">{i18n.language.startsWith('zh') ? '暂无情绪轨迹' : 'No emotion trace yet'}</Typography>;
  const emotionChips = buildEmotionChips(character, i18n.language);
  if (!developerMode) {
    return emotionChips.length ? (
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
        {emotionChips.map((item) => (
          <Tooltip key={item.label} title={item.hint} arrow>
            <Chip size="small" label={item.label} variant="outlined" />
          </Tooltip>
        ))}
      </Stack>
    ) : <Typography variant="caption" color="text.secondary">{i18n.language.startsWith('zh') ? '情绪暂稳' : 'Emotion steady'}</Typography>;
  }
  return (
    <Stack spacing={1}>
      {[
        ['irritation', emotional.irritation],
        ['affection', emotional.affection],
        ['insecurity', emotional.insecurity],
        ['excitement', emotional.excitement],
        ['embarrassment', emotional.embarrassment],
      ].map(([key, value]) => (
        <Box key={String(key)}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{getTraitLabel(String(key), i18n.language)}</Typography>
            <Typography variant="caption" color="text.secondary">{value}</Typography>
          </Box>
          <LinearProgress variant="determinate" value={Number(value)} sx={{ height: 5, borderRadius: 999 }} />
        </Box>
      ))}
    </Stack>
  );
}

function getInnerImpulseLabel(impulse: NonNullable<AICharacter['soulState']>['lastImpulse'] | undefined, language: string) {
  const isZh = language.startsWith('zh');
  const labels: Record<string, string> = {
    answer: isZh ? '回应' : 'Answer',
    show_off: isZh ? '表现' : 'Show',
    defend_face: isZh ? '护住面子' : 'Save face',
    seek_attention: isZh ? '想被看见' : 'Seeking notice',
    comfort: isZh ? '接住对方' : 'Comfort',
    repair: isZh ? '别扭找补' : 'Repair',
    mock: isZh ? '带刺调侃' : 'Tease',
    avoid: isZh ? '回避' : 'Avoid',
    change_topic: isZh ? '转开话题' : 'Change topic',
    stay_silent: isZh ? '沉默' : 'Silent',
    send_emoji: isZh ? '用表情代替话' : 'Emoji',
    withdraw: isZh ? '想撤回' : 'Withdraw',
  };
  return impulse ? labels[impulse] || impulse : (isZh ? '尚未形成明显冲动' : 'No clear impulse yet');
}

function buildSoulSummary(character: Partial<AICharacter>, language: string) {
  const soul = character.soulState;
  const isZh = language.startsWith('zh');
  if (!soul) {
    return isZh
      ? '这个角色还没有留下足够的运行痕迹。等它经历几轮被回应、被忽视、靠近或退让后，内心残响会开始浮现。'
      : 'This character has not left enough runtime traces yet.';
  }
  if (soul.lastImpulse === 'repair') return isZh ? '刚才的话留下了一点余波，它有想靠近、找补，又不愿说得太软的冲动。' : 'A recent edge left residue; it wants to repair without sounding too soft.';
  if (soul.lastImpulse === 'seek_attention') return isZh ? '它有点想被看见，但更可能绕着说，用玩笑或半句话试探有没有人接住。' : 'It wants to be noticed, likely through a joke or sideways remark.';
  if (soul.lastImpulse === 'defend_face') return isZh ? '面子风险正在上升，它可能先嘴硬、岔开，或把真正想说的话压回去。' : 'Face pressure is rising; it may dodge, harden, or swallow words.';
  if (soul.lastImpulse === 'comfort') return isZh ? '它对房间仍有安全感，倾向笨拙但认真地接住别人。' : 'It still trusts the room enough to offer clumsy care.';
  if (soul.lastImpulse === 'mock') return isZh ? '关系里有一点刺感，它可能用调侃和反驳保持距离。' : 'There is a relational edge, so teasing may become distance.';
  if (soul.lastImpulse === 'avoid') return isZh ? '此刻能量或安全感偏低，它更可能短句、旁观，或者先退一步。' : 'Low energy or safety makes it more likely to step back.';
  if (soul.trustInRoom >= 58 && soul.loneliness < 45) return isZh ? '它暂时还相信这个房间，表达会更松一点，也更容易留下温和的余地。' : 'It still trusts the room and can speak with more ease.';
  return isZh ? '它还没有强烈冲动，更多是在观察房间里的关系和话题如何继续。' : 'No strong impulse; it is watching how the room continues.';
}

function soulMetricValue(value: number, canBeNegative = false) {
  if (!canBeNegative) return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return Math.max(0, Math.min(100, ((Number.isFinite(value) ? value : 0) + 100) / 2));
}

function SoulMetricRow({ label, value, hint, canBeNegative = false }: { label: string; value: number; hint: string; canBeNegative?: boolean }) {
  return (
    <Tooltip title={hint} arrow placement="top">
      <Box sx={{ cursor: 'help', '&:hover .soul-metric-label': { textDecoration: 'underline' } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
          <Typography className="soul-metric-label" variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="caption" color="text.secondary">{Math.round(value)}</Typography>
        </Box>
        <LinearProgress variant="determinate" value={soulMetricValue(value, canBeNegative)} sx={{ height: 5, borderRadius: 999 }} />
      </Box>
    </Tooltip>
  );
}

function SoulStatePanel({ character, developerMode }: { character: Partial<AICharacter>; developerMode: boolean }) {
  const { i18n } = useTranslation();
  const soul = character.soulState;
  const isZh = i18n.language.startsWith('zh');
  const summary = buildSoulSummary(character, i18n.language);
  const chips = soul ? [
    getInnerImpulseLabel(soul.lastImpulse, i18n.language),
    soul.ignoredStreak >= 2 ? (isZh ? '有未被接住的余波' : 'Unanswered residue') : '',
    soul.repression >= 56 ? (isZh ? '话被压住' : 'Suppressed words') : '',
    soul.trustInRoom >= 58 ? (isZh ? '仍有安全感' : 'Room feels safe') : '',
  ].filter(Boolean) : [isZh ? '等待经历' : 'Waiting for traces'];
  return (
    <SurfaceCard>
      <SectionHeader title={isZh ? '内心残响' : 'Inner Residue'} dense action={developerMode ? <Chip size="small" label={isZh ? '调试' : 'Debug'} color="warning" variant="outlined" /> : undefined} />
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">{summary}</Typography>
        <StatChipRow items={chips} />
        {soul?.lastImpulseReason ? (
          <Tooltip title={isZh ? `最近依据：${soul.lastImpulseReason}` : `Reason: ${soul.lastImpulseReason}`} arrow placement="top">
            <Typography variant="caption" color="text.secondary" sx={{ width: 'fit-content', cursor: 'help', '&:hover': { textDecoration: 'underline' } }}>
              {isZh ? '查看形成原因' : 'View reason'}
            </Typography>
          </Tooltip>
        ) : null}
        {developerMode && soul ? (
          <Stack spacing={0.8} sx={{ pt: 0.5 }}>
            <SoulMetricRow label={isZh ? '心境' : 'Mood'} value={soul.mood?.pleasure || 0} canBeNegative hint={isZh ? '心境来自情绪、关系安全感和近期回应，不代表固定性格。' : 'Mood is projected from emotion, safety, and recent response.'} />
            <SoulMetricRow label={isZh ? '能量' : 'Energy'} value={soul.energy} hint={isZh ? '决定它更愿意主动发言，还是短句、旁观、停顿。' : 'Whether it tends to speak up or stay brief.'} />
            <SoulMetricRow label={isZh ? '孤独感' : 'Loneliness'} value={soul.loneliness} hint={isZh ? '来自最近发言是否被接住，用来模拟想被看见的冲动。' : 'Derived from whether recent speech was answered.'} />
            <SoulMetricRow label={isZh ? '压抑感' : 'Repression'} value={soul.repression} hint={isZh ? '表示有些话被压住，可能转化为迟疑、刺感或找补。' : 'Suppressed words may leak as hesitation, edge, or repair.'} />
            <SoulMetricRow label={isZh ? '房间安全感' : 'Room safety'} value={soul.trustInRoom} hint={isZh ? '角色对当前群聊氛围的安全判断，会影响是否露出柔软面。' : 'How safe the room feels for this character.'} />
          </Stack>
        ) : null}
      </Stack>
    </SurfaceCard>
  );
}

function clipRuntimeText(text: string, max = 72) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function relationshipLevel(value: number) {
  const abs = Math.abs(value);
  if (abs >= 60) return value < 0 ? '很低' : '很强';
  if (abs >= 32) return value < 0 ? '偏低' : '偏高';
  if (abs >= 8) return value < 0 ? '略低' : '略高';
  return '';
}

function buildRelationshipReadableChips(relation: NonNullable<AICharacter['relationships']>[number]) {
  const dimensions = [
    { label: '亲和', value: Number.isFinite(relation.warmth) ? relation.warmth : 0, threshold: 8 },
    { label: '能力判断', value: Number.isFinite(relation.competence) ? relation.competence : 0, threshold: 8 },
    { label: '信任', value: Number.isFinite(relation.trust) ? relation.trust : 0, threshold: 8 },
    { label: '威胁感', value: Number.isFinite(relation.threat) ? relation.threat : 0, threshold: 12 },
  ];
  const visible = dimensions
    .filter((item) => Math.abs(item.value) >= item.threshold)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((item) => `${item.label}${relationshipLevel(item.value)}`);
  return visible.length ? visible : ['关系仍在形成'];
}

function buildRelationshipDebugChips(relation: NonNullable<AICharacter['relationships']>[number]) {
  return [
    `亲和 ${formatRelationshipNumber(Number.isFinite(relation.warmth) ? relation.warmth : 0)}`,
    `能力 ${formatRelationshipNumber(Number.isFinite(relation.competence) ? relation.competence : 0)}`,
    `信任 ${formatRelationshipNumber(Number.isFinite(relation.trust) ? relation.trust : 0)}`,
    `威胁 ${formatRelationshipNumber(Number.isFinite(relation.threat) ? relation.threat : 0)}`,
  ];
}

function buildRelationshipDebugHint(relation: NonNullable<AICharacter['relationships']>[number]) {
  return buildRelationshipDebugChips(relation).join(' / ');
}

function getStrongestRelationship(character: Partial<AICharacter>, resolveCharacterName: (id: string, fallback?: string) => string) {
  const relation = (character.relationships || [])
    .slice()
    .sort((a, b) => {
      const score = (entry: NonNullable<AICharacter['relationships']>[number]) => Math.abs(entry.warmth || 0) + Math.abs(entry.trust || 0) + Math.abs(entry.threat || 0) + Math.abs(entry.competence || 0) * 0.5;
      return score(b) - score(a);
    })[0];
  if (!relation) return null;
  const dominant = [
    { label: '亲和', value: relation.warmth || 0 },
    { label: '信任', value: relation.trust || 0 },
    { label: '威胁感', value: relation.threat || 0 },
    { label: '能力判断', value: relation.competence || 0 },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const level = relationshipLevel(dominant.value);
  return `${resolveCharacterName(relation.characterId, relation.note)} · ${dominant.label}${level || '有变化'}`;
}

function SoulOverviewPanel({
  character,
  resolveCharacterName,
  developerMode,
}: {
  character: Partial<AICharacter>;
  resolveCharacterName: (id: string, fallback?: string) => string;
  developerMode: boolean;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const soulChips = character.id ? buildMemberInnerLifeChips(character as AICharacter, i18n.language).map((item) => item.label) : [];
  const relationship = getStrongestRelationship(character, resolveCharacterName);
  const memoryCount = (character.layeredMemories || []).filter((item) => !item.archivedAt).length;
  const feedbackSignals = summarizeExpressionFeedbackInfluence(character.layeredMemories || []).filter((signal) => signal.strength > 0.08).slice(0, 2);
  const core = character.coreProfile;
  const coreLine = [core?.coreDesire, core?.coreFear ? `${isZh ? '怕' : 'Fears'} ${core.coreFear}` : '', core?.socialMask ? `${isZh ? '面具' : 'Mask'} ${core.socialMask}` : ''].filter(Boolean).join(' / ');
  const chips = [
    ...soulChips,
    relationship ? `${isZh ? '牵挂' : 'Tie'} ${relationship}` : '',
    memoryCount ? `${isZh ? '记忆' : 'Memory'} ${memoryCount}` : '',
    ...feedbackSignals.map((signal) => `${signal.label} ${Math.round(signal.strength * 100)}%`),
  ].filter(Boolean);
  return (
    <SurfaceCard>
      <SectionHeader title={isZh ? '灵魂概览' : 'Soul Overview'} dense action={developerMode ? <Chip size="small" label={isZh ? '调试' : 'Debug'} color="warning" variant="outlined" /> : undefined} />
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {clipRuntimeText(buildSoulSummary(character, i18n.language), 108)}
        </Typography>
        {chips.length ? <StatChipRow items={chips} /> : <Typography variant="caption" color="text.secondary">{isZh ? '还没有足够的关系、记忆或内心痕迹。' : 'Not enough relationship, memory, or inner traces yet.'}</Typography>}
        {coreLine ? (
          <Tooltip title={coreLine} arrow>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', width: 'fit-content', cursor: 'help', '&:hover': { textDecoration: 'underline' } }}>
              {isZh ? '核心画像' : 'Core profile'}：{clipRuntimeText(coreLine, 76)}
            </Typography>
          </Tooltip>
        ) : null}
        {developerMode && feedbackSignals.length ? (
          <Typography variant="caption" color="text.secondary">
            {feedbackSignals.map((signal) => `${signal.label}：负向 ${signal.negativeCount} / 正向 ${signal.positiveCount} / 强度 ${Math.round(signal.strength * 100)}%`).join('；')}
          </Typography>
        ) : null}
      </Stack>
    </SurfaceCard>
  );
}

function RuntimeTimelinePanel({
  filteredTimeline,
  developerMode,
  members = [],
}: {
  filteredTimeline: Array<{ type: 'memory' | 'relationship' | 'drift'; text: string; createdAt: number }>;
  developerMode: boolean;
  members?: Array<{ id: string; name?: string }>;
}) {
  return filteredTimeline.length ? (
    <Stack spacing={0.85}>
      {filteredTimeline.slice().reverse().slice(0, developerMode ? 8 : 5).map((item, index) => (
        <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
          {developerMode ? <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography> : null}
          <Typography variant="body2">{sanitizeUserFacingText(item.text, members)}</Typography>
        </Box>
      ))}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">{developerMode ? '当前筛选下暂无时间线数据' : '当前暂无关键变化'}</Typography>;
}

function RelationshipGraphPanel({ relationships, developerMode, resolveCharacterName }: { relationships: NonNullable<AICharacter['relationships']>; developerMode: boolean; resolveCharacterName: (id: string, fallback?: string) => string }) {
  return relationships.length ? (
    <Stack spacing={1}>
      {relationships.slice(0, developerMode ? 8 : 4).map((relation, index) => {
        const radarEntry: RelationshipLedgerEntry = {
          pairKey: `character:${relation.characterId}`,
          actorId: 'character',
          targetId: relation.characterId,
          current: normalizeCurrent({
            warmth: Number.isFinite(relation.warmth) ? relation.warmth : 0,
            competence: Number.isFinite(relation.competence) ? relation.competence : 0,
            trust: Number.isFinite(relation.trust) ? relation.trust : 0,
            threat: Number.isFinite(relation.threat) ? relation.threat : 0,
          }),
          derived: {},
          axisReasons: {},
          trend: 'flat',
          recentEvents: [],
          lastUpdatedAt: relation.updatedAt || Date.now(),
        };
        return (
          <Box key={`${relation.characterId}-graph-${index}`} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 1.1, alignItems: 'center' }}>
              <RelationshipRadar entry={radarEntry} onOpenAxis={() => undefined} compact />
              <Stack spacing={0.6} sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{resolveCharacterName(relation.characterId, relation.note)}</Typography>
                <Tooltip title={buildRelationshipDebugHint(relation)} arrow>
                  <Box sx={{ width: 'fit-content' }}>
                    <StatChipRow items={developerMode ? buildRelationshipDebugChips(relation) : buildRelationshipReadableChips(relation)} />
                  </Box>
                </Tooltip>
              </Stack>
            </Box>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>;
}

function RelationshipOverviewPanel({
  relationships,
  relationshipMemories,
  resolveCharacterName,
  developerMode,
  members,
}: {
  relationships: NonNullable<AICharacter['relationships']>;
  relationshipMemories: MemoryItem[];
  resolveCharacterName: (id: string, fallback?: string) => string;
  developerMode: boolean;
  members: AICharacter[];
}) {
  const memoryByTarget = new Map(relationshipMemories.map((item) => [item.subjectIds?.[1] || '', item]));
  return relationships.length ? (
    <Stack spacing={1}>
      {relationships.slice(0, 8).map((relation, index) => {
        const radarEntry: RelationshipLedgerEntry = {
          pairKey: `character:${relation.characterId}`,
          actorId: 'character',
          targetId: relation.characterId,
          current: normalizeCurrent({
            warmth: Number.isFinite(relation.warmth) ? relation.warmth : 0,
            competence: Number.isFinite(relation.competence) ? relation.competence : 0,
            trust: Number.isFinite(relation.trust) ? relation.trust : 0,
            threat: Number.isFinite(relation.threat) ? relation.threat : 0,
          }),
          derived: {},
          axisReasons: {},
          trend: 'flat',
          recentEvents: [],
          lastUpdatedAt: relation.updatedAt || Date.now(),
        };
        const memory = memoryByTarget.get(relation.characterId);
        return (
          <Box key={`${relation.characterId}-overview-${index}`} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 1.1, alignItems: 'center' }}>
              <RelationshipRadar entry={radarEntry} onOpenAxis={() => undefined} compact />
              <Stack spacing={0.6} sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{resolveCharacterName(relation.characterId, relation.note)}</Typography>
                <Tooltip title={buildRelationshipDebugHint(relation)} arrow>
                  <Box sx={{ width: 'fit-content' }}>
                    <StatChipRow items={buildRelationshipReadableChips(relation)} />
                  </Box>
                </Tooltip>
                {relation.note && relation.note !== relation.characterId ? <Typography variant="body2" color="text.secondary">{sanitizeUserFacingText(relation.note, members)}</Typography> : null}
                {memory ? (
                  <Tooltip title={sanitizeUserFacingText(memory.evidenceText || memory.text, members)} arrow>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 'fit-content', cursor: 'help', '&:hover': { textDecoration: 'underline' } }}>
                      {developerMode ? `强化 ${memory.reinforcementCount} · 置信 ${(memory.confidence * 100).toFixed(0)}%` : '有记忆沉淀'}
                    </Typography>
                  </Tooltip>
                ) : null}
              </Stack>
            </Box>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系数据</Typography>;
}

const EXPERIENCE_ARTIFACT_TABS: Array<{ key: CharacterExperienceArtifactKind; label: string }> = [
  { key: 'birth_letter', label: '诞生' },
  { key: 'diary', label: '日记' },
  { key: 'growth', label: '成长' },
  { key: 'final_letter', label: '信' },
];

function CharacterExperienceArtifactPanel({ character, relatedCharacters }: { character: Partial<AICharacter>; relatedCharacters: AICharacter[] }) {
  const { i18n } = useTranslation();
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);
  const selectedProfile = useMemo(() => getPreferredAIProfile(aiProfiles, 'text') || aiProfiles[0] || null, [aiProfiles]);
  const [kind, setKind] = useState<CharacterExperienceArtifactKind>('diary');
  const [generatedTexts, setGeneratedTexts] = useState<Partial<Record<CharacterExperienceArtifactKind, string>>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useMemo(() => buildCharacterExperienceArtifactContext(character, relatedCharacters), [character, relatedCharacters]);
  const localPreview = useMemo(() => buildLocalCharacterExperienceArtifact(kind, context), [kind, context]);
  const hasGeneratedText = Boolean(generatedTexts[kind]);
  const displayedText = generatedTexts[kind] || localPreview;
  const canGenerate = Boolean(selectedProfile?.apiKey && selectedProfile?.model);

  const handleGenerate = async () => {
    if (!selectedProfile || !canGenerate) return;
    setGenerating(true);
    setError(null);
    try {
      const text = await generateCharacterExperienceArtifact({
        config: selectedProfile,
        kind,
        character,
        relatedCharacters,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
      });
      setGeneratedTexts((prev) => ({ ...prev, [kind]: text.trim() || localPreview }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SurfaceCard>
      <SectionHeader
        title="角色经历"
        dense
        action={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Button size="small" variant="text" disabled={!canGenerate || generating} onClick={handleGenerate}>{generating ? '生成中' : '生成'}</Button>
            <Chip size="small" label="调试" color="warning" variant="outlined" />
          </Box>
        )}
      />
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {EXPERIENCE_ARTIFACT_TABS.map((tab) => (
            <Chip
              key={tab.key}
              size="small"
              label={tab.label}
              color={kind === tab.key ? 'primary' : 'default'}
              variant={kind === tab.key ? 'filled' : 'outlined'}
              onClick={() => setKind(tab.key)}
            />
          ))}
        </Box>
        <Box sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
          <Typography variant="body2" color={hasGeneratedText ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'pre-wrap' }}>{displayedText}</Typography>
        </Box>
        {error ? <Typography variant="caption" color="error">{error}</Typography> : null}
      </Stack>
    </SurfaceCard>
  );
}

interface RuntimeInsightsPanelProps {
  character: Partial<AICharacter>;
}

export function CharacterMemoryInspector({ character }: RuntimeInsightsPanelProps) {
  const allLayeredMemories = useMemo(() => buildCharacterLayeredMemories(character), [character]);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const includeRuntimeEvidence = developerMode && Boolean(showDeveloperMemory);

  return (
    <PageSection spacing={2}>
      <LayeredMemoryPanel memories={allLayeredMemories} includeRuntimeEvidence={includeRuntimeEvidence} />
    </PageSection>
  );
}

export function CharacterRelationshipInspector({ character }: RuntimeInsightsPanelProps) {
  const characters = useCharacterStore((state) => state.characters);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory);
  const relationships = character.relationships || [];
  const resolveCharacterName = useMemo(() => {
    const byId = new Map(characters.map((item) => [item.id, item.name]));
    return (id: string, fallback?: string) => {
      const matched = byId.get(id);
      if (matched) return matched;
      if (fallback && fallback !== id) return fallback;
      return id.startsWith('draft-') ? '未命名关系' : `角色 ${id.slice(0, 6)}`;
    };
  }, [characters]);
  const relationshipMemories = useMemo(() => {
    const items = buildRelationshipMemoryItems(character).map((item) => ({
      ...item,
      text: resolveCharacterName(item.subjectIds?.[1] || '', item.text),
    }));
    return items.slice(0, 8);
  }, [character, resolveCharacterName]);

  return (
    <PageSection spacing={2}>
      <SurfaceCard>
        <SectionHeader title="关系概览" dense />
        <RelationshipOverviewPanel relationships={relationships} relationshipMemories={relationshipMemories} resolveCharacterName={resolveCharacterName} developerMode={isDeveloperView} members={characters} />
      </SurfaceCard>
    </PageSection>
  );
}

export default function RuntimeInsightsPanel({ character }: RuntimeInsightsPanelProps) {
  const { i18n } = useTranslation();
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'memory' | 'relationship' | 'drift'>('all');
  const characters = useCharacterStore((state) => state.characters);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory);
  const relationships = character.relationships || [];
  const resolveCharacterName = useMemo(() => {
    const byId = new Map(characters.map((item) => [item.id, item.name]));
    return (id: string, fallback?: string) => {
      const matched = byId.get(id);
      if (matched) return matched;
      if (fallback && fallback !== id) return fallback;
      return id.startsWith('draft-') ? '未命名关系' : `角色 ${id.slice(0, 6)}`;
    };
  }, [characters]);
  const behavior = character.behavior;
  const personalityDrift = character.personalityDrift || {};
  const effectiveBehavior = useMemo(
    () => (character.behavior ? applyDriftToBehavior(character as AICharacter) : null),
    [character]
  );
  const timeline = useMemo(() => character.runtimeTimeline || [
    ...relationships.slice(-3).map((relation) => ({ type: 'relationship' as const, text: `${relation.note || relation.characterId} · ${relation.updatedAt ? new Date(relation.updatedAt).toLocaleString() : '最近更新'}`, createdAt: relation.updatedAt || Date.now() })),
    ...(formatLocalizedDriftSummary(personalityDrift, i18n.language) ? [{ type: 'drift' as const, text: formatLocalizedDriftSummary(personalityDrift, i18n.language), createdAt: Date.now() }] : []),
  ], [character.runtimeTimeline, relationships, personalityDrift]);
  const filteredTimeline = timelineFilter === 'all' ? timeline : timeline.filter((item) => item.type === timelineFilter);
  const dominantEmotionLabel = getDominantEmotionLabel(character.emotionalState, i18n.language);
  const runtimeSummaryItems = [
    relationships[0] ? `关系 ${relationships[0].warmth + relationships[0].competence + relationships[0].trust >= relationships[0].threat + 12 ? '升温' : '紧张'}` : '',
    ...buildDriftChips(personalityDrift, i18n.language, isDeveloperView).slice(0, 1),
    dominantEmotionLabel ? `情绪 ${dominantEmotionLabel}` : '',
  ].filter(Boolean);
  const behaviorFormulaHints = useMemo(() => {
    const drift = personalityDrift || {};
    const d = (key: string) => Number(drift[key as keyof typeof drift] || 0);
    const isZh = i18n.language.startsWith('zh');
    const fmt = (value: number) => (value > 0 ? `+${value}` : `${value}`);
    return {
      proactivity: isZh
        ? `主动性 = 基础值 + 外向性×0.6 + 果断度×0.35\n当前值：${fmt(Math.round(d('extroversion') * 0.6))} + ${fmt(Math.round(d('assertiveness') * 0.35))}`
        : `Proactivity = base + extroversion×0.6 + assertiveness×0.35\nCurrent: ${fmt(Math.round(d('extroversion') * 0.6))} + ${fmt(Math.round(d('assertiveness') * 0.35))}`,
      aggressiveness: isZh
        ? `攻击性 = 基础值 + 敏感度×0.5 + 果断度×0.3\n当前值：${fmt(Math.round(d('neuroticism') * 0.5))} + ${fmt(Math.round(d('assertiveness') * 0.3))}`
        : `Aggressiveness = base + neuroticism×0.5 + assertiveness×0.3\nCurrent: ${fmt(Math.round(d('neuroticism') * 0.5))} + ${fmt(Math.round(d('assertiveness') * 0.3))}`,
      humorIntensity: isZh
        ? `幽默感 = 基础值 + 幽默×0.45 + 创造力×0.25\n当前值：${fmt(Math.round(d('humor') * 0.45))} + ${fmt(Math.round(d('creativity') * 0.25))}`
        : `Humor = base + humor×0.45 + creativity×0.25\nCurrent: ${fmt(Math.round(d('humor') * 0.45))} + ${fmt(Math.round(d('creativity') * 0.25))}`,
      empathyLevel: isZh
        ? `共情度 = 基础值 + 共情力×0.8 + 宜人性×0.35\n当前值：${fmt(Math.round(d('empathy') * 0.8))} + ${fmt(Math.round(d('agreeableness') * 0.35))}`
        : `Empathy = base + empathy×0.8 + agreeableness×0.35\nCurrent: ${fmt(Math.round(d('empathy') * 0.8))} + ${fmt(Math.round(d('agreeableness') * 0.35))}`,
      summarizing: isZh
        ? `总结倾向 = 基础值 + 开放性×0.35\n当前值：${fmt(Math.round(d('openness') * 0.35))}`
        : `Summarizing = base + openness×0.35\nCurrent: ${fmt(Math.round(d('openness') * 0.35))}`,
      offTopic: isZh
        ? `跑题倾向 = 基础值 + 开放性×0.25 + 创造力×0.2\n当前值：${fmt(Math.round(d('openness') * 0.25))} + ${fmt(Math.round(d('creativity') * 0.2))}`
        : `Off-topic = base + openness×0.25 + creativity×0.2\nCurrent: ${fmt(Math.round(d('openness') * 0.25))} + ${fmt(Math.round(d('creativity') * 0.2))}`,
    } as Record<string, string>;
  }, [i18n.language, personalityDrift]);

  const behaviorChartItems = useMemo(
    () => Object.entries(effectiveBehavior || behavior || {}).map(([key, value]) => ({
      label: getTraitLabel(key, i18n.language),
      value: Number(value),
      hint: behaviorFormulaHints[key] || undefined,
    })),
    [behavior, behaviorFormulaHints, effectiveBehavior, i18n.language]
  );
  const runtimeAffectHints = getAffectSummaryLines(character as AICharacter, i18n.language).slice(0, isDeveloperView ? 4 : 2);
  const hasRuntimeSummary = runtimeSummaryItems.length > 0;

  return (
    <PageSection spacing={2}>
      <SoulOverviewPanel character={character} resolveCharacterName={resolveCharacterName} developerMode={isDeveloperView} />

      <SurfaceCard>
        <SectionHeader title="运行态观察" dense action={isDeveloperView ? <Chip size="small" label="调试" color="warning" variant="outlined" /> : undefined} />
        {hasRuntimeSummary ? <Box sx={{ mt: 0.5 }}><StatChipRow items={runtimeSummaryItems} /></Box> : <Typography variant="caption" color="text.secondary">暂无运行态观察结果</Typography>}
      </SurfaceCard>

      <SoulStatePanel character={character} developerMode={isDeveloperView} />

      <SurfaceCard>
        <SectionHeader title="情绪状态" dense action={isDeveloperView && runtimeAffectHints.length ? <Chip size="small" label="变化" color="warning" variant="outlined" /> : undefined} />
        <Stack spacing={1}>
          <EmotionPanel character={character} developerMode={isDeveloperView} />
          {isDeveloperView && runtimeAffectHints.length ? <StatChipRow items={runtimeAffectHints} /> : null}
        </Stack>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="行为 / 漂移" dense />
        <Stack spacing={1.25}>
          {isDeveloperView ? (
            <SimpleBarChart
              title={i18n.language.startsWith('zh') ? '行为强度' : 'Behavior intensity'}
              items={behaviorChartItems}
            />
          ) : null}
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" color="text.primary" sx={{ fontWeight: 700 }}>
              {i18n.language.startsWith('zh') ? '人格漂移' : 'Personality drift'}
            </Typography>
            {Object.keys(personalityDrift).length
              ? <StatChipRow items={buildDriftChips(personalityDrift, i18n.language, isDeveloperView)} />
              : <Typography variant="caption" color="text.secondary">{i18n.language.startsWith('zh') ? '暂无显著漂移' : 'No significant drift yet'}</Typography>}
          </Stack>
        </Stack>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="运行时间线" dense action={<StatChipRow items={[viewMode === 'timeline' ? '时间线' : '关系图谱']} />} />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.25 }}>
          <Chip size="small" label="时间线" color={viewMode === 'timeline' ? 'primary' : 'default'} variant={viewMode === 'timeline' ? 'filled' : 'outlined'} onClick={() => setViewMode('timeline')} />
          <Chip size="small" label="关系图谱" color={viewMode === 'graph' ? 'primary' : 'default'} variant={viewMode === 'graph' ? 'filled' : 'outlined'} onClick={() => setViewMode('graph')} />
        </Box>
        {viewMode === 'timeline' ? (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
              {[
                ['all', '全部'],
                ['memory', '记忆'],
                ['relationship', '关系'],
                ['drift', '漂移'],
              ].map(([value, label]) => (
                <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'memory' | 'relationship' | 'drift')} />
              ))}
            </Box>
            <RuntimeTimelinePanel filteredTimeline={filteredTimeline} developerMode={isDeveloperView} members={characters} />
          </>
        ) : (
          <RelationshipGraphPanel relationships={relationships} developerMode={isDeveloperView} resolveCharacterName={resolveCharacterName} />
        )}
      </SurfaceCard>

      {developerMode ? <CharacterExperienceArtifactPanel character={character} relatedCharacters={characters} /> : null}
    </PageSection>
  );
}
