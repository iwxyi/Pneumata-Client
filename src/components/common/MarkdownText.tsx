import { lazy, memo, Suspense } from 'react';
import { Box, Typography } from '@mui/material';

const RichMarkdownText = lazy(() => import('./RichMarkdownText'));

function normalizeStreamingMarkdown(text: string) {
  const fenceCount = (text.match(/^```/gm) || []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

export function shouldUseRichMarkdown(text: string) {
  if (!text) return false;
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+\.\s+\S|>\s|\|.*\|)|```|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|!\[[^\]]*]\(|\[[^\]]+]\(|<\/?[a-z][\s\S]*>/i.test(text);
}

function PlainMarkdownText({ text }: { text: string }) {
  return (
    <Box
      sx={{
        fontSize: 'inherit',
        lineHeight: 1.95,
        minWidth: 0,
        maxWidth: '100%',
        '& p': { mt: 0, mb: 0.95, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
        '& > :last-child': { mb: 0 },
      }}
    >
      <Typography component="p" variant="body2">
        {text}
      </Typography>
    </Box>
  );
}

function MarkdownText({
  text,
  softLineBreaks = true,
  forceRich = false,
  deferDiagrams = false,
  onOpenDiagram,
}: {
  text: string;
  softLineBreaks?: boolean;
  forceRich?: boolean;
  deferDiagrams?: boolean;
  onOpenDiagram?: (payload: { source: string; svg: string; dataUrl: string }) => void;
}) {
  const normalized = normalizeStreamingMarkdown(text);
  if (!forceRich && !shouldUseRichMarkdown(normalized)) return <PlainMarkdownText text={normalized} />;
  return (
    <Suspense fallback={<PlainMarkdownText text={normalized} />}>
      <RichMarkdownText text={normalized} softLineBreaks={softLineBreaks} deferDiagrams={deferDiagrams} onOpenDiagram={onOpenDiagram} />
    </Suspense>
  );
}

export default memo(MarkdownText);
