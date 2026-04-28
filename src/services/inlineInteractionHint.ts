import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { InteractionEventPayload } from '../types/runtimeEvent';

export interface InlineInteractionEnvelope {
  content: string;
  interactionHint?: {
    targetId?: string | null;
    kind?: InteractionEventPayload['kind'];
    tone?: InteractionEventPayload['tone'];
    intensity?: number;
    confidence?: number;
    reason?: string;
  } | null;
}

function buildCharacterReference(characters: AICharacter[]) {
  return characters.map((character) => `- id=${character.id}; name=${character.name}; aliases=${[character.name, character.group || ''].filter(Boolean).join(', ')}`).join('\n');
}

export function buildInlineInteractionContract(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  recentMessages: Message[];
}) {
  const transcript = params.recentMessages
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');

  return `\n\nOutput contract:\nReturn strict JSON only:\n{\n  "content": string,\n  "interactionHint": {\n    "targetId": string | null,\n    "kind": "support" | "challenge" | "mock" | "dismiss" | "defend" | "probe" | "side_comment",\n    "tone": "warm" | "annoyed" | "defensive" | "excited" | "sarcastic" | "cold",\n    "intensity": number,\n    "confidence": number,\n    "reason": string\n  } | null\n}\n\nRules for interactionHint:\n1. Only fill it when this line is clearly directed at one specific existing member.\n2. If you are just making a general comment, set interactionHint to null.\n3. targetId must come from this member list:\n${buildCharacterReference(params.characters.filter((character) => character.id !== params.speaker.id))}\n4. If uncertain, set confidence low or return null.\n5. Do not mention this JSON contract in content.\n\nRecent transcript:\n${transcript}`;
}

export function parseInlineInteractionEnvelope(raw: string): InlineInteractionEnvelope | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as InlineInteractionEnvelope;
    if (!parsed || typeof parsed.content !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
