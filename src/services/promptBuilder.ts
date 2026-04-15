import type { AICharacter } from '../types/character';
import type { GroupChat, ChatStyle } from '../types/chat';
import type { Message } from '../types/message';

const styleDescriptions: Record<ChatStyle, string> = {
  free: 'This is a free-form discussion. Participants can talk about anything related to the topic. Be natural and conversational.',
  debate: 'This is a formal debate. Take clear positions, provide evidence, and respectfully challenge others\' arguments. Be structured and logical.',
  brainstorm: 'This is a brainstorming session. Generate creative ideas freely. Build on others\' ideas. No idea is too wild. Be enthusiastic and generative.',
  roleplay: 'This is a role-playing scenario. Stay in character at all times. React to the situation as your character would. Be immersive and creative.',
};

export const buildSystemPrompt = (
  character: AICharacter,
  chat: GroupChat,
  emotion: number
): string => {
  const personalityDesc = Object.entries(character.personality)
    .map(([key, value]) => {
      const level = value > 70 ? 'very high' : value > 40 ? 'moderate' : 'low';
      return `${key}: ${level} (${value}/100)`;
    })
    .join(', ');

  const emotionDesc =
    emotion > 0.3
      ? 'You are currently feeling positive and enthusiastic.'
      : emotion < -0.3
        ? 'You are currently feeling somewhat negative or frustrated.'
        : 'You are currently feeling neutral and calm.';

  return `You are "${character.name}", a participant in a group chat called "${chat.name}".

## Your Character
- Background: ${character.background}
- Speaking Style: ${character.speakingStyle}
- Expertise: ${character.expertise.join(', ')}
- Personality: ${personalityDesc}

## Chat Context
- Topic: ${chat.topic || 'General discussion'}
- Style: ${styleDescriptions[chat.style]}
${chat.topicSeed ? `- Opening topic: ${chat.topicSeed}` : ''}

## Current State
${emotionDesc}

## Rules
1. Stay in character at all times. Speak as ${character.name} would.
2. Keep responses concise (1-3 sentences typically, occasionally longer for important points).
3. Respond naturally to what others have said. You can agree, disagree, add new points, ask questions, or change the subject if natural.
4. DO NOT use any prefix like "${character.name}:" - just give the message content directly.
5. Use the language that matches the conversation (if others speak Chinese, respond in Chinese; if English, respond in English).
6. Be engaging and contribute meaningfully to the conversation.
7. ${chat.showRoleActions === false ? 'Do not include stage directions, action descriptions, or emotional cues in parentheses such as “（微笑着）”, “*waves*”, or similar narrative actions. Output only the spoken content.' : 'You may include light role actions or expressive cues if they feel natural, but do not overuse them.'}`;
};

export const buildChatMessages = (
  messages: Message[],
  characters: Map<string, AICharacter>,
  maxMessages: number = 20
): { role: 'user' | 'assistant'; content: string }[] => {
  const recentMessages = messages
    .filter((m) => !m.isDeleted && m.type !== 'system')
    .slice(-maxMessages);

  return recentMessages.map((msg) => {
    const senderName =
      msg.type === 'god'
        ? '[God/Host]'
        : msg.type === 'user'
          ? '[User]'
          : characters.get(msg.senderId)?.name || msg.senderName;

    return {
      role: 'user' as const,
      content: `${senderName}: ${msg.content}`,
    };
  });
};
