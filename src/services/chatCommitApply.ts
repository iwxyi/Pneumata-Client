import type { DriverMessageCommitTransition } from '../types/chat';
import { applyCommitTransition, type CommitRuntimeServices } from './sessionCommitContract';

export interface ChatCommitApplyParams {
  chatId: string;
  transition: DriverMessageCommitTransition;
  updateCharacter: (id: string, patch: DriverMessageCommitTransition['characterPatches'][number]['patch']) => Promise<void>;
  updateCharacters?: (patches: Array<{ id: string; patch: DriverMessageCommitTransition['characterPatches'][number]['patch'] }>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitTransition['runtimeEvents'][number], sourceMessageId?: string) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitTransition['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  updateChat: (id: string, patch: DriverMessageCommitTransition['chatPatch']) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitTransition['chatRuntimeDelta']>, patch?: DriverMessageCommitTransition['chatPatch']) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  speakerId: string;
  sourceMessageId?: string;
}

export function buildCommitRuntimeServices(params: ChatCommitApplyParams): CommitRuntimeServices {
  return {
    updateCharacter: params.updateCharacter,
    updateCharacters: params.updateCharacters,
    appendEventMessage: params.appendEventMessage,
    appendEventMessages: params.appendEventMessages,
    updateChat: params.updateChat,
    applyChatRuntimeDelta: params.applyChatRuntimeDelta,
    recordSpeak: params.recordSpeak,
  };
}

export async function applyChatCommitRuntime(params: ChatCommitApplyParams) {
  await applyCommitTransition({
    chatId: params.chatId,
    speakerId: params.speakerId,
    transition: params.transition,
    services: buildCommitRuntimeServices(params),
    sourceMessageId: params.sourceMessageId,
  });
}
