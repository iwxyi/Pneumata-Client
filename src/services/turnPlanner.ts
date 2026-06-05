import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';

export type TurnRhythm = 'micro_ack' | 'short_reply' | 'full_reply' | 'multi_bubble' | 'defer_or_wait';
export type TurnLengthBand = 'micro' | 'short' | 'medium' | 'long' | 'extended';

export interface TurnPlan {
  rhythm: TurnRhythm;
  targetBubbleCount: number;
  lengthBand: TurnLengthBand;
  allowExtraMessages: boolean;
  waitSensitive: boolean;
  reasons: string[];
}

interface TurnPlanSurface {
  kind: 'chat' | 'professional' | 'creative' | 'longform';
}

export interface TurnPlanInput {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
  intent: SpeakIntent;
  surface: TurnPlanSurface;
  now?: number;
}

function charLength(text: string | undefined | null) {
  return Array.from((text || '').replace(/\s+/g, '')).length;
}

function lengthBand(length: number): TurnLengthBand {
  if (length <= 10) return 'micro';
  if (length <= 34) return 'short';
  if (length <= 88) return 'medium';
  if (length <= 180) return 'long';
  return 'extended';
}

function hasTerminalPunctuation(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /[。！？!?…~～）)"'”’\]]$/.test(trimmed);
}

