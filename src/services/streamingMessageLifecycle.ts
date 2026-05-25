import type { Message } from '../types/message';

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
  return finalContent;
}

export function shouldDiscardStreamingDraft(current: Message | null, persisted: Message | null) {
  if (!current) return false;
  if (!persisted) return true;
  if (persisted.isDeleted) return false;
  return Boolean(persisted.isStreaming);
}
