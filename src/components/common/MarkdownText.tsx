import { Box, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownAstNode = {
  type?: string;
  value?: string;
  children?: MarkdownAstNode[];
};

function normalizeStreamingMarkdown(text: string) {
  const fenceCount = (text.match(/^```/gm) || []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function splitSoftBreakText(value: string): MarkdownAstNode[] {
  const parts = value.split('\n');
  return parts.flatMap((part, index) => {
    const nodes: MarkdownAstNode[] = [];
    if (index > 0) nodes.push({ type: 'break' });
    if (part) nodes.push({ type: 'text', value: part });
    return nodes;
  });
}

function remarkSingleLineBreaks() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      if (!node.children) return;
      if (node.type === 'paragraph') {
        node.children = node.children.flatMap((child) => (
          child.type === 'text' && typeof child.value === 'string' && child.value.includes('\n')
            ? splitSoftBreakText(child.value)
            : [child]
        ));
        return;
      }
      node.children.forEach(visit);
    };
    visit(tree);
  };
}

export default function MarkdownText({ text, softLineBreaks = true }: { text: string; softLineBreaks?: boolean }) {
  return (
    <Box
      sx={{
        fontSize: 'inherit',
        lineHeight: 1.75,
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& p': { mt: 0, mb: 0.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
        '& h1, & h2, & h3, & h4': { mt: 1.15, mb: 0.55, fontWeight: 850, lineHeight: 1.35 },
        '& h1': { fontSize: '1.28em' },
        '& h2': { fontSize: '1.16em' },
        '& h3': { fontSize: '1.06em' },
        '& h4': { fontSize: '1em' },
        '& ul, & ol': { mt: 0.35, mb: 0.75, pl: 2.4 },
        '& li': { mb: 0.35, overflowWrap: 'anywhere' },
        '& blockquote': {
          m: 0,
          my: 0.75,
          pl: 1,
          borderLeft: '3px solid',
          borderColor: 'divider',
          color: 'text.secondary',
        },
        '& pre': {
          m: 0,
          my: 0.75,
          p: 1,
          borderRadius: 1,
          overflowX: 'auto',
          bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.92)' : 'rgba(2,6,23,0.82)',
          color: '#e5e7eb',
          fontSize: '0.92em',
          lineHeight: 1.65,
        },
        '& pre code': {
          p: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          whiteSpace: 'pre',
        },
        '& code': {
          px: 0.5,
          py: 0.1,
          borderRadius: 0.75,
          bgcolor: 'action.hover',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '0.94em',
        },
        '& table': {
          width: '100%',
          borderCollapse: 'collapse',
          my: 0.85,
          fontSize: '0.96em',
        },
        '& th, & td': {
          border: '1px solid',
          borderColor: 'divider',
          px: 0.75,
          py: 0.45,
          textAlign: 'left',
          verticalAlign: 'top',
        },
        '& th': { fontWeight: 800, bgcolor: 'action.hover' },
        '& a': { color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
        '& input[type="checkbox"]': { transform: 'translateY(1px)' },
      }}
    >
      <ReactMarkdown
        remarkPlugins={softLineBreaks ? [remarkGfm, remarkSingleLineBreaks] : [remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Box component="a" href={href} target="_blank" rel="noreferrer">
              {children}
            </Box>
          ),
          p: ({ children }) => <Typography component="p" variant="body2">{children}</Typography>,
          code: ({ children, className, ...props }) => (
            <code className={className} {...props}>
              {children}
            </code>
          ),
        }}
      >
        {normalizeStreamingMarkdown(text)}
      </ReactMarkdown>
    </Box>
  );
}
