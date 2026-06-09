import { useMemo, useState } from 'react';
import { Box, Button, Chip, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { MemoryItem } from '../../services/memoryTypes';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useChatStore } from '../../stores/useChatStore';
import { useMessageStore } from '../../stores/useMessageStore';
import SimpleBarChart from '../common/SimpleBarChart';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import PageSection from '../common/PageSection';
import StatChipRow from '../common/StatChipRow';
import DebugChip from '../common/DebugChip';
import { formatRelationshipNumber } from '../../services/relationshipLedger';
import { useCharacterStore } from '../../stores/useCharacterStore';
import { applyDriftToBehavior, formatLocalizedDriftSummary, getDominantEmotionLabel, getAffectSummaryLines, formatEmotionStateLabel } from '../../services/personalityDrift';
import LayeredMemoryPanel from '../memory/LayeredMemoryPanel';
import { getPreferredAIProfile } from '../../types/settings';
import {
  buildCharacterExperienceArtifactContext,
  buildCharacterFinalLetterContext,
  buildLocalCharacterExperienceArtifact,
  generateCharacterExperienceArtifact,
  type CharacterExperienceArtifactKind,
} from '../../services/characterExperienceArtifacts';
import { summarizeExpressionFeedbackInfluence } from '../../services/expressionFeedbackInfluence';
import { buildMemberInnerLifeChips } from '../../services/memberInnerLifePresentation';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { formatInnerImpulseLabel } from '../../services/runtimeDecisionLabels';
import { buildCharacterCompanionshipStates, buildCompanionshipRuntimeTrace, buildCompanionshipStatusSignature, buildRitualRegistry, buildSharedMemoryAnchors, buildSharedSecrets, buildUserCompanionshipProjection } from '../../services/companionshipProjection';
import type { Message } from '../../types/message';
import type { CharacterCompanionshipState, CompanionshipPhase, CompanionshipRuntimeTrace, CompanionshipStyle, PendingCareTopic, PendingPromise, RitualRegistryEntry, SharedMemoryAnchor, SharedSecret, UserProfileMemoryEventItem, UserProfileMemoryKind } from '../../types/companionship';
import type { RuntimeEventV2 } from '../../types/runtimeEvent';

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

function recentByTime<T extends { lastMessageAt?: number; updatedAt?: number; createdAt?: number }>(items: T[], limit: number) {
  return items.slice().sort((a, b) => (b.lastMessageAt || b.updatedAt || b.createdAt || 0) - (a.lastMessageAt || a.updatedAt || a.createdAt || 0)).slice(0, limit);
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
      label: formatEmotionStateLabel(item.key, item.value, language),
      hint: `${getTraitLabel(item.key, language)} ${item.value}`,
    }));
}

function EmotionPanel({ character, developerMode, emotionChips }: { character: Partial<AICharacter>; developerMode: boolean; emotionChips: Array<{ label: string; hint: string }> }) {
  const { i18n } = useTranslation();
  const emotional = character.emotionalState;
  if (!emotional) return <Typography variant="caption" color="text.secondary">{i18n.language.startsWith('zh') ? '暂无情绪轨迹' : 'No emotion trace yet'}</Typography>;
  if (!developerMode) {
    return emotionChips.length ? (
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
        {emotionChips.map((item) => (
          <Tooltip key={item.label} title={item.hint} arrow>
            <Chip size="small" label={item.label} variant="outlined" />
          </Tooltip>
        ))}
      </Stack>
    ) : null;
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
  if (!impulse) return language.startsWith('zh') ? '尚未形成明显冲动' : 'No clear impulse yet';
  return formatInnerImpulseLabel(impulse, language, 'insight');
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
      <SectionHeader title={isZh ? '内心残响' : 'Inner Residue'} dense action={developerMode ? <DebugChip /> : undefined} />
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

function buildManualCompanionshipEventId(parts: Array<string | number | undefined>) {
  const now = Date.now();
  const source = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `evt_${now}_${hash.toString(36)}`;
}

function buildManualCareTopicBlockedEvent(chat: GroupChat, character: AICharacter, topic: PendingCareTopic): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, topic.id, 'care-blocked']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户关闭了一个关心事项提醒`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_care_topic',
      characterId: character.id,
      userId: 'user',
      topicId: topic.id,
      topicText: topic.text,
      action: 'blocked',
      urgency: topic.urgency,
      reason: '用户在角色关系页手动关闭该关心事项。',
      evidence: 'manual_close_from_character_relationship_tab',
      confidence: 1,
    },
  };
}

function buildManualPromiseRevokedEvent(chat: GroupChat, character: AICharacter, promise: PendingPromise): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, promise.id, 'promise-revoked']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户关闭了一个未完成约定`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_promise',
      characterId: character.id,
      userId: 'user',
      promiseId: promise.id,
      promiseText: promise.text,
      action: 'revoked',
      participantIds: promise.participantIds?.length ? promise.participantIds : [character.id, 'user'],
      reason: '用户在角色关系页手动关闭该约定追踪。',
      evidence: 'manual_close_from_character_relationship_tab',
      confidence: 1,
    },
  };
}

function buildManualAddressingEvent(chat: GroupChat, character: AICharacter, action: 'forbid' | 'unforbid', address: string): RuntimeEventV2 {
  const now = Date.now();
  const normalized = address.replace(/\s+/g, '').trim();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, normalized, `addressing-${action}`]),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: action === 'forbid'
      ? `${character.name} 记录用户禁用了一个称呼`
      : `${character.name} 记录用户恢复了一个称呼`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_addressing',
      characterId: character.id,
      userId: 'user',
      action,
      currentAddress: normalized,
      forbiddenAddresses: [normalized],
      reason: action === 'forbid'
        ? '用户在角色关系页手动禁用该称呼。'
        : '用户在角色关系页手动解除禁用该称呼。',
      evidence: 'manual_addressing_update_from_character_relationship_tab',
      initiatedBy: 'user',
      confidence: 1,
    },
  };
}

