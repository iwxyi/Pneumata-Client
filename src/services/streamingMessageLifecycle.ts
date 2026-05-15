import type { Message } from '../types/message';

function countMeaningfulChars(content: string) {
  return content.replace(/[\p{P}\p{S}\s]/gu, '').length;
}

function shouldPreferStreamedContent(finalContent: string, lastStreamedContent: string) {
  if (!finalContent || !lastStreamedContent) return false;
  if (finalContent === lastStreamedContent) return false;
  if (!lastStreamedContent.startsWith(finalContent)) return false;
  const suffix = lastStreamedContent.slice(finalContent.length).trim();
  if (!suffix) return false;
  if (lastStreamedContent.length > 48 || suffix.length > 24) return false;
  if (countMeaningfulChars(suffix) < 2) return false;
  if (/^(因为|首先|其次|另外|总结|总之|所以总体|简单来说|具体来说|一方面|另一方面)/.test(suffix)) return false;
  if (/[{}[\]<>]/.test(lastStreamedContent)) return false;
  return true;
}

export function resolveCommittedStreamContent(finalContent: string, lastStreamedContent: string) {
  const normalizedFinal = finalContent.trim();
  const normalizedStreamed = lastStreamedContent.trim();
  if (!normalizedFinal) return normalizedStreamed ? lastStreamedContent : finalContent;
  if (shouldPreferStreamedContent(normalizedFinal, normalizedStreamed)) return lastStreamedContent;
  return finalContent;
}

export function shouldDiscardStreamingDraft(current: Message | null, persisted: Message | null) {
  if (!current) return false;
  if (!persisted) return true;
  if (persisted.isDeleted) return false;
  return Boolean(persisted.isStreaming);
}
