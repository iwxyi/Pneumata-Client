import type { DriverMessageCommitTransition } from '../types/chat';
import { applyCommitTransition, type CommitRuntimeServices } from './sessionCommitContract';

export interface ChatCommitApplyParams {
  chatId: string;
  transition: DriverMessageCommitTransition;
  updateCharacter: (id: string, patch: DriverMessageCommitTransition['characterPatches'][number]['patch']) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitTransition['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: DriverMessageCommitTransition['chatPatch']) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  speakerId: string;
}

export function buildCommitRuntimeServices(params: ChatCommitApplyParams): CommitRuntimeServices {
  return {
    updateCharacter: params.updateCharacter,
    appendEventMessage: params.appendEventMessage,
    updateChat: params.updateChat,
    recordSpeak: params.recordSpeak,
  };
}

export async function applyChatCommitRuntime(params: ChatCommitApplyParams) {
  await applyCommitTransition({
    chatId: params.chatId,
    speakerId: params.speakerId,
    transition: params.transition,
    services: buildCommitRuntimeServices(params),
  });
}
