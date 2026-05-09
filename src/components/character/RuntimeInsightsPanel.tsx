import { useMemo, useState } from 'react';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { MemoryItem } from '../../services/memoryTypes';
import { useSettingsStore } from '../../stores/useSettingsStore';
import SimpleBarChart from '../common/SimpleBarChart';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import PageSection from '../common/PageSection';
import StatChipRow from '../common/StatChipRow';
import { formatRelationshipNumber } from '../../services/relationshipLedger';

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

function MemoryCard({ item, developerMode }: { item: MemoryItem; developerMode: boolean }) {
  return (
    <Box sx={{ p: { xs: 0.95, sm: 1.1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
      {developerMode ? <StatChipRow items={[item.layer, item.scope, item.kind]} /> : null}
      <Typography variant="body2" sx={{ mt: developerMode ? 0.5 : 0 }}>{item.text}</Typography>
      {developerMode ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{`强化 ${item.reinforcementCount} · 置信 ${(item.confidence * 100).toFixed(0)}%`}</Typography> : null}
    </Box>
  );
}

function EmotionPanel({ character }: { character: Partial<AICharacter> }) {
  const emotional = character.emotionalState;
  if (!emotional) return <Typography variant="caption" color="text.secondary">暂无情绪轨迹</Typography>;
  return (
    <Stack spacing={1}>
      {[
        ['烦躁', emotional.irritation],
        ['好感', emotional.affection],
        ['不安', emotional.insecurity],
        ['兴奋', emotional.excitement],
        ['尴尬', emotional.embarrassment],
      ].map(([label, value]) => (
        <Box key={String(label)}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
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

function RelationshipGraphPanel({ relationships, developerMode }: { relationships: NonNullable<AICharacter['relationships']>; developerMode: boolean }) {
  return relationships.length ? (
    <Stack spacing={0.85}>
      {relationships.slice(0, developerMode ? 8 : 4).map((relation, index) => (
        <Box key={`${relation.characterId}-graph-${index}`} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{relation.note || relation.characterId}</Typography>
          {developerMode ? <Box sx={{ mt: 0.5 }}><StatChipRow items={[`亲和 ${formatRelationshipNumber(relation.warmth)}`, `能力 ${formatRelationshipNumber(relation.competence)}`, `信任 ${formatRelationshipNumber(relation.trust)}`, `威胁 ${formatRelationshipNumber(relation.threat)}`]} /></Box> : null}
        </Box>
      ))}
    </Stack>
  ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>;
}

interface RuntimeInsightsPanelProps {
  character: Partial<AICharacter>;
}

export default function RuntimeInsightsPanel({ character }: RuntimeInsightsPanelProps) {
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'memory' | 'relationship' | 'drift'>('all');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const isDeveloperView = developerMode && Boolean(showDeveloperMemory);
  const relationships = character.relationships || [];
  const memory = character.memory;
  const behavior = character.behavior;
  const personalityDrift = character.personalityDrift || {};
  const layeredMemories = useMemo(() => {
    const items = buildCharacterLayeredMemories(character);
    return isDeveloperView ? items : items.filter((item) => item.layer !== 'working').slice(0, 4);
  }, [character, isDeveloperView]);
  const relationshipMemories = useMemo(() => {
    const items = buildRelationshipMemoryItems(character);
    return isDeveloperView ? items : items.slice(0, 4);
  }, [character, isDeveloperView]);
  const timeline = useMemo(() => character.runtimeTimeline || [
    ...(memory?.longTerm || []).slice(-3).map((item) => ({ type: 'memory' as const, text: item, createdAt: Date.now() })),
    ...relationships.slice(-3).map((relation) => ({ type: 'relationship' as const, text: `${relation.note || relation.characterId} · ${relation.updatedAt ? new Date(relation.updatedAt).toLocaleString() : '最近更新'}`, createdAt: relation.updatedAt || Date.now() })),
    ...Object.entries(personalityDrift).map(([key, value]) => ({ type: 'drift' as const, text: `${key} ${value > 0 ? '+' : ''}${value}`, createdAt: Date.now() })),
  ], [character.runtimeTimeline, memory?.longTerm, relationships, personalityDrift]);
  const filteredTimeline = timelineFilter === 'all' ? timeline : timeline.filter((item) => item.type === timelineFilter);
  const memorySummary = layeredMemories.slice(0, 3).map((item) => item.text).join(' / ');

  return (
    <PageSection spacing={2}>
      <SurfaceCard>
        <SectionHeader title="运行态观察" dense action={isDeveloperView ? <Chip size="small" label="调试" color="warning" variant="outlined" /> : undefined} />
        <Typography variant="body2" color="text.secondary">{isDeveloperView ? '这里展示角色运行后逐渐沉淀出来的完整运行态与记忆调试信息。' : (memorySummary || '这里展示角色运行后逐渐沉淀下来的关键线索。')}</Typography>
        {!isDeveloperView ? <Box sx={{ mt: 1 }}><StatChipRow items={[
          relationships[0] ? `关系 ${relationships[0].warmth + relationships[0].competence + relationships[0].trust >= relationships[0].threat + 12 ? '升温' : '紧张'}` : '',
          ...Object.entries(personalityDrift).slice(0, 1).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`),
          character.emotionalState ? `情绪 ${Object.entries(character.emotionalState).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || '稳定'}` : '',
        ].filter(Boolean)} /></Box> : null}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title={isDeveloperView ? '角色记忆' : '关键记忆'} dense />
        {layeredMemories.length ? <Stack spacing={1}>{layeredMemories.map((item) => <MemoryCard key={item.id} item={item} developerMode={isDeveloperView} />)}</Stack> : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无结构化记忆' : '暂无明显沉淀'}</Typography>}
      </SurfaceCard>

      {isDeveloperView ? (
        <SurfaceCard>
          <SectionHeader title="多层记忆结构" dense />
          <StatChipRow items={[
            `工作记忆 ${layeredMemories.filter((item) => item.layer === 'working').length}`,
            `情节记忆 ${layeredMemories.filter((item) => item.layer === 'episodic').length}`,
            `长期记忆 ${layeredMemories.filter((item) => item.layer === 'long_term').length}`,
            `角色自我 ${layeredMemories.filter((item) => item.scope === 'character_self').length}`,
            `关系记忆 ${layeredMemories.filter((item) => item.scope === 'relationship').length}`,
            `会话记忆 ${layeredMemories.filter((item) => item.scope === 'conversation').length}`,
            `线程记忆 ${layeredMemories.filter((item) => item.scope === 'thread').length}`,
          ]} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            direct 单聊现在优先使用角色自身记忆、关系记忆与最近变化；会话/线程记忆作为补充，而不是主检索源。
          </Typography>
        </SurfaceCard>
      ) : null}

      <SurfaceCard>
        <SectionHeader title={isDeveloperView ? '关系记忆' : '关系变化'} dense />
        {relationshipMemories.length ? <Stack spacing={1}>{relationshipMemories.map((item) => <MemoryCard key={item.id} item={item} developerMode={isDeveloperView} />)}</Stack> : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无关系记忆' : '暂无突出关系变化'}</Typography>}
      </SurfaceCard>

      {isDeveloperView ? (
        <SurfaceCard>
          <SectionHeader title="最近记忆变更" dense />
          {layeredMemories.length ? (
            <Stack spacing={0.85}>
              {layeredMemories.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((item) => (
                <Box key={`change-${item.id}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary">{item.layer} / {item.scope} / {item.kind}</Typography>
                  <Typography variant="body2">{item.text}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{new Date(item.updatedAt).toLocaleString()}</Typography>
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">暂无最近记忆变更</Typography>}
        </SurfaceCard>
      ) : null}

      <SurfaceCard>
        <SectionHeader title="情绪状态" dense />
        <EmotionPanel character={character} />
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="核心画像" dense />
        <CoreProfilePanel character={character} />
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="行为 / 漂移" dense />
        <Stack spacing={1.25}>
          {isDeveloperView ? <SimpleBarChart title="行为强度" items={Object.entries(behavior || {}).map(([key, value]) => ({ label: key, value: Number(value) }))} /> : null}
          {Object.keys(personalityDrift).length ? <StatChipRow items={Object.entries(personalityDrift).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`)} /> : null}
        </Stack>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader title="运行视图" dense action={<StatChipRow items={[viewMode === 'timeline' ? '时间线' : '关系图谱']} />} />
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
          <RelationshipGraphPanel relationships={relationships} developerMode={isDeveloperView} />
        )}
      </SurfaceCard>
    </PageSection>
  );
}