function buildManualIntimateConflictResolvedEvent(chat: GroupChat, character: AICharacter, conflict: NonNullable<CompanionshipRuntimeTrace['intimateConflict']>): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, conflict.kind, 'intimate-conflict-resolved']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户标记亲密冲突已修复`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_intimate_conflict',
      characterId: character.id,
      userId: 'user',
      action: 'resolved',
      kind: 'reconciliation',
      severity: Math.min(24, Math.max(8, Math.round(conflict.severity * 0.25))),
      repairReadiness: Math.max(82, conflict.repairReadiness),
      summary: '用户已标记这段冲突或误会完成修复，后续表达应保留温和余波，但不要继续翻旧账。',
      evidence: ['manual_resolve_from_character_relationship_tab', conflict.summary],
      participantIds: [character.id, 'user'],
      confidence: 1,
    },
  };
}

function buildManualAttachmentProfileEvent(chat: GroupChat, character: AICharacter, action: 'disabled' | 'enabled'): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, `attachment-${action}`]),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: action === 'disabled'
      ? `${character.name} 记录用户关闭了依恋适配`
      : `${character.name} 记录用户恢复了依恋适配`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_attachment_profile',
      characterId: character.id,
      userId: 'user',
      action,
      confidence: 1,
      reason: action === 'disabled'
        ? '用户在角色关系页手动关闭依恋适配。'
        : '用户在角色关系页手动恢复依恋适配。',
      evidence: ['manual_attachment_update_from_character_relationship_tab'],
    },
  };
}

function buildManualUserProfileMemoryRevokeEvent(chat: GroupChat, character: AICharacter, item: UserProfileMemoryEventItem): RuntimeEventV2 {
  const now = Date.now();
  const normalized = clipRuntimeText(item.text, 140);
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, item.kind, normalized, 'user-profile-revoke']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户撤回了一条画像线索`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_user_profile_memory',
      characterId: character.id,
      userId: 'user',
      action: 'revoke',
      items: [{
        kind: item.kind,
        text: normalized,
        evidence: item.evidence || 'manual_revoke_from_character_relationship_tab',
        confidence: 1,
        sensitive: item.sensitive,
      }],
      reason: '用户在角色关系页手动撤回该画像线索。',
      evidence: 'manual_revoke_from_character_relationship_tab',
      confidence: 1,
    },
  };
}

function buildManualSharedAnchorArchiveEvent(chat: GroupChat, character: AICharacter, anchor: SharedMemoryAnchor): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, anchor.id, 'shared-anchor-archive']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户归档了一条共同锚点`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_shared_anchor',
      characterId: character.id,
      userId: anchor.participantIds.includes('user') ? 'user' : undefined,
      anchorId: anchor.id,
      action: 'archive',
      kind: anchor.kind,
      participantIds: anchor.participantIds,
      title: anchor.title,
      text: anchor.text,
      evidence: anchor.evidence || anchor.text,
      confidence: 1,
      reason: '用户在角色关系页手动归档该共同锚点。',
    },
  };
}

function buildManualSharedSecretRevokedEvent(chat: GroupChat, character: AICharacter, secret: SharedSecret): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, secret.id, 'shared-secret-revoked']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户撤回了一条小秘密`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_shared_secret',
      characterId: character.id,
      userId: secret.participantIds.includes('user') ? 'user' : undefined,
      secretId: secret.id,
      action: 'revoked',
      participantIds: secret.participantIds,
      privateText: secret.privateText,
      publicMask: secret.publicMask,
      reason: '用户在角色关系页手动撤回该小秘密。',
      evidence: secret.publicMask || 'manual_revoke_from_character_relationship_tab',
      emotionalWeight: secret.emotionalWeight,
      confidence: 1,
    },
  };
}

