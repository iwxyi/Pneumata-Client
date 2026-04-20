import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { retrieveRelevantMemories } from '../../services/memoryRetrieval';
import type { MemoryItem } from '../../services/memoryTypes';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { useSettingsStore } from '../../stores/useSettingsStore';
import SimpleBarChart from '../common/SimpleBarChart';

interface ChatRuntimePanelProps {
  chat: GroupChat;
  members: AICharacter[];
}

export default function ChatRuntimePanel({ chat, members }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showDeveloperMemory = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const isDeveloperView = developerMode && showDeveloperMemory;

  const relationshipPairs = members.flatMap((member) =>
    member.relationships
      .filter((relation) => Boolean(relation.note?.trim()) || Math.abs(relation.affinity + relation.respect - relation.hostility - relation.contempt) >= 15 || relation.affinity >= 60 || relation.respect >= 60 || relation.hostility >= 35 || relation.contempt >= 35)
      .slice(0, 2)
      .map((relation) => ({
        source: member.name,
        target: members.find((item) => item.id === relation.characterId)?.name || relation.characterId,
        relation,
        score: relation.affinity + relation.respect - relation.hostility - relation.contempt,
      }))
  ).slice(0, isDeveloperView ? 8 : 4);
  const filteredTimeline = useMemo(() => {
    const items = chat.runtimeTimeline || [];
    const filtered = timelineFilter === 'all' ? items : items.filter((item) => item.type === timelineFilter);
    return filtered.slice().reverse().slice(0, isDeveloperView ? 10 : 6);
  }, [chat.runtimeTimeline, timelineFilter, isDeveloperView]);

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
              <Typography variant="body2"><strong>最近事件：</strong>{chat.worldState.recentEvent || '暂无'}</Typography>
              {(chat.worldState.conflictAxes || []).length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                  {(chat.worldState.conflictAxes || []).map((axis) => <Chip key={axis.title} size="small" label={`${axis.title} ${axis.currentTilt && axis.currentTilt > 0 ? axis.poles[0] : axis.poles[1]}`} />)}
                </Box>
              ) : null}
            </Stack>
            {isDeveloperView ? (
              <SimpleBarChart
                title="群聊运行指标"
                items={[
                  { label: '成员数', value: members.length * 10, color: '#6750A4' },
                  { label: '运行笔记', value: (chat.runtimeNotes?.length || 0) * 10, color: '#4E7E6B' },
                  { label: '成果物', value: (chat.runtimeArtifacts?.length || 0) * 10, color: '#B26A00' },
                  { label: '时间线事件', value: (chat.runtimeTimeline?.length || 0) * 5, color: '#C62828' },
                ]}
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
                  <Typography variant="caption" color="text.secondary">{item.relation.note || (item.score >= 0 ? '关系升温中' : '关系紧张中')}</Typography>
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
              {filteredTimeline.length ? (
                <Stack spacing={1}>
                  {filteredTimeline.map((item, index) => (
                    <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      {isDeveloperView ? <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography> : null}
                      <Typography variant="body2">{item.text}</Typography>
                    </Box>
                  ))}
                </Stack>
              ) : <Typography variant="caption" color="text.secondary">{isDeveloperView ? '当前筛选下暂无运行时间线' : '当前暂无关键变化'}</Typography>}
            </>
          ) : (
            relationshipPairs.length ? (
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
                    ) : <Typography variant="caption" color="text.secondary">{item.relation.note || '关系持续演化中'}</Typography>}
                  </Box>
                ))}
              </Stack>
            ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>
          )}
        </CardContent>
      </Card>

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
