import type { Message, NarrativeBlock } from '../../types/message';

export function isNarrativeParagraphMessage(message: Message) {
  const turn = message.metadata?.narrativeTurn;
  return Boolean((turn && turn.povActorId === 'narrator') || (message.type === 'ai' && message.senderId === 'narrator'));
}

export function getNarrativeParagraphBlocks(message: Message): NarrativeBlock[] {
  const turn = message.metadata?.narrativeTurn;
  if (turn?.povActorId === 'narrator') {
    return turn.blocks.filter((block) => block.actorKind === 'narrator' && block.displayMode === 'paragraph' && block.text.trim());
  }
  const text = message.content.trim();
  if (!isNarrativeParagraphMessage(message) || !text) return [];
  return [{
    id: `${message.id}:narrator`,
    actorId: 'narrator',
    actorKind: 'narrator',
    kind: 'prose',
    displayMode: 'paragraph',
    text,
  }];
}

export function shouldUseCompactMessageBubble(options: {
  compactBubbleMode: boolean;
  compactPrivateBubbleMode: boolean;
  privateConversation: boolean;
  selfMemberId?: string | null;
  isUser: boolean;
  isGuidanceBubble: boolean;
}) {
  const isPrivateConversation = options.privateConversation || options.selfMemberId !== null;
  return (options.compactBubbleMode && !options.isUser && !options.isGuidanceBubble)
    || (options.compactPrivateBubbleMode && isPrivateConversation && !options.isUser && !options.isGuidanceBubble);
}
