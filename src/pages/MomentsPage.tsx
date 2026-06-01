import { useEffect, useMemo } from 'react';
import { Avatar, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import type { ActorRef } from '../types/runtimeEvent';
import EmptyState from '../components/common/EmptyState';
import { sanitizeUserFacingText } from '../services/displayTextSanitizer';
import { projectWorldAttentionCandidates, projectWorldAttentionStates, projectWorldMoments } from '../services/worldRuntimeProjection';
import { formatActorRefKindLabel, formatSystemAgentSubtypeLabel } from '../services/actorRefPresentation';

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatActorRefLabel(
  ref: ActorRef | undefined,
) {
  if (!ref) return '未知';
  const base = formatActorRefKindLabel(ref.kind);
  if (ref.kind !== 'system_agent') return base;
  const subtype = formatSystemAgentSubtypeLabel(ref.subtype);
  return subtype === '系统' ? base : `${base} · ${subtype}`;
}

export default function MomentsPage() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const chats = useChatStore((state) => state.chats);
  const loadChats = useChatStore((state) => state.loadChats);
  const characters = useCharacterStore((state) => state.characters);
  const loadCharacters = useCharacterStore((state) => state.loadCharacters);

  useEffect(() => {
    void loadChats();
    void loadCharacters();
  }, [loadCharacters, loadChats]);

  const characterAvatars = useMemo(() => new Map(characters.map((character) => [character.id, character.avatar])), [characters]);
  const textMembers = useMemo(() => characters.map((character) => ({ id: character.id, name: character.name })), [characters]);
  const moments = useMemo(() => projectWorldMoments(chats, characters), [chats, characters]);
  const attentionCandidates = useMemo(() => projectWorldAttentionCandidates(chats, characters), [chats, characters]);
  const attentionStates = useMemo(() => projectWorldAttentionStates(chats, characters), [chats, characters]);

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 1.5, md: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Stack direction="row" spacing={1.25} sx={{ mb: 2, alignItems: 'center' }}>
        <DynamicFeedIcon color="primary" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 820, letterSpacing: 0 }}>
            {isZh ? '朋友圈' : 'Moments'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isZh ? '角色日常状态、活动现场和关系余波形成的动态投影。' : 'A feed of character moments projected from daily states, events, and relationship residue.'}
          </Typography>
        </Box>
      </Stack>

      {!moments.length ? (
        <EmptyState
          icon="📝"
          message={isZh ? '还没有朋友圈动态。当角色发动态、记录活动或同步状态时，这里会显示对应内容。' : 'No moments yet. Character posts, activity notes, and status updates will appear here.'}
        />
      ) : (
        <Stack divider={<Divider flexItem />} spacing={0}>
          {moments.map((moment) => (
            <Box key={moment.id} sx={{ py: 2.2 }}>
              <Stack direction="row" spacing={1.3} sx={{ alignItems: 'flex-start' }}>
                <Avatar sx={{ width: 42, height: 42 }}>{moment.actorId ? characterAvatars.get(moment.actorId) || moment.actorName.slice(0, 1) : moment.actorName.slice(0, 1)}</Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} sx={{ justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: 0 }}>
                        {moment.actorName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {sanitizeUserFacingText(moment.conversationName, textMembers)} · {formatTime(moment.createdAt)}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        moment.kind === 'status_update'
                          ? (isZh ? '状态' : 'Status')
                          : moment.kind === 'check_in'
                            ? (isZh ? '问候' : 'Check-in')
                            : moment.kind === 'react_to_moment'
                              ? (isZh ? '回应' : 'Reaction')
                              : (isZh ? '动态' : 'Moment')
                      }
                    />
                  </Stack>
                  <Typography variant="body1" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                    {sanitizeUserFacingText(moment.text, textMembers)}
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.2, flexWrap: 'wrap' }}>
                    {moment.expectedArtifacts.length ? <Chip size="small" icon={<PhotoCameraIcon />} label={moment.expectedArtifacts.join('、')} /> : null}
                    {moment.visibility ? <Chip size="small" icon={<LockOpenIcon />} variant="outlined" label={moment.visibility === 'derived_public' ? (isZh ? '公开投影' : 'Public projection') : moment.visibility} /> : null}
                    {moment.activityType ? <Chip size="small" variant="outlined" label={sanitizeUserFacingText(moment.activityType, textMembers)} /> : null}
                    {moment.sourceRefs.length > 1 ? <Chip size="small" variant="outlined" label={isZh ? `跨会话来源 ×${moment.sourceRefs.length}` : `Cross-session x${moment.sourceRefs.length}`} /> : null}
                  </Stack>
                </Box>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {attentionCandidates.length ? (
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: 0, mb: 1 }}>
            {isZh ? '关注候选' : 'Attention candidates'}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {attentionCandidates.slice(0, 12).map((item) => (
              <Chip
                key={item.id}
                icon={<VisibilityIcon />}
                label={isZh
                  ? `${sanitizeUserFacingText(item.actorName, textMembers)} → ${item.targetNames.map((name) => sanitizeUserFacingText(name, textMembers)).join('、') || '群聊'} · ${sanitizeUserFacingText(item.reason, textMembers)}`
                  : `${sanitizeUserFacingText(item.actorName, textMembers)} -> ${item.targetNames.map((name) => sanitizeUserFacingText(name, textMembers)).join(', ') || 'group'} · ${sanitizeUserFacingText(item.reason, textMembers)}`}
                variant="outlined"
                size="small"
              />
            ))}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
            {attentionCandidates.slice(0, 8).map((item) => (
              <Chip
                key={`${item.id}-kind`}
                size="small"
                variant="outlined"
                label={`${sanitizeUserFacingText(item.actorName, textMembers)}：${formatActorRefLabel(item.actorRef)}`}
              />
            ))}
          </Stack>
        </Box>
      ) : null}

      {attentionStates.length ? (
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: 0, mb: 1 }}>
            {isZh ? '关注状态' : 'Attention state'}
          </Typography>
          <Stack spacing={0.9}>
            {attentionStates.slice(0, 8).map((item) => (
              <Box key={`${item.actorId}-${item.targetId}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {sanitizeUserFacingText(item.actorName, textMembers)} → {sanitizeUserFacingText(item.targetName, textMembers)}
                </Typography>
                <Stack direction="row" spacing={0.8} useFlexGap sx={{ mt: 0.6, flexWrap: 'wrap' }}>
                  <Chip size="small" label={isZh ? `关注 ${(item.attentionScore * 100).toFixed(0)}%` : `Attention ${(item.attentionScore * 100).toFixed(0)}%`} />
                  <Chip size="small" variant="outlined" label={isZh ? `克制 ${(item.restraint * 100).toFixed(0)}%` : `Restraint ${(item.restraint * 100).toFixed(0)}%`} />
                  <Chip size="small" variant="outlined" label={isZh ? `建议：${item.suggestedActions.join(' / ')}` : `Suggested: ${item.suggestedActions.join(' / ')}`} />
                  <Chip size="small" variant="outlined" label={isZh ? `发起身份：${formatActorRefLabel(item.actorRef)}` : `Actor: ${formatActorRefLabel(item.actorRef)}`} />
                  <Chip size="small" variant="outlined" label={isZh ? `目标身份：${formatActorRefLabel(item.targetRef)}` : `Target: ${formatActorRefLabel(item.targetRef)}`} />
                </Stack>
                {item.reasons.length ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {sanitizeUserFacingText(item.reasons.join('；'), textMembers)}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}
