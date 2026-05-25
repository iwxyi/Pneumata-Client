import { useState } from 'react';
import { Card, CardContent, Chip, Stack, TextField, Typography, Tooltip, Box } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { ChatStyle, GroupChat, RuntimeEvolutionIntensity } from '../../types/chat';
import { formatConflictHookLabels, formatConflictPressureLabel, formatConflictStageLabel, formatConflictTypeLabel } from '../../services/runtimeEventFactory';
import type { ConflictFocusState } from '../../types/runtimeEvent';
import { classifyRuntimeArtifactSeedLine } from '../../services/runtimeSeed';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import LayeredMemoryPanel from '../memory/LayeredMemoryPanel';
import DebugChip from '../common/DebugChip';

interface RuntimeSeedSectionProps {
  editingChatId?: string;
  editingChatCreatedAt?: number;
  editingChatUpdatedAt?: number;
  editingChatLastMessageAt?: number;
  editingChatTimeline?: Array<{ type: 'note' | 'artifact' | 'relationship'; text: string; createdAt: number }>;
  editingChatRuntimeEvents?: GroupChat['runtimeEventsV2'];
  editingChatRelationshipLedger?: GroupChat['relationshipLedger'];
  editingChatLayeredMemories?: GroupChat['layeredMemories'];
  editingChatConflictAxes?: GroupChat['worldState']['conflictAxes'];
  editingChatConflictState?: GroupChat['worldState']['conflictState'];
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  selectedMembers: string[];
  showRoleActions: boolean;
  ownerCharacterId: string;
  adminCharacterIds: string[];
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  mood: string;
  focus: string;
  recentEvent: string;
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
  seedMemoryText: string;
  seedArtifactText: string;
  setSeedMemoryText: (value: string) => void;
  setSeedArtifactText: (value: string) => void;
  runtimePhaseLabel: string;
  runtimeMoodLabel: string;
  runtimeFocusLabel: string;
  runtimeRecentEventLabel: string;
  selectedCharacters: AICharacter[];
}

const STYLE_LABELS: Partial<Record<ChatStyle, string>> = {
  free: '自由聊天',
  debate: '辩论',
  brainstorm: '头脑风暴',
  roleplay: '角色扮演',
};

type ConflictRelationFilter = 'all' | 'active' | 'axis' | 'history' | 'relationship';

