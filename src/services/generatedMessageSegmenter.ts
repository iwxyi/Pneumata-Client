import type { GeneratedRoundMessage } from './chatEngine';

const MAX_EXTRA_MESSAGES = 4;

function normalizeModelExtraMessages(extraMessages: unknown) {
  if (!Array.isArray(extraMessages)) return [];
  const cleaned = extraMessages
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (cleaned.length <= MAX_EXTRA_MESSAGES) return cleaned;
  return [
    ...cleaned.slice(0, MAX_EXTRA_MESSAGES - 1),
    cleaned.slice(MAX_EXTRA_MESSAGES - 1).join('\n'),
  ];
}

function withoutTransientExtras(message: GeneratedRoundMessage): GeneratedRoundMessage {
  if (message.extraMessages == null && message.messageParts == null) return message;
  const { extraMessages: _extraMessages, messageParts: _messageParts, ...rest } = message;
  return rest;
}

function getVisibleTurnParts(message: GeneratedRoundMessage) {
  if (Array.isArray(message.messageParts) && message.messageParts.length) {
    return message.messageParts.map((part) => part.content).filter(Boolean);
  }
  return [message.content, ...normalizeModelExtraMessages(message.extraMessages)].filter(Boolean);
}

export function buildGeneratedTurnContent(message: GeneratedRoundMessage) {
  return getVisibleTurnParts(message).join('\n');
}

export function splitGeneratedMessageText(content: string, _requestedCount = 1) {
  return content ? [content] : [];
}

export function splitGeneratedRoundMessage(message: GeneratedRoundMessage) {
  if (Array.isArray(message.messageParts) && message.messageParts.length) {
    const baseMessage = withoutTransientExtras(message);
    const parts = message.messageParts.filter((part) => Boolean(part.content?.trim()));
    return parts.map((part, index) => ({
      ...baseMessage,
      content: part.content,
      metadata: {
        ...(part.metadata || {}),
        turnSegment: {
          index,
          count: parts.length,
        },
      },
      interactionHint: index === 0 ? message.interactionHint : null,
      interactionHints: index === 0 ? message.interactionHints : null,
      incomingInteractionHint: index === 0 ? message.incomingInteractionHint : null,
      addressedTargetIds: index === 0 ? message.addressedTargetIds : null,
      primaryAddressedTargetId: index === 0 ? message.primaryAddressedTargetId : null,
      socialEventHints: index === 0 ? message.socialEventHints : null,
      conflictFocus: index === 0 ? message.conflictFocus : null,
    }));
  }
  const parts = getVisibleTurnParts(message);
  const baseMessage = withoutTransientExtras(message);
  if (parts.length <= 1) return [baseMessage];

  if (
    message.metadata?.withdrawal?.withdrawn
  ) {
    return [baseMessage];
  }

  if (
    message.metadata?.generationDecision?.image?.shouldGenerate
    || message.metadata?.generationDecision?.audio?.shouldGenerate
    || message.metadata?.format === 'markdown'
  ) {
    return [{
      ...baseMessage,
      content: parts.join('\n'),
    }];
  }

  return parts.map((content, index) => ({
    ...baseMessage,
    content,
    metadata: {
      ...(index === 0 ? baseMessage.metadata : {
        format: baseMessage.metadata?.format,
        manualSpeaker: baseMessage.metadata?.manualSpeaker,
      }),
      turnSegment: {
        index,
        count: parts.length,
      },
    },
    interactionHint: index === 0 ? message.interactionHint : null,
    interactionHints: index === 0 ? message.interactionHints : null,
    incomingInteractionHint: index === 0 ? message.incomingInteractionHint : null,
    addressedTargetIds: index === 0 ? message.addressedTargetIds : null,
    primaryAddressedTargetId: index === 0 ? message.primaryAddressedTargetId : null,
    socialEventHints: index === 0 ? message.socialEventHints : null,
    conflictFocus: index === 0 ? message.conflictFocus : null,
  }));
}
