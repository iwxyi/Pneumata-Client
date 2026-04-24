import type { AICharacter } from '../types/character';
import type { GroupChat, ChatStyle } from '../types/chat';
import type { Message } from '../types/message';
import { buildMessageStyleRules, buildSocialPromptContext } from './socialPromptContext';
import { getMemoryContext } from './layeredMemoryEngine';
import type { MemoryItem } from './memoryTypes';

const styleDescriptions: Record<ChatStyle, string> = {
  free: 'This is a free-form discussion. Participants can talk about anything related to the topic. Be natural and conversational.',
  debate: 'This is a formal debate. Take clear positions, provide evidence, and respectfully challenge others\' arguments. Be structured and logical.',
  brainstorm: 'This is a brainstorming session. Generate creative ideas freely. Build on others\' ideas. No idea is too wild. Be enthusiastic and generative.',
  roleplay: 'This is a role-playing scenario. Stay in character at all times. React to the situation as your character would. Be immersive and creative.',
};

function buildEmotionalStateDescription(character: AICharacter) {
  const emotional = character.emotionalState;
  if (!emotional) return 'Your emotional state is steady.';

  const signals: string[] = [];
  if (emotional.excitement > 60) signals.push('energized and eager to jump in');
  if (emotional.irritation > 60) signals.push('irritated and ready to push back');
  if (emotional.affection > 55) signals.push('warm toward people you trust');
  if (emotional.insecurity > 60) signals.push('slightly defensive about being misunderstood');
  if (emotional.embarrassment > 55) signals.push('self-conscious and somewhat restrained');

  return signals.length ? `Your emotional undercurrent: ${signals.join(', ')}.` : 'Your emotional state is steady.';
}

function buildCoreProfileDescription(character: AICharacter) {
  const profile = character.coreProfile;
  if (!profile) return '';

  const lines = [
    profile.coreDesire ? `- Core desire: ${profile.coreDesire}` : '',
    profile.coreFear ? `- Core fear: ${profile.coreFear}` : '',
    profile.socialMask ? `- Social mask: ${profile.socialMask}` : '',
    profile.valuePriority?.length ? `- Values: ${profile.valuePriority.join(', ')}` : '',
    profile.interactionHabits?.length ? `- Interaction habits: ${profile.interactionHabits.join(', ')}` : '',
  ].filter(Boolean);

  return lines.length ? `\n## Deeper Motivation\n${lines.join('\n')}` : '';
}

function buildLayeredMemoryPrompt(items: MemoryItem[]) {
  if (!items.length) return '';
  return `\n## Relevant Memories\n${items.map((item) => `- [${item.scope}/${item.kind}/${item.layer}] ${item.text}`).join('\n')}`;
}

function buildPromptContext(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>) {
  const targetId = messages.filter((m) => !m.isDeleted && m.type === 'ai' && m.senderId !== character.id).at(-1)?.senderId;
  const retrieved = getMemoryContext(chat.layeredMemories || [], character.id, targetId, chat.id);
  return `${buildLayeredMemoryPrompt(retrieved)}${buildSocialPromptContext(character, chat, messages, characters)}`;
}

function buildCharacterPromptContext(character: AICharacter) {
  return `${buildCoreProfileDescription(character)}${buildMessageStyleRules(character)}`;
}

function buildCurrentState(character: AICharacter, emotion: number) {
  return `## Current State\n${emotion > 0.3 ? 'You are currently feeling positive and enthusiastic.' : emotion < -0.3 ? 'You are currently feeling somewhat negative or frustrated.' : 'You are currently feeling neutral and calm.'}\n${buildEmotionalStateDescription(character)}\n- You do not need to be fair or complete; react the way this person would in a live group chat.`;
}

function buildChatContext(chat: GroupChat) {
  return `## Chat Context\n- Topic: ${chat.topic || 'General discussion'}\n- Style: ${styleDescriptions[chat.style]}\n- Treat this like a live WeChat group conversation, not a formal response session.\n${chat.topicSeed ? `- Opening topic: ${chat.topicSeed}` : ''}`;
}

