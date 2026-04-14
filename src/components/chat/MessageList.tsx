import { useRef, useEffect } from 'react';
import { Box } from '@mui/material';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

interface MessageListProps {
  messages: Message[];
  characters: AICharacter[];
  thinkingCharacterId: string | null;
}

export default function MessageList({ messages, characters, thinkingCharacterId }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const characterMap = new Map(characters.map((c) => [c.id, c]));

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinkingCharacterId]);

  const visibleMessages = messages.filter((m) => !m.isDeleted);
  const thinkingChar = thinkingCharacterId ? characterMap.get(thinkingCharacterId) : null;

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        overflow: 'auto',
        py: 2,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {visibleMessages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          avatar={msg.type === 'ai' ? characterMap.get(msg.senderId)?.avatar : undefined}
        />
      ))}

      {thinkingChar && (
        <TypingIndicator
          characterName={thinkingChar.name}
          avatar={thinkingChar.avatar}
        />
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
