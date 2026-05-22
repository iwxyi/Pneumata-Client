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
  let tableRows: string[][] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

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
  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows;
    tableRows = [];
    blocks.push(
      <Box key={`table-${blocks.length}`} sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <Box
                    key={cellIndex}
                    component={rowIndex === 0 ? 'th' : 'td'}
                    sx={{ border: '1px solid', borderColor: 'divider', px: 0.75, py: 0.45, textAlign: 'left', verticalAlign: 'top', fontWeight: rowIndex === 0 ? 800 : 400 }}
                  >
                    {renderInlineMarkdown(cell)}
                  </Box>
                ))}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
    );
  };
  const flushCode = () => {
    if (!codeLines.length) return;
    const code = codeLines.join('\n');
    codeLines = [];
    blocks.push(
      <Box key={`code-${blocks.length}`} component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'action.hover', overflowX: 'auto', fontFamily: 'monospace', fontSize: '0.92em', lineHeight: 1.65, whiteSpace: 'pre' }}>
        <code>{code}</code>
      </Box>
    );
  };

  lines.forEach((rawLine) => {
    if (/^```/.test(rawLine.trim())) {
      flushList();
      flushTable();
      if (inCodeBlock) flushCode();
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) {
      codeLines.push(rawLine);
      return;
    }
    const line = rawLine.trim();
    if (!line) {
      flushList();
      flushTable();
      return;
    }
    if (/^\|.+\|$/.test(line) && !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) {
      flushList();
      tableRows.push(line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      flushTable();
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
      flushTable();
      blocks.push(
        <Box key={`quote-${blocks.length}`} sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1, py: 0.25, fontStyle: 'italic', lineHeight: 1.75 }}>
          {renderInlineMarkdown(quote[1])}
        </Box>
      );
      return;
    }
    flushList();
    flushTable();
    blocks.push(
      <Box key={`p-${blocks.length}`} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.75, mb: 0.5, fontSize: 'inherit' }}>
        {renderInlineMarkdown(line)}
      </Box>
    );
  });
  flushList();
  flushTable();
  flushCode();

  return <>{blocks}</>;
}