function buildManualRitualSuppressedEvent(chat: GroupChat, character: AICharacter, ritual: RitualRegistryEntry): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, ritual.id, 'ritual-suppressed']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户抑制了一个关系仪式`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_ritual',
      characterId: character.id,
      userId: ritual.participantIds.includes('user') ? 'user' : undefined,
      ritualId: ritual.id,
      kind: ritual.kind,
      action: 'suppressed',
      participantIds: ritual.participantIds,
      content: ritual.content,
      evolution: ritual.evolution,
      reason: '用户在角色关系页手动抑制该关系仪式。',
      evidence: ritual.content,
      confidence: 1,
    },
  };
}

function buildManualPhaseCorrectionEvent(chat: GroupChat, character: AICharacter, phase: CompanionshipPhase, style: CompanionshipStyle): RuntimeEventV2 {
  const now = Date.now();
  return {
    id: buildManualCompanionshipEventId([chat.id, character.id, phase, style, 'phase-correction']),
    conversationId: chat.id,
    kind: 'artifact',
    createdAt: now,
    actorIds: ['user'],
    targetIds: [character.id],
    summary: `${character.name} 记录用户手动修正了陪伴关系阶段`,
    channelId: 'pair-private',
    eventClass: 'artifact',
    visibility: 'pair_private',
    visibleToIds: ['user', character.id],
    payload: {
      eventType: 'companionship_phase_event',
      characterId: character.id,
      userId: 'user',
      phase,
      style,
      reason: '用户在角色关系页手动修正陪伴关系阶段。',
      evidence: ['manual_phase_correction_from_character_relationship_tab'],
      initiatedBy: 'user',
      confidence: 1,
    },
  };
}

function formatUserProfileMemoryKindLabel(kind: UserProfileMemoryKind) {
  const labels: Record<UserProfileMemoryKind, string> = {
    display_name: '名字',
    address_preference: '称呼',
    schedule_hint: '作息',
    pressure_source: '压力',
    preference: '偏好',
    dislike: '不喜欢',
    boundary: '边界',
    important_date: '日期',
    recent_plan: '计划',
    emotional_pattern: '情绪',
  };
  return labels[kind] || kind;
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
  return visible;
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

function buildRelationshipUserHint(relation: NonNullable<AICharacter['relationships']>[number], members: Array<{ id: string; name?: string }>) {
  const readable = buildRelationshipReadableChips(relation).join(' / ');
  const note = relation.note && relation.note !== relation.characterId ? sanitizeUserFacingText(relation.note, members) : '';
  return [readable ? `当前倾向：${readable}` : '', note ? `最近证据：${note}` : ''].filter(Boolean).join('\n') || '这段关系来自角色资料和最近互动的累计印象。';
}

function formatCharacterCompanionshipStyle(style: CharacterCompanionshipState['style']) {
  const labels: Record<CharacterCompanionshipState['style'], string> = {
    close_friend: '亲近朋友',
    sibling_like: '像家人',
    romantic_tension: '暧昧张力',
    mentor_protege: '照看/学习',
    partner: '可靠搭档',
    rival_with_care: '带刺关心',
  };
  return labels[style];
}

function formatSharedMemoryAnchorKind(kind: SharedMemoryAnchor['kind']) {
  const labels: Record<SharedMemoryAnchor['kind'], string> = {
    first_time: '第一次',
    confession: '心意确认',
    conflict: '旧冲突',
    repair: '修复',
    inside_joke: '共同梗',
    shared_secret: '小秘密',
    promise: '约定',
    milestone: '里程碑',
  };
  return labels[kind];
}

function SharedMemoryAnchorPanel({
  anchors,
  resolveCharacterName,
  developerMode,
  onArchiveAnchor,
}: {
  anchors: SharedMemoryAnchor[];
  resolveCharacterName: (id: string, fallback?: string) => string;
  developerMode: boolean;
  onArchiveAnchor?: (anchor: SharedMemoryAnchor) => void;
}) {
  return anchors.length ? (
    <Stack spacing={1}>
      {anchors.slice(0, developerMode ? 8 : 4).map((anchor) => {
        const participantNames = anchor.participantIds.map((id) => resolveCharacterName(id)).join(' × ');
        const archiveAnchor = onArchiveAnchor;
        const canArchive = developerMode && Boolean(archiveAnchor) && anchor.participantIds.includes('user');
        const chips = developerMode
          ? [
              formatSharedMemoryAnchorKind(anchor.kind),
              `显著 ${anchor.salience}`,
              `置信 ${anchor.confidence}`,
              anchor.source === 'layered_memory' ? '分层记忆' : '关系备注',
            ]
          : [formatSharedMemoryAnchorKind(anchor.kind), participantNames].filter(Boolean);
        return (
          <Box key={anchor.id} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Stack spacing={0.65}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{anchor.title}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">{participantNames}</Typography>
                  {canArchive && archiveAnchor ? (
                    <Button size="small" variant="text" onClick={() => archiveAnchor(anchor)} sx={{ p: 0, minWidth: 0 }}>
                      归档
                    </Button>
                  ) : null}
                </Box>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {anchor.text}
              </Typography>
              {chips.length ? <StatChipRow items={chips} /> : null}
              {developerMode && anchor.evidence ? (
                <Typography variant="caption" color="text.secondary">
                  证据：{anchor.evidence}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无共同锚点。高显著的第一次、约定、小秘密、冲突或修复记忆会在这里出现。</Typography>;
}

function CharacterCompanionshipPanel({
  states,
  resolveCharacterName,
  developerMode,
}: {
  states: CharacterCompanionshipState[];
  resolveCharacterName: (id: string, fallback?: string) => string;
  developerMode: boolean;
}) {
  return states.length ? (
    <Stack spacing={1}>
      {states.slice(0, developerMode ? 8 : 4).map((state) => {
        const chips = developerMode
          ? [
              `亲近 ${state.closeness}`,
              `护短 ${state.protectiveness}`,
              `依赖 ${state.reliance}`,
            ]
          : [
              state.closeness >= 58 ? '很熟' : state.closeness >= 36 ? '熟悉' : '',
              state.protectiveness >= 58 ? '护短明显' : state.protectiveness >= 36 ? '会在意' : '',
              state.reliance >= 58 ? '很信赖' : state.reliance >= 36 ? '可依赖' : '',
            ].filter(Boolean);
        const textureLines = [
          state.sharedSecrets.length ? `秘密：${state.sharedSecrets.join('、')}` : '',
          state.sharedRituals.length ? `仪式/共同梗：${state.sharedRituals.join('、')}` : '',
          state.unresolvedCareTopics.length ? `未完成关心：${state.unresolvedCareTopics.join('、')}` : '',
        ].filter(Boolean);
        return (
          <Box key={`${state.actorId}-${state.targetId}`} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Stack spacing={0.65}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{resolveCharacterName(state.targetId)}</Typography>
                <Chip size="small" label={formatCharacterCompanionshipStyle(state.style)} variant="outlined" />
              </Box>
              {chips.length ? <StatChipRow items={chips} /> : null}
              {textureLines.length ? (
                <Typography variant="caption" color="text.secondary">
                  {textureLines.join('；')}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无可投影的角色陪伴关系。关系积累到一定强度后，这里会显示护短、默契、搭档感或带刺关心。</Typography>;
}

function CompanionshipDeveloperTracePanel({
  trace,
  onDisableAttachment,
  onEnableAttachment,
}: {
  trace: CompanionshipRuntimeTrace | null | undefined;
  onDisableAttachment?: () => void;
  onEnableAttachment?: () => void;
}) {
  if (!trace) return null;
  const intimacyItems = [
    ['吸引', trace.intimacy.attraction],
    ['亲密', trace.intimacy.intimacy],
    ['依恋', trace.intimacy.attachment],
    ['想念', trace.intimacy.longing],
    ['安全', trace.intimacy.security],
  ] as const;
  const policyItems = [
    `主动预算 ${trace.carePolicy.dailyInitiationBudget}/天`,
    `触发敏感 ${trace.carePolicy.triggerSensitivity}`,
    `沉默阈值 ${trace.carePolicy.silenceAnxietyThresholdHours}h`,
    `表达强度 ${trace.carePolicy.expressionIntensity}`,
    trace.carePolicy.allowMissYou ? '允许想念表达' : '禁用想念表达',
  ];
  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.75 }}>
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>阶段/风格</Typography>
          <Typography variant="body2">{trace.phase} · {trace.style}</Typography>
        </Box>
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>画像置信</Typography>
          <Typography variant="body2">{trace.userProfileConfidence}%</Typography>
        </Box>
      </Box>
      <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>亲密投影</Typography>
        <Stack spacing={0.65}>
          {intimacyItems.map(([label, value]) => (
            <Box key={label} sx={{ display: 'grid', gridTemplateColumns: '44px 1fr 36px', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <LinearProgress variant="determinate" value={value} sx={{ height: 6, borderRadius: 999 }} />
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>{value}</Typography>
            </Box>
          ))}
        </Stack>
      </Box>
      <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>主动策略</Typography>
        <StatChipRow items={policyItems} />
        {trace.boundaryReasons.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.65 }}>
            克制：{trace.boundaryReasons.join(' / ')}
          </Typography>
        ) : null}
      </Box>
      {trace.pendingCareTopics.length || trace.pendingPromises.length ? (
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>未完成事项</Typography>
          {trace.pendingCareTopics.length ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              关心事项：{trace.pendingCareTopics.join(' / ')}
            </Typography>
          ) : null}
          {trace.pendingPromises.length ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              约定：{trace.pendingPromises.join(' / ')}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {trace.attachmentProfile ? (
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.65 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>依恋适配</Typography>
            {trace.attachmentProfile.confidence <= 0 ? (
              <Button size="small" variant="text" onClick={onEnableAttachment} sx={{ p: 0, minWidth: 0 }}>
                恢复适配
              </Button>
            ) : (
              <Button size="small" variant="text" onClick={onDisableAttachment} sx={{ p: 0, minWidth: 0 }}>
                关闭适配
              </Button>
            )}
          </Box>
          <StatChipRow items={[trace.attachmentProfile.inferredStyle, `置信 ${trace.attachmentProfile.confidence}%`, ...trace.attachmentProfile.adaptations]} />
          {trace.attachmentProfile.evidence.length ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.65 }}>
              证据：{trace.attachmentProfile.evidence.join(' / ')}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {trace.intimateConflict ? (
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'warning.main', color: 'warning.contrastText' }}>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.78 }}>亲密冲突/修复</Typography>
          <Typography variant="body2">{trace.intimateConflict.summary}</Typography>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.78 }}>
            {trace.intimateConflict.kind} · 强度 {trace.intimateConflict.severity} · 修复成熟度 {trace.intimateConflict.repairReadiness}
          </Typography>
        </Box>
      ) : null}
      {trace.diagnostics.length ? (
        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'error.main', color: 'error.contrastText' }}>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.78 }}>运行诊断</Typography>
          {trace.diagnostics.map((item) => (
            <Typography key={item} variant="caption" sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {item}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Stack>
  );
}

function formatCompanionshipPhaseLabel(phase: CompanionshipRuntimeTrace['phase']) {
  const labels: Record<CompanionshipRuntimeTrace['phase'], string> = {
    stranger: '陌生',
    curious: '好奇',
    fond: '好感',
    ambiguous: '暧昧',
    confessing: '确认前',
    confirmed: '已确认',
    passionate: '热恋',
    deep: '深层陪伴',
    cooling: '降温',
    crisis: '危机',
    reconciling: '修复中',
  };
  return labels[phase] || phase;
}

function formatCompanionshipStyleLabel(style: CompanionshipRuntimeTrace['style']) {
  const labels: Record<CompanionshipRuntimeTrace['style'], string> = {
    friend: '朋友',
    family: '家人式',
    mentor: '照看/引导',
    ambiguous: '暧昧',
    romantic: '亲密',
    custom: '自定义',
  };
  return labels[style] || style;
}

const PHASE_CORRECTION_OPTIONS: Array<{ label: string; phase: CompanionshipPhase; style: CompanionshipStyle }> = [
  { label: '朋友', phase: 'fond', style: 'friend' },
  { label: '暧昧', phase: 'ambiguous', style: 'ambiguous' },
  { label: '已确认', phase: 'confirmed', style: 'romantic' },
  { label: '降温', phase: 'cooling', style: 'friend' },
  { label: '修复中', phase: 'reconciling', style: 'friend' },
  { label: '危机', phase: 'crisis', style: 'friend' },
];

function isSameCompanionshipPhaseCorrection(trace: CompanionshipRuntimeTrace | null, option: { phase: CompanionshipPhase; style: CompanionshipStyle }) {
  return Boolean(trace && trace.phase === option.phase && trace.style === option.style);
}

function UserCompanionshipCard({
  chatName,
  signature,
  trace,
  pendingCareTopics,
  pendingPromises,
  sharedSecrets,
  rituals,
  onBlockCareTopic,
  onRevokePromise,
  onForbidAddress,
  onUnforbidAddress,
  onResolveConflict,
  onDisableAttachment,
  onEnableAttachment,
  onRevokeProfileCue,
  onRevokeSharedSecret,
  onSuppressRitual,
  onCorrectPhase,
  developerMode,
}: {
  chatName: string;
  signature: NonNullable<ReturnType<typeof buildCompanionshipStatusSignature>>;
  trace: CompanionshipRuntimeTrace | null;
  pendingCareTopics: PendingCareTopic[];
  pendingPromises: PendingPromise[];
  sharedSecrets: SharedSecret[];
  rituals: RitualRegistryEntry[];
  onBlockCareTopic: (topic: PendingCareTopic) => void;
  onRevokePromise: (promise: PendingPromise) => void;
  onForbidAddress: (address: string) => void;
  onUnforbidAddress: (address: string) => void;
  onResolveConflict: (conflict: NonNullable<CompanionshipRuntimeTrace['intimateConflict']>) => void;
  onDisableAttachment: () => void;
  onEnableAttachment: () => void;
  onRevokeProfileCue: (item: UserProfileMemoryEventItem) => void;
  onRevokeSharedSecret: (secret: SharedSecret) => void;
  onSuppressRitual: (ritual: RitualRegistryEntry) => void;
  onCorrectPhase: (phase: CompanionshipPhase, style: CompanionshipStyle) => void;
  developerMode: boolean;
}) {
  const headlineChips = [
    trace ? formatCompanionshipPhaseLabel(trace.phase) : '',
    trace ? formatCompanionshipStyleLabel(trace.style) : '',
    signature.addressing?.currentAddress ? `称呼 ${signature.addressing.currentAddress}` : '',
    trace?.pendingCareTopics.length ? `关心 ${trace.pendingCareTopics.length}` : '',
    trace?.pendingPromises.length ? `约定 ${trace.pendingPromises.length}` : '',
    trace?.boundaries.length || trace?.boundaryReasons.length ? '有边界' : '',
  ].filter(Boolean);
  const visibleLines = [
    trace?.sharedAnchors.length ? `共同锚点：${trace.sharedAnchors.slice(0, 2).join(' / ')}` : '',
    trace?.sharedSecrets.length ? `小秘密：${trace.sharedSecrets.slice(0, 2).join(' / ')}` : '',
    trace?.rituals.length ? `仪式：${trace.rituals.slice(0, 2).join(' / ')}` : '',
    trace?.boundaries.length ? `用户边界：${trace.boundaries.slice(0, 2).join(' / ')}` : '',
  ].filter(Boolean);
  return (
    <Box sx={{ p: { xs: 1.15, sm: 1.35 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.16)' }}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{chatName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {trace ? `${formatCompanionshipPhaseLabel(trace.phase)} · ${formatCompanionshipStyleLabel(trace.style)} · 画像置信 ${trace.userProfileConfidence}%` : '最近单聊投影'}
            </Typography>
          </Box>
          {developerMode ? <DebugChip /> : null}
        </Box>
        <Typography variant="body2" color="text.primary">
          {signature.text}
        </Typography>
        {headlineChips.length ? <StatChipRow items={headlineChips} /> : null}
        {signature.addressing ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 0.75 }}>
            <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'background.paper' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>当前称呼</Typography>
              <Typography variant="body2" noWrap>{signature.addressing.currentAddress}</Typography>
              {signature.addressing.currentAddress && signature.addressing.currentAddress !== '你' && !signature.addressing.forbiddenAddresses.includes(signature.addressing.currentAddress) ? (
                <Button size="small" variant="text" onClick={() => onForbidAddress(signature.addressing?.currentAddress || '')} sx={{ mt: 0.35, p: 0, minWidth: 0 }}>
                  禁用
                </Button>
              ) : null}
            </Box>
            <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'background.paper' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>私下称呼</Typography>
              <Typography variant="body2" noWrap>{signature.addressing.privateAddress || signature.addressing.currentAddress}</Typography>
              {signature.addressing.privateAddress && signature.addressing.privateAddress !== signature.addressing.currentAddress && !signature.addressing.forbiddenAddresses.includes(signature.addressing.privateAddress) ? (
                <Button size="small" variant="text" onClick={() => onForbidAddress(signature.addressing?.privateAddress || '')} sx={{ mt: 0.35, p: 0, minWidth: 0 }}>
                  禁用
                </Button>
              ) : null}
            </Box>
            <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'background.paper' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>公开称呼</Typography>
              <Typography variant="body2" noWrap>{signature.addressing.publicAddress || '用户'}</Typography>
            </Box>
          </Box>
        ) : null}
        {signature.unsentDraft || signature.offlineTrace || signature.onlineReturn ? (
          <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
              {signature.unsentDraft ? '未发送的话' : signature.onlineReturn ? '上线回归' : '离线痕迹'}
            </Typography>
            <Typography variant="body2">
              {signature.unsentDraft || signature.onlineReturn || signature.offlineTrace}
            </Typography>
          </Box>
        ) : null}
        {trace?.intimateConflict ? (
          <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'warning.main', color: 'warning.contrastText' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.82 }}>亲密冲突/修复</Typography>
                <Typography variant="body2">{trace.intimateConflict.summary}</Typography>
              </Box>
              <Button size="small" variant="outlined" onClick={() => trace.intimateConflict && onResolveConflict(trace.intimateConflict)} sx={{ color: 'inherit', borderColor: 'currentColor', flexShrink: 0 }}>
                已修复
              </Button>
            </Box>
          </Box>
        ) : null}
        {pendingCareTopics.length || pendingPromises.length ? (
          <Stack spacing={0.75}>
            {pendingCareTopics.slice(0, 3).map((topic) => (
              <Box key={topic.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>待关心</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{topic.text}</Typography>
                </Box>
                <Button size="small" variant="text" onClick={() => onBlockCareTopic(topic)} sx={{ flexShrink: 0 }}>
                  关闭
                </Button>
              </Box>
            ))}
            {pendingPromises.slice(0, 3).map((promise) => (
              <Box key={promise.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>未完成约定</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{promise.text}</Typography>
                </Box>
                <Button size="small" variant="text" onClick={() => onRevokePromise(promise)} sx={{ flexShrink: 0 }}>
                  关闭
                </Button>
              </Box>
            ))}
          </Stack>
        ) : null}
        {visibleLines.length ? (
          <Stack spacing={0.45}>
            {visibleLines.map((line) => (
              <Typography key={line} variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {line}
              </Typography>
            ))}
          </Stack>
        ) : null}
        {signature.addressing?.forbiddenAddresses.length ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">禁用称呼：</Typography>
            {signature.addressing.forbiddenAddresses.map((address) => (
              <Chip
                key={address}
                size="small"
                label={address}
                variant="outlined"
                onDelete={() => onUnforbidAddress(address)}
                sx={{ height: 24, borderRadius: 999 }}
              />
            ))}
          </Box>
        ) : null}
        {developerMode ? (
          <Stack spacing={1}>
            <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>
                阶段修正
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {PHASE_CORRECTION_OPTIONS.map((option) => {
                  const selected = isSameCompanionshipPhaseCorrection(trace, option);
                  return (
                    <Button
                      key={`${option.phase}-${option.style}`}
                      size="small"
                      variant={selected ? 'contained' : 'outlined'}
                      disabled={selected}
                      onClick={() => onCorrectPhase(option.phase, option.style)}
                      sx={{ borderRadius: 999, minWidth: 0, px: 1.1 }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </Stack>
            </Box>
            {trace?.userProfileCues.length ? (
              <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>
                  用户画像线索
                </Typography>
                <Stack spacing={0.75}>
                  {trace.userProfileCues.slice(0, 6).map((item, index) => (
                    <Box key={`${item.kind}-${item.text}-${index}`} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.25 }}>
                          <Chip size="small" label={formatUserProfileMemoryKindLabel(item.kind)} variant="outlined" sx={{ height: 22, borderRadius: 999 }} />
                          <Typography variant="caption" color="text.secondary">置信 {Math.round(item.confidence * 100)}%</Typography>
                          {item.sensitive ? <Typography variant="caption" color="warning.main">敏感</Typography> : null}
                        </Stack>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{item.text}</Typography>
                        {item.evidence ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                            证据：{clipRuntimeText(item.evidence, 96)}
                          </Typography>
                        ) : null}
                      </Box>
                      <Button size="small" variant="text" onClick={() => onRevokeProfileCue(item)} sx={{ flexShrink: 0 }}>
                        撤回
                      </Button>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
            {sharedSecrets.length ? (
              <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>
                  小秘密边界
                </Typography>
                <Stack spacing={0.75}>
                  {sharedSecrets.slice(0, 4).map((secret) => (
                    <Box key={secret.id} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.25 }}>
                          <Chip size="small" label={secret.leakState === 'sealed' ? '密封' : secret.leakState === 'hinted_publicly' ? '公开暗示' : secret.leakState === 'leaked' ? '已泄露' : '已坦白'} variant="outlined" sx={{ height: 22, borderRadius: 999 }} />
                          <Typography variant="caption" color="text.secondary">权重 {secret.emotionalWeight}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{secret.publicMask}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                          参与者：{secret.participantIds.join(' × ')}
                        </Typography>
                      </Box>
                      <Button size="small" variant="text" onClick={() => onRevokeSharedSecret(secret)} sx={{ flexShrink: 0 }}>
                        撤回
                      </Button>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
            {rituals.length ? (
              <Box sx={{ p: 1.1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.65 }}>
                  关系仪式
                </Typography>
                <Stack spacing={0.75}>
                  {rituals.slice(0, 5).map((ritual) => (
                    <Box key={ritual.id} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.25 }}>
                          <Chip size="small" label={ritual.kind} variant="outlined" sx={{ height: 22, borderRadius: 999 }} />
                          <Typography variant="caption" color={ritual.executionState === 'suppressed' ? 'warning.main' : 'text.secondary'}>
                            {ritual.executionState || 'available'}
                          </Typography>
                          {ritual.nextAvailableAt ? <Typography variant="caption" color="text.secondary">下次 {new Date(ritual.nextAvailableAt).toLocaleString()}</Typography> : null}
                        </Stack>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{ritual.content}</Typography>
                        {ritual.boundaryReasons.length ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                            边界：{ritual.boundaryReasons.slice(0, 2).join(' / ')}
                          </Typography>
                        ) : null}
                      </Box>
                      {ritual.executionState !== 'suppressed' ? (
                        <Button size="small" variant="text" onClick={() => onSuppressRitual(ritual)} sx={{ flexShrink: 0 }}>
                          抑制
                        </Button>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
            <CompanionshipDeveloperTracePanel trace={trace} onDisableAttachment={onDisableAttachment} onEnableAttachment={onEnableAttachment} />
            <Box sx={{ display: 'grid', gap: 0.5 }}>
              {signature.debugLines.map((line) => (
                <Typography key={line} variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                  {line}
                </Typography>
              ))}
            </Box>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

function isLikelyInternalCharacterId(value: string) {
  return /^[0-9a-f-]{18,}$/i.test(value);
}

function resolveFallbackCharacterName(id: string, fallback?: string) {
  if (fallback && fallback !== id) return fallback;
  if (id.startsWith('draft-')) return '未命名关系';
  if (!id || isLikelyInternalCharacterId(id)) return '未知角色';
  return id;
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
      <SectionHeader title={isZh ? '灵魂概览' : 'Soul Overview'} dense action={developerMode ? <DebugChip /> : undefined} />
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
  const typeLabel = (type: 'memory' | 'relationship' | 'drift') => type === 'memory' ? '记忆' : type === 'relationship' ? '关系' : '漂移';
  const isReactivated = (text: string) => /旧记忆.*重新唤醒|重新激活|回温/.test(text);
  const tone = (item: { type: 'memory' | 'relationship' | 'drift'; text: string }) => {
    if (isReactivated(item.text)) return 'rgba(255, 152, 0, 0.08)';
    if (item.type === 'relationship') return 'rgba(46, 125, 50, 0.08)';
    if (item.type === 'drift') return 'rgba(25, 118, 210, 0.08)';
    return 'action.hover';
  };
  return filteredTimeline.length ? (
    <Stack spacing={0.85}>
      {filteredTimeline.slice().reverse().slice(0, developerMode ? 8 : 5).map((item, index) => (
        <Tooltip key={`${item.type}-${item.createdAt}-${index}`} title={developerMode ? sanitizeUserFacingText(item.text, members) : ''} arrow placement="top-start">
          <Box sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: tone(item), '&:hover .timeline-text': { textDecoration: developerMode ? 'underline' : 'none' } }}>
            <Stack direction="row" spacing={0.65} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.55 }}>
              <Chip size="small" label={typeLabel(item.type)} variant="outlined" sx={{ height: 22 }} />
              {isReactivated(item.text) ? <Chip size="small" label="旧记忆回温" color="warning" variant="outlined" sx={{ height: 22 }} /> : null}
              {developerMode ? <Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleString()}</Typography> : null}
            </Stack>
            <Typography className="timeline-text" variant="body2">{sanitizeUserFacingText(item.text, members)}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">{developerMode ? '当前筛选下暂无时间线数据' : '当前暂无关键变化'}</Typography>;
}

function RelationshipAxisPills({
  relation,
  developerMode,
}: {
  relation: NonNullable<AICharacter['relationships']>[number];
  developerMode: boolean;
}) {
  const items = developerMode ? buildRelationshipDebugChips(relation) : buildRelationshipReadableChips(relation);
  return items.length ? <StatChipRow items={items} /> : null;
}

function RelationshipGraphPanel({ relationships, developerMode, resolveCharacterName, members }: { relationships: NonNullable<AICharacter['relationships']>; developerMode: boolean; resolveCharacterName: (id: string, fallback?: string) => string; members: AICharacter[] }) {
  return relationships.length ? (
    <Stack spacing={1}>
      {relationships.slice(0, developerMode ? 8 : 4).map((relation, index) => {
        return (
          <Box key={`${relation.characterId}-graph-${index}`} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Stack spacing={0.65} sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{resolveCharacterName(relation.characterId, relation.note)}</Typography>
              <Tooltip title={developerMode ? buildRelationshipDebugHint(relation) : buildRelationshipUserHint(relation, members)} arrow placement="top-start">
                <Box sx={{ width: 'fit-content', '&:hover': { textDecoration: 'underline' } }}>
                  <RelationshipAxisPills relation={relation} developerMode={developerMode} />
                </Box>
              </Tooltip>
              {relation.note && relation.note !== relation.characterId ? <Typography variant="body2" color="text.secondary">{sanitizeUserFacingText(relation.note, members)}</Typography> : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系数据</Typography>;
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
        const memory = memoryByTarget.get(relation.characterId);
        const readableChips = buildRelationshipReadableChips(relation);
        return (
          <Box key={`${relation.characterId}-overview-${index}`} sx={{ p: { xs: 1, sm: 1.15 }, borderRadius: 2.25, bgcolor: 'action.hover', border: '1px solid', borderColor: 'rgba(148, 163, 184, 0.12)' }}>
            <Stack spacing={0.6} sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{resolveCharacterName(relation.characterId, relation.note)}</Typography>
              {readableChips.length ? (
                <Tooltip title={developerMode ? buildRelationshipDebugHint(relation) : buildRelationshipUserHint(relation, members)} arrow placement="top-start">
                  <Box sx={{ width: 'fit-content', '&:hover': { textDecoration: 'underline' } }}>
                    <StatChipRow items={developerMode ? buildRelationshipDebugChips(relation) : readableChips} />
                  </Box>
                </Tooltip>
              ) : null}
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
  const context = useMemo(() => (
    kind === 'final_letter'
      ? buildCharacterFinalLetterContext(character, relatedCharacters)
      : buildCharacterExperienceArtifactContext(character, relatedCharacters)
  ), [character, kind, relatedCharacters]);
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
            <DebugChip />
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
  const characters = useCharacterStore((state) => state.characters);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showCompanionshipDebug = useSettingsStore((state) => state.developerUI.showCompanionshipDebug);
  const includeRuntimeEvidence = developerMode && Boolean(showDeveloperMemory || showCompanionshipDebug);
  const memoryMembers = useMemo(() => {
    const selfMember = character.id ? [{ id: character.id, name: character.name || '当前角色' }] : [];
    return [...characters, ...selfMember];
  }, [character.id, character.name, characters]);

  return (
    <PageSection spacing={2}>
      <LayeredMemoryPanel title="记忆沉淀" memories={allLayeredMemories} emptyText="暂无沉淀记忆" includeRuntimeEvidence={includeRuntimeEvidence} members={memoryMembers} />
    </PageSection>
  );
}

export function CharacterRelationshipInspector({ character }: RuntimeInsightsPanelProps) {
  const characters = useCharacterStore((state) => state.characters);
  const chats = useChatStore((state) => state.chats);
  const updateChat = useChatStore((state) => state.updateChat);
  const messages = useMessageStore((state) => state.messages);
  const messageWindowsByChatId = useMessageStore((state) => state.messageWindowsByChatId);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showCompanionshipDebug = useSettingsStore((state) => state.developerUI.showCompanionshipDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory || showCompanionshipDebug);
  const relationships = useMemo(() => character.relationships || [], [character.relationships]);
  const resolveCharacterName = useMemo(() => {
    const byId = new Map(characters.map((item) => [item.id, item.name]));
    return (id: string, fallback?: string) => {
      const matched = byId.get(id);
      if (matched) return matched;
      return resolveFallbackCharacterName(id, fallback);
    };
  }, [characters]);
  const relationshipMemories = useMemo(() => {
    const items = buildRelationshipMemoryItems(character).map((item) => ({
      ...item,
      text: resolveCharacterName(item.subjectIds?.[1] || '', item.text),
    }));
    return items.slice(0, 8);
  }, [character, resolveCharacterName]);
  const characterCompanionshipStates = useMemo(() => {
    if (!character.id || !character.personality || !character.memory) return [];
    return buildCharacterCompanionshipStates(character as AICharacter, character.updatedAt || character.createdAt || 0);
  }, [character]);
  const sharedMemoryAnchors = useMemo(() => {
    if (!character.id || !character.personality || !character.memory) return [];
    const directChat = recentByTime(chats.filter((chat) => chat.type === 'direct' && chat.memberIds.includes(character.id || '')), 1)[0];
    return buildSharedMemoryAnchors(character as AICharacter, character.updatedAt || character.createdAt || 0, directChat);
  }, [character, chats]);
  const latestUserDirectChat = useMemo(() => {
    if (!character.id) return undefined;
    return recentByTime(chats.filter((chat) => chat.type === 'direct' && chat.memberIds.includes(character.id || '')), 1)[0];
  }, [character.id, chats]);
  const companionshipView = useMemo(() => {
    if (!character.id || !character.personality || !character.memory) return null;
    const directChats = chats.filter((chat) => chat.type === 'direct' && chat.memberIds.includes(character.id || ''));
    const views = recentByTime(directChats, 3).map((directChat) => {
      const chatMessages = [
        ...(directChat.latestMessage ? [directChat.latestMessage] : []),
        ...messages.filter((message) => message.chatId === directChat.id),
        ...(messageWindowsByChatId[directChat.id]?.messages || []),
      ].filter((message, index, source): message is Message => Boolean(message) && source.findIndex((item) => item?.id === message?.id) === index);
      const projection = buildUserCompanionshipProjection({
        chat: directChat,
        character: character as AICharacter,
        messages: chatMessages,
      });
      const signature = buildCompanionshipStatusSignature({
        chat: directChat,
        character: character as AICharacter,
        messages: chatMessages,
      });
      if (!signature) return null;
      const trace = buildCompanionshipRuntimeTrace({
        chat: directChat,
        character: character as AICharacter,
        messages: chatMessages,
      });
      const sharedSecrets = buildSharedSecrets(character as AICharacter, directChat.updatedAt || Date.now(), directChat)
        .filter((secret) => secret.participantIds.includes('user'));
      const rituals = buildRitualRegistry({
        character: character as AICharacter,
        chat: directChat,
        messages: chatMessages,
        now: directChat.updatedAt || Date.now(),
      }).filter((ritual) => ritual.participantIds.includes('user'));
      return {
        chatId: directChat.id,
        chatName: directChat.name,
        chat: directChat,
        signature,
        trace,
        pendingCareTopics: projection.userBond?.pendingCareTopics || [],
        pendingPromises: projection.userBond?.pendingPromises || [],
        sharedSecrets,
        rituals,
      };
    }).filter(Boolean) as Array<{
      chatId: string;
      chatName: string;
      chat: GroupChat;
      signature: NonNullable<ReturnType<typeof buildCompanionshipStatusSignature>>;
      trace: CompanionshipRuntimeTrace | null;
      pendingCareTopics: PendingCareTopic[];
      pendingPromises: PendingPromise[];
      sharedSecrets: SharedSecret[];
      rituals: RitualRegistryEntry[];
    }>;
    return views.length ? views : null;
  }, [character, chats, messageWindowsByChatId, messages]);

  const appendManualCompanionshipEvent = async (chat: GroupChat, event: RuntimeEventV2) => {
    await updateChat(chat.id, {
      runtimeEventsV2: [...(chat.runtimeEventsV2 || []).filter((item) => item.id !== event.id), event],
    });
  };

  return (
    <PageSection spacing={2}>
      <SurfaceCard>
        <SectionHeader title="关系概览" dense />
        <RelationshipOverviewPanel relationships={relationships} relationshipMemories={relationshipMemories} resolveCharacterName={resolveCharacterName} developerMode={isDeveloperView} members={characters} />
      </SurfaceCard>
      <SurfaceCard>
        <SectionHeader title="角色陪伴" dense action={isDeveloperView ? <DebugChip /> : undefined} />
        <CharacterCompanionshipPanel states={characterCompanionshipStates} resolveCharacterName={resolveCharacterName} developerMode={isDeveloperView} />
      </SurfaceCard>
      <SurfaceCard>
        <SectionHeader title="共同锚点" dense action={isDeveloperView ? <DebugChip /> : undefined} />
        <SharedMemoryAnchorPanel
          anchors={sharedMemoryAnchors}
          resolveCharacterName={resolveCharacterName}
          developerMode={isDeveloperView}
          onArchiveAnchor={latestUserDirectChat ? (anchor) => {
            if (!anchor.participantIds.includes('user')) return;
            void appendManualCompanionshipEvent(latestUserDirectChat, buildManualSharedAnchorArchiveEvent(latestUserDirectChat, character as AICharacter, anchor));
          } : undefined}
        />
      </SurfaceCard>
      <SurfaceCard>
        <SectionHeader title="陪伴关系" dense action={isDeveloperView ? <DebugChip /> : undefined} />
        {companionshipView?.length ? (
          <Stack spacing={1.25}>
            {companionshipView.map((view) => (
              <UserCompanionshipCard
                key={view.chatId}
                chatName={view.chatName}
                signature={view.signature}
                trace={view.trace}
                pendingCareTopics={view.pendingCareTopics}
                pendingPromises={view.pendingPromises}
                sharedSecrets={view.sharedSecrets}
                rituals={view.rituals}
                onBlockCareTopic={(topic) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualCareTopicBlockedEvent(view.chat, character as AICharacter, topic));
                }}
                onRevokePromise={(promise) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualPromiseRevokedEvent(view.chat, character as AICharacter, promise));
                }}
                onForbidAddress={(address) => {
                  if (!address.trim()) return;
                  void appendManualCompanionshipEvent(view.chat, buildManualAddressingEvent(view.chat, character as AICharacter, 'forbid', address));
                }}
                onUnforbidAddress={(address) => {
                  if (!address.trim()) return;
                  void appendManualCompanionshipEvent(view.chat, buildManualAddressingEvent(view.chat, character as AICharacter, 'unforbid', address));
                }}
                onResolveConflict={(conflict) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualIntimateConflictResolvedEvent(view.chat, character as AICharacter, conflict));
                }}
                onDisableAttachment={() => {
                  void appendManualCompanionshipEvent(view.chat, buildManualAttachmentProfileEvent(view.chat, character as AICharacter, 'disabled'));
                }}
                onEnableAttachment={() => {
                  void appendManualCompanionshipEvent(view.chat, buildManualAttachmentProfileEvent(view.chat, character as AICharacter, 'enabled'));
                }}
                onRevokeProfileCue={(item) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualUserProfileMemoryRevokeEvent(view.chat, character as AICharacter, item));
                }}
                onRevokeSharedSecret={(secret) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualSharedSecretRevokedEvent(view.chat, character as AICharacter, secret));
                }}
                onSuppressRitual={(ritual) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualRitualSuppressedEvent(view.chat, character as AICharacter, ritual));
                }}
                onCorrectPhase={(phase, style) => {
                  void appendManualCompanionshipEvent(view.chat, buildManualPhaseCorrectionEvent(view.chat, character as AICharacter, phase, style));
                }}
                developerMode={isDeveloperView}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            暂无可投影的用户单聊陪伴关系。建立单聊并产生互动后，这里会显示称呼、关心事项和关系边界。
          </Typography>
        )}
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
  const showCompanionshipDebug = useSettingsStore((state) => state.developerUI.showCompanionshipDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory || showCompanionshipDebug);
  const relationships = useMemo(() => character.relationships || [], [character.relationships]);
  const resolveCharacterName = useMemo(() => {
    const byId = new Map(characters.map((item) => [item.id, item.name]));
    return (id: string, fallback?: string) => {
      const matched = byId.get(id);
      if (matched) return matched;
      return resolveFallbackCharacterName(id, fallback);
    };
  }, [characters]);
  const behavior = character.behavior;
  const personalityDrift = useMemo(() => character.personalityDrift || {}, [character.personalityDrift]);
  const effectiveBehavior = useMemo(
    () => (character.behavior ? applyDriftToBehavior(character as AICharacter) : null),
    [character]
  );
  const fallbackTimelineAt = character.updatedAt || character.createdAt || 0;
  const driftSummary = formatLocalizedDriftSummary(personalityDrift, i18n.language);
  const timeline = useMemo(() => character.runtimeTimeline || [
    ...relationships.slice(-3).map((relation) => ({ type: 'relationship' as const, text: `${relation.note || relation.characterId} · ${relation.updatedAt ? new Date(relation.updatedAt).toLocaleString() : '最近更新'}`, createdAt: relation.updatedAt || fallbackTimelineAt })),
    ...(driftSummary ? [{ type: 'drift' as const, text: driftSummary, createdAt: fallbackTimelineAt }] : []),
  ], [character.runtimeTimeline, relationships, fallbackTimelineAt, driftSummary]);
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
  const emotionChips = buildEmotionChips(character, i18n.language);
  const shouldShowEmotionCard = isDeveloperView || !character.emotionalState || emotionChips.length > 0;

  return (
    <PageSection spacing={2}>
      <SoulOverviewPanel character={character} resolveCharacterName={resolveCharacterName} developerMode={isDeveloperView} />

      <SurfaceCard>
        <SectionHeader title="运行态观察" dense action={isDeveloperView ? <DebugChip /> : undefined} />
        {hasRuntimeSummary ? <Box sx={{ mt: 0.5 }}><StatChipRow items={runtimeSummaryItems} /></Box> : <Typography variant="caption" color="text.secondary">暂无运行态观察结果</Typography>}
      </SurfaceCard>

      <SoulStatePanel character={character} developerMode={isDeveloperView} />

      {shouldShowEmotionCard ? (
        <SurfaceCard>
          <SectionHeader title="情绪状态" dense action={isDeveloperView && runtimeAffectHints.length ? <Chip size="small" label="变化" color="warning" variant="outlined" /> : undefined} />
          <Stack spacing={1}>
            <EmotionPanel character={character} developerMode={isDeveloperView} emotionChips={emotionChips} />
            {isDeveloperView && runtimeAffectHints.length ? <StatChipRow items={runtimeAffectHints} /> : null}
          </Stack>
        </SurfaceCard>
      ) : null}

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
        <SectionHeader title="运行时间线" dense action={<StatChipRow items={[viewMode === 'timeline' ? '时间线' : '关系摘要']} />} />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.25 }}>
          <Chip size="small" label="时间线" color={viewMode === 'timeline' ? 'primary' : 'default'} variant={viewMode === 'timeline' ? 'filled' : 'outlined'} onClick={() => setViewMode('timeline')} />
          <Chip size="small" label="关系摘要" color={viewMode === 'graph' ? 'primary' : 'default'} variant={viewMode === 'graph' ? 'filled' : 'outlined'} onClick={() => setViewMode('graph')} />
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
          <RelationshipGraphPanel relationships={relationships} developerMode={isDeveloperView} resolveCharacterName={resolveCharacterName} members={characters} />
        )}
      </SurfaceCard>

      {developerMode ? <CharacterExperienceArtifactPanel character={character} relatedCharacters={characters} /> : null}
    </PageSection>
  );
}
