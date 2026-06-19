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
type StoryChoiceHistoryItem = NonNullable<NonNullable<GroupChat['scenarioState']>['choiceHistory']>[number];
type StoryBranchItem = NonNullable<NonNullable<GroupChat['scenarioState']>['branches']>[number];
type StoryQualityTrace = NonNullable<Message['metadata']>['storyQuality'];

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
    state?.currentScene
    || state?.chapterRecap
    || state?.chapterMemory
    || state?.openQuestions?.length
    || state?.clues?.length
    || state?.stakes?.length
    || state?.relationshipShifts?.length
    || state?.choiceHistory?.length,
  );
}

function renderCurrentScene(chat: GroupChat, members: AICharacter[], showDebugDetails: boolean) {
  const scene = chat.scenarioState?.currentScene;
  if (!scene) return null;
  const actorNames = (scene.presentActorIds || [])
    .map((id) => members.find((member) => member.id === id)?.name)
    .filter(Boolean) as string[];
  const rows = [
    scene.location ? `地点：${formatNarrativeLineText(scene.location, members)}` : '',
    scene.time ? `时间：${formatNarrativeLineText(scene.time, members)}` : '',
    scene.visibleThreat ? `压力：${formatNarrativeLineText(scene.visibleThreat, members)}` : '',
    showDebugDetails && actorNames.length ? `在场：${actorNames.join('、')}` : '',
  ].filter(Boolean);
  if (!rows.length && !scene.summary) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>当前场景</Typography>
      <Box sx={{ px: 0.9, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(14,165,233,0.06)' }}>
        {scene.summary ? (
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.55 }}>
            {formatNarrativeLineText(scene.summary, members)}
          </Typography>
        ) : null}
        {rows.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: scene.summary ? 0.35 : 0, lineHeight: 1.6 }}>
            {rows.join(' · ')}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function renderChapterSettlement(chat: GroupChat, members: AICharacter[]) {
  const state = chat.scenarioState;
  const recap = state?.chapterRecap;
  if (!state || !recap) return null;
  const latestChoice = state.choiceHistory?.slice(-1)[0];
  const latestClue = recap.discoveredClues.slice(-1)[0];
  const latestRelationship = recap.changedRelationships.slice(-1)[0];
  const latestImpact = recap.choiceImpacts?.slice(-1)[0];
  const latestQuestion = recap.unresolvedQuestions.slice(-1)[0];
  const rows = [
    latestClue ? `发现：${formatNarrativeLineText(latestClue, members)}` : '',
    latestRelationship ? `关系：${formatNarrativeLineText(latestRelationship, members)}` : '',
    latestChoice?.outcome ? `结果：${formatNarrativeLineText(latestChoice.outcome, members)}` : '',
    latestImpact ? `影响：${formatNarrativeLineText(latestImpact, members)}` : '',
    latestQuestion ? `未解：${formatNarrativeLineText(latestQuestion, members)}` : '',
    state.storyGoal ? `下一步：${formatNarrativeLineText(state.storyGoal, members)}` : '',
  ].filter(Boolean);
  if (!rows.length) return null;
  const sceneLabel = [
    state.currentScene?.time ? formatNarrativeLineText(state.currentScene.time, members) : '',
    state.currentScene?.location ? formatNarrativeLineText(state.currentScene.location, members) : '',
  ].filter(Boolean).join(' · ');
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>章节结算</Typography>
      <Box
        sx={(theme) => ({
          px: 0.9,
          py: 0.75,
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(16,185,129,0.18)' : 'rgba(52,211,153,0.18)',
          bgcolor: theme.palette.mode === 'light' ? 'rgba(236,253,245,0.58)' : 'rgba(6,78,59,0.18)',
        })}
      >
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.35 }}>
          <Chip size="small" label={recap.title || '阶段回顾'} variant="outlined" sx={compactPillChipSx} />
          {sceneLabel ? <Chip size="small" label={sceneLabel} variant="outlined" sx={compactPillChipSx} /> : null}
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.55 }}>
          {formatNarrativeLineText(recap.summary, members)}
        </Typography>
        <Stack spacing={0.25} sx={{ mt: 0.45 }}>
          {rows.map((row) => (
            <Typography key={row} variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
              {row}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Box>
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

const STORY_QUALITY_LABELS: Record<string, string> = {
  has_narration: '旁白',
  has_speech: '气泡',
  has_choice_point: '抉择',
  concrete_scene: '具体场景',
  has_story_hook: '悬念钩子',
  has_relationship_pressure: '关系压力',
  choices_have_tradeoffs: '选择取舍',
};

const STORY_QUALITY_GAPS: Record<string, string> = {
  missing_narration: '缺少旁白',
  weak_concrete_scene: '场景细节弱',
  missing_story_hook: '缺少悬念钩子',
  no_character_speech: '缺少角色气泡',
  too_few_choices: '选项不足',
  choice_tradeoff_missing: '选择取舍不足',
};

function formatStoryQualityLabel(value: string) {
  return STORY_QUALITY_LABELS[value] || value;
}

function formatStoryQualityGap(value: string) {
  return STORY_QUALITY_GAPS[value] || value;
}

function getLatestStoryQuality(messages: Message[]): StoryQualityTrace | null {
  return messages.slice().reverse().find((message) => message.metadata?.storyQuality)?.metadata?.storyQuality || null;
}

function renderStoryQuality(messages: Message[], showDebugDetails: boolean) {
  if (!showDebugDetails) return null;
  const quality = getLatestStoryQuality(messages);
  if (!quality) return null;
  const score = Math.max(0, Math.min(100, Math.round(Number(quality.score || 0))));
  const labels = (quality.labels || []).map(formatStoryQualityLabel).filter(Boolean).slice(0, 8);
  const gaps = (quality.gaps || []).map(formatStoryQualityGap).filter(Boolean).slice(0, 6);
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>故事质量</Typography>
      <Box
        sx={(theme) => ({
          px: 0.9,
          py: 0.75,
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(245,158,11,0.2)' : 'rgba(251,191,36,0.22)',
          bgcolor: theme.palette.mode === 'light' ? 'rgba(255,251,235,0.72)' : 'rgba(120,53,15,0.2)',
        })}
      >
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: labels.length || gaps.length ? 0.45 : 0 }}>
          <Chip size="small" label={`质量 ${score}`} variant="outlined" sx={compactPillChipSx} />
          {labels.map((label) => <Chip key={label} size="small" label={label} variant="outlined" sx={compactPillChipSx} />)}
        </Stack>
        {gaps.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
            待补：{gaps.join(' / ')}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function renderChoiceReview(chat: GroupChat, members: AICharacter[], showDebugDetails: boolean) {
  const choices = chat.scenarioState?.choiceHistory || [];
  const branches = chat.scenarioState?.branches || [];
  const groups = choices.slice(-4).map((choice, index) => {
    const epoch = Number(choice.choiceEpoch || 0);
    const alternatives = epoch > 0
      ? branches.filter((branch) => Number(branch.choiceEpoch || 0) === epoch && branch.status === 'completed')
      : [];
    return { choice, epoch, alternatives, index };
  });
  if (!groups.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.45 }}>关键抉择</Typography>
      <Stack spacing={0.7}>
        {groups.map(({ choice, epoch, alternatives, index }) => (
          <Box
            key={`${choice.branchId || choice.label}:${epoch || index}:review`}
            sx={(theme) => ({
              px: 0.9,
              py: 0.75,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: theme.palette.mode === 'light' ? 'rgba(99,102,241,0.16)' : 'rgba(129,140,248,0.18)',
              bgcolor: theme.palette.mode === 'light' ? 'rgba(238,242,255,0.42)' : 'rgba(49,46,129,0.18)',
            })}
          >
            <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.35 }}>
              <Chip size="small" label={`节点 ${epoch || index + 1}`} variant="outlined" sx={compactPillChipSx} />
              <Chip size="small" label="已选" variant="outlined" sx={compactPillChipSx} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {formatNarrativeLineText(choice.label, members)}
              </Typography>
            </Stack>
            {choice.outcome ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
                结果：{formatNarrativeLineText(choice.outcome, members)}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.6 }}>
              影响：{formatChoiceImpactText({ choice, alternatives, chat, members })}
            </Typography>
            {showDebugDetails && (choice.risk || choice.reward) ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2, lineHeight: 1.6 }}>
                {[choice.risk ? `代价：${choice.risk}` : '', choice.reward ? `获得：${choice.reward}` : ''].filter(Boolean).map((item) => formatNarrativeLineText(item, members)).join(' · ')}
              </Typography>
            ) : null}
            {alternatives.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.6 }}>
                未走路径：{alternatives.slice(0, 3).map((branch) => formatNarrativeLineText(branch.label, members)).join(' / ')}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function formatChoiceImpactText(params: {
  choice: StoryChoiceHistoryItem;
  alternatives: StoryBranchItem[];
  chat: GroupChat;
  members: AICharacter[];
}) {
  if (params.choice.impact) {
    return formatNarrativeLineText(params.choice.impact, params.members);
  }
  const latestClue = params.chat.scenarioState?.clues?.slice(-1)[0];
  if (latestClue) {
    return `留下新线索：${formatNarrativeLineText(latestClue, params.members)}`;
  }
  const latestRelationship = params.chat.scenarioState?.relationshipShifts?.slice(-1)[0];
  if (latestRelationship) {
    return `改变角色关系：${formatNarrativeLineText(latestRelationship, params.members)}`;
  }
  const latestQuestion = params.chat.scenarioState?.openQuestions?.slice(-1)[0];
  if (latestQuestion) {
    return `留下悬念：${formatNarrativeLineText(latestQuestion, params.members)}`;
  }
  if (params.choice.outcome) {
    return '已造成可见后果，后续剧情会沿这个结果继续累积。';
  }
  if (params.chat.scenarioState?.storyGoal) {
    return `推动当前目标：${formatNarrativeLineText(params.chat.scenarioState.storyGoal, params.members)}`;
  }
  if (params.alternatives.length) {
    return '已锁定当前路线，未走分支会保留为回看线索。';
  }
  return '这个选择已经成为后续剧情的承接点。';
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

function getStoryProgressCopy(chat: GroupChat, members: AICharacter[]) {
  if (chat.sessionKind?.scenarioId !== 'story-reader') return null;
  const state = chat.scenarioState || {};
  const phase = state.phase || 'scene';
  const beatLabel = formatStoryBeatKind(state.storyBeatKind);
  const latestChoice = state.selectedChoice || state.choiceHistory?.slice(-1)[0] || null;
  const situation = state.storySituation || state.currentScene?.summary || state.currentScene?.visibleThreat || '';
  const formattedSituation = situation ? formatNarrativeLineText(situation, members) : '';
  if (phase === 'choice') {
    return {
      title: '等待你的选择',
      body: formattedSituation
        ? `当前章节已经推进到抉择点，先选择一个走向，故事会从你的选择后继续。当前处境：${formattedSituation}`
        : '当前章节已经推进到抉择点，先选择一个走向，故事会从你的选择后继续。',
      chips: [beatLabel || '抉择'].filter(Boolean),
    };
  }
  if (phase === 'branch') {
    return {
      title: '正在兑现选择',
      body: latestChoice?.label && formattedSituation
        ? `刚才选择了：${formatNarrativeLineText(latestChoice.label, members)}。当前处境：${formattedSituation}。下一段会先呈现这个选择带来的具体后果。`
        : latestChoice?.label
        ? `刚才选择了：${formatNarrativeLineText(latestChoice.label, members)}。下一段会先呈现这个选择带来的具体后果。`
        : formattedSituation
          ? `当前处境：${formattedSituation}。下一段会先呈现刚才选择带来的具体后果。`
        : '下一段会先呈现刚才选择带来的具体后果。',
      chips: [beatLabel || '后果'].filter(Boolean),
    };
  }
  if (state.storyGoal) {
    const goal = formatNarrativeLineText(state.storyGoal, members);
    return {
      title: '主线推进',
      body: formattedSituation && formattedSituation !== goal
        ? `当前目标：${goal}。当前处境：${formattedSituation}`
        : `当前目标：${goal}`,
      chips: [beatLabel || '主线推进'].filter(Boolean),
    };
  }
  const question = state.openQuestions?.slice(-1)[0];
  return {
    title: '主线推进',
    body: question
      ? `下一段可以继续追踪：${formatNarrativeLineText(question, members)}`
      : '没有待选项时，故事会按当前目标继续推进。',
    chips: [beatLabel || '主线推进'].filter(Boolean),
  };
}

function renderStoryProgressCard(chat: GroupChat, members: AICharacter[]) {
  const progress = getStoryProgressCopy(chat, members);
  if (!progress) return null;
  return (
    <Box
      sx={(theme) => ({
        p: { xs: 0.9, sm: 1 },
        borderRadius: 2,
        border: '1px solid',
        borderColor: theme.palette.mode === 'light' ? 'rgba(14,165,233,0.18)' : 'rgba(125,211,252,0.18)',
        bgcolor: theme.palette.mode === 'light' ? 'rgba(240,249,255,0.72)' : 'rgba(8,47,73,0.22)',
      })}
    >
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.45 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{progress.title}</Typography>
        {progress.chips.map((chip) => <Chip key={chip} size="small" label={chip} variant="outlined" sx={compactPillChipSx} />)}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.65 }}>
        {progress.body}
      </Typography>
    </Box>
  );
}

