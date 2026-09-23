import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MediaGenerationDecision, Message, MessagePresenceUpdate } from '../types/message';
import type { AddressedTargetHintEnvelope, ConflictFocusPayload, InteractionHintCollection, RecentSocialEventSummary, SocialEventHintEnvelope } from '../types/runtimeEvent';
import { normalizeSocialEventHints } from '../types/runtimeEvent';
import type { TurnPlan } from './turnPlanner';
import type { RichDeliveryPolicy } from './styleProfileRegistry';
import { hasVisibleStoryEvents, normalizeStoryEvents } from './narrativeRuntime';
import { resolveSessionFamilyKey } from './sessionEngineKeys';
import { getPromptSpeakerLabel, getPromptTurnTypeLabel, isHumanDirectedMessage } from './chatMessageSemantics';

export interface InlineStoryChoice {
  label: string;
  prompt?: string | null;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
}

export type InlineStoryEventKind = 'narration' | 'speech' | 'choice_point' | 'chapter_update';

export interface InlineStoryEvent {
  type: InlineStoryEventKind;
  actorId?: string | null;
  actorName?: string | null;
  text?: string | null;
  choices?: InlineStoryChoice[] | null;
  title?: string | null;
  summary?: string | null;
  status?: 'active' | 'completed' | null;
  startNewChapter?: boolean | null;
  keyChoices?: string[] | null;
}

export interface InlineStoryBlock {
  actorId: string;
  actorName?: string | null;
  kind: 'prose' | 'dialogue';
  text: string;
}

export interface InlineDeliberationArtifacts {
  claims?: Array<{
    text: string;
    stance?: 'support' | 'oppose' | 'neutral' | 'review' | 'inquiry';
    reason?: string;
    confidence?: number;
  }>;
  evidence?: Array<{
    text: string;
    reason?: string;
    confidence?: number;
  }>;
  issues?: Array<{
    text: string;
    targetActorId?: string | null;
    reason?: string;
    confidence?: number;
  }>;
  verdicts?: Array<{
    text: string;
    tendency?: 'support' | 'oppose' | 'mixed' | 'undecided';
    reason?: string;
    confidence?: number;
  }>;
  summary?: {
    text: string;
    reason?: string;
    confidence?: number;
  } | null;
  overallReason?: string | null;
}

export interface InlineInteractionEnvelope {
  content: string;
  messages?: Array<{
    content: string;
    mediaDecision?: MediaGenerationDecision | null;
  }> | null;
  narrativeText?: string | null;
  storyEvents?: InlineStoryEvent[] | null;
  narrativeBlocks?: InlineStoryBlock[] | null;
  extraMessages?: string[] | null;
  intentionalRepeat?: boolean | null;
  interactionHints?: InteractionHintCollection | null;
  addressedTargets?: AddressedTargetHintEnvelope | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
  mediaDecision?: MediaGenerationDecision | null;
  storyChoices?: InlineStoryChoice[] | null;
  deliberationArtifacts?: InlineDeliberationArtifacts | null;
  presenceUpdate?: MessagePresenceUpdate | null;
  toolRequest?: {
    type: 'web_search';
    query: string;
    reason?: string | null;
  } | null;
}

function cleanJsonLikeText(value: string) {
  return value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function unescapeJsonStringContent(value: string) {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .trim();
}

function extractJsonStringField(raw: string, fieldName: string) {
  const cleaned = cleanJsonLikeText(raw);
  const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
  const fieldMatch = fieldPattern.exec(cleaned);
  if (!fieldMatch) return null;
  let index = fieldMatch.index + fieldMatch[0].length;
  let escaped = false;
  let value = '';
  while (index < cleaned.length) {
    const char = cleaned[index];
    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }
    if (char === '"') break;
    value += char;
    index += 1;
  }
  return value ? unescapeJsonStringContent(value) : null;
}

function salvageContentFromMalformedEnvelope(raw: string): InlineInteractionEnvelope | null {
  const content = extractJsonStringField(raw, 'content');
  return content ? { content, interactionHints: null, socialEventHints: null, conflictFocus: null } : null;
}

function isContractPlaceholderText(value: unknown) {
  return typeof value === 'string'
    && /(write a fresh one-sentence summary|explain the actual contradiction|placeholder|字段占位符|member-id|speaker-id|根据证据新写|当前请求自然作答)/i.test(value);
}

