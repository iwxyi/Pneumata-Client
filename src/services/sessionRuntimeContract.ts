import type { DriverEventPayload, GroupChat } from '../types/chat';
import type { SessionIntent, VisibilityScope } from '../types/sessionEngine';
import { buildDefaultActionIntent, buildDefaultMessageIntent, buildIntentMetadataForEvent } from '../types/sessionEngine';
import { getConversationChannelId } from './sessionTopology';

export function buildRuntimeEventContract(chat: GroupChat, intent: SessionIntent, payload: Omit<DriverEventPayload, 'channelId' | 'causedByIntentId' | 'threadRef' | 'eventClass'> & { visibilityScope?: VisibilityScope }) {
  const metadata = buildIntentMetadataForEvent(chat, intent);
  return {
    ...payload,
    ...metadata,
    channelId: metadata.channelId || getConversationChannelId(chat),
    visibilityScope: payload.visibilityScope || 'public',
  } satisfies DriverEventPayload;
}

export function buildMessageRuntimeContract(chat: GroupChat, actorId: string, payload: Omit<DriverEventPayload, 'channelId' | 'causedByIntentId' | 'threadRef' | 'eventClass'> & { visibilityScope?: VisibilityScope }) {
  return buildRuntimeEventContract(chat, buildDefaultMessageIntent(payload.summary, actorId), payload);
}

export function buildActionRuntimeContract(chat: GroupChat, actionType: string, fields: Record<string, unknown>, actorId: string | undefined, payload: Omit<DriverEventPayload, 'channelId' | 'causedByIntentId' | 'threadRef' | 'eventClass'> & { visibilityScope?: VisibilityScope }) {
  return buildRuntimeEventContract(chat, buildDefaultActionIntent(actionType, fields, actorId), payload);
}
