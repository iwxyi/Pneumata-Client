import { lazy, Suspense } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat, StoryChapterState } from '../../types/chat';
import type { Message } from '../../types/message';
import MemberList from '../controls/MemberList';
import FloatingSegmentedTabs from '../common/FloatingSegmentedTabs';
import { formatScenarioRoleLabel } from '../../services/scenarioPresentation';
import { ChatPrivateInfoCard } from './ChatPrivateInfoCard';
import { projectSessionParticipantTopology } from '../../services/sessionParticipantProjection';
import { formatNarrativeLineText } from '../../services/narrativeLinePresentation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { compactPillChipSx } from '../../styles/interaction';

const RelationshipPanel = lazy(() => import('../controls/RelationshipPanel'));
const ChatRuntimePanel = lazy(() => import('./ChatRuntimePanel'));
const ChatNarrativePanel = lazy(() => import('./ChatNarrativePanel'));

type ChatSidebarTab = 'members' | 'narrative' | 'chapters' | 'clues' | 'roles' | 'world' | 'developer' | 'activities';

interface ChatSidebarPanelProps {
  chat: GroupChat & { primaryRecentEvent?: string };
  members: AICharacter[];
  messages?: Message[];
  thinkingId: string | null;
  rightPanelTab: string;
  setRightPanelTab: (value: ChatSidebarTab) => void;
  showMemberTab: boolean;
  showRuntimeTab: boolean;
  showActivityTab?: boolean;
  activityPanel?: React.ReactNode;
  memberFooter?: React.ReactNode;
  memberPanelTitle?: string;
  runtimePanelTitle?: string;
  privatePayloads: Array<{ key: string; title: string; text: string }>;
  privatePayloadTitle?: string;
  directMemoryContext?: {
    targetName: string | null;
    targetSummary: string;
    targetResolutionLabel?: string;
    memoryVisibility: string;
    recentMemories: Array<{ id: string; text: string; layer: string; scope: string }>;
    recentRelationshipChanges: Array<{ type: string; text: string; createdAt: number }>;
    recentMemoryWrites?: Array<{ id: string; text: string; layer: string; scope: string }>;
    sourceTagSummary?: string;
    sourceTagRows?: Array<{ tag: string; count: number; label: string }>;
    targetResolution?: string;
  } | null;
  onSpeakAs: (charId: string) => void;
  onGuideMember?: (charId: string) => void;
  onSetPerspectiveMember?: (charId: string) => void;
  onStartDirectChat?: (charId: string) => void;
  onRemoveMember?: (charId: string) => void;
  onUpdateSeats?: (memberIds: string[]) => void;
  onStoryChapterClick?: (chapter: StoryChapterState) => void;
  perspectiveMemberId?: string | null;
}

function memberName(id: string | null | undefined, members: AICharacter[]) {
  if (!id) return '成员';
  return members.find((member) => member.id === id)?.name || '成员';
}

