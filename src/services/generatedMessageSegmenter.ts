import type { GeneratedRoundMessage } from './chatEngine';

// Streaming output is the authoritative bubble. Local punctuation-based splitting
// can rewrite or truncate the bubble after commit, so multi-bubble output must use
// a future explicit model protocol instead of this legacy heuristic.
export function splitGeneratedMessageText(content: string, _requestedCount = 1) {
  return content ? [content] : [];
}

export function splitGeneratedRoundMessage(message: GeneratedRoundMessage) {
  return [message];
}
