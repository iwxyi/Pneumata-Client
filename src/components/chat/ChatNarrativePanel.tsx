import { useMemo, useState } from 'react';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';
import StatChipRow from '../common/StatChipRow';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { Message } from '../../types/message';
import type { NarrativeLineProjection, NarrativeLineType } from '../../services/narrativeProjection';
import { projectNarrativeLines } from '../../services/narrativeProjection';
import { projectRuntimePressure } from '../../services/runtimeDecision';
import { formatBeatType, formatDirectorSource, formatKnownReason, formatNarrativeLineStatus, formatNarrativeLineType } from '../../services/runtimeInsightPresentation';
import { buildNarrativeLineTooltip, formatNarrativeLineText, getNarrativeLineParticipantNames } from '../../services/narrativeLinePresentation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { compactPillChipSx } from '../../styles/interaction';

interface ChatNarrativePanelProps {
  chat: GroupChat;
  members: AICharacter[];
  messages?: Message[];
  hideTitle?: boolean;
}

type LineFilter = 'all' | 'main' | NarrativeLineType;

const LINE_FILTERS: Array<{ key: LineFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'main', label: '主线' },
  { key: 'conflict', label: '矛盾线' },
  { key: 'relationship', label: '关系线' },
  { key: 'faction', label: '阵营线' },
  { key: 'growth', label: '成长线' },
  { key: 'goal', label: '目标线' },
  { key: 'mystery', label: '暗线' },
  { key: 'scenario', label: '场景线' },
  { key: 'topic', label: '话题线' },
];

function lineTone(line: NarrativeLineProjection) {
  if (line.type === 'conflict') return 'rgba(244, 67, 54, 0.06)';
  if (line.type === 'faction') return 'rgba(46, 125, 50, 0.06)';
  if (line.type === 'growth') return 'rgba(25, 118, 210, 0.06)';
  if (line.type === 'mystery') return 'rgba(123, 31, 162, 0.06)';
  if (line.type === 'goal') return 'rgba(2, 136, 209, 0.06)';
  if (line.type === 'scenario') return 'rgba(245, 124, 0, 0.06)';
  return 'action.hover';
}

function hoverableText(text: string, tooltip: string, variant: 'caption' | 'body2' = 'caption') {
  if (!tooltip) return <Typography variant={variant}>{text}</Typography>;
  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{tooltip}</Box>} arrow placement="top-start">
      <Typography
        component="span"
        variant={variant}
        sx={{
          cursor: 'help',
          '&:hover': { textDecoration: 'underline dotted', textUnderlineOffset: '3px' },
        }}
      >
        {text}
      </Typography>
    </Tooltip>
  );
}

function simplifyRelationshipSummary(summary: string) {
  return summary
    .replace(/^(.+?)\s*对\s*(.+?)：/, '')
    .replace(/^(.+?)\s*和\s*(.+?)的互动正在形成新的关系倾向。?$/, '新的关系倾向')
    .replace(/[。.]$/g, '')
    .trim();
}

function relationshipSummaryChips(summary: string) {
  const compact = simplifyRelationshipSummary(summary);
  if (!compact) return [];
  const chips = compact
    .split(/[，、/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (/找补|缓和|靠近/.test(summary) && !chips.some((item) => /找补|缓和|靠近/.test(item))) {
    return ['找补/缓和', ...chips].slice(0, 3);
  }
  return chips;
}

function renderRelationshipChips(items: string[], tooltip: string) {
  if (!items.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 0.7 }}>
      {items.map((item) => (
        <Tooltip key={item} title={<Box sx={{ whiteSpace: 'pre-line' }}>{tooltip}</Box>} arrow placement="top-start">
          <Chip
            size="small"
            label={item}
            variant="outlined"
            sx={{ ...compactPillChipSx, '&:hover': { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

function renderRelationshipLine(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[], messages: Message[]) {
  const tooltip = buildNarrativeLineTooltip({ line, chat, members, messages });
  const nextBeat = line.possibleNextBeats[0];
  const title = formatNarrativeLineText(line.title, members);
  const summary = formatNarrativeLineText(line.summary, members);
  const chips = relationshipSummaryChips(summary);
  return (
    <Box key={line.id} sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: lineTone(line) }}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip size="small" label={formatNarrativeLineStatus(line.status)} variant="outlined" sx={compactPillChipSx} />
        <Box sx={{ fontWeight: 700 }}>{hoverableText(title, tooltip, 'body2')}</Box>
      </Stack>
      {chips.length ? renderRelationshipChips(chips, tooltip) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45 }}>{simplifyRelationshipSummary(summary)}</Typography>
      )}
      {nextBeat ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.55 }}>
          {hoverableText(`可能走向：${formatBeatType(nextBeat.beatType)}`, '用于提示这条线接下来可能发展的方向，不会强制锁定剧情。')}
        </Typography>
      ) : null}
    </Box>
  );
}

