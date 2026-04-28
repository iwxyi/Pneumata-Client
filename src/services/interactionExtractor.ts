import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { InteractionEventPayload } from '../types/runtimeEvent';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function detectTargetId(message: Pick<Message, 'content'>, characters: AICharacter[], speakerId: string) {
  return characters.find((character) => character.id !== speakerId && message.content.includes(character.name))?.id || null;
}

function hasExplicitSecondPerson(text: string) {
  return /你|你们|您/.test(text);
}

function countInteractionSignals(text: string) {
  return [
    /笑死|离谱|就这|不是吧|呵|哎哟|哎呦/i.test(text),
    /对|确实|有道理|我也觉得|行吧|可以/i.test(text),
    /\?|？|怎么|凭什么|是不是|要不|难道/i.test(text),
    /别扯|算了|懒得|随便|无所谓/i.test(text),
    /不是|你这|不行|错了|扯|离谱|荒谬/i.test(text),
  ].filter(Boolean).length;
}

export function extractInteractionEvent(params: {
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
}): InteractionEventPayload | null {
  const text = params.message.content.trim();
  if (!text) return null;
  const actorId = params.message.senderId;
  const targetId = detectTargetId(params.message, params.characters, actorId);
  const sarcastic = /笑死|离谱|就这|不是吧|呵|哎哟|哎呦/i.test(text);
  const supportive = /对|确实|有道理|我也觉得|行吧|可以/i.test(text);
  const probing = /\?|？|怎么|凭什么|是不是|要不|难道/i.test(text);
  const dismissive = /别扯|算了|懒得|随便|无所谓/i.test(text);
  const directConflict = /不是|你这|不行|错了|扯|离谱|荒谬/i.test(text);
  const explicitSecondPerson = hasExplicitSecondPerson(text);
  const signalCount = countInteractionSignals(text);

  if (!targetId) return null;
  if (!explicitSecondPerson && signalCount < 2) return null;

  const kind = dismissive ? 'dismiss'
    : directConflict && probing ? 'probe'
    : directConflict ? 'challenge'
    : sarcastic ? 'mock'
    : supportive ? 'support'
    : probing ? 'probe'
    : 'side_comment';

  if (kind === 'side_comment') return null;

  const tone = sarcastic ? 'sarcastic'
    : directConflict ? 'annoyed'
    : supportive ? 'warm'
    : probing ? 'defensive'
    : 'cold';
  const intensity = clamp(
    (sarcastic ? 2 : 0)
    + (directConflict ? 2 : 0)
    + (probing ? 1 : 0)
    + (supportive ? 1 : 0),
    1,
    5,
  );

  if (intensity < 2) return null;

  return {
    kind,
    actorId,
    targetId,
    intensity,
    tone,
    evidenceText: text.slice(0, 120),
    confidence: 0.9,
  };
}
