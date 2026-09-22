import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';
import { resolveSessionFamilyKey } from './sessionEngineKeys';
import type { RichDeliveryPolicy } from './styleProfileRegistry';

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
  richDelivery?: RichDeliveryPolicy;
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

function isAnalysisRoom(chat: GroupChat) {
  return resolveSessionFamilyKey(chat) === 'analysis';
}

function chooseAnalysisContinuationPlan(input: TurnPlanInput, latestLength: number, latestIsHuman: boolean): TurnPlan {
  if (latestIsHuman || input.intent.stance === 'summarize') {
    const allowExtraMessages = latestIsHuman && latestLength >= 90;
    return {
      rhythm: allowExtraMessages ? 'multi_bubble' : 'full_reply',
      targetBubbleCount: allowExtraMessages ? 2 : 1,
      lengthBand: latestLength >= 160 ? 'long' : 'medium',
      allowExtraMessages,
      waitSensitive: false,
      reasons: [`surface:${input.surface.kind}`, 'analysis_room', latestIsHuman ? 'human_turn' : 'summarize_intent', `latest_length:${latestLength}`, ...(allowExtraMessages ? ['analysis_structured_multi_bubble'] : [])],
    };
  }

  const allowExtraMessages = latestLength >= 120 && (input.intent.delivery === 'group_redirect' || input.intent.messageShape === 'two_sentences');
  if (!latestIsHuman && latestLength >= 120) {
    return {
      rhythm: 'short_reply',
      targetBubbleCount: 1,
      lengthBand: 'short',
      allowExtraMessages: false,
      waitSensitive: false,
      reasons: [`surface:${input.surface.kind}`, 'analysis_room', 'ai_continuation', `latest_length:${latestLength}`, 'avoid_ai_chain_essay'],
    };
  }
  return {
    rhythm: input.intent.delivery === 'quick_question' || input.intent.messageShape === 'question_only' ? 'short_reply' : allowExtraMessages ? 'multi_bubble' : 'full_reply',
    targetBubbleCount: allowExtraMessages ? 2 : 1,
    lengthBand: latestLength >= 180 ? 'medium' : 'short',
    allowExtraMessages,
    waitSensitive: false,
    reasons: [`surface:${input.surface.kind}`, 'analysis_room', 'ai_continuation', `latest_length:${latestLength}`, ...(allowExtraMessages ? ['analysis_structured_multi_bubble'] : [])],
  };
}

