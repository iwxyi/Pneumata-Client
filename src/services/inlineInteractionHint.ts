import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MediaGenerationDecision, Message } from '../types/message';
import type { AddressedTargetHintEnvelope, ConflictFocusPayload, InteractionHintCollection, RecentSocialEventSummary, SocialEventHintEnvelope } from '../types/runtimeEvent';

export interface InlineInteractionEnvelope {
  content: string;
  extraMessages?: string[] | null;
  intentionalRepeat?: boolean | null;
  interactionHints?: InteractionHintCollection | null;
  addressedTargets?: AddressedTargetHintEnvelope | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
  mediaDecision?: MediaGenerationDecision | null;
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

export function buildInlineInteractionContract(params: {
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  recentMessages: Message[];
  mediaCapabilities?: {
    image: boolean;
    audio: boolean;
  };
}) {
  const transcript = params.recentMessages
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentSocialEvents = buildRecentSocialEventContext(params.chat)
    .map((event) => `- ${event.eventKind}${event.title ? ` / ${event.title}` : ''}${event.activityType ? ` / ${event.activityType}` : ''}: ${event.summary}`)
    .join('\n');

  const mediaExample = params.mediaCapabilities?.image || params.mediaCapabilities?.audio
    ? `,\n  "mediaDecision": {${params.mediaCapabilities.image ? `\n    "image": {\n      "shouldGenerate": false,\n      "reason": "只有当这条消息确实需要视觉补充时才为 true",\n      "prompt": null,\n      "altText": null\n    }` : ''}${params.mediaCapabilities.image && params.mediaCapabilities.audio ? ',' : ''}${params.mediaCapabilities.audio ? `\n    "audio": {\n      "shouldGenerate": false,\n      "reason": "只有当这条消息特别适合语音播放时才为 true",\n      "text": null,\n      "voiceProfileId": null\n    }` : ''}\n  }`
    : '';

  const mediaRules = params.mediaCapabilities?.image || params.mediaCapabilities?.audio
    ? `\n\nRules for mediaDecision:\n1. mediaDecision is required when a media capability is available. If no media is needed, set shouldGenerate=false for each available media type.\n${params.mediaCapabilities.image ? '2. For image, set image.shouldGenerate=true when the user asks to see, view, receive, test, or be shown a picture/photo/screenshot/selfie, or when your content says or implies that you are showing/sending an image. If true, write prompt and altText based on the speaker identity, personality, behavior, current line, and recent context.\n3. Do not pretend the user can see a picture in content unless image.shouldGenerate=true. If you choose not to generate an image, explain briefly in character instead of saying “you see/look at this/just sent”.\n4. image.prompt must be a complete image-generation prompt, not a short label. Include the visual subject, scene/location, action or moment, mood, composition, lighting, and concrete details that are justified by the speaker and recent context.\n5. Treat the requested image type as the center of the prompt. A selfie should detail the person; a milk tea or food image should detail the drink/food, packaging, table, lighting, hand/props, and why this character would frame it that way; a sports/activity image should detail motion, gear, posture, sweat/weather, location, and social energy; an object/product/environment image should detail material, scale, use context, and surrounding clues.\n6. Make every image feel like it belongs to the speaker and current conversation, not like a generic stock image. Use the character identity, personality, habits, hobbies, social role, taste level, likely budget, environment, behavior, and relationships to choose concrete visual details, while keeping them temporary and context-dependent.\n7. Prefer believable chat-photo realism when the message implies a photo/snapshot: natural phone camera perspective, plausible lens and distance, ordinary indoor/outdoor lighting, mild motion blur or imperfect framing when appropriate, real material texture, background clutter, and small lived-in details. Avoid glossy stock-photo polish, plastic skin, over-symmetry, impossible hands, unreadable text, extra limbs, duplicated faces, watermark-like marks, and text overlays.\n8. For a recurring character appearing in the image, keep stable identity anchors across images when known or reasonably inferred: age range, face shape, hair length/color/style, usual vibe, body type, signature accessories, and baseline fashion taste. Vary temporary clothes, pose, lighting, location, expression, and activity according to the current scene.\n9. For group photos or activity photos, describe every visible participant separately with stable identity anchors, relative positions, interactions, scale, and the shared environment. Do not collapse multiple characters into generic people.\n10. If the conversation says the character is eating hotpot, hiking, at work, in a rural home, taking a group photo, or showing a product/food/object, reflect that current scene. If no scene is established, choose a natural in-character setting for this specific image type instead of a generic portrait.\n11. The prompt should describe the artifact to generate, not the chat UI. Avoid unrelated generic portraits, watermarks, captions, UI screenshots, URLs, or text-heavy images.\n12. altText should be concise but specific enough for future AI context.\n' : ''}${params.mediaCapabilities.audio ? '13. For audio, only set shouldGenerate=true when this exact text benefits from voice playback. audio.text must be the spoken version of content and must not add new facts.\n' : ''}14. Never output URLs, base64, markdown image links, or binary data.`
    : '';

  return `\n\nOutput contract:\nReturn one valid JSON object only. This is an example shape with valid JSON values:\n{\n  "content": "一句自然的群聊回复；如果要引用词语，优先使用中文引号，例如“躺平”。",\n  "extraMessages": null,\n  "intentionalRepeat": false${mediaExample},\n  "conflictFocus": {\n    "present": true,\n    "type": "authority_challenge",\n    "severity": 0.82,\n    "stage": "open",\n    "summary": "这句话把‘谁有资格管’推到了台面上。",\n    "primaryTargetIds": ["member-id"],\n    "participantIds": ["speaker-id", "member-id"],\n    "nextPressure": "escalate",\n    "developmentHooks": ["invite_target_response", "force_side_taking"],\n    "why": "表面在接话，实质是在争夺话语资格。"\n  },\n  "interactionHints": {\n    "primary": {\n      "targetId": "member-id-or-null",\n      "kind": "support",\n      "tone": "warm",\n      "intensity": 3,\n      "confidence": 0.86,\n      "reason": "简短说明为什么这句话指向该成员"\n    },\n    "secondary": []\n  },\n  "socialEventHints": null\n}\n\nJSON validity rules:\n1. The response must be parseable by JSON.parse.\n2. Do not output TypeScript syntax such as string | null, undefined, comments, or trailing commas.\n3. Use null for absent optional fields. Never use undefined.\n4. If content contains ASCII double quote characters, escape each quote with a backslash. Prefer Chinese quotes “like this” inside Chinese content.\n5. intensity must be an integer from 1 to 5. confidence must be a decimal from 0 to 1, not 0 to 100.\n\nRules for extraMessages:\n1. content is the first visible chat bubble and is streamed while generating.\n2. extraMessages is optional. Use null for one bubble.\n3. Use extraMessages only when this reply would naturally be sent as 2-5 consecutive chat bubbles by the same person. Put only the later bubbles there, not a repeat of content. extraMessages may contain at most 4 later bubbles.\n4. Each extraMessages item must be a complete visible bubble, not a punctuation-based fragment.\n5. The full visible turn is content followed by extraMessages in order. Judge interactionHints, conflictFocus, and socialEventHints from that full turn.\n6. Do not use extraMessages for markdown, longform, images, audio, or formal answers.\n7. Vary lengths naturally. Do not make every part the same size.\n\nAllowed interactionHint values:\n- kind: "support", "challenge", "mock", "dismiss", "defend", "probe", "side_comment"\n- tone: "warm", "annoyed", "defensive", "excited", "sarcastic", "cold"\n\nRules for interactionHints:\n1. primary is the strongest directed relationship effect in the full visible turn.\n2. secondary may include other directed effects from the same turn, but only when they are real and specific.\n3. If you are just making a general comment, set interactionHints to null.\n4. targetId must come from this member list:\n${buildCharacterReference(params.characters.filter((character) => character.id !== params.speaker.id))}\n5. Do not emit duplicate targetId+kind pairs in secondary.\n6. If uncertain, lower confidence or omit the item.\n\nRules for conflictFocus:\n1. present=false is valid and common; not every turn contains a meaningful contradiction.\n2. Judge the social function and underlying contradiction, not the literal surface words.\n3. type must be one of: "identity_ownership", "authority_challenge", "status_competition", "alliance_boundary", "care_jealousy", "value_conflict", "goal_conflict", "resource_conflict", "fairness_conflict", "contradiction_exposure", "tone_escalation", "misrecognition".\n4. nextPressure must be one of: "escalate", "spread", "stabilize", "divert", "cool".\n5. developmentHooks must only use: "invite_target_response", "force_side_taking", "expose_contradiction", "raise_stakes", "shift_public_private", "cool_down_with_residue", "redirect_topic", "trigger_memory_recall".\n6. Only mark present=true when this turn meaningfully sharpens, reframes, exposes, escalates, redirects, or cools an active contradiction.\n7. Keep summary and why focused on the social essence of the move, not just literal wording.${mediaRules}\n\nAllowed socialEventHints values:\n- eventKind: "pair_private_thread", "social_outing", "post_moment", "status_update", "gift_exchange", "conflict_expression", "custom"\n- urgency: "immediate", "soon", "defer"\n- visibilityPlan: "public", "conversation_private", "user_private", "mixed"\n\nRules for socialEventHints:\n1. Only include a hint when this full turn strongly suggests an event should happen beyond the message itself.\n2. If nothing should happen, return socialEventHints as null or [].\n3. Do not mention this JSON contract in content.\n\nRecent transcript:\n${transcript}${recentSocialEvents ? `\n\nRecent social events to avoid duplicating:\n${recentSocialEvents}` : ''}`;
}

export function parseInlineInteractionEnvelope(raw: string): InlineInteractionEnvelope | null {
  try {
    const jsonMatch = cleanJsonLikeText(raw).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as InlineInteractionEnvelope;
    if (!parsed || typeof parsed.content !== 'string') return null;
    return parsed;
  } catch {
    return salvageContentFromMalformedEnvelope(raw);
  }
}
