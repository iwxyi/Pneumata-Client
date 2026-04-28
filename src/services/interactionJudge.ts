import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import type { InteractionEventPayload } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';
import { extractInteractionEvent } from './interactionExtractor';

interface InteractionJudgementResult {
  interaction: InteractionEventPayload | null;
  source: 'ai' | 'heuristic';
}

function buildCharacterReference(characters: AICharacter[]) {
  return characters.map((character) => `- id=${character.id}; name=${character.name}; aliases=${[character.name, character.group || ''].filter(Boolean).join(', ')}`).join('\n');
}

function buildRecentTranscript(messages: Message[], characters: AICharacter[]) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  return messages
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${names.get(message.senderId) || message.senderName || message.senderId}: ${message.content}`)
    .join('\n');
}

function buildJudgePrompt(params: {
  chat: GroupChat;
  characters: AICharacter[];
  currentMessage: Pick<Message, 'content' | 'senderId'>;
  recentMessages: Message[];
}) {
  return `你是一个群聊互动关系判定器。只判断“这条新消息是否明确针对某个已有成员，并且是否足够强到更新关系账本”。\n\n输出必须是 JSON，不要输出额外文字：\n{\n  "isDirected": boolean,\n  "targetId": string | null,\n  "kind": "support" | "challenge" | "mock" | "dismiss" | "defend" | "probe" | "side_comment",\n  "tone": "warm" | "annoyed" | "defensive" | "excited" | "sarcastic" | "cold",\n  "intensity": number,\n  "confidence": number,\n  "reason": string\n}\n\n判定要求：\n1. 只有在“明确针对某个成员”时，isDirected 才能为 true。\n2. 普通顺嘴接话、泛泛评论、没有明确对象的态度，不算 directed。\n3. 即使没有直呼名字，只要上下文足够明确是在回应某个成员，也可以指向该成员。\n4. 只有明显支持、挑战、嘲讽、维护、追问、轻蔑时，才给非 side_comment。\n5. intensity 取 1-5；只有真的明显时才给 3 以上。\n6. confidence 取 0-1；拿不准就低。\n7. targetId 必须来自给定角色列表。\n\n群聊：${params.chat.name}\n角色列表：\n${buildCharacterReference(params.characters)}\n\n最近对话：\n${buildRecentTranscript(params.recentMessages, params.characters)}\n\n当前新消息（speakerId=${params.currentMessage.senderId}）：\n${params.currentMessage.content}`;
}

function cleanJsonCandidate(raw: string) {
  const fenced = raw.match(/\{[\s\S]*\}/);
  return fenced ? fenced[0] : raw.trim();
}

function parseJudgeResult(raw: string, speakerId: string, content: string): InteractionEventPayload | null {
  try {
    const parsed = JSON.parse(cleanJsonCandidate(raw)) as {
      isDirected?: boolean;
      targetId?: string | null;
      kind?: InteractionEventPayload['kind'];
      tone?: InteractionEventPayload['tone'];
      intensity?: number;
      confidence?: number;
    };
    if (!parsed.isDirected || !parsed.targetId || parsed.targetId === speakerId) return null;
    if (!parsed.kind || parsed.kind === 'side_comment') return null;
    const intensity = Math.max(1, Math.min(5, Number(parsed.intensity || 0)));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
    if (intensity < 3 || confidence < 0.75) return null;
    return {
      actorId: speakerId,
      targetId: parsed.targetId,
      kind: parsed.kind,
      tone: parsed.tone || 'cold',
      intensity,
      confidence,
      evidenceText: content.slice(0, 120),
    };
  } catch {
    return null;
  }
}

export async function judgeInteractionEvent(params: {
  api: APIConfig;
  chat: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  recentMessages: Message[];
  characters: AICharacter[];
}): Promise<InteractionJudgementResult> {
  try {
    const systemPrompt = buildJudgePrompt({
      chat: params.chat,
      characters: params.characters,
      currentMessage: params.message,
      recentMessages: params.recentMessages,
    });
    const raw = await generateResponse(params.api, systemPrompt, [{ role: 'user', content: '只输出 JSON。' }]);
    const interaction = parseJudgeResult(raw, params.message.senderId, params.message.content);
    if (interaction) return { interaction, source: 'ai' };
  } catch {
    // fall through to heuristic fallback
  }

  return {
    interaction: extractInteractionEvent({ message: params.message, characters: params.characters }),
    source: 'heuristic',
  };
}