function hasStoryAssets(chat: GroupChat) {
  const state = chat.scenarioState;
  return Boolean(
    state?.chapterRecap
    || state?.chapterMemory
    || state?.openQuestions?.length
    || state?.clues?.length
    || state?.stakes?.length
    || state?.relationshipShifts?.length
    || state?.choiceHistory?.length,
  );
}

function renderAssetChips(label: string, values: string[] | undefined, members: AICharacter[]) {
  const visible = (values || []).map((item) => formatNarrativeLineText(item, members)).filter(Boolean).slice(-4);
  if (!visible.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>{label}</Typography>
      <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {visible.map((item) => (
          <Chip key={item} size="small" label={item} variant="outlined" sx={compactPillChipSx} />
        ))}
      </Stack>
    </Box>
  );
}

function renderChoiceHistory(chat: GroupChat, members: AICharacter[]) {
  const choices = (chat.scenarioState?.choiceHistory || []).slice(-5);
  if (!choices.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>已走路径</Typography>
      <Stack spacing={0.55}>
        {choices.map((choice, index) => (
          <Box key={`${choice.branchId || choice.label}:${choice.choiceEpoch || index}`} sx={{ px: 0.8, py: 0.65, borderRadius: 1.5, bgcolor: 'rgba(15,23,42,0.04)' }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
              {index + 1}. {formatNarrativeLineText(choice.label, members)}
            </Typography>
            {choice.risk || choice.reward ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {[choice.risk ? `风险：${choice.risk}` : '', choice.reward ? `收益：${choice.reward}` : ''].filter(Boolean).map((item) => formatNarrativeLineText(item, members)).join(' · ')}
              </Typography>
            ) : null}
            {choice.outcome ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                后果：{formatNarrativeLineText(choice.outcome, members)}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function renderUnchosenBranches(chat: GroupChat, members: AICharacter[]) {
  const branches = chat.scenarioState?.branches || [];
  const choiceEpochs = Array.from(new Set(
    (chat.scenarioState?.choiceHistory || [])
      .map((choice) => Number(choice.choiceEpoch || 0))
      .filter((epoch) => epoch > 0),
  )).slice(-3);
  const alternatives = choiceEpochs.flatMap((epoch) => branches
    .filter((branch) => Number(branch.choiceEpoch || 0) === epoch && branch.status === 'completed')
    .map((branch) => ({
      epoch,
      label: branch.label,
      risk: branch.risk,
      reward: branch.reward,
      intent: branch.intent,
    }))).slice(-6);
  if (!alternatives.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>当时还可以选择</Typography>
      <Stack spacing={0.55}>
        {alternatives.map((branch, index) => (
          <Box key={`${branch.epoch}:${branch.label}:${index}`} sx={{ px: 0.8, py: 0.65, borderRadius: 1.5, bgcolor: 'rgba(15,23,42,0.035)' }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
              {formatNarrativeLineText(branch.label, members)}
            </Typography>
            {branch.intent || branch.risk || branch.reward ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {[branch.intent ? `意图：${branch.intent}` : '', branch.risk ? `风险：${branch.risk}` : '', branch.reward ? `收益：${branch.reward}` : ''].filter(Boolean).map((item) => formatNarrativeLineText(item, members)).join(' · ')}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function formatStoryBeatKind(kind: string | undefined) {
  const labels: Record<string, string> = {
    establish: '开场',
    pressure: '加压',
    decision: '抉择',
    consequence: '后果',
    new_pressure: '新压力',
  };
  return kind ? labels[kind] || kind : '';
}

function renderStoryAssetSummary(chat: GroupChat, members: AICharacter[]) {
  if (!hasStoryAssets(chat)) return null;
  const state = chat.scenarioState || {};
  const recap = state.chapterRecap || null;
  const recentChoices = (state.choiceHistory || [])
    .slice(-3)
    .map((choice) => [choice.label, choice.risk ? `风险：${choice.risk}` : '', choice.reward ? `收益：${choice.reward}` : '', choice.outcome ? `后果：${choice.outcome}` : ''].filter(Boolean).join(' · '));
  return (
    <Box sx={{ p: { xs: 0.9, sm: 1 }, borderRadius: 2, bgcolor: 'rgba(123,31,162,0.06)' }}>
      <Stack spacing={0.85}>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="small" label={recap ? recap.title : '章节记忆'} variant="outlined" sx={compactPillChipSx} />
          {state.storyBeatKind ? <Chip size="small" label={formatStoryBeatKind(state.storyBeatKind)} variant="outlined" sx={compactPillChipSx} /> : null}
        </Stack>
        {recap ? (
          <>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {formatNarrativeLineText(recap.summary, members)}
            </Typography>
            {renderAssetChips('回顾线索', recap.discoveredClues, members)}
            {renderAssetChips('回顾悬念', recap.unresolvedQuestions, members)}
            {renderAssetChips('回顾关系', recap.changedRelationships, members)}
            {renderAssetChips('回顾代价', recap.stakes, members)}
            {renderAssetChips('回顾选择', recap.lastChoiceLabels, members)}
          </>
        ) : null}
        {state.chapterMemory ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {formatNarrativeLineText(state.chapterMemory, members)}
          </Typography>
        ) : null}
        {renderAssetChips('悬念', state.openQuestions, members)}
        {renderAssetChips('线索', state.clues, members)}
        {renderAssetChips('代价', state.stakes, members)}
        {renderAssetChips('关系压力', state.relationshipShifts, members)}
        {renderAssetChips('最近选择', recentChoices, members)}
        {renderChoiceHistory(chat, members)}
        {renderUnchosenBranches(chat, members)}
      </Stack>
    </Box>
  );
}

function renderLine(line: NarrativeLineProjection, chat: GroupChat, members: AICharacter[], messages: Message[], isZh: boolean, showDebugDetails: boolean) {
  if (line.type === 'relationship') return renderRelationshipLine(line, chat, members, messages);
  const names = getNarrativeLineParticipantNames(line, members);
  const tooltip = buildNarrativeLineTooltip({ line, chat, members, messages });
  const nextBeat = line.possibleNextBeats[0];
  const title = formatNarrativeLineText(line.title, members);
  const summary = formatNarrativeLineText(line.summary, members);
  const question = line.openQuestions[0] ? formatNarrativeLineText(line.openQuestions[0], members) : '';
  const nextReason = nextBeat?.reason ? formatNarrativeLineText(formatKnownReason(nextBeat.reason), members) : '';
  const visibleNames = names.filter((name) => !title.includes(name) && !summary.includes(name));
  return (
    <Box key={line.id} sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: lineTone(line) }}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Tooltip title={`${formatNarrativeLineType(line.type)} · ${formatNarrativeLineStatus(line.status)}`} arrow placement="top-start">
          <Chip size="small" label={formatNarrativeLineStatus(line.status)} variant="outlined" sx={{ ...compactPillChipSx, cursor: 'help' }} />
        </Tooltip>
        <Box sx={{ fontWeight: 700 }}>{hoverableText(title, tooltip, 'body2')}</Box>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{summary}</Typography>
      {visibleNames.length ? <Box sx={{ mt: 0.65 }}><StatChipRow items={visibleNames.slice(0, 4)} /></Box> : null}
      {question ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {hoverableText(question, '这条问题用于提醒后续剧情可继续发展的方向。')}
        </Typography>
      ) : null}
      {nextBeat ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {hoverableText(
            `${isZh ? '可能走向' : 'Likely direction'}：${formatBeatType(nextBeat.beatType)}`,
            `${isZh ? '用于提示这条线接下来可能发展的方向，不会强制锁定剧情。' : 'A hint for where this line may develop next, not a forced plot path.'}${showDebugDetails && nextReason ? `\n${nextReason}` : ''}`,
          )}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function ChatNarrativePanel({ chat, members, messages = [], hideTitle = false }: ChatNarrativePanelProps) {
  const [activeFilter, setActiveFilter] = useState<LineFilter>('all');
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const language = useSettingsStore((state) => state.language);
  const isZh = language.startsWith('zh');
  const showDebugDetails = developerMode && showAdvancedRuntimePanels;
  const runtimePressure = useMemo(() => projectRuntimePressure({ chat, characters: members, messages }), [chat, members, messages]);
  const narrativeLines = useMemo(() => projectNarrativeLines({ chat, characters: members, messages }), [chat, members, messages]);
  const mainLineId = runtimePressure.primaryLine?.id || narrativeLines[0]?.id || null;
  const showDirectorIntent = Boolean(runtimePressure.directorIntent) && activeFilter === 'main';
  const visibleLines = narrativeLines.filter((line) => activeFilter === 'all' ? true : activeFilter === 'main' ? line.id === mainLineId : line.type === activeFilter);
  const storyAssetSummary = activeFilter === 'all' || activeFilter === 'main' ? renderStoryAssetSummary(chat, members) : null;
  const filters = LINE_FILTERS.map((filter) => ({
    ...filter,
    count: filter.key === 'all' ? narrativeLines.length : filter.key === 'main' ? (mainLineId ? 1 : 0) : narrativeLines.filter((line) => line.type === filter.key).length,
  })).filter((filter) => filter.key === 'all' || filter.key === 'main' || filter.count > 0);

  return (
    <SurfaceCard>
      {hideTitle ? null : <SectionHeader title="叙事线" dense />}
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {filters.map((filter) => (
            <Chip
              key={filter.key}
              size="small"
              label={`${filter.label} ${filter.count}`}
              color={activeFilter === filter.key ? 'primary' : 'default'}
              variant={activeFilter === filter.key ? 'filled' : 'outlined'}
              onClick={() => setActiveFilter(filter.key)}
              sx={compactPillChipSx}
            />
          ))}
        </Box>
        {showDirectorIntent && runtimePressure.directorIntent ? (
          <Box sx={{ p: { xs: 0.85, sm: 0.95 }, borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.06)' }}>
            <Typography variant="caption" color="text.secondary">主线方向</Typography>
            <Typography variant="body2" sx={{ mt: 0.2 }}>
              {formatDirectorSource(runtimePressure.directorIntent.source)} · {formatBeatType(runtimePressure.directorIntent.beatType)}
              {runtimePressure.directorIntent.targetActorIds.length ? ` · ${runtimePressure.directorIntent.targetActorIds.map((id) => members.find((member) => member.id === id)?.name || '成员').join('、')}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>{formatNarrativeLineText(formatKnownReason(runtimePressure.directorIntent.reason), members)}</Typography>
          </Box>
        ) : null}
        {storyAssetSummary}
        {visibleLines.length ? <Stack spacing={0.8}>{visibleLines.map((line) => renderLine(line, chat, members, messages, isZh, showDebugDetails))}</Stack> : storyAssetSummary ? null : <Typography variant="body2" color="text.secondary">暂无对应叙事线</Typography>}
      </Stack>
    </SurfaceCard>
  );
}
