import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, Snackbar, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import EmptyState from '../components/common/EmptyState';
import ImageLightbox from '../components/common/ImageLightbox';
import SurfaceCard from '../components/common/SurfaceCard';
import { compactPillChipSx } from '../styles/interaction';
import { sanitizeUserFacingText } from '../services/displayTextSanitizer';
import { projectWorldMoments } from '../services/worldRuntimeProjection';
import { isImageAvatar } from '../utils/avatar';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { updateSourceChatAfterPostMoment } from '../services/directSessionRuntime';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';
import { generateImageWithAdapter, generateTextWithAdapter } from '../services/aiGenerationAdapter';
import { getPreferredAIProfile } from '../types/settings';
import { persistGeneratedMomentMedia, resolveMomentMediaUrl, type StoredMomentMedia } from '../services/momentMediaStorage';

const MOMENT_PAGE_SIZE = 20;

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatAvatarFallback(avatar: string | undefined, actorName: string) {
  if (avatar?.trim() && !isImageAvatar(avatar)) return avatar.trim().slice(0, 2);
  return actorName.trim().slice(0, 1) || '?';
}

function cleanGeneratedMomentText(value: string) {
  return value
    .replace(/^```(?:json|text)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/^朋友圈[:：]\s*/i, '')
    .replace(/(?:\s*[（(]\s*)?(?:配图|图片|附图)\s*[:：][\s\S]*?(?:[）)])?\s*$/iu, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^(朋友圈动态|朋友圈|Moments?)$/i.test(line))
    .join('\n')
    .trim()
    .slice(0, 260);
}

function cleanDisplayedMomentText(value: string) {
  return cleanGeneratedMomentText(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || '');
}

function MomentMediaThumbnail(props: {
  item: { url: string; thumbnailUrl?: string; alt?: string };
  alt: string;
  onClick: () => void;
}) {
  const requestedSrc = props.item.thumbnailUrl || props.item.url;
  const [resolvedSrc, setResolvedSrc] = useState<{ request: string; src: string } | null>(null);
  const src = resolvedSrc?.request === requestedSrc ? resolvedSrc.src : requestedSrc;

  useEffect(() => {
    let active = true;
    void resolveMomentMediaUrl(requestedSrc).then((resolved) => {
      if (active && resolved) setResolvedSrc({ request: requestedSrc, src: resolved });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [requestedSrc]);

  return (
    <Box
      component="img"
      src={src}
      alt={props.item.alt || props.alt}
      onClick={props.onClick}
      sx={{
        width: '100%',
        aspectRatio: '1 / 1',
        objectFit: 'cover',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        cursor: 'zoom-in',
      }}
    />
  );
}

export default function MomentsPage() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const chats = useChatStore((state) => state.chats);
  const loadChats = useChatStore((state) => state.loadChats);
  const updateChat = useChatStore((state) => state.updateChat);
  const characters = useCharacterStore((state) => state.characters);
  const loadCharacters = useCharacterStore((state) => state.loadCharacters);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMomentDebug = useSettingsStore((state) => state.developerUI.showMomentDebug);
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'warning' } | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(MOMENT_PAGE_SIZE);

  useEffect(() => {
    void loadChats();
    void loadCharacters();
  }, [loadCharacters, loadChats]);

  const characterAvatars = useMemo(() => new Map(characters.map((character) => [character.id, character.avatar])), [characters]);
  const textMembers = useMemo(() => characters.map((character) => ({ id: character.id, name: character.name })), [characters]);
  const moments = useMemo(() => projectWorldMoments(chats, characters, { includeCandidates: developerMode && showMomentDebug }).filter((moment) => moment.kind === 'post_moment'), [characters, chats, developerMode, showMomentDebug]);
  const visibleMoments = useMemo(() => moments.slice(0, visibleCount), [moments, visibleCount]);
  const visibleMomentMedia = useMemo(() => [...visibleMoments].reverse().flatMap((moment) => (
    moment.media.map((item, mediaIndex) => ({
      item,
      key: `${moment.id}-${mediaIndex}`,
      alt: item.alt || moment.title || moment.actorName,
    }))
  )), [visibleMoments]);
  const momentLightboxImages = useMemo(() => visibleMomentMedia.map(({ item, alt, key }) => ({
    key,
    src: item.thumbnailUrl || item.url,
    fullSrc: item.fullUrl || item.url,
    alt,
  })), [visibleMomentMedia]);
  const viewerIndex = viewerKey ? momentLightboxImages.findIndex((item) => item.key === viewerKey) : -1;
  const viewerOpen = viewerIndex >= 0;
  const hasMoreMoments = visibleCount < moments.length;
  const canGenerate = useMemo(() => chats.some((chat) => !chat.deletedAt && chat.memberIds.some((id) => characters.some((character) => character.id === id))), [characters, chats]);

  const loadMoreMoments = useCallback(() => {
    setVisibleCount((current) => Math.min(current + MOMENT_PAGE_SIZE, moments.length));
  }, [moments.length]);

  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !hasMoreMoments || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreMoments();
    }, { rootMargin: '420px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreMoments, loadMoreMoments]);

  const openViewer = useCallback((index: number) => {
    setViewerKey(momentLightboxImages[index]?.key || null);
  }, [momentLightboxImages]);

  const handleGenerateMoment = useCallback(async () => {
    const candidateChats = chats
      .filter((chat) => !chat.deletedAt)
      .map((chat) => ({
        chat,
        members: chat.memberIds.map((id) => characters.find((character) => character.id === id)).filter((character): character is NonNullable<typeof character> => Boolean(character)),
      }))
      .filter((item) => item.members.length > 0);
    if (!candidateChats.length) {
      setNotice({ message: isZh ? '没有可用于生成朋友圈的群聊角色。' : 'No chat member is available for moment generation.', severity: 'warning' });
      return;
    }
    const pickedChat = candidateChats[Math.floor(Math.random() * candidateChats.length)];
    const actor = pickedChat.members[Math.floor(Math.random() * pickedChat.members.length)];
    const now = Date.now();
    const mode = now % 3;
    const payload: SocialEventCandidatePayload = {
      eventKind: 'post_moment',
      initiatorId: actor.id,
      participantIds: [actor.id],
      targetIds: pickedChat.members.filter((member) => member.id !== actor.id).slice(0, 1).map((member) => member.id),
      reasonType: mode === 0 ? 'celebration' : mode === 1 ? 'world_attention_share_moment_event' : 'world_attention_share_moment_inner',
      confidence: 0.92,
      urgency: 'soon',
      seedIntent: mode === 0
        ? '调试生成：角色想把刚才轻松的一刻发成朋友圈。'
        : mode === 1
          ? '调试生成：角色想记录群聊里一个有画面感的片段。'
          : '调试生成：角色想发一条不直说事件、偏内心化的朋友圈。',
      visibilityPlan: 'public',
      expectedArtifacts: mode === 1 ? ['moment_text', 'moment_group_photo'] : ['moment_text'],
      sourceText: pickedChat.chat.worldState?.recentEvent || pickedChat.chat.topic || pickedChat.chat.name,
      title: mode === 2 ? '今日碎片' : '朋友圈动态',
      activityType: mode === 2 ? '情绪碎片' : mode === 1 ? '关系互动' : '即时分享',
      dedupeKey: `debug-moment-${pickedChat.chat.id}-${actor.id}-${now}`,
    };
    const textProfile = getPreferredAIProfile(aiProfiles, 'text');
    if (textProfile?.apiKey && textProfile.model) {
      try {
        const targetNames = payload.targetIds?.map((id) => characters.find((character) => character.id === id)?.name || id).join('、') || '无';
        const rawText = await generateTextWithAdapter({
          profile: textProfile,
          systemPrompt: '你是角色朋友圈文案生成器。只输出一条朋友圈正文，不要解释，不要写“某某发了一条动态”，不要写内部字段名。',
          messages: [{
            role: 'user',
            content: [
              `角色：${actor.name}`,
              `背景：${actor.background || '未设置'}`,
              `说话风格：${actor.speakingStyle || '未设置'}`,
              `专长/标签：${(actor.expertise || []).join('、') || '无'}`,
              `人格参数：${JSON.stringify(actor.personality || {})}`,
              `群聊：${pickedChat.chat.name}`,
              `群聊主题：${pickedChat.chat.topic || '无'}`,
              `房间情绪：${pickedChat.chat.worldState?.mood || '无'}`,
              `当前焦点：${pickedChat.chat.worldState?.focus || '无'}`,
              `最近事件：${pickedChat.chat.worldState?.recentEvent || '无'}`,
              `朋友圈题材：${payload.activityType || payload.reasonType}`,
              `目标对象：${targetNames}`,
              `种子意图：${payload.seedIntent}`,
              `来源片段：${payload.sourceText || '无'}`,
              `是否可能配图：${payload.expectedArtifacts?.some((artifact) => artifact !== 'moment_text') ? '是' : '否'}`,
              '要求：像真实朋友圈，不要像系统记录；可短可长，符合人设；不要过度解释事件；可以含一点内心、吐槽、余味或随手记录；不要输出标题。',
            ].join('\n'),
          }],
          maxTokens: 220,
        });
        const cleaned = cleanGeneratedMomentText(rawText);
        if (cleaned) payload.momentText = cleaned;
      } catch {
        // Keep local fallback text when the configured text model is unavailable.
      }
    }
    let generatedImageDataUrl: string | null = null;
    let generatedImageMimeType: string | undefined;
    let imageError: string | null = null;
    const imageProfile = getPreferredAIProfile(aiProfiles, 'image');
    const shouldGenerateImage = payload.expectedArtifacts?.some((artifact) => artifact !== 'moment_text') && imageProfile?.apiKey && imageProfile.model;
    if (shouldGenerateImage) {
      try {
        const prompt = `${actor.name} posts a natural social media moment image. Context: ${payload.sourceText || payload.seedIntent}. No text, no watermark, candid composition, character-appropriate style.`;
        const images = await generateImageWithAdapter({
          profile: imageProfile,
          prompt,
          count: 1,
          intent: 'chat-image',
          character: actor,
          characters: [actor],
          allowCharacterReferenceImages: true,
          negativePrompt: actor.visualIdentity?.negativePrompt,
          seed: actor.visualIdentity?.seed,
        });
        const first = images[0];
        if (first?.dataUrl) {
          generatedImageDataUrl = first.dataUrl;
          generatedImageMimeType = first.mimeType;
        } else {
          imageError = isZh ? '图片模型没有返回可用图片' : 'Image model returned no usable image';
        }
      } catch (error) {
        generatedImageDataUrl = null;
        imageError = getErrorMessage(error) || (isZh ? '图片模型不可用' : 'Image model is unavailable');
      }
    }
    const patch = updateSourceChatAfterPostMoment(pickedChat.chat, payload, actor.name);
    const artifactEvent = (patch.runtimeEventsV2 || []).find((event) => {
      const eventPayload = event.payload as { artifactType?: string; eventKind?: string };
      return event.kind === 'artifact' && eventPayload.artifactType === 'moment_text' && eventPayload.eventKind === 'post_moment';
    });
    let media: StoredMomentMedia[] = [];
    if (generatedImageDataUrl && artifactEvent) {
      try {
        const stored = await persistGeneratedMomentMedia({
          chatId: pickedChat.chat.id,
          eventId: artifactEvent.id,
          actor,
          dataUrl: generatedImageDataUrl,
          mimeType: generatedImageMimeType,
          alt: payload.title || '朋友圈图片',
        });
        if (stored) media = [stored];
      } catch (error) {
        media = [];
        imageError = getErrorMessage(error) || (isZh ? '图片保存失败' : 'Image save failed');
      }
    }
    const patchedEvents = (patch.runtimeEventsV2 || []).map((event) => {
      const eventPayload = event.payload as { artifactType?: string; eventKind?: string };
      if (!media.length || event.kind !== 'artifact' || eventPayload.artifactType !== 'moment_text' || eventPayload.eventKind !== 'post_moment') return event;
      return {
        ...event,
        payload: {
          ...event.payload,
          media,
        },
      };
    });
    await updateChat(pickedChat.chat.id, { ...patch, runtimeEventsV2: patchedEvents });
    setNotice({
      severity: imageError ? 'warning' : 'success',
      message: imageError
        ? (isZh ? `已生成文字朋友圈，但图片生成失败：${imageError}` : `Generated text moment, but image failed: ${imageError}`)
        : media.length
          ? (isZh ? `已生成 ${actor.name} 的图文朋友圈。` : `Generated a moment with image for ${actor.name}.`)
          : (isZh ? `已生成 ${actor.name} 的朋友圈。` : `Generated a moment for ${actor.name}.`),
    });
  }, [aiProfiles, characters, chats, isZh, updateChat]);

  useEffect(() => {
    setHeaderTitle(isZh ? '朋友圈' : 'Moments');
    setHeaderBackAction(null);
    setHeaderActions(
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {developerMode && showMomentDebug ? <Chip size="small" label={isZh ? '调试' : 'Debug'} color="warning" variant="outlined" sx={compactPillChipSx} /> : null}
        {developerMode && showMomentDebug ? (
          <Button size="small" variant="contained" startIcon={<AutoAwesomeIcon />} disabled={!canGenerate} onClick={handleGenerateMoment} sx={{ borderRadius: 999, minHeight: 30 }}>
            {isZh ? '生成' : 'Generate'}
          </Button>
        ) : null}
      </Stack>,
    );
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [canGenerate, developerMode, handleGenerateMoment, isZh, setHeaderActions, setHeaderBackAction, setHeaderTitle, showMomentDebug]);

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2, md: 3 }, pt: { xs: 1, sm: 1.5, md: 2 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 112px)', md: 4 }, maxWidth: 920, mx: 'auto' }}>
      {!moments.length ? (
        <EmptyState
          icon="📝"
          message={isZh ? '还没有朋友圈动态。角色发布后的动态会显示在这里。' : 'No moments yet. Published character posts will appear here.'}
        />
      ) : (
        <Stack spacing={{ xs: 1.25, sm: 1.5 }}>
          {visibleMoments.map((moment) => {
            const avatar = moment.actorId ? characterAvatars.get(moment.actorId) : undefined;
            const text = cleanDisplayedMomentText(sanitizeUserFacingText(moment.text, textMembers));
            return (
              <SurfaceCard
                key={moment.id}
                contentSx={{ p: { xs: 1.5, sm: 1.75 }, '&:last-child': { pb: { xs: 1.5, sm: 1.75 } } }}
              >
                <Stack direction="row" spacing={{ xs: 1.15, sm: 1.4 }} sx={{ alignItems: 'flex-start' }}>
                  <Avatar
                    src={isImageAvatar(avatar) ? avatar : undefined}
                    alt={moment.actorName}
                    sx={{
                      width: { xs: 40, sm: 44 },
                      height: { xs: 40, sm: 44 },
                      bgcolor: 'primary.light',
                      color: 'primary.contrastText',
                      fontSize: '1rem',
                      fontWeight: 760,
                      flexShrink: 0,
                    }}
                  >
                    {isImageAvatar(avatar) ? undefined : formatAvatarFallback(avatar, moment.actorName)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: 0, lineHeight: 1.25 }}>
                      {sanitizeUserFacingText(moment.actorName, textMembers)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {sanitizeUserFacingText(moment.conversationName, textMembers)} · {formatTime(moment.createdAt)}
                    </Typography>
                    {developerMode && showMomentDebug && moment.debugState === 'candidate' ? (
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.8, flexWrap: 'wrap' }}>
                        <Chip size="small" label={isZh ? '候选' : 'Candidate'} color="warning" variant="outlined" sx={compactPillChipSx} />
                        {moment.activityType ? <Chip size="small" label={sanitizeUserFacingText(moment.activityType, textMembers)} variant="outlined" sx={compactPillChipSx} /> : null}
                        {moment.expectedArtifacts.map((artifact) => <Chip key={artifact} size="small" label={artifact} variant="outlined" sx={compactPillChipSx} />)}
                      </Stack>
                    ) : null}
                    {developerMode && showMomentDebug && moment.debugState !== 'candidate' ? (
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.8, flexWrap: 'wrap' }}>
                        <Chip size="small" label={isZh ? '已发布' : 'Published'} color="success" variant="outlined" sx={compactPillChipSx} />
                        {moment.media.length ? <Chip size="small" label={isZh ? `图片 ${moment.media.length}` : `Images ${moment.media.length}`} variant="outlined" sx={compactPillChipSx} /> : null}
                      </Stack>
                    ) : null}
                    <Typography
                      variant="body1"
                      sx={{
                        mt: 1.15,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.75,
                      }}
                    >
                      {text || (isZh ? '这条动态暂时没有正文。' : 'This post has no content yet.')}
                    </Typography>
                    {moment.media.length ? (
                      <Box
                        sx={{
                          mt: 1.25,
                          display: 'grid',
                          gap: 0.75,
                          gridTemplateColumns: moment.media.length > 1 ? { xs: '1fr 1fr', sm: 'repeat(3, minmax(0, 1fr))' } : 'minmax(0, 420px)',
                          maxWidth: moment.media.length > 1 ? { sm: 420 } : 420,
                        }}
                      >
                        {moment.media.slice(0, 4).map((item, index) => (
                          <MomentMediaThumbnail
                            key={`${item.url}-${index}`}
                            item={item}
                            alt={moment.title || moment.actorName}
                            onClick={() => void openViewer(Math.max(0, visibleMomentMedia.findIndex((entry) => entry.key === `${moment.id}-${index}`)))}
                          />
                        ))}
                      </Box>
                    ) : null}
                    {developerMode && showMomentDebug && moment.debugEvidence.length ? (
                      <Box sx={{ mt: 1.25, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                        <Typography variant="caption" sx={{ display: 'block', fontWeight: 760, mb: 0.5 }}>
                          {isZh ? '调试证据' : 'Debug evidence'}
                        </Typography>
                        <Stack spacing={0.35}>
                          {moment.debugEvidence.slice(0, 10).map((item) => (
                            <Typography key={item} variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                              {sanitizeUserFacingText(item, textMembers)}
                            </Typography>
                          ))}
                        </Stack>
                      </Box>
                    ) : null}
                  </Box>
                </Stack>
              </SurfaceCard>
            );
          })}
          {hasMoreMoments ? (
            <Box ref={loadMoreRef} sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <Button variant="text" onClick={loadMoreMoments}>
                {isZh ? `加载更多（${Math.min(MOMENT_PAGE_SIZE, moments.length - visibleCount)}）` : 'Load more'}
              </Button>
            </Box>
          ) : null}
        </Stack>
      )}
      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity || 'success'} onClose={() => setNotice(null)} sx={{ width: '100%' }}>
          {notice?.message}
        </Alert>
      </Snackbar>
      <ImageLightbox
        open={viewerOpen}
        images={momentLightboxImages}
        index={Math.max(0, viewerIndex)}
        onIndexChange={(index) => setViewerKey(momentLightboxImages[index]?.key || null)}
        resolveImageSrc={resolveMomentMediaUrl}
        onReachStart={hasMoreMoments ? loadMoreMoments : undefined}
        reachStartVersion={visibleCount}
        onClose={() => setViewerKey(null)}
      />
    </Box>
  );
}
