import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult, DriverMessageCommitTransition } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { refineMemoryCandidate } from './memoryEngine';
import { accumulateChatRuntime } from './chatRuntime';

export function buildChatCommitTransition(params: {
  chat: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  previousAiMessage: Pick<Message, 'senderId'> | null;
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
  }) => DriverMessageCommitResult;
}): DriverMessageCommitTransition {
  const result = params.onCommit({
    conversation: params.chat,
    characters: params.characters,
    message: params.message,
    previousAiMessage: params.previousAiMessage,
  });
  return {
    chatPatch: result.chatPatch,
    characterPatches: result.characterPatches,
    runtimeEvents: result.runtimeEvents,
  };
}

export async function finalizeChatCommitRuntime(params: {
  api: APIConfig;
  chat: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'chatId' | 'content' | 'type' | 'senderId' | 'senderName' | 'emotion'>;
  previousAiMessage: Pick<Message, 'senderId'> | null;
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
  }) => DriverMessageCommitResult;
}): Promise<DriverMessageCommitTransition> {
  const transition = buildChatCommitTransition(params);
  const candidate = params.message.type === 'ai'
    ? transition.chatPatch.runtimeNotes?.at(-1) || transition.chatPatch.runtimeArtifacts?.at(-1) || null
    : null;

  if (candidate && params.api.apiKey && params.message.type === 'ai') {
    const refined = await refineMemoryCandidate(params.api, params.chat, params.message, {
      kind: transition.chatPatch.runtimeArtifacts?.at(-1) === candidate ? 'artifact' : 'note',
      text: candidate,
      reason: 'driver post-processing candidate',
    });

    if (refined) {
      transition.chatPatch = {
        ...transition.chatPatch,
        ...accumulateChatRuntime(params.chat, params.message, refined, transition.runtimeEvents),
      };
    }
  }

  return transition;
}
