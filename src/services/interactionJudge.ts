import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import type { InteractionEventPayload, ModelRelationshipAssessment } from '../types/runtimeEvent';
import { generateResponse } from './aiClient';

interface InteractionJudgementResult {
  interaction: InteractionEventPayload | null;
  source: 'ai' | 'none';
}

function buildCharacterReference(characters: AICharacter[]) {
  return characters.map((character) => `- id=${character.id}; name=${character.name}; aliases=${[character.name, character.group || ''].filter(Boolean).join(', ')}`).join('\n');
}

function buildRecentTranscript(messages: Message[], characters: AICharacter[]) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  return messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
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
  return `你是一个跨房间关系事件判定器。判断这条新消息是否明确针对某个成员，并判断它是否真的改变了双方关系。这个判定同时适用于群聊、角色间私聊、AI 私聊回流和用户所在群聊。\n\n输出必须是 JSON，不要输出额外文字：\n{\n  "isDirected": boolean,\n  "targetId": string | null,\n  "kind": "support" | "challenge" | "mock" | "dismiss" | "defend" | "probe" | "side_comment",\n  "tone": "warm" | "annoyed" | "defensive" | "excited" | "sarcastic" | "cold",\n  "intensity": number,\n  "confidence": number,\n  "reason": string,\n  "relationship": {"delta":{"warmth":number,"competence":number,"trust":number,"threat":number},"labels":[string],"stance":string}\n}\n\n判定要求：\n1. 只有在“明确针对某个成员”时，isDirected 才能为 true。\n2. 普通顺嘴接话、泛泛评论、没有明确对象的态度，不算 directed。\n3. 即使没有直呼名字，只要上下文足够明确是在回应某个成员，也可以指向该成员。\n4. relationship 是你对本次具体关系变化的判断，不是 kind 的固定翻译；没有真实关系变化时省略 relationship 或四轴全为 0。\n5. 四轴范围为 -8 到 8。结合角色设定、近期对话、既有关系和这句话的实际后果判断。角色礼貌回应、完成任务、自己守住边界，不等于自动增加亲和或信任。\n6. labels 和 stance 必须是这次关系语义，不要把固定阈值或通用模板写进去。\n7. 只有明显支持、挑战、嘲讽、维护、追问、轻蔑时，才给非 side_comment。\n8. intensity 取 1-5；只有真的明显时才给 3 以上。\n9. confidence 取 0-1；拿不准就低。\n10. targetId 必须来自给定角色列表。\n\n群聊：${params.chat.name}\n角色列表：\n${buildCharacterReference(params.characters)}\n\n最近对话：\n${buildRecentTranscript(params.recentMessages, params.characters)}\n\n当前新消息（speakerId=${params.currentMessage.senderId}）：\n${params.currentMessage.content}`;
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
      relationship?: ModelRelationshipAssessment;
    };
    if (!parsed.isDirected || !parsed.targetId || parsed.targetId === speakerId) return null;
    if (!parsed.kind || parsed.kind === 'side_comment') return null;
    const intensity = Math.max(1, Math.min(5, Number(parsed.intensity || 0)));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));
    if (intensity < 3 || confidence < 0.75) return null;
    const relationship = parsed.relationship && typeof parsed.relationship === 'object'
      ? {
        delta: {
          warmth: Math.max(-8, Math.min(8, Number(parsed.relationship.delta?.warmth || 0))),
          competence: Math.max(-8, Math.min(8, Number(parsed.relationship.delta?.competence || 0))),
          trust: Math.max(-8, Math.min(8, Number(parsed.relationship.delta?.trust || 0))),
          threat: Math.max(-8, Math.min(8, Number(parsed.relationship.delta?.threat || 0))),
        },
        labels: Array.isArray(parsed.relationship.labels) ? parsed.relationship.labels.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
        stance: typeof parsed.relationship.stance === 'string' ? parsed.relationship.stance.slice(0, 160) : undefined,
      }
      : undefined;
    if (!relationship || !Object.values(relationship.delta).some((value) => value !== 0)) return null;
    return {
      actorId: speakerId,
      targetId: parsed.targetId,
      kind: parsed.kind,
      tone: parsed.tone || 'cold',
      intensity,
      confidence,
      evidenceText: content.slice(0, 120),
      relationship,
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
    const raw = await generateResponse(params.api, systemPrompt, [{ role: 'user', content: '只输出 JSON。' }], undefined, {
      aiUsage: { type: 'interaction_analysis', label: '互动事件判断', scope: 'chat', resourceId: params.chat.id },
    });
    const interaction = parseJudgeResult(raw, params.message.senderId, params.message.content);
    if (interaction) return { interaction, source: 'ai' };
  } catch {
    return {
      interaction: null,
      source: 'none',
    };
  }

  return {
    interaction: null,
    source: 'none',
  };
}
