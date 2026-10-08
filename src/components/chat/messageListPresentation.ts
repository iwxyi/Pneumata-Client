import type { Message } from '../../types/message';
import type { ChatRenderItem } from './chatRenderModel';
import { getNarrativeDisplayBlocks } from './messageBubblePresentation';
import type { MessageListRenderItem } from './messageListRenderItems';

const CONTINUOUS_SENDER_WINDOW_MS = 90_000;

export function getContinuousAiMessageKeys(items: MessageListRenderItem[]) {
  const keys = new Set<string>();
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (
      previous.renderKind === 'bubble'
      && current.renderKind === 'bubble'
      && previous.message.type === 'ai'
      && current.message.type === 'ai'
      && previous.message.senderId === current.message.senderId
      && current.message.timestamp >= previous.message.timestamp
      && current.message.timestamp - previous.message.timestamp <= CONTINUOUS_SENDER_WINDOW_MS
    ) {
      keys.add(current.key);
    }
  }
  return keys;
}

export function isNarrativeRevealAllowed(params: {
  item: ChatRenderItem;
  revealMessageKeys?: ReadonlySet<string>;
}) {
  const keys = params.revealMessageKeys;
  if (!keys?.size) return false;
  return [
    params.item.key,
    params.item.message.id,
    params.item.message.clientKey,
    params.item.message.serverId,
  ].some((key) => Boolean(key && keys.has(key)));
}

export function getVisibleNarrativeDisplayBlocks(message: Message, showDeveloperDetails: boolean) {
  return getNarrativeDisplayBlocks(message)
    .filter((block) => block.displayMode !== 'system_panel' || showDeveloperDetails);
}