function sanitizeConflictFocus(conflictFocus: ConflictFocusPayload | null | undefined) {
  if (!conflictFocus) return conflictFocus ?? null;
  if (isContractPlaceholderText(conflictFocus.summary) || isContractPlaceholderText(conflictFocus.why)) return null;
  return conflictFocus;
}

function normalizeConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function cleanArtifactText(value: unknown, max = 180) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || isContractPlaceholderText(trimmed)) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function normalizeArtifactList<T extends Record<string, unknown>>(
  value: unknown,
  map: (item: Record<string, unknown>) => T | null,
  limit = 3,
) {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => (item && typeof item === 'object') ? map(item as Record<string, unknown>) : null)
    .filter(Boolean) as T[];
  return normalized.length ? normalized.slice(0, limit) : undefined;
}

function sanitizeDeliberationArtifacts(value: InlineDeliberationArtifacts | null | undefined): InlineDeliberationArtifacts | null {
  if (!value || typeof value !== 'object') return null;
  const claims = normalizeArtifactList(value.claims, (item) => {
    const text = cleanArtifactText(item.text);
    if (!text) return null;
    const stance = ['support', 'oppose', 'neutral', 'review', 'inquiry'].includes(String(item.stance)) ? item.stance as NonNullable<NonNullable<InlineDeliberationArtifacts['claims']>[number]['stance']> : 'neutral';
    return { text, stance, reason: cleanArtifactText(item.reason, 100), confidence: normalizeConfidence(item.confidence) };
  });
  const evidence = normalizeArtifactList(value.evidence, (item) => {
    const text = cleanArtifactText(item.text);
    return text ? { text, reason: cleanArtifactText(item.reason, 100), confidence: normalizeConfidence(item.confidence) } : null;
  });
  const issues = normalizeArtifactList(value.issues, (item) => {
    const text = cleanArtifactText(item.text);
    return text ? {
      text,
      targetActorId: typeof item.targetActorId === 'string' ? item.targetActorId : null,
      reason: cleanArtifactText(item.reason, 100),
      confidence: normalizeConfidence(item.confidence),
    } : null;
  });
  const verdicts = normalizeArtifactList(value.verdicts, (item) => {
    const text = cleanArtifactText(item.text);
    if (!text) return null;
    const tendency = ['support', 'oppose', 'mixed', 'undecided'].includes(String(item.tendency)) ? item.tendency as NonNullable<NonNullable<InlineDeliberationArtifacts['verdicts']>[number]['tendency']> : 'mixed';
    return { text, tendency, reason: cleanArtifactText(item.reason, 100), confidence: normalizeConfidence(item.confidence) };
  });
  const summaryText = cleanArtifactText(value.summary?.text, 220);
  const summary = summaryText ? {
    text: summaryText,
    reason: cleanArtifactText(value.summary?.reason, 100),
    confidence: normalizeConfidence(value.summary?.confidence),
  } : null;
  const overallReason = cleanArtifactText(value.overallReason, 140) || null;
  if (!claims && !evidence && !issues && !verdicts && !summary && !overallReason) return null;
  return { claims, evidence, issues, verdicts, summary, overallReason };
}

function sanitizePresenceUpdate(value: MessagePresenceUpdate | null | undefined): MessagePresenceUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const status = value.status === 'away' ? 'away' : value.status === 'online' ? 'online' : null;
  if (!status) return null;
  const activity = cleanArtifactText(value.activity, 60);
  const reason = cleanArtifactText(value.reason, 100);
  const durationMinutes = typeof value.durationMinutes === 'number' && Number.isFinite(value.durationMinutes)
    ? Math.max(3, Math.min(720, Math.round(value.durationMinutes)))
    : status === 'away' ? 30 : undefined;
  return {
    status,
    activity,
    reason,
    durationMinutes,
  };
}

