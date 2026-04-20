import type { DriverMessageCommitTransition } from '../types/chat';

export async function applyChatCommitRuntime(params: {
  chatId: string;
  transition: DriverMessageCommitTransition;
  updateCharacter: (id: string, patch: DriverMessageCommitTransition['characterPatches'][number]['patch']) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitTransition['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: DriverMessageCommitTransition['chatPatch']) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  speakerId: string;
}) {
  for (const patch of params.transition.characterPatches) {
    await params.updateCharacter(patch.characterId, patch.patch);
  }

  for (const eventPayload of params.transition.runtimeEvents) {
    await params.appendEventMessage(params.chatId, eventPayload);
  }

  params.recordSpeak(params.speakerId);
  await params.updateChat(params.chatId, { lastMessageAt: Date.now(), ...params.transition.chatPatch });
}
