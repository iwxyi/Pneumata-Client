import type { Message } from '../types/message';
import { getMessageRenderIdentity } from './messageIdentity';

function compareByTimeline(left: Message, right: Message) {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  return 0;
}

export function upsertTransientMessage(messages: Message[], message: Message) {
  const identity = getMessageRenderIdentity(message);
  const next = messages.filter((item) => getMessageRenderIdentity(item) !== identity);
  return [...next, message].sort(compareByTimeline);
}

export function removeTransientMessage(messages: Message[], message: Message) {
  const identity = getMessageRenderIdentity(message);
  return messages.filter((item) => getMessageRenderIdentity(item) !== identity);
}

export function releaseConfirmedTransientMessages(transientMessages: Message[], committedMessages: Message[]) {
  const committedIdentities = new Set(
    committedMessages
      .filter((message) => !message.isStreaming && !message.isDeleted)
      .map(getMessageRenderIdentity),
  );
  const next = transientMessages.filter((message) => (
    message.isStreaming || !committedIdentities.has(getMessageRenderIdentity(message))
  ));
  return next.length === transientMessages.length ? transientMessages : next;
}

export function overlayTransientMessages(messages: Message[], transientMessages: Message[]) {
  const byIdentity = new Map<string, Message>();
  messages.forEach((message) => byIdentity.set(getMessageRenderIdentity(message), message));
  transientMessages.forEach((message) => byIdentity.set(getMessageRenderIdentity(message), message));
  return Array.from(byIdentity.values()).sort(compareByTimeline);
}
