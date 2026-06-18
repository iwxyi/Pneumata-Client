import type { Message, NarrativeBlock } from '../../types/message';

export function getNarrativeParagraphBlocks(message: Message): NarrativeBlock[] {
  const turn = message.metadata?.narrativeTurn;
  if (!turn || turn.povActorId !== 'narrator') return [];
  return turn.blocks.filter((block) => block.actorKind === 'narrator' && block.displayMode === 'paragraph' && block.text.trim());
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
