import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { mergeSessionChatPatch } from '../types/sessionEngine';
import { runChatCommitPipeline } from './chatCommitPipeline';
import { resolveSessionEngine } from './sessionEngineRegistry';

function wrapCommitWithFrameworkPatch(params: Parameters<typeof runChatCommitPipeline>[0]): Parameters<typeof runChatCommitPipeline>[0]['onCommit'] {
  return async (args) => {
    const transition = await params.onCommit(args);
    const engine = resolveSessionEngine(args.conversation);
    return {
      ...transition,
      chatPatch: mergeSessionChatPatch(engine, args.conversation, transition.chatPatch),
    };
  };
}

export async function runSessionCommitPipeline(params: {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  currentMessages: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>;
  upsertMessage: (message: Message) => void;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}) {
  await runChatCommitPipeline({
    ...params,
    onCommit: wrapCommitWithFrameworkPatch(params),
  });
}
