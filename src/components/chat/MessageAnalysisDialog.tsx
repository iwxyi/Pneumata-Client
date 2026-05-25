import { useMemo } from 'react';
import { Box, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import MarkdownText from '../common/MarkdownText';
import type { Message } from '../../types/message';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';

type AnalysisSection = { index: number; title: string; content: string };

function parseAnalysisSections(text: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  let current: AnalysisSection | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/^__(.+)__$/, '$1')
      .trim();
    const headingMatch = line.match(/^(\d{1,2})[.、]\s*(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      const heading = headingMatch[2].trim();
      const splitMatch = heading.match(/^(.+?)(?:[:：]\s*)(.+)$/);
      current = {
        index: Number(headingMatch[1]),
        title: splitMatch?.[1]?.trim() || heading,
        content: splitMatch?.[2]?.trim() || '',
      };
      continue;
    }
    if (current) {
      current.content = [current.content, rawLine].filter((item) => item.trim()).join('\n');
    }
  }
  if (current) sections.push(current);
  return sections;
}

function getAnalysisSectionTone(index: number) {
  if (index === 1) return { color: '#2563eb', bgcolor: 'rgba(37,99,235,0.10)' };
  if ([3, 4, 8].includes(index)) return { color: '#7c3aed', bgcolor: 'rgba(124,58,237,0.10)' };
  if ([5, 7].includes(index)) return { color: '#0f766e', bgcolor: 'rgba(15,118,110,0.10)' };
  if (index === 9) return { color: '#b45309', bgcolor: 'rgba(180,83,9,0.10)' };
  return { color: '#475569', bgcolor: 'rgba(71,85,105,0.10)' };
}

function cleanRuntimeText(text: string | undefined | null) {
  return sanitizeUserFacingText(text || '').trim();
}

