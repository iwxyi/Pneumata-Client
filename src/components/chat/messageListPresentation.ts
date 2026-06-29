import type { Message } from '../../types/message';
import type { ChatRenderItem } from './chatRenderModel';
import { getNarrativeDisplayBlocks } from './messageBubblePresentation';

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
