import type React from 'react';
import { Box } from '@mui/material';

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Box key={index} component="code" sx={{ px: 0.5, py: 0.1, borderRadius: 0.75, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: 'inherit' }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Box key={index} component="strong" sx={{ fontWeight: 800 }}>{part.slice(2, -2)}</Box>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <Box key={index} component="em" sx={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Box>;
    }
    return part;
  });
}

export default function MarkdownText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: Array<{ ordered: boolean; text: string }> = [];

  const flushList = () => {
    if (!listItems.length) return;
    const ordered = listItems[0].ordered;
    const items = listItems;
    listItems = [];
    blocks.push(
      <Box key={`list-${blocks.length}`} component={ordered ? 'ol' : 'ul'} sx={{ m: 0, pl: 2.5, fontSize: 'inherit', '& li': { mb: 0.45, lineHeight: 1.75, fontSize: 'inherit' } }}>
        {items.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}
      </Box>
    );
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(
        <Box key={`heading-${blocks.length}`} sx={{ mt: blocks.length ? 1 : 0, mb: 0.5, fontWeight: 850, fontSize: 'inherit', lineHeight: 1.75 }}>
          {renderInlineMarkdown(heading[2])}
        </Box>
      );
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push({ ordered: false, text: bullet[1] });
      return;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      listItems.push({ ordered: true, text: ordered[1] });
      return;
    }
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushList();
      blocks.push(
        <Box key={`quote-${blocks.length}`} sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1, py: 0.25, fontStyle: 'italic', lineHeight: 1.75 }}>
          {renderInlineMarkdown(quote[1])}
        </Box>
      );
      return;
    }
    flushList();
    blocks.push(
      <Box key={`p-${blocks.length}`} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.75, mb: 0.5, fontSize: 'inherit' }}>
        {renderInlineMarkdown(line)}
      </Box>
    );
  });
  flushList();

  return <>{blocks}</>;
}