function formatDateTime(value?: number) {
  if (!value) return '无';
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function runtimeIntensityLabel(value: RuntimeEvolutionIntensity) {
  return value === 'slow' ? '慢' : value === 'fast' ? '快' : '平衡';
}

function isLikelyInternalId(value: string) {
  return /^[0-9a-f-]{18,}$/i.test(value) || /^draft-\d+$/i.test(value);
}

function resolveName(id: string | undefined, characters: AICharacter[]) {
  if (!id) return '未设置';
  const matched = characters.find((character) => character.id === id)?.name;
  if (matched) return matched;
  return isLikelyInternalId(id) ? '未知成员' : id;
}

function buildNameMap(characters: AICharacter[]) {
  return new Map(characters.map((character) => [character.id, character.name] as const));
}

function cleanRuntimeText(text: string | undefined, nameMap: Map<string, string>) {
  return sanitizeUserFacingText(String(text || '').trim(), Array.from(nameMap.entries()).map(([id, name]) => ({ id, name })));
}

function clampDisplayMetric(value: number | undefined) {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.round(Math.max(-100, Math.min(100, safe)));
}

function formatRelationshipValue(value: number | undefined) {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return clampDisplayMetric(safe);
}

function formatAxisBias(value: number | undefined) {
  const score = clampDisplayMetric(value);
  const strength = Math.abs(score) >= 60 ? '强' : Math.abs(score) >= 32 ? '中' : '弱';
  return strength;
}

function formatRelationshipDimension(label: string, value: number | undefined, threshold = 8) {
  const score = formatRelationshipValue(value);
  if (Math.abs(score) < threshold) return null;
  const level = Math.abs(score) >= 60 ? '很高' : Math.abs(score) >= 32 ? '偏高' : '略高';
  if (score < 0) {
    const negativeLevel = Math.abs(score) >= 60 ? '很低' : Math.abs(score) >= 32 ? '偏低' : '略低';
    return `${label}${negativeLevel}（${score}）`;
  }
  return `${label}${level}（${score}）`;
}

function tooltipText(text: string, title: string) {
  return (
    <Tooltip title={title} arrow placement="top-start">
      <Box component="span" sx={{ cursor: 'help', '&:hover': { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } }}>{text}</Box>
    </Tooltip>
  );
}

function summarizeLifecycleTitle(title: string) {
  return title.replace(/\n/g, ' / ');
}

function buildAxisEvidence(axis: NonNullable<GroupChat['worldState']['conflictAxes']>[number]) {
  return [
    `长期张力轴：${axis.poles[0]} vs ${axis.poles[1]}。当前偏向来自最近多轮互动对这条轴的累积影响。`,
    '它不是一场正在发生的争吵，而是群聊长期容易滑向的关系或立场方向。',
  ].join('\n');
}

function buildConflictEvidence(conflict: ConflictFocusState, nameMap: Map<string, string>) {
  const participants = conflict.participantIds.map((id) => nameMap.get(id) || (isLikelyInternalId(id) ? '未知成员' : id)).join('、');
  const hooks = conflict.developmentHooks.length ? `建议：${formatConflictHookLabels(conflict.developmentHooks).join(' / ')}` : '';
  return [participants ? `参与者：${participants}` : '', hooks, conflict.sourceEventIds.length ? `已参考 ${conflict.sourceEventIds.length} 条近期变化` : ''].filter(Boolean).join('\n');
}

function latestRelationshipEvidence(item: NonNullable<GroupChat['relationshipLedger']>[number], nameMap: Map<string, string>) {
  const axisEvidence = Object.values(item.axisReasons || {}).flat().slice(-1)[0];
  const recentEvent = item.recentEvents?.at(-1);
  return cleanRuntimeText(axisEvidence?.evidence || recentEvent?.summary || '', nameMap);
}

function buildRelationshipLine(item: NonNullable<GroupChat['relationshipLedger']>[number], characters: AICharacter[]) {
  const semantic = item.derived?.semantic?.summary;
  const dimensions = [
    formatRelationshipDimension('信任', item.current.trust),
    formatRelationshipDimension('威胁感', item.current.threat, 12),
    formatRelationshipDimension('亲和', item.current.warmth),
    formatRelationshipDimension('能力判断', item.current.competence),
  ].filter(Boolean);
  return {
    title: `${resolveName(item.actorId, characters)} -> ${resolveName(item.targetId, characters)}`,
    body: semantic || '',
    detail: dimensions.join(' / '),
  };
}

function buildConflictItems(props: RuntimeSeedSectionProps, nameMap: Map<string, string>, includeDebug: boolean) {
  const directConflicts = [
    props.editingChatConflictState?.primaryConflict,
    ...(props.editingChatConflictState?.activeConflicts || []),
  ].filter((item): item is ConflictFocusState => Boolean(item));
  const unique = new Map<string, ConflictFocusState>();
  directConflicts.forEach((item) => unique.set(item.id, item));

  const eventConflicts = (props.editingChatRuntimeEvents || [])
    .filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload?.eventType === 'conflict_focus_shift' || event.summary.includes('矛盾') || event.summary.includes('冲突');
    })
    .slice(-4)
    .reverse()
    .map((event) => ({
      id: event.id,
      category: 'history' as const,
      summary: cleanRuntimeText(event.summary, nameMap),
      meta: '历史冲突事件',
      tooltip: cleanRuntimeText(event.summary, nameMap),
    }));

  const axisConflicts = (props.editingChatConflictAxes || [])
    .filter((axis) => Math.abs(axis.currentTilt || 0) >= 12)
    .slice(0, 4)
    .map((axis, index) => ({
      id: `axis-${index}`,
      category: 'axis' as const,
      summary: axis.title,
      meta: includeDebug
        ? `长期张力 / 当前偏向：${(axis.currentTilt || 0) > 0 ? axis.poles[0] : axis.poles[1]} / 强度 ${formatAxisBias(axis.currentTilt)}`
        : `长期张力 / 当前偏向：${(axis.currentTilt || 0) > 0 ? axis.poles[0] : axis.poles[1]}`,
      tooltip: buildAxisEvidence(axis),
    }));

  const items = [
    ...Array.from(unique.values()).map((conflict) => ({
      id: conflict.id,
      category: 'active' as const,
      summary: cleanRuntimeText(conflict.summary, nameMap),
      meta: includeDebug
        ? `活跃矛盾 / ${formatConflictTypeLabel(conflict.type)} / ${formatConflictStageLabel(conflict.stage)} / ${formatConflictPressureLabel(conflict.nextPressure)} / 强度 ${Math.round(conflict.severity * 100)}%`
        : `活跃矛盾 / ${formatConflictStageLabel(conflict.stage)} / ${formatConflictPressureLabel(conflict.nextPressure)}`,
      tooltip: buildConflictEvidence(conflict, nameMap),
    })),
    ...axisConflicts,
    ...eventConflicts,
  ];

  return {
    items,
    counts: {
      active: unique.size,
      axes: axisConflicts.length,
      history: eventConflicts.length,
    },
  };
}

