import type { Message } from '../types/message';

function compactForTruncationCompare(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？；;：:、]/g, '');
}

export function resolveCommittedStreamContent(finalContent: string, lastStreamedContent: string) {
  const normalizedFinal = finalContent.trim();
  const normalizedStreamed = lastStreamedContent.trim();
  if (!normalizedFinal) return normalizedStreamed ? lastStreamedContent : finalContent;
  if (
    normalizedStreamed
    && normalizedStreamed.length > normalizedFinal.length
    && normalizedStreamed.includes(normalizedFinal)
  ) {
    return lastStreamedContent;
  }
  const compactFinal = compactForTruncationCompare(normalizedFinal);
  const compactStreamed = compactForTruncationCompare(normalizedStreamed);
  if (
    compactFinal.length >= 8
    && compactStreamed.length > compactFinal.length
    && compactStreamed.includes(compactFinal)
  ) {
    return lastStreamedContent;
  }
  return finalContent;
}

export function shouldDiscardStreamingDraft(current: Message | null, persisted: Message | null) {
  if (!current) return false;
  if (!persisted) return true;
  if (persisted.isDeleted) return false;
  return Boolean(persisted.isStreaming);
}