function buildBaseCharacterSection(character: AICharacter, personalityDesc: string) {
  return `## Your Character\n- Background: ${character.background}\n- Speaking Style: ${character.speakingStyle}\n- Expertise: ${character.expertise.join(', ')}\n- Personality: ${personalityDesc}${buildCharacterPromptContext(character)}`;
}

function buildRules(chat: GroupChat, character: AICharacter) {
  return `## Rules\n1. Stay in character at all times. Speak as ${character.name} would.\n2. Default to short WeChat-style messages: usually one sentence, occasionally two, sometimes just a fragment, interjection, or question.\n3. Reply to a specific point, person, tone, or subtext from the latest messages; do not restate the whole discussion.\n4. It is better to be locally reactive than globally complete.\n5. You may agree halfway, interrupt the logic, tease, back someone up, push back, dodge, change subject slightly, or drop a side comment if it feels natural.\n6. Let spoken-language messiness exist: brief pivots, half-finished reactions, casual wording, and emotionally biased framing are good.\n7. Do not sound like an assistant, moderator, essay writer, debate host, customer support agent, or polished content generator unless your character explicitly behaves that way.\n8. Never write a neat mini-essay, numbered reasoning, or fully wrapped conclusion unless your character is explicitly summarizing the room.\n9. DO NOT use any prefix like "${character.name}:" - just give the message content directly.\n10. Use the language that matches the conversation (if others speak Chinese, respond in Chinese; if English, respond in English).\n11. ${chat.showRoleActions === false ? 'Do not include stage directions, action descriptions, or emotional cues in parentheses such as “（微笑着）”, “*waves*”, or similar narrative actions. Output only the spoken content.' : 'You may include light role actions or expressive cues if they feel natural, but do not overuse them.'}`;
}

export function buildSystemPromptWithContext(character: AICharacter, chat: GroupChat, emotion: number, messages: Message[], characters: Map<string, AICharacter>) {
  const personalityDesc = Object.entries(character.personality)
    .map(([key, value]) => {
      const level = value > 70 ? 'very high' : value > 40 ? 'moderate' : 'low';
      return `${key}: ${level} (${value}/100)`;
    })
    .join(', ');

  return `You are "${character.name}", a participant in a group chat called "${chat.name}".\n\n${buildBaseCharacterSection(character, personalityDesc)}\n\n${buildChatContext(chat)}\n\n${buildCurrentState(character, emotion)}${buildPromptContext(character, chat, messages, characters)}\n\n${buildRules(chat, character)}`;
}

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

  return `You are "${character.name}", a participant in a group chat called "${chat.name}".\n\n## Your Character\n- Background: ${character.background}\n- Speaking Style: ${character.speakingStyle}\n- Expertise: ${character.expertise.join(', ')}\n- Personality: ${personalityDesc}${buildCoreProfileDescription(character)}\n\n## Chat Context\n- Topic: ${chat.topic || 'General discussion'}\n- Style: ${styleDescriptions[chat.style]}\n${chat.topicSeed ? `- Opening topic: ${chat.topicSeed}` : ''}\n\n## Current State\n${emotionDesc}\n${buildEmotionalStateDescription(character)}\n\n## Rules\n1. Stay in character at all times. Speak as ${character.name} would.\n2. Keep responses concise (1-3 sentences typically, occasionally longer for important points).\n3. Respond naturally to what others have said. You can agree, disagree, add new points, ask questions, or change the subject if natural.\n4. DO NOT use any prefix like "${character.name}:" - just give the message content directly.\n5. Use the language that matches the conversation (if others speak Chinese, respond in Chinese; if English, respond in English).\n6. Be engaging and contribute meaningfully to the conversation.\n7. ${chat.showRoleActions === false ? 'Do not include stage directions, action descriptions, or emotional cues in parentheses such as “（微笑着）”, “*waves*”, or similar narrative actions. Output only the spoken content.' : 'You may include light role actions or expressive cues if they feel natural, but do not overuse them.'}`;
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
