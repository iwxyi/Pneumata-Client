/**
 * Tail mutations belong to the viewport only when it was already following
 * the tail. User interaction history is deliberately not an input here:
 * "has interacted" and "is at the bottom" are different states.
 */
export function shouldMaintainTailAfterMutation(input: {
  autoStickToBottom: boolean;
  wasPinnedBeforeMutation: boolean;
  isUserPointerHeld: boolean;
}) {
  return input.autoStickToBottom
    && input.wasPinnedBeforeMutation
    && !input.isUserPointerHeld;
}