function sanitizeEnvelope(envelope: InlineInteractionEnvelope): InlineInteractionEnvelope {
  const messages = Array.isArray(envelope.messages)
    ? envelope.messages
      .filter((part): part is NonNullable<InlineInteractionEnvelope['messages']>[number] => Boolean(part && typeof part === 'object' && typeof part.content === 'string' && part.content.trim()))
      .slice(0, 5)
      .map((part) => ({
        content: part.content.trim(),
        mediaDecision: part.mediaDecision && typeof part.mediaDecision === 'object' ? part.mediaDecision : null,
      }))
    : null;
  return {
    ...envelope,
    content: typeof envelope.content === 'string' ? envelope.content : '',
    messages,
    socialEventHints: normalizeSocialEventHints(envelope.socialEventHints),
    conflictFocus: sanitizeConflictFocus(envelope.conflictFocus),
    storyEvents: normalizeStoryEvents(envelope.storyEvents),
    deliberationArtifacts: sanitizeDeliberationArtifacts(envelope.deliberationArtifacts),
    presenceUpdate: sanitizePresenceUpdate(envelope.presenceUpdate),
  };
}

function hasVisibleEnvelopeContent(envelope: InlineInteractionEnvelope) {
  if (typeof envelope.content === 'string' && envelope.content.trim()) return true;
  if (Array.isArray(envelope.messages) && envelope.messages.some((item) => item && typeof item.content === 'string' && item.content.trim())) return true;
  if (typeof envelope.narrativeText === 'string' && envelope.narrativeText.trim()) return true;
  if (Array.isArray(envelope.extraMessages) && envelope.extraMessages.some((item) => typeof item === 'string' && item.trim())) return true;
  if (Array.isArray(envelope.narrativeBlocks) && envelope.narrativeBlocks.some((item) => item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim())) return true;
  return hasVisibleStoryEvents(envelope.storyEvents);
}

function buildMemberReference(params: { chat: GroupChat; characters: AICharacter[]; speakerId?: string }) {
  const memberIds = new Set(params.chat.memberIds);
  const characterLines = params.characters
    .filter((character) => memberIds.has(character.id) && character.id !== params.speakerId)
    .map((character) => `- id=${character.id}; name=${character.name}; aliases=${[character.name, character.group || ''].filter(Boolean).join(', ')}`);
  const userLine = params.chat.memberIds.includes('user') ? ['- id=user; name=用户/我; aliases=用户,我'] : [];
  return [...characterLines, ...userLine].join('\n') || '- No valid targets.';
}

function buildRecentSocialEventContext(chat: GroupChat, limit = 4): RecentSocialEventSummary[] {
  return (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'event_candidate' || event.kind === 'artifact')
    .slice(-24)
    .reverse()
    .flatMap<RecentSocialEventSummary>((event) => {
      const payload = event.payload as Record<string, unknown>;
      const eventKind = typeof payload.eventKind === 'string' ? payload.eventKind : null;
      if (!eventKind) return [];
      return [{
        eventKind: eventKind as RecentSocialEventSummary['eventKind'],
        title: typeof payload.title === 'string' ? payload.title : undefined,
        activityType: typeof payload.activityType === 'string' ? payload.activityType : undefined,
        participantIds: Array.isArray(payload.participantIds) ? payload.participantIds.filter((id): id is string => typeof id === 'string') : undefined,
        targetIds: Array.isArray(event.targetIds) ? event.targetIds : undefined,
        createdAt: event.createdAt,
        summary: event.summary,
      }];
    })
    .slice(0, limit);
}

function buildRecentTranscriptScope(messages: Message[]) {
  const recent = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-8);
  if (!recent.length) return '- No recent transcript turns are available.';
  const humanCount = recent.filter(isHumanDirectedMessage).length;
  const aiCount = recent.filter((message) => message.type === 'ai').length;
  const latest = recent.at(-1);
  const speakers = Array.from(new Set(recent.map((message) => getPromptSpeakerLabel(message)))).slice(-6);
  return [
    '- The complete recent transcript is supplied as separate chat messages. Only the current speaker\'s own prior visible turns are assistant messages. This contract intentionally does not repeat raw dialogue.',
    `- Recent window for judging interaction fields: ${recent.length} turns (${humanCount} human / ${aiCount} AI).`,
    `- Latest turn: ${latest ? `${getPromptTurnTypeLabel(latest)} from ${getPromptSpeakerLabel(latest)}` : 'none'}.`,
    `- Speakers in window: ${speakers.join(', ') || 'none'}.`,
  ].join('\n');
}