function renderStoryAssetSummary(chat: GroupChat, members: AICharacter[], messages: Message[], showDebugDetails: boolean) {
  const qualityPanel = renderStoryQuality(messages, showDebugDetails);
  if (!hasStoryAssets(chat) && !qualityPanel) return null;
  const state = chat.scenarioState || {};
  const recap = state.chapterRecap || null;
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
            {renderAssetChips('回顾影响', recap.choiceImpacts, members)}
          </>
        ) : null}
        {state.chapterMemory ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {formatNarrativeLineText(state.chapterMemory, members)}
          </Typography>
        ) : null}
        {state.storyGoal ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            当前目标：{formatNarrativeLineText(state.storyGoal, members)}
          </Typography>
        ) : null}
        {state.storySituation ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            当前处境：{formatNarrativeLineText(state.storySituation, members)}
          </Typography>
        ) : null}
        {renderChapterSettlement(chat, members)}
        {renderCurrentScene(chat, members, showDebugDetails)}
        {renderAssetChips('悬念', state.openQuestions, members)}
        {renderAssetChips('线索', state.clues, members)}
        {showDebugDetails ? renderAssetChips('代价', state.stakes, members) : null}
        {renderAssetChips('关系压力', state.relationshipShifts, members)}
        {qualityPanel}
        {renderChoiceReview(chat, members, showDebugDetails)}
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
  const settingsSnapshot = useSettingsStore.getState();
  const showDebugDetails = (developerMode || settingsSnapshot.developerMode)
    && (showAdvancedRuntimePanels || settingsSnapshot.developerUI.showAdvancedRuntimePanels);
  const runtimePressure = useMemo(() => projectRuntimePressure({ chat, characters: members, messages }), [chat, members, messages]);
  const narrativeLines = useMemo(() => projectNarrativeLines({ chat, characters: members, messages }), [chat, members, messages]);
  const mainLineId = runtimePressure.primaryLine?.id || narrativeLines[0]?.id || null;
  const showDirectorIntent = Boolean(runtimePressure.directorIntent) && activeFilter === 'main';
  const visibleLines = narrativeLines.filter((line) => activeFilter === 'all' ? true : activeFilter === 'main' ? line.id === mainLineId : line.type === activeFilter);
  const storyProgressCard = activeFilter === 'all' || activeFilter === 'main' ? renderStoryProgressCard(chat, members) : null;
  const storyAssetSummary = activeFilter === 'all' || activeFilter === 'main' ? renderStoryAssetSummary(chat, members, messages, showDebugDetails) : null;
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
        {storyProgressCard}
        {storyAssetSummary}
        {visibleLines.length ? <Stack spacing={0.8}>{visibleLines.map((line) => renderLine(line, chat, members, messages, isZh, showDebugDetails))}</Stack> : storyAssetSummary ? null : <Typography variant="body2" color="text.secondary">暂无对应叙事线</Typography>}
      </Stack>
    </SurfaceCard>
  );
}
