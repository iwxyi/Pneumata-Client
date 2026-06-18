import { Avatar, Box, Button, Chip, LinearProgress, Typography, keyframes } from '@mui/material';
import type { Message, MessageAttachment, NarrativeBlock } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { getAttachmentStatusDetail, getAttachmentStatusLabel } from '../../services/messageAttachmentDisplay';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../../utils/bubbleStyle';
import { isImageAvatar } from '../../utils/avatar';
import { rememberFailedAvatarUrl, resolveSafeAvatarSrc } from '../../utils/avatarFallback';
import MarkdownText from '../common/MarkdownText';
import { formatNarrativeLineText } from '../../services/narrativeLinePresentation';

const typingBounce = keyframes`
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
`;

export function PendingTypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, py: 0.25 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'text.disabled',
            animation: `${typingBounce} 1.4s ease-in-out infinite`,
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </Box>
  );
}

function findNarrativeBlockCharacter(block: NarrativeBlock, characters: AICharacter[]) {
  if (block.characterId) {
    const byId = characters.find((character) => character.id === block.characterId);
    if (byId) return byId;
  }
  const actorName = (block.actorName || '').trim();
  return actorName ? characters.find((character) => character.name === actorName) || null : null;
}

function NarrativeSpeechBubble({ block, character }: { block: NarrativeBlock; character?: AICharacter | null }) {
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const resolvedStyle = character
    ? resolveCharacterBubbleStyle({ bubbleStyle: character.bubbleStyle, bubbleStyleId: character.bubbleStyleId, customStyles: customBubbleStyles })
    : null;
  const bubblePreview = resolvedStyle ? buildBubblePreview(resolvedStyle, false) : null;
  const displayName = character?.name || block.actorName || block.actorId;
  const avatar = character?.avatar?.trim();
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1.1, alignItems: 'flex-start', minWidth: 0 }}>
      <Box sx={{ flexShrink: 0 }}>
        {avatar && isImageAvatar(avatar) ? (
          <Avatar
            src={resolveSafeAvatarSrc(avatar)}
            alt={displayName}
            slotProps={{ img: { onError: () => rememberFailedAvatarUrl(avatar) } }}
            sx={{ width: 34, height: 34 }}
          />
        ) : (
          <Avatar sx={{ width: 34, height: 34, bgcolor: resolvedStyle?.backgroundColor || 'primary.main', fontSize: 15 }}>
            {displayName.slice(0, 1)}
          </Avatar>
        )}
      </Box>
      <Box sx={{ maxWidth: 'min(78%, 720px)', minWidth: 0, display: 'grid', gap: 0.35, justifyItems: 'start' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', px: 0.5, width: 'fit-content' }}>
          {displayName}
        </Typography>
        <Box
          sx={{
            px: 1.4,
            py: 1,
            borderRadius: bubblePreview?.borderRadius || '18px',
            background: bubblePreview?.background || '#ffffff',
            color: bubblePreview?.color || (resolvedStyle?.textColor || '#1f2937'),
            border: bubblePreview?.border || '1px solid rgba(15, 23, 42, 0.08)',
            boxShadow: bubblePreview?.boxShadow || '0 8px 24px rgba(15, 23, 42, 0.08)',
            wordBreak: 'break-word',
            userSelect: 'text',
            WebkitUserSelect: 'text',
            '& table': { width: '100%', borderCollapse: 'collapse' },
            '& th, & td': { border: '1px solid', borderColor: 'divider', px: 0.75, py: 0.4 },
          }}
        >
          <Box sx={{ typography: 'body2', lineHeight: 1.75 }}>
            <MarkdownText text={block.text} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function NarrativeChoiceCard({ block }: { block: NarrativeBlock }) {
  const choice = block.choices?.[0];
  const meta = [
    choice?.intent ? `意图：${choice.intent}` : '',
    choice?.risk ? `风险：${choice.risk}` : '',
    choice?.reward ? `收益：${choice.reward}` : '',
  ].filter(Boolean);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box
        sx={(theme) => ({
          width: '100%',
          maxWidth: 640,
          borderRadius: 2,
          px: { xs: 1.35, sm: 1.6 },
          py: { xs: 1, sm: 1.15 },
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(99,102,241,0.22)' : 'rgba(129,140,248,0.32)',
          bgcolor: theme.palette.mode === 'light' ? 'rgba(238,242,255,0.62)' : 'rgba(49,46,129,0.20)',
        })}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, mb: 0.35 }}>
          你选择了
        </Typography>
        <Typography variant="body2" sx={{ lineHeight: 1.75, fontWeight: 700, wordBreak: 'break-word' }}>
          {block.text}
        </Typography>
        {meta.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.55, lineHeight: 1.6, wordBreak: 'break-word' }}>
            {meta.join(' · ')}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function NarrativeSystemPanel({ block, characters }: { block: NarrativeBlock; characters: AICharacter[] }) {
  const lines = block.text.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = lines[0] || '章节回顾';
  const bodyLines = lines.slice(1);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box
        sx={(theme) => ({
          width: '100%',
          maxWidth: 680,
          borderRadius: 2,
          px: { xs: 1.35, sm: 1.6 },
          py: { xs: 1, sm: 1.15 },
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(14,165,233,0.24)' : 'rgba(125,211,252,0.26)',
          bgcolor: theme.palette.mode === 'light' ? 'rgba(240,249,255,0.72)' : 'rgba(8,47,73,0.26)',
          boxShadow: theme.palette.mode === 'light' ? '0 10px 28px rgba(15,23,42,0.06)' : '0 12px 30px rgba(0,0,0,0.22)',
        })}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, mb: 0.45 }}>
          {formatNarrativeLineText(title, characters)}
        </Typography>
        {bodyLines.map((line) => (
          <Typography key={line} variant="body2" sx={{ lineHeight: 1.75, wordBreak: 'break-word', mt: 0.35 }}>
            {formatNarrativeLineText(line, characters)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

export function NarrativeParagraphContent({ blocks, characters = [] }: { blocks: NarrativeBlock[]; characters?: AICharacter[] }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.75 }}>
      {blocks.map((block) => block.displayMode === 'bubble' ? (
        <NarrativeSpeechBubble key={block.id} block={block} character={findNarrativeBlockCharacter(block, characters)} />
      ) : block.displayMode === 'choice_card' ? (
        <NarrativeChoiceCard key={block.id} block={block} />
      ) : block.displayMode === 'system_panel' ? (
        <NarrativeSystemPanel key={block.id} block={block} characters={characters} />
      ) : (
        <Box key={block.id} sx={{ typography: 'body1', lineHeight: 2.05, color: 'text.primary', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
          <MarkdownText text={block.text} />
        </Box>
      ))}
    </Box>
  );
}

export function MessageContent({ message, onRetryMedia, onOpenImage }: {
  message: Message;
  onRetryMedia?: (message: Message, attachmentId: string) => void | Promise<void>;
  onOpenImage?: (message: Message, attachment: MessageAttachment) => void;
}) {
  const attachments = message.metadata?.attachments || [];
  const statusChipColor = (status: string | undefined): 'error' | 'success' | 'primary' => {
    if (status === 'failed') return 'error';
    if (status === 'ready') return 'success';
    return 'primary';
  };
  const getMediaFrameStyle = (attachment: { width?: number; height?: number }) => {
    const width = Number(attachment.width || 0);
    const height = Number(attachment.height || 0);
    const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3';
    return {
      width: '100%',
      maxWidth: 320,
      aspectRatio: ratio,
      borderRadius: 1.5,
      border: '1px solid',
      borderColor: 'divider',
      overflow: 'hidden',
      bgcolor: 'action.hover',
      position: 'relative' as const,
    };
  };
  return (
    <Box sx={{ display: 'grid', gap: 0.9 }}>
      <Box sx={{ typography: 'body2', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text', '& table': { width: '100%', borderCollapse: 'collapse' }, '& th, & td': { border: '1px solid', borderColor: 'divider', px: 0.75, py: 0.4 } }}>
        <MarkdownText text={message.content} />
      </Box>
      {attachments.map((attachment) => {
        if (attachment.kind === 'image') {
          if (attachment.status === 'ready' && attachment.url) {
            return (
              <Box key={attachment.id} sx={getMediaFrameStyle(attachment)}>
                <Box
                  component="img"
                  src={attachment.url}
                  alt={attachment.altText}
                  onClick={() => onOpenImage?.(message, attachment)}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: onOpenImage ? 'zoom-in' : 'default' }}
                />
              </Box>
            );
          }
          return (
            <Box key={attachment.id} sx={getMediaFrameStyle(attachment)}>
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 1.5, textAlign: 'center' }}>
                <Box sx={{ display: 'grid', gap: 0.75, maxWidth: '85%' }}>
                  <Box>
                    <Chip size="small" label={getAttachmentStatusLabel(attachment)} color={statusChipColor(attachment.status)} variant="outlined" sx={{ height: 22 }} />
                  </Box>
                  {attachment.status !== 'failed' ? <LinearProgress /> : null}
                  <Typography variant="caption" sx={{ color: attachment.status === 'failed' ? 'error.main' : 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {getAttachmentStatusDetail(attachment)}
                  </Typography>
                  {attachment.status === 'failed' && onRetryMedia ? (
                    <Button size="small" variant="outlined" color="error" onClick={() => void onRetryMedia?.(message, attachment.id)}>
                      重试
                    </Button>
                  ) : null}
                  <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {attachment.altText}
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        }
        if (attachment.kind === 'audio') {
          if (attachment.status === 'ready' && attachment.url) {
            return (
              <Box key={attachment.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 220 }}>
                <Box component="audio" controls src={attachment.url} sx={{ width: '100%', maxWidth: 280 }} />
              </Box>
            );
          }
          return (
            <Box key={attachment.id} sx={{ minWidth: 200, borderRadius: 999, border: '1px solid', borderColor: 'divider', px: 1.25, py: 0.75, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">{getAttachmentStatusLabel(attachment)}</Typography>
                <Chip size="small" label={attachment.status === 'failed' ? '失败' : '处理中'} color={statusChipColor(attachment.status)} variant="outlined" sx={{ height: 20 }} />
              </Box>
              {attachment.status !== 'failed' ? <LinearProgress sx={{ mt: 0.5 }} /> : null}
              <Typography variant="caption" sx={{ display: 'block', mt: 0.45, color: attachment.status === 'failed' ? 'error.main' : 'text.secondary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {getAttachmentStatusDetail(attachment)}
              </Typography>
              {attachment.status === 'failed' && onRetryMedia ? (
                <Button size="small" variant="outlined" color="error" sx={{ mt: 0.6 }} onClick={() => void onRetryMedia?.(message, attachment.id)}>
                  重试
                </Button>
              ) : null}
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
}
