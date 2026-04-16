import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import SimpleBarChart from '../common/SimpleBarChart';

interface RuntimeInsightsPanelProps {
  character: Partial<AICharacter>;
}

export default function RuntimeInsightsPanel({ character }: RuntimeInsightsPanelProps) {
  const [viewMode, setViewMode] = useState<'timeline' | 'graph'>('timeline');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'memory' | 'relationship' | 'drift'>('all');
  const relationships = character.relationships || [];
  const memory = character.memory;
  const behavior = character.behavior;
  const personalityDrift = character.personalityDrift || {};
  const timeline = useMemo(() => character.runtimeTimeline || [
    ...(memory?.longTerm || []).slice(-3).map((item) => ({ type: 'memory' as const, text: item, createdAt: Date.now() })),
    ...relationships.slice(-3).map((relation) => ({ type: 'relationship' as const, text: `${relation.note || relation.characterId} · ${relation.updatedAt ? new Date(relation.updatedAt).toLocaleString() : '最近更新'}`, createdAt: relation.updatedAt || Date.now() })),
    ...Object.entries(personalityDrift).map(([key, value]) => ({ type: 'drift' as const, text: `${key} ${value > 0 ? '+' : ''}${value}`, createdAt: Date.now() })),
  ], [character.runtimeTimeline, memory?.longTerm, relationships, personalityDrift]);
  const filteredTimeline = timelineFilter === 'all' ? timeline : timeline.filter((item) => item.type === timelineFilter);

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态观察</Typography>
          <Typography variant="body2" color="text.secondary">
            这里展示角色运行后逐渐沉淀出来的数据。当前支持记忆、关系、行为倾向，后面可继续扩展到情绪漂移、产出文件、图谱等。
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>长期记忆</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {(memory?.longTerm || []).length ? (memory?.longTerm || []).map((item) => <Chip key={item} label={item} size="small" />) : <Typography variant="caption" color="text.secondary">暂无长期记忆</Typography>}
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>关系状态</Typography>
          <Stack spacing={1}>
            {relationships.length ? relationships.slice(0, 5).map((relation, index) => (
              <Box key={`${relation.characterId}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{relation.note || relation.characterId}</Typography>
                <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
                  {[
                    ['亲近', relation.affinity],
                    ['尊重', relation.respect],
                    ['敌意', relation.hostility],
                    ['轻视', relation.contempt],
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
            )) : <Typography variant="caption" color="text.secondary">暂无关系沉淀</Typography>}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>性格 / 行为漂移</Typography>
          {behavior ? (
            <Stack spacing={1.25}>
              <SimpleBarChart
                title="行为强度"
                items={Object.entries(behavior).map(([key, value]) => ({ label: key, value: Number(value) }))}
              />
              {Object.keys(personalityDrift).length ? (
                <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {Object.entries(personalityDrift).map(([key, value]) => <Chip key={key} size="small" label={`${key} ${value > 0 ? '+' : ''}${value}`} />)}
                </Box>
              ) : null}
            </Stack>
          ) : <Typography variant="caption" color="text.secondary">暂无行为漂移数据</Typography>}
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
                  ['memory', '记忆'],
                  ['relationship', '关系'],
                  ['drift', '漂移'],
                ].map(([value, label]) => (
                  <Chip key={value} size="small" label={label} color={timelineFilter === value ? 'primary' : 'default'} variant={timelineFilter === value ? 'filled' : 'outlined'} onClick={() => setTimelineFilter(value as 'all' | 'memory' | 'relationship' | 'drift')} />
                ))}
              </Box>
              {filteredTimeline.length ? (
                <Stack spacing={1}>
                  {filteredTimeline.slice().reverse().slice(0, 8).map((item, index) => (
                    <Box key={`${item.type}-${item.createdAt}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">{item.type} · {new Date(item.createdAt).toLocaleString()}</Typography>
                      <Typography variant="body2">{item.text}</Typography>
                    </Box>
                  ))}
                </Stack>
              ) : <Typography variant="caption" color="text.secondary">当前筛选下暂无时间线数据</Typography>}
            </>
          ) : (
            relationships.length ? (
              <Stack spacing={1}>
                {relationships.slice(0, 8).map((relation, index) => (
                  <Box key={`${relation.characterId}-graph-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{relation.note || relation.characterId}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                      <Chip size="small" color="success" label={`亲近 ${relation.affinity}`} />
                      <Chip size="small" color="info" label={`尊重 ${relation.respect}`} />
                      <Chip size="small" color="warning" label={`敌意 ${relation.hostility}`} />
                      <Chip size="small" color="error" label={`轻视 ${relation.contempt}`} />
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
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>未来可扩展</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {['情绪轨迹', '互动图谱', '记忆时间线', '生成文件', '事件摘要'].map((item) => <Chip key={item} label={item} size="small" variant="outlined" />)}
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
