import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import PrivatePayloadPanel from '../session/PrivatePayloadPanel';
import { retrieveRelevantMemories } from '../../services/memoryRetrieval';
import type { MemoryItem } from '../../services/memoryTypes';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { MemoryCandidatePayload, RuntimeEventV2 } from '../../types/runtimeEvent';
import { useSettingsStore } from '../../stores/useSettingsStore';
import SimpleBarChart from '../common/SimpleBarChart';
import DialogueDebugPanel from './DialogueDebugPanel';
import { projectLatestRuntimeEvent } from '../../services/sessionProjection';

function matchTimelineFilter(item: { type: 'note' | 'artifact' | 'relationship' }, filter: 'all' | 'note' | 'artifact' | 'relationship') {
  return filter === 'all' || item.type === filter;
}

function buildRuntimeEventKey(item: { type: string; createdAt: number; text: string }, index: number) {
  return `${item.type}-${item.createdAt}-${index}-${item.text.slice(0, 24)}`;
}

function clipLabel(text: string, max = 24) {
  return text.slice(0, max);
}

function describeEventHeadline(event: RuntimeEventV2 | null) {
  return event ? `${event.kind} · ${clipLabel(event.summary)}` : null;
}

function readRoomShiftDelta(event: RuntimeEventV2 | null) {
  if (!event || event.kind !== 'room_shift') return null;
  const payload = event.payload as { delta?: { heat?: number; cohesion?: number; topicDrift?: number } };
  return payload.delta || null;
}

