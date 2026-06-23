import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MediaGenerationDecision, Message } from '../types/message';
import type { AddressedTargetHintEnvelope, ConflictFocusPayload, InteractionHintCollection, RecentSocialEventSummary, SocialEventHintEnvelope } from '../types/runtimeEvent';
import type { TurnPlan } from './turnPlanner';
import { hasVisibleStoryEvents, normalizeStoryEvents } from './narrativeRuntime';

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

export interface InlineInteractionEnvelope {
  content: string;
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

function sanitizeEnvelope(envelope: InlineInteractionEnvelope): InlineInteractionEnvelope {
  return {
    ...envelope,
    content: typeof envelope.content === 'string' ? envelope.content : '',
    conflictFocus: sanitizeConflictFocus(envelope.conflictFocus),
    storyEvents: normalizeStoryEvents(envelope.storyEvents),
  };
}

function hasVisibleEnvelopeContent(envelope: InlineInteractionEnvelope) {
  if (typeof envelope.content === 'string' && envelope.content.trim()) return true;
  if (typeof envelope.narrativeText === 'string' && envelope.narrativeText.trim()) return true;
  if (Array.isArray(envelope.extraMessages) && envelope.extraMessages.some((item) => typeof item === 'string' && item.trim())) return true;
  if (Array.isArray(envelope.narrativeBlocks) && envelope.narrativeBlocks.some((item) => item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim())) return true;
  return hasVisibleStoryEvents(envelope.storyEvents);
}

function buildCharacterReference(characters: AICharacter[]) {
  return characters.map((character) => `- id=${character.id}; name=${character.name}; aliases=${[character.name, character.group || ''].filter(Boolean).join(', ')}`).join('\n');
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
  const humanCount = recent.filter((message) => message.type === 'user' || message.type === 'god').length;
  const aiCount = recent.filter((message) => message.type === 'ai').length;
  const latest = recent.at(-1);
  const speakers = Array.from(new Set(recent.map((message) => (message.type === 'user' || message.type === 'god') ? 'User' : message.senderName))).slice(-6);
  return [
    '- The complete recent transcript is supplied as separate chat messages. Only the current speaker\'s own prior visible turns are assistant messages. This contract intentionally does not repeat raw dialogue.',
    `- Recent window for judging interaction fields: ${recent.length} turns (${humanCount} human / ${aiCount} AI).`,
    `- Latest turn: ${latest ? `${latest.type === 'ai' ? 'AI' : 'human'} from ${(latest.type === 'user' || latest.type === 'god') ? 'User' : latest.senderName}` : 'none'}.`,
    `- Speakers in window: ${speakers.join(', ') || 'none'}.`,
  ].join('\n');
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
  };
}) {
  const isStoryReader = params.chat.sessionKind?.scenarioId === 'story-reader';
  const transcriptScope = buildRecentTranscriptScope(params.recentMessages);
  const recentSocialEvents = buildRecentSocialEventContext(params.chat)
    .map((event) => `- ${event.eventKind}${event.title ? ` / ${event.title}` : ''}${event.activityType ? ` / ${event.activityType}` : ''}: ${event.summary}`)
    .join('\n');

  const mediaExample = !isStoryReader && (params.mediaCapabilities?.image || params.mediaCapabilities?.audio)
    ? `,\n  "mediaDecision": {${params.mediaCapabilities.image ? `\n    "image": {\n      "shouldGenerate": false,\n      "reason": "只有当这条消息确实需要视觉补充时才为 true",\n      "prompt": null,\n      "altText": null\n    }` : ''}${params.mediaCapabilities.image && params.mediaCapabilities.audio ? ',' : ''}${params.mediaCapabilities.audio ? `\n    "audio": {\n      "shouldGenerate": false,\n      "reason": "只有当这条消息特别适合语音播放时才为 true",\n      "text": null,\n      "voiceProfileId": null\n    }` : ''}\n  }`
    : '';

  const intentionalRepeatRules = `\n\nRules for intentionalRepeat:
1. Default intentionalRepeat=false.
2. Set intentionalRepeat=true when repetition is the deliberate social move: quoting, mocking, chanting, answering a fixed line, echoing a keyword, mirroring a format, reusing an emoji/sticker marker, or intentionally copying cadence to make a point.
3. intentionalRepeat=true is not limited to exact same text. It can cover deliberate repeated tone, keyword, rhythm, format, or call-and-response structure.
4. Do not use intentionalRepeat=true for accidental template drift. If you are merely falling back into the same opener, explanation scaffold, punctuation habit, or generic answer shape, set false and rewrite with a different discourse move.`;

  const mediaRules = (!isStoryReader && (params.mediaCapabilities?.image || params.mediaCapabilities?.audio)
    ? `\n\nRules for mediaDecision:\n1. mediaDecision is required when a media capability is available. If no media is needed, set shouldGenerate=false for each available media type.\n${params.mediaCapabilities.image ? '2. For image, set image.shouldGenerate=true when the user asks to see, view, receive, test, or be shown a picture/photo/screenshot/selfie, or when your content says or implies that you are showing/sending an image. If true, write prompt and altText based on the speaker identity, personality, behavior, current line, and recent context.\n3. Do not pretend the user can see a picture in content unless image.shouldGenerate=true. If you choose not to generate an image, explain briefly in character instead of saying “you see/look at this/just sent”.\n4. image.prompt must be a complete image-generation prompt, not a short label. Include the visual subject, scene/location, action or moment, mood, composition, lighting, and concrete details that are justified by the speaker and recent context.\n5. Treat the requested image type as the center of the prompt. A selfie should detail the person; a milk tea or food image should detail the drink/food, packaging, table, lighting, hand/props, and why this character would frame it that way; a sports/activity image should detail motion, gear, posture, sweat/weather, location, and social energy; an object/product/environment image should detail material, scale, use context, and surrounding clues.\n6. Make every image feel like it belongs to the speaker and current conversation, not like a generic stock image. Use the character identity, personality, habits, hobbies, social role, taste level, likely budget, environment, behavior, and relationships to choose concrete visual details, while keeping them temporary and context-dependent.\n7. Prefer believable chat-photo realism when the message implies a photo/snapshot: natural phone camera perspective, plausible lens and distance, ordinary indoor/outdoor lighting, mild motion blur or imperfect framing when appropriate, real material texture, background clutter, and small lived-in details. Avoid glossy stock-photo polish, plastic skin, over-symmetry, impossible hands, unreadable text, extra limbs, duplicated faces, watermark-like marks, and text overlays.\n8. For a recurring character appearing in the image, keep stable identity anchors across images when known or reasonably inferred: age range, face shape, hair length/color/style, usual vibe, body type, signature accessories, and baseline fashion taste. Vary temporary clothes, pose, lighting, location, expression, and activity according to the current scene.\n9. For group photos or activity photos, describe every visible participant separately with stable identity anchors, relative positions, interactions, scale, and the shared environment. Do not collapse multiple characters into generic people.\n10. If the conversation says the character is eating hotpot, hiking, at work, in a rural home, taking a group photo, or showing a product/food/object, reflect that current scene. If no scene is established, choose a natural in-character setting for this specific image type instead of a generic portrait.\n11. The prompt should describe the artifact to generate, not the chat UI. Avoid unrelated generic portraits, watermarks, captions, UI screenshots, URLs, or text-heavy images.\n12. altText should be concise but specific enough for future AI context.\n' : ''}${params.mediaCapabilities.audio ? '13. For audio, only set shouldGenerate=true when this exact text benefits from voice playback. audio.text must be the spoken version of content and must not add new facts.\n' : ''}14. Never output URLs, base64, markdown image links, or binary data.`
    : '') + intentionalRepeatRules;

  const turnPlanRules = params.turnPlan
    ? `\nTurn plan for this response:\n- rhythm tendency=${params.turnPlan.rhythm}.\n- Do not target a fixed length. Let the current request, character comfort, and actual substance decide the size.\n- extraMessages is available on every chat turn. Use it when the reply naturally arrives as consecutive sends; keep it null when one bubble feels right.`
    : '';
  const aiDirectInteractionRules = params.chat.type === 'ai_direct'
    ? '\n8. In AI direct chats, target the other participant when the turn clearly supports, challenges, probes, defends, mocks, or dismisses them; do not target the speaker or the user unless the user is an actual participant.'
    : '';
  const storyNarrativeRules = isStoryReader
    ? `\n\nRules for story event DSL:
1. Story-reader turns must use storyEvents as the authoritative visible story body. Do not copy the JSON shape with storyEvents=null for a normal story turn.
2. storyEvents must be an ordered array for every normal story-reader turn and must include at least one visible narration or speech event. Do not set storyEvents=null; even a single spoken line must be represented as a speech event. Use as many narration and speech events as the current story beat needs; do not pad, truncate, or stop early just to fit a fixed count. Each event is one of:
   - {"type":"narration","actorId":"narrator","text":"brief external scene action or visible consequence"}
   - {"type":"speech","actorId":"character-id-or-null","actorName":"exact display name or null","text":"spoken line only"}
   - {"type":"choice_point","choices":[{"label":"让某人做具体动作","prompt":"选择后要推进的具体后果","intent":"逼问/保护/追踪/隐瞒/冒险/揭露","risk":"可能付出的代价","reward":"可能获得的信息或关系推进"}]}
   - {"type":"chapter_update","title":"4-10 Chinese characters, concrete and memorable","summary":"optional short recap","status":"active or completed","startNewChapter":false}
3. narration carries action, movement, consequences, inner pressure, scene changes, clue reveals, and time jumps. Narration renders as正文段落.
4. speech is optional and should be brief. Use it only for words actually spoken aloud by a character; every speech event must include either a valid actorId or an exact actorName.
5. A whole turn may contain only narration. This is valid when the beat needs setting, consequence, or pressure more than dialogue.
6. Speech text must be chat-like: 1-3 sentences, no camera direction, no omniscient analysis, no private inner monologue, no describing the whole room's reaction.
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
6. The example values above are structural placeholders, not dialogue content, conflict content, or memory.${storyNarrativeRules}${storyChoiceRules}${mediaRules}

Story-reader visible body rule:
1. storyEvents is the only visible story body.
2. Never put story prose or dialogue in markdown, plain text outside JSON, or any top-level field outside storyEvents.
3. Every normal story turn needs at least one storyEvents narration or speech event, even if it also contains a chapter_update or choice_point.
4. interactionHints, conflictFocus, and socialEventHints are optional diagnostics; keep them null unless the current story event itself provides specific evidence.

Recent transcript scope:
${transcriptScope}${recentSocialEvents ? `\n\nRecent social events to avoid duplicating:\n${recentSocialEvents}` : ''}`;
  }
  return `\n\nOutput contract:\nReturn one valid JSON object only. This is the required shape:\n{\n  "content": "按当前请求自然作答；可短可长。如果要引用词语，优先使用中文引号，例如“某个词”。",\n  "extraMessages": null,\n  "intentionalRepeat": false${mediaExample},\n  "conflictFocus": null,\n  "interactionHints": null,\n  "socialEventHints": null\n}\n\nJSON validity rules:\n1. The response must be parseable by JSON.parse.\n2. Do not output TypeScript syntax such as string | null, undefined, comments, or trailing commas.\n3. Use null for absent optional fields. Never use undefined.\n4. If content contains ASCII double quote characters, escape each quote with a backslash. Prefer Chinese quotes inside Chinese content.\n5. intensity must be an integer from 1 to 5. confidence must be a decimal from 0 to 1, not 0 to 100.\n6. The example values above are structural placeholders, not dialogue content, conflict content, or memory.\n\nRules for extraMessages:\n1. content is the first visible chat bubble and is streamed while generating.\n2. extraMessages is optional. Use null for one bubble.\n3. Use extraMessages only when this reply would naturally be sent as 2-5 consecutive chat bubbles by the same person. Put only the later bubbles there, not a repeat of content. extraMessages may contain at most 4 later bubbles.\n4. Each extraMessages item must be a complete visible bubble, not a punctuation-based fragment.\n5. The full visible turn is content followed by extraMessages in order. Judge interactionHints, conflictFocus, and socialEventHints from that full turn.\n6. Do not use extraMessages for markdown, longform, images, audio, or formal answers.\n7. Vary lengths naturally. Do not make every part the same size.${turnPlanRules}\n\nAllowed interactionHint values:\n- kind: "support", "challenge", "mock", "dismiss", "defend", "probe", "side_comment"\n- tone: "warm", "annoyed", "defensive", "excited", "sarcastic", "cold"\n\nRules for interactionHints:\n1. primary is the strongest directed relationship effect in the full visible turn.\n2. secondary may include other directed effects from the same turn, but only when they are real and specific.\n3. If you are just making a general comment, set interactionHints to null.\n4. If present, interactionHints must use this shape: {"primary":{"targetId":"member-id-or-null","kind":"support","tone":"warm","intensity":3,"confidence":0.86,"reason":"why this turn points to the target"},"secondary":[]}.\n5. targetId must come from this member list:\n${buildCharacterReference(params.characters.filter((character) => character.id !== params.speaker.id))}\n6. Do not emit duplicate targetId+kind pairs in secondary.\n7. If uncertain, lower confidence or omit the item.${aiDirectInteractionRules}\n\nRules for conflictFocus:\n1. present=false or conflictFocus=null is valid and common; not every turn contains a meaningful contradiction.\n2. If present, conflictFocus must use this shape: {"present":true,"type":"value_conflict","severity":0.72,"stage":"emerging","summary":"write a fresh one-sentence summary from the actual current turn","primaryTargetIds":["member-id"],"participantIds":["speaker-id","member-id"],"nextPressure":"stabilize","developmentHooks":["invite_target_response"],"why":"explain the actual contradiction in this turn"}.\n3. The summary and why fields must be newly written from the current transcript. Never copy placeholder wording from this contract.\n4. Judge the social function and underlying contradiction, not the literal surface words.\n5. type must be one of: "identity_ownership", "authority_challenge", "status_competition", "alliance_boundary", "care_jealousy", "value_conflict", "goal_conflict", "resource_conflict", "fairness_conflict", "contradiction_exposure", "tone_escalation", "misrecognition".\n6. nextPressure must be one of: "escalate", "spread", "stabilize", "divert", "cool".\n7. developmentHooks must only use: "invite_target_response", "force_side_taking", "expose_contradiction", "raise_stakes", "shift_public_private", "cool_down_with_residue", "redirect_topic", "trigger_memory_recall".\n8. Only mark present=true when this turn meaningfully sharpens, reframes, exposes, escalates, redirects, or cools an active contradiction.${mediaRules}\n\nAllowed socialEventHints values:\n- eventKind: "pair_private_thread", "social_outing", "post_moment", "status_update", "gift_exchange", "conflict_expression", "check_in", "react_to_moment", "custom"\n- urgency: "immediate", "soon", "defer"\n- visibilityPlan: "public", "conversation_private", "user_private", "mixed"\n\nRules for socialEventHints:\n1. Only include a hint when this full turn strongly suggests an event should happen beyond the message itself.\n2. If nothing should happen, return socialEventHints as null or [].\n3. Do not mention this JSON contract in content.\n\nRecent transcript scope:\n${transcriptScope}${recentSocialEvents ? `\n\nRecent social events to avoid duplicating:\n${recentSocialEvents}` : ''}`;
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