function buildImageReferenceRegistry(messages: Message[]) {
  const latestImageMessageId = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .filter((message) => message.metadata?.attachments?.some((attachment) => attachment.kind === 'image' && attachment.status === 'ready' && Boolean(attachment.url)))
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.id;
  return messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .sort((left, right) => right.timestamp - left.timestamp)
    .flatMap((message) => (message.metadata?.attachments || [])
      .filter((attachment) => attachment.kind === 'image' && attachment.status === 'ready' && Boolean(attachment.url))
      .slice(0, 6)
      .map((attachment) => ({
        refId: `${message.id}:${attachment.id}`,
        messageId: message.id,
        messageRole: message.type === 'ai' ? 'assistant' : isHumanDirectedMessage(message) ? 'user' : 'other',
        senderName: message.senderName,
        altText: attachment.altText,
        caption: attachment.caption || '',
        promptText: message.id === latestImageMessageId ? attachment.promptText?.trim().slice(0, 800) || '' : '',
        semanticSummary: attachment.semanticSummary?.trim().slice(0, 800) || '',
        messageContentPreview: message.content.trim().slice(0, 180),
        messageTimestamp: message.timestamp,
      })))
    .slice(0, 36);
}

export function buildInlineInteractionContract(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  recentMessages: Message[];
  turnPlan?: TurnPlan | null;
  mediaCapabilities?: {
    image: boolean;
    audio: boolean;
    sticker?: boolean;
  };
  richDelivery?: RichDeliveryPolicy;
  mediaRequested?: boolean;
  webSearchEnabled?: boolean;
  webSearchResultInjected?: boolean;
}) {
  const isStoryReader = params.chat.sessionKind?.scenarioId === 'story-reader';
  const isAnalysisRoom = resolveSessionFamilyKey(params.chat) === 'analysis';
  const mediaCapabilities = params.mediaCapabilities || { image: false, audio: false };
  const richDelivery = params.richDelivery;
  const shouldIncludeMediaDecision = Boolean(!isStoryReader && (mediaCapabilities.image || mediaCapabilities.audio || mediaCapabilities.sticker));
  const transcriptScope = buildRecentTranscriptScope(params.recentMessages);
  const imageReferenceRegistry = shouldIncludeMediaDecision && mediaCapabilities.image
    ? buildImageReferenceRegistry(params.recentMessages)
    : [];
  const recentSocialEvents = buildRecentSocialEventContext(params.chat)
    .map((event) => `- ${event.eventKind}${event.title ? ` / ${event.title}` : ''}${event.activityType ? ` / ${event.activityType}` : ''}: ${event.summary}`)
    .join('\n');

  const mediaExampleFields = [
    mediaCapabilities.image ? `"images": [{"shouldGenerate": false, "reason": "只有当这条消息确实需要视觉补充时才为 true", "prompt": null, "altText": null, "aspectRatio": null, "imageSize": null, "targetImageIds": [], "referenceImageIds": [], "styleImageIds": []}]` : '',
    mediaCapabilities.audio ? `"audio": {"shouldGenerate": false, "reason": "只有当这条消息特别适合语音播放时才为 true", "text": null, "voiceProfileId": null}` : '',
    mediaCapabilities.sticker ? `"sticker": {"shouldSend": false, "keyword": null, "altText": null}` : '',
  ].filter(Boolean);
  const mediaExample = shouldIncludeMediaDecision
    ? `,\n  "mediaDecision": {${mediaExampleFields.map((field) => `\n    ${field}`).join(',')}\n  }`
    : '';
  const deliberationExample = isAnalysisRoom
    ? `,\n  "deliberationArtifacts": {"claims":[{"text":"从本条可见回复中抽取的论点","stance":"review","reason":"这条可见回复为什么支持该论点","confidence":0.8}]}`
    : '';
  const toolRequestExample = params.webSearchEnabled && !params.webSearchResultInjected && !isStoryReader
    ? ', "toolRequest": null'
    : '';
  const mediaCapabilityInstruction = shouldIncludeMediaDecision
    ? `\n\nAvailable delivery capabilities for this turn: ${[mediaCapabilities.image ? 'image generation' : '', mediaCapabilities.audio ? 'voice synthesis' : '', mediaCapabilities.sticker ? 'keyword meme sticker search' : ''].filter(Boolean).join(' + ')}. These are real runtime capabilities. When the user explicitly asks for a meme/sticker, set mediaDecision.sticker.shouldSend=true and use a short concrete search keyword; do not use it for ordinary image requests.\n`
    : '';

  const deliveryPolicyRules = richDelivery
    ? `\nDelivery policy for this room: consecutive bubbles=${richDelivery.multiBubble.proactivity} (maximum ${richDelivery.multiBubble.maxBubbles}); proactive image=${richDelivery.image.proactivity}; proactive audio=${richDelivery.audio.proactivity}; proactive sticker=${richDelivery.sticker.proactivity}. “off” means do not initiate that delivery form yourself, but honor an explicit user request when the capability is available. “low”, “medium”, and “high” are increasing invitations to use it when the exact moment benefits; they are never quotas. For high or medium bubble delivery, a natural first-send/afterthought/question sequence is an ordinary valid outcome even without an explicit multi-message request; decide from timing and character impulse, not from a fixed count. Keep media relevant, avoid repeating recent media, and do not spend a delivery form merely to decorate a reply.`
    : '';
  const mediaRules = (shouldIncludeMediaDecision
    ? `\n\nRules for mediaDecision:\n1. Media is optional. Follow this room's delivery policy before deciding; never pretend media was sent when no task is queued.${deliveryPolicyRules}\n${mediaCapabilities.image ? `2. Use images for requested or genuinely useful visual content. Infer the user's actual image goal from the latest message plus recent conversation. images is an array of 1-9 distinct image tasks; use one entry per image, never repeat the same prompt. Each image prompt must be final model-ready text and altText must be concise and specific.\n3. imageReferenceRegistry below lists recent chat images. Use IDs only when the request clearly identifies a reference; never output URLs, base64, or markdown image links.\nImage reference registry:\n${JSON.stringify(imageReferenceRegistry)}\n` : ''}${mediaCapabilities.audio ? '4. Use audio when the user asks for a voice reply or when the delivery policy permits it and speaking is a natural expression of the character\'s current emotion and relationship context. audio.text is the exact spoken content and must not add facts beyond the visible reply. When audio is selected, keep visible text concise and semantically aligned with the spoken content; do not send a long essay followed by a short unrelated audio clip.\n' : ''}5. Text, audio, and images may be combined in one turn. Prefer messages[] when this turn contains multiple independent consecutive sends. Each item has content and its own optional mediaDecision. A voice item must be a standalone bubble; text and images may be combined or sent separately. Multiple text/image/audio items may be emitted in natural sequence.\n6. Keep legacy content + extraMessages compatible. When messages[] is present it is authoritative and extraMessages should be null.`
    : '');
  const expressiveAudioOverride = mediaCapabilities.audio
    ? '\n\nAudio policy clarification: decide from the user\'s actual intent and the character\'s situation, not from a local keyword rule. If the latest user request explicitly asks to hear the reply, speak, sing, or send a voice message, audio is required when TTS is available. Character identity, habitual voice-message preference, affection, urgency, teasing, singing, crying, anger, or an emotionally important scene may also justify proactive audio. Consecutive audio turns are allowed when natural for the scene; do not suppress them merely because the previous turn also used audio. Keep each spoken text aligned with its visible message.\n'
    : '';

  const turnPlanMaxBubbles = Math.max(2, Math.min(5, params.richDelivery?.multiBubble.maxBubbles || params.turnPlan?.targetBubbleCount || 1));
  const turnPlanRules = params.turnPlan
    ? params.turnPlan.allowExtraMessages
      ? `\nTurn plan: rhythm=${params.turnPlan.rhythm}; this turn may use one to ${turnPlanMaxBubbles} consecutive bubbles if that is how the speaker would naturally send it. Before choosing the envelope, simulate typing this turn as live chat rather than drafting a paragraph. This is permission, not a quota: model a short run of real sends with unequal sizes, not a polished paragraph cut apart. A bubble may be only acknowledgement, invitation, hesitation, realization, retraction, reaction, or a question; it does not need a new thesis. If the user explicitly asks for several separate messages, treat that as a real delivery request and honor it when the scene and character can do so; decide the natural count from the request and context, up to the room maximum. After each beat, ask whether the next one would be typed after pressing send. If the answer is yes, prefer messages[] for independent sends and set content equal to messages[0].content; set extraMessages=null. Do not downgrade distinct short sends into paragraph breaks. A full stop alone is never a reason to split. A bubble may contain one or more paragraphs when that reads more naturally than separate sends.`
      : `\nTurn plan: rhythm=${params.turnPlan.rhythm}; one bubble is the default, but content may still contain paragraph breaks if the visible reply genuinely has separate thoughts.`
    : '';
  const aiDirectInteractionRules = params.chat.type === 'ai_direct'
    ? '\n8. In AI direct chats, target the other participant when the turn clearly supports, challenges, probes, defends, mocks, or dismisses them; do not target the speaker or the user unless the user is an actual participant.'
    : '';
  const storyNarrativeRules = isStoryReader
    ? `\n\nRules for story event DSL:
1. Story-reader turns must use storyEvents as the authoritative visible story body. Do not copy the JSON shape with storyEvents=null for a normal story turn.
2. storyEvents must be an ordered array for every normal story-reader turn and must include at least one visible narration or speech event. Do not set storyEvents=null; even a single spoken line must be represented as a speech event. Use as many narration and speech events as the current story beat needs; suggested event counts are guidance, not enforcement. Do not pad, truncate, or stop early just to fit a fixed count. Each event is one of:
   - {"type":"narration","actorId":"narrator","text":"brief external scene action or visible consequence"}
   - {"type":"speech","actorId":"character-id-or-null","actorName":"exact display name or null","text":"spoken line only"}
   - {"type":"choice_point","choices":[{"label":"让某人做具体动作","prompt":"选择后要推进的具体后果","intent":"逼问/保护/追踪/隐瞒/冒险/揭露","risk":"可能付出的代价","reward":"可能获得的信息或关系推进"}]}
   - {"type":"chapter_update","title":"4-10 Chinese characters, concrete and memorable","summary":"optional short recap","status":"active or completed","startNewChapter":false}
3. narration carries action, movement, consequences, inner pressure, scene changes, clue reveals, and time jumps. Narration renders as正文段落.
4. speech is optional. Use it only for words actually spoken aloud by a character; every speech event must include either a valid actorId or an exact actorName.
5. A whole turn may contain only narration. This is valid when the beat needs setting, consequence, or pressure more than dialogue.
6. Speech text must be chat-like. A common speech event is 1-3 sentences, but scene and character pressure decide the actual size: it can be terse, interrupted, or more developed when needed. No camera direction, omniscient analysis, private inner monologue, or describing the whole room's reaction.
7. Do not let one character inherit another character's private object, gesture, memory, clothing detail, wording, or sensory detail unless that detail was explicitly spoken aloud or publicly visible.
8. Put each narration and each character line in its own event, preserving story order. Do not merge narration and speech into one event.
9. Do not output alternate rewrites of the same moment. If you revise a narration or spoken line, keep only the final version; do not include both drafts in storyEvents.
10. choice_point appears only at a genuine decision point. Never add choices on a fixed cadence.
11. Put user decision pauses in a choice_point event. Do not render choices in any top-level field outside storyEvents or in a separate visible prose block.
12. Write visible scene execution, not author notes, beat analysis, future outline, or summaries like "接下来剧情将". If the user just chose a branch, first show what immediately changes on screen: a cost, clue, relationship shift, danger, or opportunity.
13. For non-choice beats, write a satisfying readable section rather than a minimal stub. Let the scene breathe with consequences, sensory detail, movement, and dialogue when useful. Stop only when the beat naturally lands on a hook or a genuine choice point.
14. chapter_update is structured metadata for the chapter sidebar. It is not visible body text. Use it when opening a new chapter, renaming the current chapter, or settling a chapter; do not invent a generic title such as "阶段回顾".
15. Do not put visible story prose or dialogue in any top-level field outside storyEvents.`
    : '';
  const storyChoiceRules = isStoryReader
    ? `\n\nRules for story choice points:
1. Most turns should not contain a choice_point; keep the story moving normally unless the scene has reached a real fork.
2. Add exactly one storyEvents choice_point with 2-4 options only when user participation would improve the story.
3. Do not ask for choices just because a fixed number of turns passed. There is no fixed cadence.
4. It is allowed to ask again soon if the scene truly demands it, but the room must not remain in a constant choose-operate loop.
5. Each option must read like a concrete character action: name who does what to whom or what object/place. Avoid abstract plot directions such as investigate clues, deepen emotion, advance plot, face the key person, continue the branch.
6. Each choice_point option must be shaped as {"label":"让某人做具体动作","prompt":"选择后要推进的具体后果","intent":"选择的戏剧功能","risk":"可能代价","reward":"可能收益"}.
7. Do not output top-level storyChoices for the primary path. storyEvents.choice_point is the source of truth. If a legacy storyChoices field is emitted for compatibility, it must exactly mirror the choice_point options and will have lower priority than storyEvents.`
    : '';
  if (isStoryReader) {
    return `\n\nOutput contract:
Return one valid JSON object only. This is the required shape for story-reader turns:
{
  "storyEvents": [
    { "type": "chapter_update", "title": "短章节名", "summary": "可选章节摘要", "status": "active" },
    { "type": "narration", "actorId": "narrator", "text": "写一段当前场景中可见的动作或后果。" },
    { "type": "speech", "actorId": "member-id", "actorName": "角色显示名", "text": "写一句角色真正说出口的话。" }
  ],
  "intentionalRepeat": false${mediaExample},
  "conflictFocus": null,
  "interactionHints": null,
  "socialEventHints": null
}

JSON validity rules:
1. The response must be parseable by JSON.parse.
2. Do not output TypeScript syntax such as string | null, undefined, comments, or trailing commas.
3. Use null for absent optional fields. Never use undefined.
4. Escape ASCII double quote characters inside string values with a backslash. Prefer Chinese quotes inside Chinese text.
5. intensity must be an integer from 1 to 5 if emitted inside optional diagnostic fields. confidence must be a decimal from 0 to 1, not 0 to 100.
6. The example values above are structural placeholders, not dialogue content, conflict content, or memory.${storyNarrativeRules}${storyChoiceRules}${mediaRules}${expressiveAudioOverride}

Story-reader visible body rule:
1. storyEvents is the only visible story body.
2. Never put story prose or dialogue in markdown, plain text outside JSON, or any top-level field outside storyEvents.
3. Every normal story turn needs at least one storyEvents narration or speech event, even if it also contains a chapter_update or choice_point.
4. interactionHints, conflictFocus, and socialEventHints are optional diagnostics; keep them null unless the current story event itself provides specific evidence.

social_outing diagnostics:
socialEventHints is the only model-authored source for activity creation and updates; the runtime will not invent or patch a social_outing from local keyword matching. When the visible storyEvents clearly propose, arrange, update, or commit to a shared concrete activity, socialEventHints must include one social_outing object with participantIds/targetIds as member ids, confidence 0-1, urgency, seedIntent, visibilityPlan, expectedArtifacts, title, activityType, timeHint, locationHint, dedupeKey, and optional participantStates. Use participantStates values mentioned/invited/interested/maybe/going/declined/withdrawn. Include "user" when the user is invited or participating.
Valid member ids:
${buildMemberReference({ chat: params.chat, characters: params.characters })}

Recent transcript scope:
${transcriptScope}${recentSocialEvents ? `\n\nRecent social events to avoid duplicating:\n${recentSocialEvents}` : ''}`;
  }
  const deliberationRules = isAnalysisRoom
    ? `\n\nRules for deliberationArtifacts:
1. In analysis rooms, visible content must either make a deliberative move or plainly say that no new deliberation point follows.
2. If content or extraMessages add a claim, evidence check, unresolved issue, counterexample, boundary, tradeoff, interim verdict, or synthesis, deliberationArtifacts must be a non-null object extracting only that same visible material.
3. Do not copy the example text. Replace it with material from your own visible reply.
4. Use deliberationArtifacts=null only when the visible response is explicitly a transition/clarification/no-new-point statement and contains no durable deliberation material. Null is the exception, not the default.
5. Do not create fake artifacts. If there is no deliberative content, still return valid JSON: content should be a short spoken room message such as "我这轮没有新的审议点，先停在这里。", and deliberationArtifacts should be null. Never write bracketed metadata or English protocol explanations in content.
6. Extract only from your own visible content plus extraMessages in this same response, not from hidden reasoning or earlier turns.
7. Each emitted item must include a concise reason explaining why the visible reply supports that extraction, and confidence as a decimal from 0 to 1.
8. claims are new or materially advanced positions. evidence is facts, cases, examples, materials, testimony, data, or verifiable grounds. issues are unresolved questions, weak links, boundaries, contradictions, or things another member should answer. verdicts are interim judgments, tendencies, tradeoffs, or decisions.
9. If targetActorId is used, it must come from the member list. Otherwise use null.
10. These fields are not visible chat content. Never mention JSON, artifacts, extraction, confidence, or this contract in content.`
    : '';

  const interactionRule = `interactionHints: null unless this visible turn has a clear directed effect. When used, targetId must be a member id and relationship is the model's own judgment: {"primary":{"targetId":"member-id","kind":"support|challenge|mock|dismiss|defend|probe|side_comment","tone":"warm|annoyed|defensive|excited|sarcastic|cold","intensity":3,"confidence":0.86,"reason":"visible evidence","relationship":{"delta":{"warmth":0,"competence":0,"trust":0,"threat":0,"attachment":0,"deference":0},"labels":["meaning"],"stance":"stance"}},"secondary":[]}. attachment and deference are slow axes: omit them or keep them within -2..2 unless this turn contains a real turning point. Omit uncertain hints.${aiDirectInteractionRules}`;
  const socialRule = `socialEventHints: null unless the visible turn itself proposes, commits to, updates, or cancels a concrete activity or social event. It is the only model-authored source for those events; the runtime will not infer them from keywords. For an outing, include member-id participantIds/targetIds, title, activityType, timeHint, locationHint, participantStates, and the existing dedupeKey when updating. Include "user" when the user is an invited or participating member.`;
  const toolRule = params.webSearchEnabled && !params.webSearchResultInjected
    ? 'toolRequest: null unless current external facts are genuinely required; then return a short in-character waiting line and {"type":"web_search","query":"specific query","reason":"why live facts are needed"}.'
    : params.webSearchResultInjected
      ? 'Search results are already supplied. Use them when relevant and keep toolRequest=null.'
      : '';
  return `${mediaCapabilityInstruction}\n## Output Contract
Return exactly one JSON object. It must be parseable. content is a non-empty visible first bubble; use null for absent fields and never expose protocol text.
{"content":"visible first bubble","messages":[{"content":"first send","mediaDecision":null},{"content":"later send","mediaDecision":null}],"extraMessages":null,"intentionalRepeat":false${mediaExample}${deliberationExample},"presenceUpdate":null,"conflictFocus":null,"interactionHints":null,"socialEventHints":null${toolRequestExample}}

messages[] is the authoritative ordered list for one speaker's independent consecutive sends (maximum 5); otherwise use null. Each item has non-empty content and optional mediaDecision. Audio must be the only media in its item. Do not split a sentence mechanically or write another actor. Unless the requested output is a document, report, or formal deliverable, this is chat even when the topic is serious: terminal punctuation is optional by default. A short reaction, unfinished thought, mutter, or follow-up may naturally have no final mark. Do not make every bubble a complete written sentence ending with the same punctuation; use a full stop when the speaker intentionally lands the thought. extraMessages is legacy-only and null whenever messages[] is used.${turnPlanRules}

intentionalRepeat is false unless repeating wording, cadence, or a marker is the deliberate social move; do not use it to excuse template drift. presenceUpdate is null unless the speaker explicitly goes away, returns, or states an actual availability change.
${interactionRule}
${socialRule}
Valid member ids:
${buildMemberReference({ chat: params.chat, characters: params.characters, speakerId: params.speaker.id })}
conflictFocus is null unless this turn materially changes a real contradiction; when present, write a fresh summary and why from the visible turn.${mediaRules}${expressiveAudioOverride}${deliberationRules}
${toolRule}
Recent transcript scope: ${transcriptScope}${recentSocialEvents ? `\nRecent social events: ${recentSocialEvents}` : ''}`;
}

export function parseInlineInteractionEnvelope(raw: string): InlineInteractionEnvelope | null {
  try {
    const jsonMatch = cleanJsonLikeText(raw).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as InlineInteractionEnvelope;
    if (!parsed || !hasVisibleEnvelopeContent(parsed)) return null;
    return sanitizeEnvelope(parsed);
  } catch {
    const salvaged = salvageContentFromMalformedEnvelope(raw);
    return salvaged ? sanitizeEnvelope(salvaged) : null;
  }
}
