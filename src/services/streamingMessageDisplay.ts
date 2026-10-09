import type { Message } from '../types/message';
import { getNextStreamingDisplayContent, STREAMING_DISPLAY_TICK_MS } from './streamingDisplayBuffer';

export function createStreamingMessageDisplay(params: {
  upsertMessage: (message: Message) => void;
  isAnimationEnabled: () => boolean;
}) {
  let target: Message | null = null;
  let displayed: Message | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const freeze = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    timer = null;
    if (!target) return;
    const content = getNextStreamingDisplayContent(displayed?.content || '', target.content);
    displayed = { ...target, content };
    params.upsertMessage(displayed);
    if (content !== target.content) timer = setTimeout(flush, STREAMING_DISPLAY_TICK_MS);
  };

  return {
    update(message: Message | null, options?: { immediate?: boolean }) {
      target = message;
      if (!message) {
        freeze();
        displayed = null;
        return;
      }
      if (options?.immediate || !params.isAnimationEnabled()) {
        freeze();
        displayed = message;
        params.upsertMessage(message);
        return;
      }
      if (displayed?.id !== message.id) displayed = { ...message, content: '' };
      if (timer === null) timer = setTimeout(flush, STREAMING_DISPLAY_TICK_MS);
    },
    freeze,
    clear() {
      freeze();
      target = null;
      displayed = null;
    },
    getDisplayed: () => displayed,
  };
}
