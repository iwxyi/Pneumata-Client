import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import SimpleBarChart from '../common/SimpleBarChart';

interface ChatRuntimePanelProps {
  chat: GroupChat;
  members: AICharacter[];
}

export default function ChatRuntimePanel({ chat, members }: ChatRuntimePanelProps) {
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'note' | 'artifact' | 'relationship'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const relationshipPairs = members.flatMap((member) =>
    member.relationships.slice(0, 2).map((relation) => ({
      source: member.name,
      target: members.find((item) => item.id === relation.characterId)?.name || relation.characterId,
      relation,
      score: relation.affinity + relation.respect - relation.hostility - relation.contempt,
    }))
  ).slice(0, 8);

  const filteredTimeline = useMemo(() => {
    const items = chat.runtimeTimeline || [];
    if (timelineFilter === 'all') return items;
    return items.filter((item) => item.type === timelineFilter);
  }, [chat.runtimeTimeline, timelineFilter]);

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态观察</Typography>
          <Typography variant="body2" color="text.secondary">
            这里展示群聊在长期运行中逐渐沉淀出来的状态、关系变化和可扩展结果。
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
            </Stack>
            <SimpleBarChart
              title="群聊运行指标"
              items={[
                { label: '成员数', value: members.length * 10, color: '#6750A4' },
                { label: '运行笔记', value: (chat.runtimeNotes?.length || 0) * 10, color: '#4E7E6B' },
                { label: '成果物', value: (chat.runtimeArtifacts?.length || 0) * 10, color: '#B26A00' },
                { label: '时间线事件', value: (chat.runtimeTimeline?.length || 0) * 5, color: '#C62828' },
              ]}
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成员关系发展</Typography>
          {relationshipPairs.length ? (
            <Stack spacing={1}>
              {relationshipPairs.map((item, index) => (
                <Box key={`${item.source}-${item.target}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{item.source} → {item.target}</Typography>
                    <Chip size="small" color={item.score >= 0 ? 'success' : 'warning'} label={item.score >= 0 ? `升温 ${item.score}` : `紧张 ${Math.abs(item.score)}`} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{item.relation.note || '关系持续演化中'}</Typography>
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
                </Box>
              ))}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">暂无明显关系变化</Typography>}
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
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
                {[
                  ['all', '全部'],
                  ['note', '沉淀记忆'],
                  ['artifact', '成果'],
                  ['relationship', '关系'],
                ].map(([value, label]) => (
                  <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'note' | 'artifact' | 'relationship')} />
                ))}
              </Box>
              {filteredTimeline.length ? (
                <Stack spacing={1}>
                  {filteredTimeline.slice().reverse().slice(0, 10).map((item, index) => (
                    <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography>
                      <Typography variant="body2">{item.text}</Typography>
                    </Box>
                  ))}
                </Stack>
              ) : <Typography variant="caption" color="text.secondary">当前筛选下暂无运行时间线</Typography>}
            </>
          ) : (
            relationshipPairs.length ? (
              <Stack spacing={1}>
                {relationshipPairs.map((item, index) => (
                  <Box key={`${item.source}-${item.target}-graph-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.source} ⇄ {item.target}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                      <Chip size="small" color="success" label={`亲近 ${item.relation.affinity}`} />
                      <Chip size="small" color="info" label={`尊重 ${item.relation.respect}`} />
                      <Chip size="small" color="warning" label={`敌意 ${item.relation.hostility}`} />
                      <Chip size="small" color="error" label={`轻视 ${item.relation.contempt}`} />
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : <Typography variant="caption" color="text.secondary">暂无关系图谱数据</Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成果 / 可扩展</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {['群聊记忆', '事件时间线', '关系图谱', '精彩片段', '衍生文件'].map((item) => <Chip key={item} label={item} size="small" variant="outlined" />)}
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
