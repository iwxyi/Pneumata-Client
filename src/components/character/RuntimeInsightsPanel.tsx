import { useMemo, useState } from 'react';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
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
import { formatLocalizedDriftSummary, getDominantEmotionLabel, getAffectSummaryLines } from '../../services/personalityDrift';
import LayeredMemoryPanel from '../memory/LayeredMemoryPanel';

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
  };
  return labels[key] || key;
}

function EmotionPanel({ character }: { character: Partial<AICharacter> }) {
  const { i18n } = useTranslation();
  const emotional = character.emotionalState;
  if (!emotional) return <Typography variant="caption" color="text.secondary">{i18n.language.startsWith('zh') ? '暂无情绪轨迹' : 'No emotion trace yet'}</Typography>;
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

function CoreProfilePanel({ character }: { character: Partial<AICharacter> }) {
  const profile = character.coreProfile;
  if (!profile) return <Typography variant="caption" color="text.secondary">暂无核心画像</Typography>;
  return (
    <Stack spacing={0.75}>
      {profile.coreDesire ? <Typography variant="caption" color="text.secondary">欲望：{profile.coreDesire}</Typography> : null}
      {profile.coreFear ? <Typography variant="caption" color="text.secondary">恐惧：{profile.coreFear}</Typography> : null}
      {profile.socialMask ? <Typography variant="caption" color="text.secondary">面具：{profile.socialMask}</Typography> : null}
      {profile.biases?.length ? <Typography variant="caption" color="text.secondary">偏见：{profile.biases.join(' / ')}</Typography> : null}
      {profile.interactionHabits?.length ? <Typography variant="caption" color="text.secondary">习惯：{profile.interactionHabits.join(' / ')}</Typography> : null}
    </Stack>
  );
}

function RuntimeTimelinePanel({ filteredTimeline, developerMode }: { filteredTimeline: Array<{ type: 'memory' | 'relationship' | 'drift'; text: string; createdAt: number }>; developerMode: boolean }) {
  return filteredTimeline.length ? (
    <Stack spacing={0.85}>
      {filteredTimeline.slice().reverse().slice(0, developerMode ? 8 : 5).map((item, index) => (
        <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
          {developerMode ? <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography> : null}
          <Typography variant="body2">{item.text}</Typography>
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
                <StatChipRow items={[`亲和 ${formatRelationshipNumber(Number.isFinite(relation.warmth) ? relation.warmth : 0)}`, `能力 ${formatRelationshipNumber(Number.isFinite(relation.competence) ? relation.competence : 0)}`, `信任 ${formatRelationshipNumber(Number.isFinite(relation.trust) ? relation.trust : 0)}`, `威胁 ${formatRelationshipNumber(Number.isFinite(relation.threat) ? relation.threat : 0)}`]} />
              </Stack>
            </Box>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>;
}

function RelationshipOverviewPanel({ relationships, relationshipMemories, resolveCharacterName }: { relationships: NonNullable<AICharacter['relationships']>; relationshipMemories: MemoryItem[]; resolveCharacterName: (id: string, fallback?: string) => string }) {
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
                <StatChipRow items={[`亲和 ${formatRelationshipNumber(Number.isFinite(relation.warmth) ? relation.warmth : 0)}`, `能力 ${formatRelationshipNumber(Number.isFinite(relation.competence) ? relation.competence : 0)}`, `信任 ${formatRelationshipNumber(Number.isFinite(relation.trust) ? relation.trust : 0)}`, `威胁 ${formatRelationshipNumber(Number.isFinite(relation.threat) ? relation.threat : 0)}`]} />
                {relation.note && relation.note !== relation.characterId ? <Typography variant="body2" color="text.secondary">{relation.note}</Typography> : null}
                {memory ? <Typography variant="caption" color="text.secondary" title={memory.evidenceText || memory.text}>{`强化 ${memory.reinforcementCount} · 置信 ${(memory.confidence * 100).toFixed(0)}%`}</Typography> : null}
              </Stack>
            </Box>
          </Box>
        );
      })}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系数据</Typography>;
}

interface RuntimeInsightsPanelProps {
  character: Partial<AICharacter>;
}

export function CharacterMemoryInspector({ character }: RuntimeInsightsPanelProps) {
  const allLayeredMemories = useMemo(() => buildCharacterLayeredMemories(character), [character]);

  return (
    <PageSection spacing={2}>
      <LayeredMemoryPanel memories={allLayeredMemories} />
    </PageSection>
  );
}

export function CharacterRelationshipInspector({ character }: RuntimeInsightsPanelProps) {
  const characters = useCharacterStore((state) => state.characters);
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
        <RelationshipOverviewPanel relationships={relationships} relationshipMemories={relationshipMemories} resolveCharacterName={resolveCharacterName} />
      </SurfaceCard>
    </PageSection>
  );
}

