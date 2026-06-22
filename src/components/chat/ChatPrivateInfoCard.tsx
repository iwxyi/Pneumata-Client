import { Box, Chip, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import type { CompanionshipStatusSignature } from '../../types/companionship';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';
import { safeRuntimePrivateText } from '../../services/runtimePrivateTextPrivacy';
import { shouldShowCompanionshipStatusHints } from '../../services/companionshipStatusVisibility';
import { compactPillChipSx } from '../../styles/interaction';

interface DirectMemoryContext {
  targetSummary: string;
  targetResolutionLabel?: string;
  memoryVisibility: string;
  recentRelationshipChanges: Array<{ type: string; text: string; createdAt: number }>;
  recentMemoryWrites?: Array<{ id: string; text: string; layer: string; scope: string }>;
  sourceTagSummary?: string;
  targetResolution?: string;
  companionshipStatus?: CompanionshipStatusSignature | null;
}

interface ChatPrivateInfoCardProps {
  chat: GroupChat;
  members: AICharacter[];
  directMemoryContext?: DirectMemoryContext | null;
}

function buildCardSx() {
  return {
    p: 1.25,
    borderRadius: 1,
    bgcolor: 'rgba(255,255,255,0.58)',
    border: '1px solid',
    borderColor: 'rgba(15,23,42,0.075)',
    boxShadow: '0 1px 0 rgba(255,255,255,0.82) inset, 0 12px 28px rgba(15,23,42,0.055)',
    backdropFilter: 'blur(18px) saturate(1.18)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
  };
}

function buildStatusSx(tone: CompanionshipStatusSignature['tone']) {
  const toneColor: Record<CompanionshipStatusSignature['tone'], string> = {
    distant: 'rgba(100,116,139,0.12)',
    curious: 'rgba(14,165,233,0.12)',
    warm: 'rgba(34,197,94,0.12)',
    ambiguous: 'rgba(236,72,153,0.12)',
    restrained: 'rgba(245,158,11,0.13)',
    crisis: 'rgba(239,68,68,0.12)',
  };
  return {
    p: 1,
    borderRadius: 1,
    bgcolor: toneColor[tone],
    border: '1px solid',
    borderColor: 'rgba(15,23,42,0.075)',
  };
}

function cleanPrivateInfoText(text: string | undefined | null, members: AICharacter[], fallback = '有一条私域内容已隐藏原文') {
  return sanitizeUserFacingText(safeRuntimePrivateText(text, fallback), members);
}

export function ChatPrivateInfoCard({ chat, members, directMemoryContext }: ChatPrivateInfoCardProps) {
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showCompanionshipDebug = useSettingsStore((state) => state.developerUI.showCompanionshipDebug);
  const companionshipSettings = useSettingsStore((state) => state.companionship);
  const showCompanionshipStatusHints = shouldShowCompanionshipStatusHints(companionshipSettings);
  const showMemoryDetails = developerMode && showMemoryDebug;
  const showCompanionshipDetails = developerMode && (showMemoryDebug || showCompanionshipDebug);

  if ((chat.type !== 'direct' && chat.type !== 'ai_direct') || !members[0]) return null;
  const character = members[0];
  const memoryChips = showMemoryDetails
    ? [
      `角色记忆 ${(character.layeredMemories || []).length}`,
      `关系 ${(character.relationships || []).length}`,
      `时间线 ${(character.runtimeTimeline || []).length}`,
    ]
    : [
      (character.layeredMemories || []).length ? '会参考长期记忆' : '',
      (character.relationships || []).length ? '会参考关系线索' : '',
      (character.runtimeTimeline || []).length ? '会参考最近变化' : '',
    ].filter(Boolean);
  const recentRelationshipText = directMemoryContext?.recentRelationshipChanges?.slice(-2).map((item) => cleanPrivateInfoText(item.text, members, '有一条私域关系变化已隐藏原文')).filter(Boolean).join(' / ');
  const recentMemoryText = directMemoryContext?.recentMemoryWrites?.slice(0, 2).map((item) => cleanPrivateInfoText(item.text, members, '有一条私域记忆已隐藏原文')).filter(Boolean).join(' / ');
  const companionshipStatus = directMemoryContext?.companionshipStatus;
  return (
    <Box sx={buildCardSx()}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>{chat.type === 'direct' ? '单聊记忆主轴' : '私聊记忆主轴'}</Typography>
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">{chat.type === 'direct' ? '该角色会优先读取自己的长期记忆、关系记忆与最近变化，而不是优先回溯来源群聊。' : '该角色会优先读取与当前私聊对象相关的长期记忆、关系记忆与最近变化，而不是回退到主群公共上下文。'}</Typography>
        {showCompanionshipStatusHints && companionshipStatus ? (
          <Box sx={buildStatusSx(companionshipStatus.tone)}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: companionshipStatus.chips.length ? 0.75 : 0 }}>
              {cleanPrivateInfoText(companionshipStatus.text, members, '有一条私域状态痕迹已隐藏原文')}
            </Typography>
            {companionshipStatus.chips.length ? (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {companionshipStatus.chips.map((chip) => <Chip key={chip} size="small" label={chip} sx={compactPillChipSx} />)}
              </Box>
            ) : null}
          </Box>
        ) : null}
        {memoryChips.length ? (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {memoryChips.map((chip) => <Chip key={chip} size="small" label={chip} sx={compactPillChipSx} />)}
          </Box>
        ) : null}
        {directMemoryContext?.targetSummary ? <Typography variant="caption" color="text.secondary">{cleanPrivateInfoText(directMemoryContext.targetSummary, members, '有一条私域记忆主轴已隐藏原文')}</Typography> : null}
        {recentRelationshipText ? (
          <Typography variant="caption" color="text.secondary">最近关系变化：{recentRelationshipText}</Typography>
        ) : null}
        {recentMemoryText ? <Typography variant="caption" color="text.secondary">最近记忆：{recentMemoryText}</Typography> : null}
        {showMemoryDetails && directMemoryContext?.memoryVisibility ? <Typography variant="caption" color="text.secondary">{directMemoryContext.memoryVisibility}</Typography> : null}
        {showMemoryDetails && directMemoryContext?.sourceTagSummary ? <Typography variant="caption" color="text.secondary">来源：{directMemoryContext.sourceTagSummary}</Typography> : null}
        {showMemoryDetails && directMemoryContext?.targetResolutionLabel ? <Typography variant="caption" color="text.secondary">判断方式：{directMemoryContext.targetResolutionLabel}</Typography> : null}
        {showMemoryDetails && directMemoryContext?.targetResolution ? <Typography variant="caption" color="text.secondary">目标识别：{cleanPrivateInfoText(directMemoryContext.targetResolution, members, '有一条私域目标识别已隐藏原文')}</Typography> : null}
        {showCompanionshipDetails && companionshipStatus?.debugLines.length ? (
          <Stack spacing={0.25}>
            {companionshipStatus.debugLines.slice(0, 5).map((line) => (
              <Typography key={line} variant="caption" color="text.secondary">陪伴：{cleanPrivateInfoText(line, members, '有一条私域调试线索已隐藏原文')}</Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