function latestVisible(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function visibleBubbleCount(message: Message) {
  const count = message.metadata?.turnSegment?.count;
  if (typeof count === 'number' && count > 0) return count;
  return 1;
}

function recentOwnStats(messages: Message[], speakerId: string) {
  const own = messages
    .filter((message) => !message.isDeleted && message.type === 'ai' && message.senderId === speakerId)
    .slice(-6);
  const lengths = own.map((message) => charLength(message.content)).filter((length) => length > 0);
  const bubbleCounts = own.map(visibleBubbleCount);
  const averageLength = lengths.length ? lengths.reduce((sum, item) => sum + item, 0) / lengths.length : 0;
  const minLength = lengths.length ? Math.min(...lengths) : 0;
  const maxLength = lengths.length ? Math.max(...lengths) : 0;
  return {
    count: own.length,
    lengths,
    averageLength,
    clustered: lengths.length >= 3 && (maxLength - minLength) <= Math.max(24, averageLength * 0.34),
    recentMultiBubbleCount: bubbleCounts.filter((count) => count > 1).length,
  };
}

function stableBucket(input: string) {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function resolveTalkativeness(speaker: AICharacter) {
  const sentenceBias = speaker.speechProfile?.sentenceLengthBias;
  const behavior = speaker.behavior || { proactivity: 50, humorIntensity: 50, summarizing: 50 };
  const personality = speaker.personality || { extroversion: 50 };
  const base = (behavior.proactivity || 50) * 0.32
    + (behavior.summarizing || 50) * 0.18
    + (behavior.humorIntensity || 50) * 0.14
    + (personality.extroversion || 50) * 0.22
    + (sentenceBias === 'long' ? 18 : sentenceBias === 'short' ? -16 : 0);
  return Math.max(0, Math.min(100, base));
}

function chooseLongFormPlan(input: TurnPlanInput, latestLength: number): TurnPlan {
  const length = latestLength >= 80 || input.surface.kind === 'longform' ? 'extended' : 'long';
  return {
    rhythm: 'full_reply',
    targetBubbleCount: 1,
    lengthBand: length,
    allowExtraMessages: false,
    waitSensitive: false,
    reasons: [`surface:${input.surface.kind}`, `latest_length:${latestLength}`],
  };
}

export function deriveTurnPlan(input: TurnPlanInput): TurnPlan {
  const visibleLatest = latestVisible(input.messages);
  const latestLength = charLength(visibleLatest?.content);
  const latestIsHuman = visibleLatest?.type === 'user' || visibleLatest?.type === 'god';
  const latestIsShortOpenHuman = Boolean(
    latestIsHuman
    && latestLength > 0
    && latestLength <= 14
    && !hasTerminalPunctuation(visibleLatest?.content || ''),
  );
  if (input.surface.kind !== 'chat') return chooseLongFormPlan(input, latestLength);

  const ownStats = recentOwnStats(input.messages, input.speaker.id);
  const talkativeness = resolveTalkativeness(input.speaker);
  const bucket = stableBucket([
    input.chat.id,
    input.speaker.id,
    visibleLatest?.id || '',
    visibleLatest?.timestamp || input.now || 0,
    ownStats.count,
  ].join('|'));
  const reasons = [
    `surface:${input.surface.kind}`,
    `chat:${input.chat.type}`,
    `latest:${latestLength}`,
    `talk:${Math.round(talkativeness)}`,
    `bucket:${bucket}`,
  ];

  if (latestIsShortOpenHuman) {
    return {
      rhythm: 'defer_or_wait',
      targetBubbleCount: 1,
      lengthBand: 'micro',
      allowExtraMessages: false,
      waitSensitive: true,
      reasons: [...reasons, 'latest_human_short_open'],
    };
  }

  const asksForDepth = latestIsHuman && latestLength >= 44;
  if (asksForDepth || input.intent.stance === 'summarize') {
    return {
      rhythm: 'full_reply',
      targetBubbleCount: 1,
      lengthBand: latestLength >= 90 ? 'long' : 'medium',
      allowExtraMessages: false,
      waitSensitive: false,
      reasons: [...reasons, asksForDepth ? 'human_depth_request' : 'summarize_intent'],
    };
  }

  const canMultiBubble = input.chat.type !== 'group' || talkativeness >= 58 || input.intent.delivery === 'side_remark';
  const shouldMultiBubble = canMultiBubble
    && ownStats.recentMultiBubbleCount === 0
    && bucket >= 62
    && latestLength >= 10
    && latestLength <= 90;
  if (shouldMultiBubble) {
    return {
      rhythm: 'multi_bubble',
      targetBubbleCount: bucket >= 88 ? 3 : 2,
      lengthBand: bucket >= 82 ? 'medium' : 'short',
      allowExtraMessages: true,
      waitSensitive: false,
      reasons: [...reasons, 'multi_bubble_spacing'],
    };
  }

  if (input.intent.messageShape === 'fragment' || input.intent.messageShape === 'question_only' || latestLength <= 12) {
    return {
      rhythm: 'micro_ack',
      targetBubbleCount: 1,
      lengthBand: 'micro',
      allowExtraMessages: false,
      waitSensitive: false,
      reasons: [...reasons, 'fragment_or_tiny_context'],
    };
  }

  return {
    rhythm: 'short_reply',
    targetBubbleCount: 1,
    lengthBand: ownStats.clustered && ownStats.averageLength < 80 ? 'short' : lengthBand(Math.max(18, Math.min(88, latestLength + 12))),
    allowExtraMessages: false,
    waitSensitive: false,
    reasons: [...reasons, ownStats.clustered ? 'recent_length_cluster' : 'default_chat'],
  };
}

export function buildTurnPlanPrompt(plan: TurnPlan) {
  const bubbleLine = plan.allowExtraMessages
    ? `- Target visible bubble count: ${plan.targetBubbleCount}. Use content as bubble 1 and extraMessages for later bubbles.`
    : '- Target visible bubble count: 1. Set extraMessages to null unless the current request clearly overrides this plan.';
  return `\n## Turn Plan
- Rhythm: ${plan.rhythm}
- Target length band: ${plan.lengthBand}
${bubbleLine}
- This is a planning prior, not a keyword rule. Follow the current request if it genuinely needs a different shape.
- Do not make consecutive turns converge to the same middle length. Let this turn have a distinct human timing shape.
- Plan reasons: ${plan.reasons.join(', ')}`;
}