export default function RuntimeInsightsPanel({ character }: RuntimeInsightsPanelProps) {
  const { i18n } = useTranslation();
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'memory' | 'relationship' | 'drift'>('all');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory);
  const relationships = character.relationships || [];
  const behavior = character.behavior;
  const personalityDrift = character.personalityDrift || {};
  const timeline = useMemo(() => character.runtimeTimeline || [
    ...relationships.slice(-3).map((relation) => ({ type: 'relationship' as const, text: `${relation.note || relation.characterId} · ${relation.updatedAt ? new Date(relation.updatedAt).toLocaleString() : '最近更新'}`, createdAt: relation.updatedAt || Date.now() })),
    ...(formatLocalizedDriftSummary(personalityDrift, i18n.language) ? [{ type: 'drift' as const, text: formatLocalizedDriftSummary(personalityDrift, i18n.language), createdAt: Date.now() }] : []),
  ], [character.runtimeTimeline, relationships, personalityDrift]);
  const filteredTimeline = timelineFilter === 'all' ? timeline : timeline.filter((item) => item.type === timelineFilter);
  const runtimeSummaryItems = [
    relationships[0] ? `关系 ${relationships[0].warmth + relationships[0].competence + relationships[0].trust >= relationships[0].threat + 12 ? '升温' : '紧张'}` : '',
    ...Object.entries(personalityDrift).slice(0, 1).map(([key, value]) => `${getTraitLabel(key, i18n.language)} ${value > 0 ? '+' : ''}${value}`),
    character.emotionalState ? `情绪 ${getDominantEmotionLabel(character.emotionalState, i18n.language)}` : '',
  ].filter(Boolean);
  const runtimeAffectHints = getAffectSummaryLines(character as AICharacter, i18n.language).slice(0, isDeveloperView ? 4 : 2);
  const hasRuntimeSummary = runtimeSummaryItems.length > 0;
  const hasCoreProfile = Boolean(character.coreProfile?.coreDesire || character.coreProfile?.coreFear || character.coreProfile?.socialMask || character.coreProfile?.biases?.length || character.coreProfile?.interactionHabits?.length);

  return (
    <PageSection spacing={2}>
      <SurfaceCard>
        <SectionHeader title="运行态观察" dense action={isDeveloperView ? <Chip size="small" label="调试" color="warning" variant="outlined" /> : undefined} />
        {hasRuntimeSummary ? <Box sx={{ mt: 0.5 }}><StatChipRow items={runtimeSummaryItems} /></Box> : <Typography variant="caption" color="text.secondary">暂无运行态观察结果</Typography>}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="情绪状态" dense action={isDeveloperView && runtimeAffectHints.length ? <Chip size="small" label="变化" color="warning" variant="outlined" /> : undefined} />
        <Stack spacing={1}>
          <EmotionPanel character={character} />
          {isDeveloperView && runtimeAffectHints.length ? <StatChipRow items={runtimeAffectHints} /> : null}
        </Stack>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="核心画像" dense />
        {hasCoreProfile ? <CoreProfilePanel character={character} /> : <Typography variant="caption" color="text.secondary">暂无核心画像</Typography>}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="行为 / 漂移" dense />
        <Stack spacing={1.25}>
          {isDeveloperView ? <SimpleBarChart title="行为强度" items={Object.entries(behavior || {}).map(([key, value]) => ({ label: key, value: Number(value) }))} /> : null}
          {Object.keys(personalityDrift).length ? <StatChipRow items={Object.entries(personalityDrift).map(([key, value]) => `${getTraitLabel(key, i18n.language)} ${value > 0 ? '+' : ''}${value}`)} /> : null}
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
            <RuntimeTimelinePanel filteredTimeline={filteredTimeline} developerMode={isDeveloperView} />
          </>
        ) : (
          <RelationshipGraphPanel relationships={relationships} developerMode={isDeveloperView} resolveCharacterName={(id, fallback) => fallback || id} />
        )}
      </SurfaceCard>
    </PageSection>
  );
}