function formatResponseSurfaceKind(value: string | undefined) {
  const labels: Record<string, string> = {
    chat: '普通聊天',
    professional: '专业讨论',
    creative: '创作表达',
    longform: '长段落表达',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function formatRoleFit(value: string | undefined) {
  const labels: Record<string, string> = {
    limited: '角色能力有限',
    ordinary: '角色可普通参与',
    capable: '角色适合展开',
  };
  return value ? labels[value] || cleanRuntimeText(value) : '';
}

function renderRuntimeClueSection(label: string, items: string[]) {
  const cleaned = items.map((item) => cleanRuntimeText(item)).filter(Boolean).slice(0, 5);
  if (!cleaned.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.55 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{label}</Typography>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {cleaned.map((item, index) => (
          <Chip key={`${label}-${item}-${index}`} size="small" label={item} sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
        ))}
      </Stack>
    </Box>
  );
}

function MessageRuntimeCluesCard({ target }: { target: Message | null }) {
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const decision = target?.metadata?.runtimeDecision;
  if (!developerMode || (!showMemoryDebug && !showAdvancedRuntimePanels) || !decision) return null;

  const memoryItems = (decision.memoryContext?.recalledArchives || []).flatMap((item) => [
    item.summary,
    item.recallReason ? `原因：${item.recallReason}` : '',
  ]).filter(Boolean);
  const innerLifeItems = decision.innerLife ? [
    decision.innerLife.tone ? `语气：${decision.innerLife.tone}` : '',
    decision.innerLife.impulse ? `冲动：${decision.innerLife.impulse}` : '',
    decision.innerLife.reason ? `原因：${decision.innerLife.reason}` : '',
  ].filter(Boolean) : [];
  const surfaceItems = decision.responseSurface ? [
    formatResponseSurfaceKind(decision.responseSurface.kind),
    formatRoleFit(decision.responseSurface.roleFit),
    decision.responseSurface.allowMarkdown ? '允许富文本' : '',
    ...(decision.responseSurface.basis || []),
  ].filter(Boolean) : [];
  const directorItems = decision.directorIntent ? [
    decision.directorIntent.beatType ? `动作：${decision.directorIntent.beatType}` : '',
    decision.directorIntent.reason ? `原因：${decision.directorIntent.reason}` : '',
  ].filter(Boolean) : [];
  const narrativeItems = (decision.narrativeLines || []).map((item) => item.title).filter(Boolean);
  const feedbackItems = (decision.expressionFeedback || []).map((item) => item.label || item.text).filter(Boolean);
  const hasContent = memoryItems.length || innerLifeItems.length || surfaceItems.length || directorItems.length || narrativeItems.length || feedbackItems.length;
  if (!hasContent) return null;

  return (
    <Box sx={{ mb: 1.75, p: 1.25, borderRadius: 2, bgcolor: 'rgba(255, 152, 0, 0.08)', border: '1px solid', borderColor: 'warning.light', display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>运行线索</Typography>
        <Chip size="small" label="调试" color="warning" variant="outlined" sx={{ height: 22 }} />
      </Box>
      {renderRuntimeClueSection('记忆', memoryItems)}
      {renderRuntimeClueSection('内心', innerLifeItems)}
      {renderRuntimeClueSection('表达', surfaceItems)}
      {renderRuntimeClueSection('调度', directorItems)}
      {renderRuntimeClueSection('叙事线', narrativeItems)}
      {renderRuntimeClueSection('反馈', feedbackItems)}
    </Box>
  );
}

function AnalysisResultView({ text }: { text: string }) {
  const sections = useMemo(() => parseAnalysisSections(text), [text]);
  if (!sections.length) {
    return (
      <Box sx={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
        <MarkdownText text={text} />
      </Box>
    );
  }

  const summary = sections.find((section) => section.index === 1) || sections[0];
  const followUps = sections.find((section) => section.index === 9);
  const bodySections = sections.filter((section) => section !== summary && section !== followUps);

  return (
    <Stack spacing={1.5} sx={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
      <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.78, mb: 0.5 }}>一句话总评</Typography>
        <Box sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, fontWeight: 650 }}>
          <MarkdownText text={summary.content || summary.title} />
        </Box>
      </Box>

      <Box sx={{ columnCount: { xs: 1, sm: 2 }, columnGap: 1.25 }}>
        {bodySections.map((section) => {
          const tone = getAnalysisSectionTone(section.index);
          return (
            <Box key={section.index} sx={{ display: 'inline-block', width: '100%', mb: 1.25, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minWidth: 0, breakInside: 'avoid' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: tone.bgcolor, color: tone.color, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                  {section.index}
                </Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, minWidth: 0 }}>{section.title}</Typography>
              </Box>
              <MarkdownText text={section.content || '无'} />
            </Box>
          );
        })}
      </Box>

      {followUps ? (
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: (theme) => theme.palette.mode === 'light' ? '#fff7ed' : 'rgba(180,83,9,0.16)', border: '1px solid', borderColor: (theme) => theme.palette.mode === 'light' ? '#fed7aa' : 'rgba(251,146,60,0.35)' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>{followUps.title}</Typography>
          <MarkdownText text={followUps.content} />
        </Box>
      ) : null}
    </Stack>
  );
}

export function MessageAnalysisDialog(props: {
  open: boolean;
  target: Message | null;
  text: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>AI分析</Typography>
          {props.target ? <Chip size="small" label={props.target.senderName || '消息'} /> : null}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ maxHeight: '72vh', overflowY: 'auto', pb: 3 }}>
        {props.target ? (
          <Box sx={{ mb: 1.75, p: 1.25, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>目标消息</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.65 }}>
              {props.target.content}
            </Typography>
          </Box>
        ) : null}
        <MessageRuntimeCluesCard target={props.target} />
        {props.loading ? (
          <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : props.error ? (
          <Typography variant="body2" color="error">{props.error}</Typography>
        ) : (
          <AnalysisResultView text={props.text} />
        )}
      </DialogContent>
    </Dialog>
  );
}
