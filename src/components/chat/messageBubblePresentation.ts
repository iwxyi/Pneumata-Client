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
