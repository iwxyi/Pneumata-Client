// Keep the first few characters individually perceptible. The model can still
// stream quickly, but the UI buffer should read as someone typing.
export const STREAMING_DISPLAY_TICK_MS = 46;

const MIN_REVEAL_GRAPHEMES = 1;
const MAX_REVEAL_GRAPHEMES = 4;

function revealStepSize(remaining: number) {
  if (remaining <= MIN_REVEAL_GRAPHEMES) return remaining;
  if (remaining >= 96) return MAX_REVEAL_GRAPHEMES;
  if (remaining >= 36) return 3;
  if (remaining >= 14) return 2;
  return MIN_REVEAL_GRAPHEMES;
}

export function getNextStreamingDisplayContent(displayContent: string, targetContent: string) {
  if (!targetContent || displayContent === targetContent) return targetContent;
  if (!displayContent) {
    const targetChars = Array.from(targetContent);
    return targetChars.slice(0, revealStepSize(targetChars.length)).join('');
  }
  if (!targetContent.startsWith(displayContent)) return targetContent;
  const displayChars = Array.from(displayContent);
  const targetChars = Array.from(targetContent);
  const remaining = targetChars.length - displayChars.length;
  if (remaining <= 0) return targetContent;
  return targetChars.slice(0, displayChars.length + revealStepSize(remaining)).join('');
}