function deriveBaseTurnPlan(input: TurnPlanInput): TurnPlan {
  const visibleLatest = latestVisible(input.messages);
  const latestLength = charLength(visibleLatest?.content);
  const latestIsHuman = visibleLatest?.type === 'user' || visibleLatest?.type === 'god';
  const latestIsShortOpenHuman = Boolean(
    latestIsHuman
    && latestLength > 0
    && latestLength <= 14
    && !hasTerminalPunctuation(visibleLatest?.content || ''),
  );
  if (input.surface.kind !== 'chat') {
    if (isAnalysisRoom(input.chat)) return chooseAnalysisContinuationPlan(input, latestLength, latestIsHuman);
    return chooseLongFormPlan(input, latestLength);
  }

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
    const canUseExtraMessages = asksForDepth
      && latestLength >= 64
      && ownStats.recentMultiBubbleCount === 0
      && (
        input.chat.type !== 'group'
        || bucket >= 54
        || input.intent.delivery === 'group_redirect'
        || input.intent.messageShape === 'question_only'
      );
    return {
      rhythm: canUseExtraMessages ? 'multi_bubble' : 'full_reply',
      targetBubbleCount: canUseExtraMessages ? 2 : 1,
      lengthBand: latestLength >= 90 ? 'long' : 'medium',
      allowExtraMessages: canUseExtraMessages,
      waitSensitive: false,
      reasons: [...reasons, asksForDepth ? 'human_depth_request' : 'summarize_intent', ...(canUseExtraMessages ? ['human_depth_can_split_bubbles'] : [])],
    };
  }

  if (!latestIsHuman && input.chat.type === 'group' && latestLength >= 90 && input.richDelivery?.multiBubble.proactivity !== 'high') {
    return {
      rhythm: 'short_reply',
      targetBubbleCount: 1,
      lengthBand: 'short',
      allowExtraMessages: false,
      waitSensitive: false,
      reasons: [...reasons, 'group_ai_chain_needs_brevity'],
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

  if (!latestIsHuman && (input.intent.messageShape === 'fragment' || latestLength <= 12)) {
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

export function deriveTurnPlan(input: TurnPlanInput): TurnPlan {
  const plan = deriveBaseTurnPlan(input);
  const delivery = input.richDelivery?.multiBubble;
  if (!delivery) return plan;

  if (delivery.proactivity === 'off') {
    return { ...plan, rhythm: plan.rhythm === 'multi_bubble' ? 'full_reply' : plan.rhythm, targetBubbleCount: 1, allowExtraMessages: false, reasons: [...plan.reasons, 'delivery:multi_bubble_off'] };
  }

  if (input.surface.kind !== 'chat') return plan;
  const latest = latestVisible(input.messages);
  const latestLength = charLength(latest?.content);
  const ownStats = recentOwnStats(input.messages, input.speaker.id);
  const bucket = stableBucket([input.chat.id, input.speaker.id, latest?.id || '', latest?.timestamp || input.now || 0, 'rich-delivery'].join('|'));
  // High is an affordance of casual/companion rooms: nearly every eligible
  // turn may choose a run of messages, while the model retains the final
  // semantic decision to keep it as one message or send several.
  const threshold = delivery.proactivity === 'high' ? 5 : delivery.proactivity === 'medium' ? 62 : 84;
  const preservesUserRequestedSplit = plan.reasons.some((reason) => reason === 'human_depth_can_split_bubbles' || reason === 'analysis_structured_multi_bubble');
  const passesDeliveryPolicy = preservesUserRequestedSplit || bucket >= threshold;
  const cappedCount = Math.max(1, Math.min(plan.targetBubbleCount, delivery.maxBubbles, 5));
  const permittedCount = delivery.proactivity === 'high' ? Math.min(5, delivery.maxBubbles) : cappedCount;
  if (plan.allowExtraMessages) {
    if (!passesDeliveryPolicy) {
      return {
        ...plan,
        rhythm: plan.rhythm === 'multi_bubble' ? 'full_reply' : plan.rhythm,
        targetBubbleCount: 1,
        allowExtraMessages: false,
        reasons: [...plan.reasons, `delivery:${delivery.proactivity}_held_single`],
      };
    }
    return { ...plan, targetBubbleCount: permittedCount, allowExtraMessages: permittedCount > 1, reasons: [...plan.reasons, `delivery:multi_bubble_${delivery.proactivity}`] };
  }

  const canProactivelySplit = (delivery.proactivity === 'high' ? latestLength > 0 : latestLength >= 8)
    && latestLength <= (delivery.proactivity === 'high' ? 180 : 90)
    && ownStats.recentMultiBubbleCount === 0
    && bucket >= threshold
    && (delivery.proactivity === 'high' || plan.rhythm !== 'defer_or_wait')
    && plan.rhythm !== 'micro_ack';
  if (!canProactivelySplit) return plan;
  return {
    ...plan,
    rhythm: 'multi_bubble',
    targetBubbleCount: Math.min(5, delivery.maxBubbles),
    allowExtraMessages: delivery.maxBubbles > 1,
    reasons: [...plan.reasons, `delivery:${delivery.proactivity}_proactive_multi_bubble`],
  };
}

export function buildTurnPlanPrompt(plan: TurnPlan) {
  const bubbleLine = plan.allowExtraMessages
    ? '- Consecutive bubbles are available, never required. Treat them as one to several real sends, not a main sentence plus an appendix: a quick acknowledgement, invitation to continue, hesitation, change of mind, small tease, delayed feeling, question, correction, or practical add-on can each be its own beat. Let the beats be uneven in length. If there is no real send-time change, keep one bubble.'
    : '- Keep this turn in one visible bubble unless the current moment clearly wants a natural follow-up message.';
  const rhythmLine = plan.rhythm === 'micro_ack'
    ? '\n- This turn can be a tiny acknowledgement or quick nudge. Do not expand it into a paragraph unless the user directly asked for substance.'
    : plan.rhythm === 'short_reply'
      ? '\n- Keep one compact social or deliberative move. In a multi-send room, that move may unfold as several unequal chat beats rather than one polished sentence.'
      : plan.rhythm === 'multi_bubble'
        ? '\n- If using multiple bubbles, keep each bubble purposeful and uneven; do not use them to continue a lecture.'
        : '';
  return `\n## Turn Plan
- Rhythm tendency: ${plan.rhythm}
${bubbleLine}
- Do not target a fixed length band. Choose length from the live situation, the user's request, the character's comfort, and the amount of actual substance available.
- Very short reactions, ordinary one-sentence replies, rambling multi-sentence thoughts, and fuller explanations are all valid when the moment calls for them.
- A full stop is a possible send boundary, not a mechanical splitting rule. Use messages[] only when the completed first thought changes the timing or social feel of what comes next.
- This is a weak planning prior, not a keyword rule, output template, or length cap. Follow the current request, scene, and play mode if they need a different shape.
${rhythmLine}
- Plan reasons: ${plan.reasons.join(', ')}`;
}
