import { memo } from 'react';
import RichMarkdownText from './RichMarkdownText';

function normalizeStreamingMarkdown(text: string) {
  const fenceCount = (text.match(/^```/gm) || []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

// eslint-disable-next-line react-refresh/only-export-components
export function shouldUseRichMarkdown(text: string) {
  if (!text) return false;
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+\.\s+\S|>\s|\|.*\|)|```|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|!\[[^\]]*]\(|\[[^\]]+]\(|<\/?[a-z][\s\S]*>/i.test(text);
}

function MarkdownText({
  text,
  softLineBreaks = true,
  forceRich: _forceRich = false,
  deferDiagrams = false,
  onOpenDiagram,
}: {
  text: string;
  softLineBreaks?: boolean;
  forceRich?: boolean;
  deferDiagrams?: boolean;
  onOpenDiagram?: (payload: { source: string; svg: string; dataUrl: string }) => void;
}) {
  void _forceRich;
  const normalized = normalizeStreamingMarkdown(text);
  // Keep one DOM shape throughout streaming and final commit. Switching from
  // a plain paragraph to the lazy rich renderer changes paragraph margins and
  // makes the bubble jump when the final text arrives.
  return <RichMarkdownText text={normalized} softLineBreaks={softLineBreaks} deferDiagrams={deferDiagrams} onOpenDiagram={onOpenDiagram} />;
}

export default memo(MarkdownText);