function ChatScenarioCard({ chat, members }: { chat: GroupChat; members: AICharacter[] }) {
  const rows = [] as string[];
  const topology = projectSessionParticipantTopology(chat, members, true);
  const nonMemberOperators = (chat.operatorIds || []).filter((id) => !chat.memberIds.includes(id));
  if (chat.scenarioState?.roleAssignments?.length) {
    rows.push(`角色位 ${chat.scenarioState.roleAssignments.slice(0, 4).map((item) => `${memberName(item.actorId, members)}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId)}` : ''}`).join(' / ')}`);
  }
  if (chat.scenarioState?.factions?.length) rows.push(`阵营 ${chat.scenarioState.factions.slice(0, 4).map((item) => item.label).join(' / ')}`);
  if (chat.scenarioState?.currentTurnActorId) rows.push(`当前轮次 ${memberName(chat.scenarioState.currentTurnActorId, members)}`);
  if (!rows.length) return null;
  return (
    <Box sx={{
      p: 1.25,
      borderRadius: 1,
      bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.060)',
      border: '1px solid',
      borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.075)' : 'rgba(226,232,240,0.105)',
      boxShadow: (theme) => theme.palette.mode === 'light'
        ? '0 1px 0 rgba(255,255,255,0.82) inset, 0 12px 28px rgba(15,23,42,0.055)'
        : '0 1px 0 rgba(255,255,255,0.08) inset, 0 14px 32px rgba(0,0,0,0.24)',
      backdropFilter: 'blur(18px) saturate(1.18)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
    }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>场景规则</Typography>
      <Stack spacing={0.5}>
        {rows.map((row) => <Typography key={row} variant="body2">{row}</Typography>)}
        {topology.memberBadges.length ? (
          <Typography variant="caption" color="text.secondary">
            {`成员 ${topology.memberBadges.map((item) => `${item.label}${item.capabilityLabels.length ? `(${item.capabilityLabels.join('/')})` : ''}`).join(' / ')}`}
          </Typography>
        ) : null}
        {topology.operatorBadges.length ? (
          <Typography variant="caption" color="text.secondary">
            {`操作者 ${topology.operatorBadges.map((item) => `${item.label}${item.capabilityLabels.length ? `(${item.capabilityLabels.join('/')})` : ''}`).join(' / ')}`}
          </Typography>
        ) : null}
        {nonMemberOperators.length ? (
          <Typography variant="caption" color="text.secondary">
            {`非成员操作者 ${nonMemberOperators.length} 位`}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

function PanelFallback() {
  return null;
}

function formatStoryProtocolDiagnosticCode(code: string) {
  const labels: Record<string, string> = {
    choice_forbidden: '禁止抉择时输出选项',
    choice_required_missing: '必须抉择时缺少选项',
    choice_subject_mismatch: '选项主语不匹配',
    choice_gate_mismatch: '选择闸门不一致',
    empty_story_events: '缺少可见故事事件',
    chapter_title_missing: '章节标题缺失',
    chapter_recap_missing: '章节结算缺失',
  };
  return labels[code] || code;
}

function StoryProtocolDiagnosticPanel({ chat }: { chat: GroupChat }) {
  const diagnostics = chat.scenarioState?.storyProtocolDiagnostics || [];
  if (!diagnostics.length) return null;
  const recent = diagnostics.slice(-5).reverse();
  const errorCount = diagnostics.filter((item) => item.level === 'error').length;
  const warnCount = diagnostics.filter((item) => item.level === 'warn').length;
  return (
    <Box sx={(theme) => ({
      p: 1,
      borderRadius: 1.25,
      border: '1px solid',
      borderColor: errorCount ? theme.palette.error.main : theme.palette.warning.main,
      bgcolor: theme.palette.mode === 'light' ? 'rgba(254,242,242,0.66)' : 'rgba(127,29,29,0.18)',
    })}>
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>故事协议诊断</Typography>
          <Chip size="small" label={`${errorCount} 错误`} variant="outlined" sx={compactPillChipSx} />
          <Chip size="small" label={`${warnCount} 警告`} variant="outlined" sx={compactPillChipSx} />
        </Stack>
        {recent.map((item) => (
          <Box key={`${item.createdAt}:${item.code}:${item.message}`} sx={{ px: 0.8, py: 0.65, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.42)' }}>
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.25 }}>
              <Chip size="small" label={item.level === 'error' ? '错误' : '警告'} variant="outlined" sx={compactPillChipSx} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{formatStoryProtocolDiagnosticCode(item.code)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
              {item.message}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
              {[item.beatKind ? `节拍：${item.beatKind}` : '', item.choicePolicy ? `抉择策略：${item.choicePolicy}` : '', item.choiceEpoch ? `epoch：${item.choiceEpoch}` : ''].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

type StoryChoiceHistoryItem = NonNullable<NonNullable<GroupChat['scenarioState']>['choiceHistory']>[number];

function normalizeChoiceLabel(value: string, members: AICharacter[]) {
  return formatNarrativeLineText(value, members)
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?；;：:（）()【】\[\]「」“”"']/g, '')
    .trim();
}

function getChapterChoiceReviews(chapter: StoryChapterState, chat: GroupChat, members: AICharacter[]) {
  const history = chat.scenarioState?.choiceHistory || [];
  const chapterChoiceLabels = chapter.keyChoices || [];
  if (!history.length || !chapterChoiceLabels.length) return [];
  const wanted = new Set(chapterChoiceLabels.map((item) => normalizeChoiceLabel(item, members)).filter(Boolean));
  const reviews: StoryChoiceHistoryItem[] = [];
  for (const choice of history) {
    const normalized = normalizeChoiceLabel(choice.label || '', members);
    if (!normalized || !wanted.has(normalized)) continue;
    reviews.push(choice);
  }
  return reviews.slice(-3);
}

function StoryChapterPanel({ chat, members, onStoryChapterClick }: { chat: GroupChat; members: AICharacter[]; onStoryChapterClick?: (chapter: StoryChapterState) => void }) {
  const chapters = chat.scenarioState?.storyChapters || [];
  if (!chapters.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
        暂无章节索引
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {chapters.map((chapter) => {
        const hasTitle = Boolean(chapter.title?.trim());
        const choiceReviews = getChapterChoiceReviews(chapter, chat, members);
        return (
          <Box
            key={chapter.id}
            component="button"
            type="button"
            onClick={() => onStoryChapterClick?.(chapter)}
            sx={(theme) => ({
              width: '100%',
              textAlign: 'left',
              border: '1px solid',
              borderColor: chapter.status === 'active' ? theme.palette.primary.main : theme.palette.divider,
              borderRadius: 1,
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.06)',
              color: 'text.primary',
              p: 1,
              cursor: onStoryChapterClick ? 'pointer' : 'default',
              font: 'inherit',
            })}
          >
            <Stack spacing={0.5}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {`第 ${chapter.index} 章 · ${hasTitle ? chapter.title : '章节标题缺失'}`}
              </Typography>
              <Typography variant="caption" color={chapter.status === 'active' ? 'primary.main' : 'text.secondary'}>
                {chapter.status === 'active' ? '进行中' : '已完成'}
              </Typography>
              {hasTitle ? null : (
                <Typography variant="caption" color="error.main">
                  模型未提供章节标题协议字段
                </Typography>
              )}
              {chapter.summary ? (
                <Typography variant="body2" color="text.secondary">
                  {formatNarrativeLineText(chapter.summary, members)}
                </Typography>
              ) : null}
              {chapter.keyChoices?.length ? (
                <Typography variant="caption" color="text.secondary">
                  {`关键选择：${chapter.keyChoices.slice(0, 3).map((item) => formatNarrativeLineText(item, members)).join(' / ')}`}
                </Typography>
              ) : null}
              {choiceReviews.length ? (
                <Stack spacing={0.35}>
                  {choiceReviews.map((choice) => (
                    <Box key={`${chapter.id}:${choice.branchId || choice.label}:review`} sx={{ px: 0.8, py: 0.65, borderRadius: 1.1, bgcolor: 'rgba(99,102,241,0.07)' }}>
                      <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.55, fontWeight: 700 }}>
                        已选：{formatNarrativeLineText(choice.label, members)}
                      </Typography>
                      {choice.outcome ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
                          结果：{formatNarrativeLineText(choice.outcome, members)}
                        </Typography>
                      ) : null}
                      {choice.impact ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
                          影响：{formatNarrativeLineText(choice.impact, members)}
                        </Typography>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

function StoryAssetList({ title, items, emptyText, tone = 'default' }: { title: string; items?: string[]; emptyText: string; tone?: 'default' | 'clue' | 'risk' | 'question' }) {
  const visible = (items || []).map((item) => item.trim()).filter(Boolean).slice(-6).reverse();
  const toneColor = tone === 'risk'
    ? 'rgba(239,68,68,0.07)'
    : tone === 'question'
      ? 'rgba(99,102,241,0.07)'
      : tone === 'clue'
        ? 'rgba(16,185,129,0.08)'
        : 'rgba(148,163,184,0.08)';
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 700 }}>{title}</Typography>
      {visible.length ? (
        <Stack spacing={0.7}>
          {visible.map((item, index) => (
            <Box key={`${title}:${index}:${item}`} sx={{ px: 1, py: 0.85, borderRadius: 1.25, bgcolor: toneColor }}>
              <Typography variant="body2" sx={{ lineHeight: 1.55 }}>{item}</Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>{emptyText}</Typography>
      )}
    </Box>
  );
}

function mergeStoryAssetItems(...groups: Array<string[] | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const raw of group || []) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function StoryCluePanel({ chat, members }: { chat: GroupChat; members: AICharacter[] }) {
  const state = chat.scenarioState || {};
  const formatItems = (items?: string[]) => (items || []).map((item) => formatNarrativeLineText(item, members));
  const questions = mergeStoryAssetItems(state.openQuestions, state.chapterRecap?.unresolvedQuestions);
  const clues = mergeStoryAssetItems(state.clues, state.chapterRecap?.discoveredClues);
  const risks = mergeStoryAssetItems(state.stakes, state.chapterRecap?.stakes);
  const choiceImpacts = mergeStoryAssetItems(
    state.chapterRecap?.choiceImpacts,
    (state.choiceHistory || []).map((choice) => choice.impact || '').filter(Boolean),
  );
  const latestQuestion = formatItems(questions).at(-1) || '';
  const latestClue = formatItems(clues).at(-1) || '';
  const latestRisk = formatItems(risks).at(-1) || '';
  const latestChoice = state.choiceHistory?.slice(-1)[0] || null;
  const recapClues = formatItems(state.chapterRecap?.discoveredClues);
  const recapQuestions = formatItems(state.chapterRecap?.unresolvedQuestions);
  const recapImpacts = formatItems(choiceImpacts);
  const counts = [
    `${questions.length} 个悬念`,
    `${clues.length} 条线索`,
    `${risks.length} 个风险`,
  ];
  return (
    <Stack spacing={1.3}>
      <Box sx={{ px: 1, py: 0.9, borderRadius: 1.25, bgcolor: 'rgba(99,102,241,0.08)' }}>
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', mb: latestQuestion || latestClue || latestRisk ? 0.55 : 0 }}>
          {counts.map((item) => <Chip key={item} size="small" label={item} variant="outlined" sx={compactPillChipSx} />)}
        </Stack>
        {latestQuestion ? <Typography variant="body2" sx={{ lineHeight: 1.55, fontWeight: 700 }}>追踪：{latestQuestion}</Typography> : null}
        {latestClue ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>最近线索：{latestClue}</Typography> : null}
        {latestRisk ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>当前风险：{latestRisk}</Typography> : null}
      </Box>
      <StoryAssetList title="未解悬念" tone="question" items={formatItems(questions)} emptyText="暂无明确未解悬念" />
      <StoryAssetList title="已发现线索" tone="clue" items={formatItems(clues)} emptyText="暂无已沉淀线索" />
      <StoryAssetList title="当前风险" tone="risk" items={formatItems(risks)} emptyText="暂无明确风险" />
      {choiceImpacts.length ? <StoryAssetList title="选择影响" items={formatItems(choiceImpacts)} emptyText="暂无选择影响" /> : null}
      {state.chapterRecap?.unresolvedQuestions?.length || state.chapterRecap?.discoveredClues?.length || latestChoice?.impact ? (
        <Box sx={{ px: 1, py: 0.85, borderRadius: 1.25, bgcolor: 'rgba(14,165,233,0.07)' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35, fontWeight: 700 }}>伏笔回看</Typography>
          {recapClues.slice(-2).map((item) => (
            <Typography key={`recap-clue:${item}`} variant="body2" sx={{ lineHeight: 1.55 }}>本章用到：{item}</Typography>
          ))}
          {recapQuestions.slice(-2).map((item) => (
            <Typography key={`recap-question:${item}`} variant="body2" sx={{ lineHeight: 1.55 }}>仍待回答：{item}</Typography>
          ))}
          {recapImpacts.slice(-1).map((item) => (
            <Typography key={`recap-impact:${item}`} variant="body2" sx={{ lineHeight: 1.55 }}>选择影响：{item}</Typography>
          ))}
          {latestChoice?.impact && !recapImpacts.includes(formatNarrativeLineText(latestChoice.impact, members)) ? (
            <Typography variant="body2" sx={{ lineHeight: 1.55 }}>选择影响：{formatNarrativeLineText(latestChoice.impact, members)}</Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}

function StoryRolePanel({ chat, members, onStartDirectChat }: { chat: GroupChat; members: AICharacter[]; onStartDirectChat?: (charId: string) => void }) {
  const state = chat.scenarioState || {};
  const presentIds = new Set(state.currentScene?.presentActorIds || []);
  const relationshipSources = [
    ...(state.relationshipShifts || []),
    ...(state.chapterRecap?.changedRelationships || []),
    ...(state.chapterRecap?.choiceImpacts || []),
    ...(state.choiceHistory || []).map((choice) => choice.impact || '').filter(Boolean),
  ];
  const relationshipShifts = Array.from(new Set(relationshipSources.map((item) => formatNarrativeLineText(item, members)).filter(Boolean))).slice(-8).reverse();
  const relationshipForMember = (member: AICharacter) => relationshipShifts.filter((item) => item.includes(member.name)).slice(0, 2);
  const roleByActorId = new Map((state.roleAssignments || []).map((item) => [item.actorId, item.roleId ? formatScenarioRoleLabel(item.roleId) : '角色位'] as const));
  const factionLabels = state.factions || [];
  const factionText = factionLabels.length ? `阵营：${factionLabels.slice(0, 4).map((item) => item.label).join(' / ')}` : '';
  return (
    <Stack spacing={1.2}>
      <Box sx={{ px: 1, py: 0.9, borderRadius: 1.25, bgcolor: 'rgba(14,165,233,0.07)' }}>
        <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', mb: factionText || state.currentScene?.visibleThreat ? 0.55 : 0 }}>
          <Chip size="small" label={`${presentIds.size || 0} 位在场`} variant="outlined" sx={compactPillChipSx} />
          <Chip size="small" label={`${relationshipShifts.length} 条关系变化`} variant="outlined" sx={compactPillChipSx} />
        </Stack>
        {state.currentScene?.visibleThreat ? (
          <Typography variant="body2" sx={{ lineHeight: 1.55, fontWeight: 700 }}>
            场上压力：{formatNarrativeLineText(state.currentScene.visibleThreat, members)}
          </Typography>
        ) : null}
        {factionText ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>{factionText}</Typography> : null}
      </Box>
      {members.map((member) => {
        const shifts = relationshipForMember(member);
        const isPresent = presentIds.has(member.id);
        const role = roleByActorId.get(member.id);
        return (
          <Box
            key={member.id}
            component="button"
            type="button"
            onClick={() => onStartDirectChat?.(member.id)}
            sx={(theme) => ({
              width: '100%',
              textAlign: 'left',
              border: '1px solid',
              borderColor: isPresent ? theme.palette.primary.main : theme.palette.divider,
              borderRadius: 1.25,
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.06)',
              color: 'text.primary',
              p: 1,
              cursor: onStartDirectChat ? 'pointer' : 'default',
              font: 'inherit',
            })}
          >
            <Stack spacing={0.55}>
              <Stack direction="row" spacing={0.6} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{member.name}</Typography>
                {isPresent ? <Chip size="small" label="在场" variant="outlined" sx={compactPillChipSx} /> : null}
                {role ? <Chip size="small" label={role} variant="outlined" sx={compactPillChipSx} /> : null}
              </Stack>
              {shifts.length ? shifts.map((shift) => (
                <Typography key={`${member.id}:${shift}`} variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.55 }}>
                  {shift}
                </Typography>
              )) : (
                <Typography variant="caption" color="text.secondary">
                  暂无明确剧情关系变化
                </Typography>
              )}
            </Stack>
          </Box>
        );
      })}
      {relationshipShifts.length ? (
        <StoryAssetList title="最近关系压力" items={relationshipShifts} emptyText="暂无关系压力" />
      ) : null}
    </Stack>
  );
}

export default function ChatSidebarPanel({
  chat,
  members,
  messages,
  thinkingId,
  rightPanelTab,
  setRightPanelTab,
  showMemberTab,
  showRuntimeTab,
  showActivityTab,
  activityPanel,
  memberFooter,
  memberPanelTitle,
  runtimePanelTitle,
  privatePayloads,
  privatePayloadTitle,
  directMemoryContext,
  onSpeakAs,
  onGuideMember,
  onSetPerspectiveMember,
  onStartDirectChat,
  onRemoveMember,
  onUpdateSeats,
  onStoryChapterClick,
  perspectiveMemberId,
}: ChatSidebarPanelProps) {
  const developerModeFromHook = useSettingsStore((state) => state.developerMode);
  const settingsSnapshot = useSettingsStore.getState();
  const developerMode = developerModeFromHook || settingsSnapshot.developerMode;
  const isStoryRoom = chat.sessionKind?.scenarioId === 'story-reader';
  const panelTabs = (isStoryRoom ? [
    showRuntimeTab ? { value: 'narrative' as const, label: '故事' } : null,
    showRuntimeTab ? { value: 'chapters' as const, label: '章节' } : null,
    showRuntimeTab ? { value: 'clues' as const, label: '线索' } : null,
    showMemberTab ? { value: 'roles' as const, label: `角色 ${members.length}` } : null,
    showRuntimeTab && developerMode ? { value: 'developer' as const, label: '开发者' } : null,
  ] : [
    showMemberTab ? { value: 'members' as const, label: `${memberPanelTitle || (chat.type === 'group' ? '成员' : '角色')} ${members.length}` } : null,
    showRuntimeTab ? { value: 'narrative' as const, label: '叙事线' } : null,
    showRuntimeTab ? { value: 'world' as const, label: runtimePanelTitle || '运行态' } : null,
    showActivityTab ? { value: 'activities' as const, label: '活动' } : null,
  ]).filter(Boolean) as Array<{ value: ChatSidebarTab; label: string }>;
  const activePanelTab = panelTabs.some((item) => item.value === rightPanelTab)
    ? rightPanelTab as ChatSidebarTab
    : panelTabs[0]?.value || 'members';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      {panelTabs.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          <FloatingSegmentedTabs
            value={activePanelTab}
            items={panelTabs}
            onChange={setRightPanelTab}
            equalWidth={false}
            comfortable={false}
          />
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: { xs: 0.25, md: 0.5 }, overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
        {activePanelTab === 'members' && showMemberTab ? (
          <Stack spacing={2}>
            <MemberList
              members={members}
              thinkingId={thinkingId}
              chat={chat}
              onSpeakAs={onSpeakAs}
              onGuideMember={onGuideMember}
              onSetPerspectiveMember={onSetPerspectiveMember}
              onStartDirectChat={onStartDirectChat}
              onRemove={onRemoveMember}
              onUpdateSeats={onUpdateSeats}
              perspectiveMemberId={perspectiveMemberId}
            />
            <Suspense fallback={<PanelFallback />}>
              <RelationshipPanel chat={chat} members={members} messages={messages || []} />
            </Suspense>
            {memberFooter || null}
          </Stack>
        ) : null}

        {activePanelTab === 'narrative' && showRuntimeTab ? (
          <Suspense fallback={<PanelFallback />}>
            <ChatNarrativePanel chat={chat} members={members} messages={messages} hideTitle />
          </Suspense>
        ) : null}

        {activePanelTab === 'chapters' && showRuntimeTab ? (
          <StoryChapterPanel chat={chat} members={members} onStoryChapterClick={onStoryChapterClick} />
        ) : null}

        {activePanelTab === 'clues' && showRuntimeTab ? (
          <StoryCluePanel chat={chat} members={members} />
        ) : null}

        {activePanelTab === 'roles' && showMemberTab ? (
          <StoryRolePanel chat={chat} members={members} onStartDirectChat={onStartDirectChat} />
        ) : null}

        {(activePanelTab === 'world' || activePanelTab === 'developer') && showRuntimeTab ? (
          <Stack spacing={2}>
            {isStoryRoom && activePanelTab === 'developer' ? <StoryProtocolDiagnosticPanel chat={chat} /> : null}
            <ChatScenarioCard chat={chat} members={members} />
            <ChatPrivateInfoCard chat={chat} members={members} directMemoryContext={directMemoryContext || null} />
            <Suspense fallback={<PanelFallback />}>
              <ChatRuntimePanel chat={chat} members={members} messages={messages} privatePayloads={privatePayloads} privatePayloadTitle={privatePayloadTitle} />
            </Suspense>
          </Stack>
        ) : null}

        {activePanelTab === 'activities' && showActivityTab ? activityPanel || null : null}
      </Box>
    </Box>
  );
}
