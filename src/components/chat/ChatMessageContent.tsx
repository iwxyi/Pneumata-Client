import { Box, Button, Chip, LinearProgress, Typography, keyframes } from '@mui/material';
import type { Message, MessageAttachment, NarrativeBlock } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { getAttachmentStatusDetail, getAttachmentStatusLabel } from '../../services/messageAttachmentDisplay';
import MarkdownText from '../common/MarkdownText';
import { formatNarrativeLineText } from '../../services/narrativeLinePresentation';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { reducedMotionSx } from '../../styles/motion';

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
            ...reducedMotionSx,
          }}
        />
      ))}
    </Box>
  );
}

function NarrativeChoiceCard({ block, showDeveloperDetails = false }: { block: NarrativeBlock; showDeveloperDetails?: boolean }) {
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const maxContentWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  const choice = block.choices?.[0];
  const meta = showDeveloperDetails ? [
    choice?.intent ? `意图：${choice.intent}` : '',
    choice?.risk ? `风险：${choice.risk}` : '',
    choice?.reward ? `收益：${choice.reward}` : '',
  ].filter(Boolean) : [];
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box
        sx={(theme) => ({
          width: '100%',
          maxWidth: maxContentWidth,
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
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const maxContentWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  const lines = block.text.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = lines[0] || '章节回顾';
  const bodyLines = lines.slice(1);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Box
        sx={(theme) => ({
          width: '100%',
          maxWidth: maxContentWidth,
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
          <Typography key={line} component="div" variant="body2" sx={{ lineHeight: 1.75, wordBreak: 'break-word', mt: 0.35 }}>
            <MarkdownText text={formatNarrativeLineText(line, characters)} />
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

export function NarrativeParagraphContent({ blocks, characters = [], showDeveloperDetails = false }: { blocks: NarrativeBlock[]; characters?: AICharacter[]; showDeveloperDetails?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.75 }}>
      {blocks.filter((block) => block.displayMode !== 'bubble').map((block) => {
        return block.displayMode === 'choice_card' ? (
        <NarrativeChoiceCard key={block.id} block={block} showDeveloperDetails={showDeveloperDetails} />
      ) : block.displayMode === 'system_panel' ? (
        showDeveloperDetails ? <NarrativeSystemPanel key={block.id} block={block} characters={characters} /> : null
      ) : (
        <Box key={block.id} sx={{ fontSize: 'inherit', lineHeight: 'inherit', color: 'text.primary', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
          <MarkdownText text={block.text} />
        </Box>
      );
      })}
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
                  loading="lazy"
                  decoding="async"
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