function buildArtifactWarning(seedArtifactText: string, nameMap: Map<string, string>) {
  const artifacts = seedArtifactText.split('\n').map((item) => cleanRuntimeText(item.trim(), nameMap)).filter(Boolean);
  const classified = artifacts.map((item) => classifyRuntimeArtifactSeedLine(item));
  const validArtifacts = classified.filter((item) => item.valid).map((item) => item.text);
  const suspicious = classified.filter((item) => !item.valid).map((item) => item.text);
  return { artifacts: validArtifacts, suspicious };
}

export default function RuntimeSeedSection(props: RuntimeSeedSectionProps) {
  const [conflictRelationFilter, setConflictRelationFilter] = useState<ConflictRelationFilter>('all');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showRuntimeDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug || state.developerUI.showAdvancedRuntimePanels);
  const includeDebug = developerMode && showRuntimeDebug;
  const nameMap = buildNameMap(props.selectedCharacters);
  const conflictProjection = buildConflictItems(props, nameMap, includeDebug);
  const layeredMemoryItems = (props.editingChatLayeredMemories || []).slice().reverse();
  const relationshipItems = (props.editingChatRelationshipLedger || [])
    .slice()
    .sort((left, right) => (right.derived?.salience || 0) - (left.derived?.salience || 0))
    .slice(0, 4);
  const visibleConflictItems = conflictProjection.items.filter((item) => conflictRelationFilter === 'all' || item.category === conflictRelationFilter);
  const conflictRelationChips: Array<{ value: ConflictRelationFilter; label: string; count: number }> = [
    { value: 'all', label: '全部', count: conflictProjection.items.length },
    { value: 'active', label: '活跃矛盾', count: conflictProjection.counts.active },
    { value: 'axis', label: '长期张力', count: conflictProjection.counts.axes },
    { value: 'history', label: '历史冲突', count: conflictProjection.counts.history },
  ];
  const { artifacts, suspicious } = buildArtifactWarning(props.seedArtifactText, nameMap);
  const lifecycleTitle = [
    `创建 ${formatDateTime(props.editingChatCreatedAt)}`,
    `更新 ${formatDateTime(props.editingChatUpdatedAt)}`,
    `最后消息 ${formatDateTime(props.editingChatLastMessageAt)}`,
  ].join('\n');
  const styleLabel = STYLE_LABELS[props.style] || '自定义风格';
  const memorySourceSummary = `${styleLabel} · ${props.selectedMembers.length} 名成员 · 变化${runtimeIntensityLabel(props.runtimeEvolutionIntensity)}`;
  const memorySourceTooltip = [
    `会话：${props.name || '未命名'} / ${styleLabel}`,
    `主题：${props.topic || '未设置'}`,
    `成员：${props.selectedMembers.length} 人`,
    `变化强度：${runtimeIntensityLabel(props.runtimeEvolutionIntensity)}`,
    includeDebug ? `阶段：${props.runtimePhaseLabel} / 气氛：${props.runtimeMoodLabel} / 焦点：${props.runtimeFocusLabel}` : '',
    includeDebug ? `最近事件：${cleanRuntimeText(props.runtimeRecentEventLabel, nameMap)}` : '',
    includeDebug ? summarizeLifecycleTitle(lifecycleTitle) : '',
  ].filter(Boolean).join('\n');
  const conflictSummary = `活跃 ${conflictProjection.counts.active} / 张力 ${conflictProjection.counts.axes} / 历史 ${conflictProjection.counts.history}`;
  const relationshipSummary = `关系 ${relationshipItems.length} 条`;
  return (
    <Stack spacing={2}>
      <LayeredMemoryPanel
        title="记忆沉淀"
        memories={layeredMemoryItems}
        emptyText="暂无沉淀记忆"
        collapsedCount={4}
        expandedCount={16}
        includeRuntimeEvidence={includeDebug}
        showDebugChip={false}
        formatMemoryText={(value) => cleanRuntimeText(value, nameMap)}
      />

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>开场背景</Typography>
          </Box>
          <Stack spacing={2}>
            <Box>
              <Tooltip title="每行一条，适合写成大家已知的前情、共识、关系背景或房间默认设定。" placement="top-start">
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, width: 'fit-content', cursor: 'help' }}>前情设定</Typography>
              </Tooltip>
              <TextField
                value={props.seedMemoryText}
                onChange={(e) => props.setSeedMemoryText(e.target.value)}
                multiline
                rows={4}
                fullWidth
                placeholder={`例如：
大家默认知道记者小陈最近在追一条匿名爆料
心理医生和律师曾在上一轮争论过保密边界`}
              />
            </Box>
            <Box>
              <Tooltip title="只有准备预置清单、计划、纪要、结论、时间线等可引用内容时才需要；留空即可。" placement="top-start">
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, width: 'fit-content', cursor: 'help' }}>已有清单/结论</Typography>
              </Tooltip>
              <TextField
                value={props.seedArtifactText}
                onChange={(e) => props.setSeedArtifactText(e.target.value)}
                multiline
                rows={3}
                fullWidth
                placeholder={`例如：
待核实线索清单
已公开版本时间线`}
              />
              {suspicious.length ? (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>
                  检测到 {suspicious.length} 条可能不是清单或结论，保存时建议移到“前情设定”或直接删除。
                </Typography>
              ) : artifacts.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>当前产物 {artifacts.length} 条</Typography> : null}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary">下面只整理会话级记忆来源。当前轮运行、最近发言和调度原因请在聊天页运行态查看。</Typography>

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>记忆来源</Typography>
            {includeDebug ? <Box sx={{ ml: 'auto' }}><DebugChip /></Box> : null}
          </Box>
          <Stack spacing={0.75}>
            <Typography variant="body2">{tooltipText(memorySourceSummary, memorySourceTooltip)}</Typography>
            <Typography variant="caption" color="text.secondary">用于决定前情、长期记忆、矛盾记忆和关系记忆如何沉淀，不展示当前聊天页的动态运行状态。</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>矛盾记忆</Typography>
            {includeDebug ? <Box sx={{ ml: 'auto' }}><DebugChip /></Box> : null}
          </Box>
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {conflictRelationChips.map((item) => (
                <Chip
                  key={item.value}
                  size="small"
                  label={`${item.label} ${item.count}`}
                  color={conflictRelationFilter === item.value ? 'primary' : 'default'}
                  variant={conflictRelationFilter === item.value ? 'filled' : 'outlined'}
                  onClick={() => setConflictRelationFilter(item.value)}
                />
              ))}
            </Stack>
            <Typography variant="body2">{tooltipText(conflictSummary, '从当前活跃矛盾、长期张力和历史冲突中整理出的会话记忆依据。')}</Typography>
            {visibleConflictItems.length ? visibleConflictItems.map((item) => (
              <Box key={item.id} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="body2">{item.tooltip ? tooltipText(item.summary, item.tooltip) : item.summary}</Typography>
                <Typography variant="caption" color="text.secondary">{item.tooltip ? tooltipText(item.meta, item.tooltip) : item.meta}</Typography>
              </Box>
            )) : conflictRelationFilter !== 'relationship' ? <Typography variant="body2" color="text.secondary">暂无匹配的冲突记录</Typography> : null}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>关系记忆</Typography>
            {includeDebug ? <Box sx={{ ml: 'auto' }}><DebugChip /></Box> : null}
          </Box>
          <Stack spacing={1}>
            <Typography variant="body2">{tooltipText(relationshipSummary, '从关系账本中整理出的角色关系记忆。')}</Typography>
            {relationshipItems.length ? relationshipItems.map((item) => {
              const line = buildRelationshipLine(item, props.selectedCharacters);
              const evidence = latestRelationshipEvidence(item, nameMap);
              return (
                <Box key={item.pairKey} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="body2">{evidence ? tooltipText(line.body ? `${line.title}：${line.body}` : line.title, `最近证据：${evidence}`) : (line.body ? `${line.title}：${line.body}` : line.title)}</Typography>
                  {includeDebug && line.detail ? <Typography variant="caption" color="text.secondary">{line.detail}</Typography> : null}
                </Box>
              );
            }) : <Typography variant="body2" color="text.secondary">暂无关系记录</Typography>}
          </Stack>
        </CardContent>
      </Card>

    </Stack>
  );
}
