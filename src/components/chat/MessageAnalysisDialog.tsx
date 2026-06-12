import { useMemo } from 'react';
import { Box, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import MarkdownText from '../common/MarkdownText';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { projectMessageRuntimeClues } from '../../services/messageRuntimeClues';
import { buildGenerationRuntimeDebugRows } from '../../services/generationRuntimePresentation';
import DebugChip from '../common/DebugChip';

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

function renderRuntimeClueSection(section: ReturnType<typeof projectMessageRuntimeClues>[number]) {
  const { label, items, statusLabel, statusHint } = section;
  if (!items.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.55 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{label}</Typography>
        <Tooltip title={statusHint} arrow>
          <Chip size="small" label={statusLabel} color="warning" variant="outlined" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }} />
        </Tooltip>
      </Box>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {items.map((item, index) => (
          <Chip key={`${label}-${item}-${index}`} size="small" label={item} sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
        ))}
      </Stack>
    </Box>
  );
}

function MessageRuntimeCluesCard({ target, members }: { target: Message | null; members: AICharacter[] }) {
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const sections = projectMessageRuntimeClues(target, members);
  if (!developerMode || (!showMemoryDebug && !showAdvancedRuntimePanels) || !sections.length) return null;

  return (
    <Box sx={{ mb: 1.75, p: 1.25, borderRadius: 2, bgcolor: 'rgba(255, 152, 0, 0.08)', border: '1px solid', borderColor: 'warning.light', display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>运行线索</Typography>
        <DebugChip sx={{ height: 22 }} />
      </Box>
      {sections.map((section) => (
        <Box key={section.key}>
          {renderRuntimeClueSection(section)}
        </Box>
      ))}
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
  members?: AICharacter[];
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
        <MessageRuntimeCluesCard target={props.target} members={props.members || []} />
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
