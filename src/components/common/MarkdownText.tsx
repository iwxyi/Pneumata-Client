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

function MarkdownText({ text, softLineBreaks = true }: { text: string; softLineBreaks?: boolean }) {
  const normalized = normalizeStreamingMarkdown(text);
  if (!shouldUseRichMarkdown(normalized)) return <PlainMarkdownText text={normalized} />;
  return (
    <Suspense fallback={<PlainMarkdownText text={normalized} />}>
      <RichMarkdownText text={normalized} softLineBreaks={softLineBreaks} />
    </Suspense>
  );
}

export default memo(MarkdownText);
