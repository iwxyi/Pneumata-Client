import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';

interface RuntimeMemoryEntry {
  kind: 'note' | 'artifact';
  text: string;
}

function uniq(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function accumulateChatRuntime(
  chat: GroupChat,
  message: Pick<Message, 'content' | 'type'>,
  memory?: RuntimeMemoryEntry | null
) {
  const nextNotes = [...(chat.runtimeNotes || [])];
  const nextArtifacts = [...(chat.runtimeArtifacts || [])];
  const nextTimeline = [...(chat.runtimeTimeline || [])];

  if (memory?.kind === 'note') {
    nextNotes.push(memory.text);
    nextTimeline.push({ type: 'note', text: memory.text, createdAt: Date.now() });
  }

  if (memory?.kind === 'artifact') {
    nextArtifacts.push(memory.text);
    nextTimeline.push({ type: 'artifact', text: memory.text, createdAt: Date.now() });
  }

  if (message.type === 'event') {
    nextTimeline.push({ type: 'relationship', text: message.content, createdAt: Date.now() });
  }

  return {
    runtimeNotes: uniq(nextNotes).slice(-12),
    runtimeArtifacts: uniq(nextArtifacts).slice(-8),
    runtimeTimeline: nextTimeline.slice(-20),
  };
}