function formatDelta(value: number | undefined) {
  if (!value) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function describeRoomShiftDelta(event: RuntimeEventV2 | null) {
  const delta = readRoomShiftDelta(event);
  if (!delta) return null;
  return `Δ热度 ${formatDelta(delta.heat)} / Δ凝聚 ${formatDelta(delta.cohesion)} / Δ跑题 ${formatDelta(delta.topicDrift)}`;
}

function readMemoryCandidateMeta(item: { meta?: { memoryCandidate?: MemoryCandidatePayload } }) {
  return item.meta?.memoryCandidate || null;
}

function readRelationshipDeltaMeta(item: { meta?: { relationshipDelta?: { reason: string; delta: { affinity?: number; respect?: number; hostility?: number; contempt?: number } } } }) {
  return item.meta?.relationshipDelta || null;
}

function readRoomShiftMeta(item: { meta?: { roomShift?: { delta?: { heat?: number; cohesion?: number; topicDrift?: number } } } }) {
  return item.meta?.roomShift || null;
}

function formatPercent(value: number | undefined) {
  if (typeof value !== 'number') return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatSignedNumber(value: number | undefined) {
  if (!value) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

void formatSignedNumber;
void readRoomShiftMeta;
void readRelationshipDeltaMeta;
void formatPercent;
void readMemoryCandidateMeta;
void describeRoomShiftDelta;
void formatDelta;
void readRoomShiftDelta;

function timelineEventLimit(isDeveloperView: boolean) {
  return isDeveloperView ? 12 : 8;
}

function timelinePreviewLimit(isDeveloperView: boolean) {
  return isDeveloperView ? 10 : 6;
}

void timelinePreviewLimit;
void timelineEventLimit;
void describeEventHeadline;
void buildRuntimeEventKey;
void matchTimelineFilter;
void clipLabel;

interface ChatRuntimePanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  privatePayloads?: Array<{ key: string; title: string; text: string }>;
}

export default function ChatRuntimePanel({ chat, members, privatePayloads = [] }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showSpeechStyle = useSettingsStore((state) => state.developerUI.showSpeechStyle);
  const isDeveloperView = developerMode && showDeveloperMemory;
  const isSpeechStyleView = developerMode && showSpeechStyle;

  const relationshipPairs = ((chat.relationshipLedger && chat.relationshipLedger.length)
    ? chat.relationshipLedger.filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId)).map((entry) => ({
        source: members.find((item) => item.id === entry.actorId)?.name || entry.actorId,
        target: members.find((item) => item.id === entry.targetId)?.name || entry.targetId,
        relation: entry.current,
        note: entry.recentEvents[entry.recentEvents.length - 1]?.summary || '',
        score: entry.current.affinity + entry.current.respect - entry.current.hostility - entry.current.contempt,
      }))
    : members.flatMap((member) =>
        member.relationships
          .filter((relation) => Boolean(relation.note?.trim()) || Math.abs(relation.affinity + relation.respect - relation.hostility - relation.contempt) >= 15 || relation.affinity >= 60 || relation.respect >= 60 || relation.hostility >= 35 || relation.contempt >= 35)
          .slice(0, 2)
          .map((relation) => ({
            source: member.name,
            target: members.find((item) => item.id === relation.characterId)?.name || relation.characterId,
            relation,
            note: relation.note || '',
            score: relation.affinity + relation.respect - relation.hostility - relation.contempt,
          }))
      )).slice(0, isDeveloperView ? 8 : 4);
  const structuredRoomState = chat.worldState.structuredRoomState;
  const recentStructuredEvents = (chat.runtimeEventsV2 || []).slice().reverse().slice(0, isDeveloperView ? 8 : 4);
  const projectedTimeline = useMemo(() => (chat.runtimeTimeline || []) as Array<{ type: 'note' | 'artifact' | 'relationship'; text: string; createdAt: number; label: string; event?: RuntimeEventV2 | null; meta?: { memoryCandidate?: MemoryCandidatePayload; relationshipDelta?: { reason: string; delta: { affinity?: number; respect?: number; hostility?: number; contempt?: number } }; roomShift?: { delta?: { heat?: number; cohesion?: number; topicDrift?: number } } } }>, [chat.runtimeTimeline]);
  const runtimeMetrics = [
    { label: '成员数', value: members.length * 10, color: '#6750A4' },
    { label: '运行笔记', value: (chat.runtimeSeed?.notes?.length || 0) * 10, color: '#4E7E6B' },
    { label: '成果物', value: (chat.runtimeSeed?.artifacts?.length || 0) * 10, color: '#B26A00' },
    { label: '时间线事件', value: (chat.runtimeEventsV2?.length || chat.runtimeTimeline?.length || 0) * 5, color: '#C62828' },
    ...(structuredRoomState ? [
      { label: '热度', value: structuredRoomState.heat, color: '#D32F2F' },
      { label: '凝聚', value: structuredRoomState.cohesion, color: '#2E7D32' },
      { label: '跑题', value: structuredRoomState.topicDrift, color: '#1565C0' },
    ] : []),
  ];

  const filteredTimeline = useMemo(() => {
    const filtered = projectedTimeline.filter((item) => matchTimelineFilter(item, timelineFilter));
    return filtered.slice().reverse().slice(0, timelinePreviewLimit(isDeveloperView));
  }, [projectedTimeline, timelineFilter, isDeveloperView]);

  const roomStateChips = structuredRoomState
    ? [
        { key: 'heat', label: `热度 ${structuredRoomState.heat}` },
        { key: 'cohesion', label: `凝聚 ${structuredRoomState.cohesion}` },
        { key: 'topicDrift', label: `跑题 ${structuredRoomState.topicDrift}` },
        ...(structuredRoomState.pileOnTarget ? [{ key: 'pileOnTarget', label: `围攻 ${members.find((item) => item.id === structuredRoomState.pileOnTarget)?.name || structuredRoomState.pileOnTarget}` }] : []),
      ]
    : [];

  const dominantThreadLabel = structuredRoomState?.dominantThread
    ? structuredRoomState.dominantThread.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ ')
    : null;

  const allianceLabels = (structuredRoomState?.alliances || []).map((pair) => pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' + '));
  const conflictLabels = (structuredRoomState?.conflictPairs || []).map((pair) => pair.map((id) => members.find((item) => item.id === id)?.name || id).join(' ↔ '));

  const displayTimeline = filteredTimeline.slice(0, timelineEventLimit(isDeveloperView));

  const latestRuntimeEvent = projectLatestRuntimeEvent(chat);
  const topInteractionChip = describeEventHeadline(latestRuntimeEvent);
  const roomShiftDeltaLabel = describeRoomShiftDelta(latestRuntimeEvent);

  const firstRelationshipPair = relationshipPairs[0];
  const firstRelationshipLabel = firstRelationshipPair ? `${firstRelationshipPair.source}→${firstRelationshipPair.target} ${firstRelationshipPair.score >= 0 ? '升温' : '紧张'}` : null;
  const primaryRecentEvent = (chat as GroupChat & { primaryRecentEvent?: string }).primaryRecentEvent || (structuredRoomState ? `热度 ${structuredRoomState.heat} / 凝聚 ${structuredRoomState.cohesion}` : chat.worldState.recentEvent);
  const metricItems = isDeveloperView ? runtimeMetrics : runtimeMetrics.slice(0, 4);
  const getRelationNote = (item: { note?: string }) => item.note || '';

  const layeredMemories = useMemo(() => {
    const items = (chat.layeredMemories || []) as MemoryItem[];
    return retrieveRelevantMemories(items, {
      speakerId: chat.memberIds[0] || chat.id,
      targetId: chat.memberIds[1] || null,
      conversationId: chat.id,
      maxItems: isDeveloperView ? 8 : 4,
    });
  }, [chat.id, chat.layeredMemories, chat.memberIds, isDeveloperView]);

  const visibleMemories = isDeveloperView ? layeredMemories : layeredMemories.filter((item) => item.layer !== 'working').slice(0, 4);
  const memorySummary = visibleMemories.slice(0, 3).map((item) => item.text).join(' / ');

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态观察</Typography>
          <Typography variant="body2" color="text.secondary">
            {isDeveloperView ? '这里展示群聊在长期运行中沉淀出的完整运行态与记忆调试信息。' : (memorySummary || '这里展示群聊运行后逐渐沉淀下来的关键状态与关系变化。')}
          </Typography>
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {firstRelationshipLabel ? <Chip size="small" label={firstRelationshipLabel} variant="outlined" /> : null}
            {topInteractionChip ? <Chip size="small" label={topInteractionChip} variant="outlined" /> : null}
            {roomShiftDeltaLabel ? <Chip size="small" label={roomShiftDeltaLabel} variant="outlined" /> : null}
            {primaryRecentEvent ? <Chip size="small" label={primaryRecentEvent.slice(0, 24)} variant="outlined" /> : null}
          </Box>
          {roomStateChips.length ? (
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {roomStateChips.map((item) => <Chip key={item.key} size="small" label={item.label} />)}
            </Box>
          ) : null}
          {dominantThreadLabel || allianceLabels.length || conflictLabels.length ? (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {dominantThreadLabel ? <Typography variant="caption" color="text.secondary">主线程：{dominantThreadLabel}</Typography> : null}
              {allianceLabels.length ? <Typography variant="caption" color="text.secondary">联盟：{allianceLabels.slice(0, 3).join(' / ')}</Typography> : null}
              {conflictLabels.length ? <Typography variant="caption" color="text.secondary">对线：{conflictLabels.slice(0, 3).join(' / ')}</Typography> : null}
            </Stack>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>群聊状态</Typography>
          <Stack spacing={1.25}>
            <Stack spacing={1}>
              <Typography variant="body2"><strong>阶段：</strong>{chat.worldState.phase || 'idle'}</Typography>
              <Typography variant="body2"><strong>气氛：</strong>{chat.worldState.mood || '未设置'}</Typography>
              <Typography variant="body2"><strong>焦点：</strong>{chat.worldState.focus || '未设置'}</Typography>
              <Typography variant="body2"><strong>最近事件：</strong>{primaryRecentEvent || '暂无'}</Typography>
              {structuredRoomState ? (
                <>
                  <Typography variant="body2"><strong>主线程：</strong>{dominantThreadLabel || '暂无'}</Typography>
                  <Typography variant="body2"><strong>围攻目标：</strong>{structuredRoomState.pileOnTarget ? (members.find((item) => item.id === structuredRoomState.pileOnTarget)?.name || structuredRoomState.pileOnTarget) : '无'}</Typography>
                </>
              ) : null}
              {(chat.worldState.conflictAxes || []).length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                  {(chat.worldState.conflictAxes || []).map((axis) => <Chip key={axis.title} size="small" label={`${axis.title} ${axis.currentTilt && axis.currentTilt > 0 ? axis.poles[0] : axis.poles[1]}`} />)}
                </Box>
              ) : null}
            </Stack>
            {isDeveloperView ? (
              <SimpleBarChart
                title="群聊运行指标"
                items={metricItems}
              />
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isDeveloperView ? '成员关系发展' : '关系变化'}</Typography>
          {relationshipPairs.length ? (
            <Stack spacing={1}>
              {relationshipPairs.map((item, index) => (
                <Box key={`${item.source}-${item.target}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{item.source} → {item.target}</Typography>
                    <Chip size="small" color={item.score >= 0 ? 'success' : 'warning'} label={item.score >= 0 ? `升温 ${item.score}` : `紧张 ${Math.abs(item.score)}`} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{getRelationNote(item) || (item.score >= 0 ? '关系升温中' : '关系紧张中')}</Typography>
                  {isDeveloperView ? (
                    <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
                      {[
                        ['亲近', item.relation.affinity],
                        ['尊重', item.relation.respect],
                        ['敌意', item.relation.hostility],
                        ['轻视', item.relation.contempt],
                      ].map(([label, value]) => (
                        <Box key={String(label)}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography variant="caption" color="text.secondary">{value}</Typography>
                          </Box>
                          <LinearProgress variant="determinate" value={Number(value)} sx={{ height: 5, borderRadius: 999 }} />
                        </Box>
                      ))}
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无明显关系变化' : '暂无突出关系变化'}</Typography>}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>运行视图</Typography>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              <Chip size="small" label="时间线" color={viewMode === 'timeline' ? 'primary' : 'default'} variant={viewMode === 'timeline' ? 'filled' : 'outlined'} onClick={() => setViewMode('timeline')} />
              <Chip size="small" label="关系图谱" color={viewMode === 'graph' ? 'primary' : 'default'} variant={viewMode === 'graph' ? 'filled' : 'outlined'} onClick={() => setViewMode('graph')} />
            </Box>
          </Box>
          {viewMode === 'timeline' ? (
            <>
              {isDeveloperView && !!(chat.layeredMemories || []).length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                  {(chat.layeredMemories || []).slice(-6).map((item) => <Chip key={item.id} size="small" label={`${item.scope}/${item.kind}${item.subjectIds?.length ? ` (${item.subjectIds.join('↔')})` : ''}`} variant="outlined" />)}
                </Box>
              ) : null}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                {[
                  ['all', '全部'],
                  ['note', isDeveloperView ? '沉淀记忆' : '记忆'],
                  ['artifact', '成果'],
                  ['relationship', '关系'],
                ].map(([value, label]) => (
                  <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'note' | 'artifact' | 'relationship')} />
                ))}
              </Box>
              {displayTimeline.length ? (
                <Stack spacing={1}>
                  {displayTimeline.map((item, index) => (
                    <Box key={buildRuntimeEventKey(item, index)} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      {isDeveloperView ? <Typography variant="caption" color="text.secondary">{item.label} · {new Date(item.createdAt).toLocaleString()}</Typography> : null}
                      <Typography variant="body2">{item.text}</Typography>
                      {readMemoryCandidateMeta(item) ? (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                          <Chip size="small" label={`类型 ${readMemoryCandidateMeta(item)?.kind}`} variant="outlined" />
                          <Chip size="small" label={`显著性 ${readMemoryCandidateMeta(item)?.salience.toFixed(2)}`} variant="outlined" />
                          <Chip size="small" label={`置信 ${formatPercent(readMemoryCandidateMeta(item)?.confidence)}`} variant="outlined" />
                        </Box>
                      ) : null}
                      {readRelationshipDeltaMeta(item) ? (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                          <Chip size="small" label={`关系 ${readRelationshipDeltaMeta(item)?.reason}`} variant="outlined" />
                          <Chip size="small" label={`亲近 ${formatSignedNumber(readRelationshipDeltaMeta(item)?.delta.affinity)}`} variant="outlined" />
                          <Chip size="small" label={`尊重 ${formatSignedNumber(readRelationshipDeltaMeta(item)?.delta.respect)}`} variant="outlined" />
                          <Chip size="small" label={`敌意 ${formatSignedNumber(readRelationshipDeltaMeta(item)?.delta.hostility)}`} variant="outlined" />
                          <Chip size="small" label={`轻视 ${formatSignedNumber(readRelationshipDeltaMeta(item)?.delta.contempt)}`} variant="outlined" />
                        </Box>
                      ) : null}
                      {readRoomShiftMeta(item)?.delta ? (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                          <Chip size="small" label={`热度 ${formatSignedNumber(readRoomShiftMeta(item)?.delta?.heat)}`} variant="outlined" />
                          <Chip size="small" label={`凝聚 ${formatSignedNumber(readRoomShiftMeta(item)?.delta?.cohesion)}`} variant="outlined" />
                          <Chip size="small" label={`跑题 ${formatSignedNumber(readRoomShiftMeta(item)?.delta?.topicDrift)}`} variant="outlined" />
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              ) : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '当前筛选下暂无运行时间线' : '当前暂无关键变化'}</Typography>}
            </>
          ) : relationshipPairs.length ? (
            <Stack spacing={1}>
              {relationshipPairs.map((item, index) => (
                <Box key={`${item.source}-${item.target}-graph-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.source} ⇄ {item.target}</Typography>
                  {isDeveloperView ? (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                      <Chip size="small" color="success" label={`亲近 ${item.relation.affinity}`} />
                      <Chip size="small" color="info" label={`尊重 ${item.relation.respect}`} />
                      <Chip size="small" color="warning" label={`敌意 ${item.relation.hostility}`} />
                      <Chip size="small" color="error" label={`轻视 ${item.relation.contempt}`} />
                    </Box>
                  ) : <Typography variant="caption" color="text.secondary">{getRelationNote(item) || '关系持续演化中'}</Typography>}
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>}

          {structuredRoomState?.silencedActors.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>被压制成员</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {structuredRoomState.silencedActors.map((actorId) => <Chip key={actorId} size="small" label={members.find((item) => item.id === actorId)?.name || actorId} />)}
              </Box>
            </Box>
          ) : null}

          {structuredRoomState?.alliances.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>最近联盟</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {allianceLabels.slice(0, 6).map((label) => <Chip key={label} size="small" label={label} variant="outlined" />)}
              </Box>
            </Box>
          ) : null}

          {structuredRoomState?.conflictPairs.length ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>主要对线</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {conflictLabels.slice(0, 6).map((label) => <Chip key={label} size="small" label={label} variant="outlined" />)}
              </Box>
            </Box>
          ) : null}

          {!structuredRoomState && !(chat.runtimeEventsV2 || []).length ? null : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              当前面板优先展示本地 reducer 推导出的结构化互动、关系账本与房间态势。
            </Typography>
          )}

        </CardContent>
      </Card>


      <PrivatePayloadPanel payloads={privatePayloads} />
      {isSpeechStyleView ? <DialogueDebugPanel chat={chat} /> : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isDeveloperView ? '记忆体系' : '关键记忆'}</Typography>
          {visibleMemories.length ? (
            <Stack spacing={1.25}>
              {visibleMemories.map((item) => (
                <Box key={item.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                  {isDeveloperView ? (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 0.75 }}>
                      <Chip size="small" label={item.layer} color={item.layer === 'long_term' ? 'primary' : item.layer === 'episodic' ? 'secondary' : 'default'} />
                      <Chip size="small" label={item.scope} variant="outlined" />
                      <Chip size="small" label={item.kind} variant="outlined" />
                      {item.subjectIds?.length ? <Chip size="small" label={item.subjectIds.join(' ↔ ')} variant="outlined" /> : null}
                    </Box>
                  ) : null}
                  <Typography variant="body2" sx={{ mb: 0.5 }}>{item.text}</Typography>
                  {isDeveloperView ? (
                    <>
                      <Typography variant="caption" color="text.secondary">强化 {item.reinforcementCount} · 置信 {(item.confidence * 100).toFixed(0)}%</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>owner={item.ownerId} · recency={item.recency.toFixed(2)} · salience={item.salience.toFixed(2)}</Typography>
                    </>
                  ) : null}
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">{isDeveloperView ? '暂无结构化记忆' : '暂无明显沉淀'}</Typography>
          )}
        </CardContent>
      </Card>

      {isDeveloperView ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成果 / 可扩展</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {['群聊记忆', '事件时间线', '关系图谱', '精彩片段', '衍生文件'].map((item) => <Chip key={item} label={item} size="small" variant="outlined" />)}
            </Box>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
