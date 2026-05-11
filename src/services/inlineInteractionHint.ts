import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { AddressedTargetHintEnvelope, ConflictFocusPayload, InteractionHintCollection, RecentSocialEventSummary, SocialEventHintEnvelope } from '../types/runtimeEvent';

export interface InlineInteractionEnvelope {
  content: string;
  intentionalRepeat?: boolean | null;
  interactionHints?: InteractionHintCollection | null;
  addressedTargets?: AddressedTargetHintEnvelope | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: ConflictFocusPayload | null;
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
}) {
  const transcript = params.recentMessages
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentSocialEvents = buildRecentSocialEventContext(params.chat)
    .map((event) => `- ${event.eventKind}${event.title ? ` / ${event.title}` : ''}${event.activityType ? ` / ${event.activityType}` : ''}: ${event.summary}`)
    .join('\n');

  return `\n\nOutput contract:\nReturn one valid JSON object only. This is an example shape with valid JSON values:\n{\n  "content": "一句自然的群聊回复；如果要引用词语，优先使用中文引号，例如“躺平”。",\n  "intentionalRepeat": false,\n  "conflictFocus": {\n    "present": true,\n    "type": "authority_challenge",\n    "severity": 0.82,\n    "stage": "open",\n    "summary": "这句话把‘谁有资格管’推到了台面上。",\n    "primaryTargetIds": ["member-id"],\n    "participantIds": ["speaker-id", "member-id"],\n    "nextPressure": "escalate",\n    "developmentHooks": ["invite_target_response", "force_side_taking"],\n    "why": "表面在接话，实质是在争夺话语资格。"\n  },\n  "interactionHints": {\n    "primary": {\n      "targetId": "member-id-or-null",\n      "kind": "support",\n      "tone": "warm",\n      "intensity": 3,\n      "confidence": 0.86,\n      "reason": "简短说明为什么这句话指向该成员"\n    },\n    "secondary": [\n      {\n        "targetId": "other-member-id",\n        "kind": "defend",\n        "tone": "excited",\n        "intensity": 2,\n        "confidence": 0.72,\n        "reason": "如果同一句话同时影响第二个人，就补在这里"\n      }\n    ]\n  },\n  "socialEventHints": [\n    {\n      "eventKind": "social_outing",\n      "participantIds": ["member-id"],\n      "targetIds": null,\n      "reasonType": "proposal",\n      "confidence": 0.84,\n      "urgency": "soon",\n      "seedIntent": "简短事件动机",\n      "visibilityPlan": "public",\n      "expectedArtifacts": null,\n      "title": "线下活动",\n      "activityType": "火锅",\n      "timeHint": null,\n      "locationHint": null,\n      "dedupeKey": null\n    }\n  ]\n}\n\nJSON validity rules:\n1. The response must be parseable by JSON.parse.\n2. Do not output TypeScript syntax such as string | null, undefined, comments, or trailing commas.\n3. Use null for absent optional fields. Never use undefined.\n4. If content contains ASCII double quote characters, escape each quote with a backslash. Prefer Chinese quotes “like this” inside Chinese content.\n5. intensity must be an integer from 1 to 5. confidence must be a decimal from 0 to 1, not 0 to 100.\n\nAllowed interactionHint values:\n- kind: "support", "challenge", "mock", "dismiss", "defend", "probe", "side_comment"\n- tone: "warm", "annoyed", "defensive", "excited", "sarcastic", "cold"\n\nRules for interactionHints:\n1. primary is the strongest directed relationship effect in this line.\n2. secondary may include other directed effects from the same line, but only when they are real and specific.\n3. If you are just making a general comment, set interactionHints to null.\n4. targetId must come from this member list:\n${buildCharacterReference(params.characters.filter((character) => character.id !== params.speaker.id))}\n5. Do not emit duplicate targetId+kind pairs in secondary.\n6. If uncertain, lower confidence or omit the item.\n\nRules for conflictFocus:\n1. present=false is valid and common; not every line contains a meaningful contradiction.\n2. Judge the social function and underlying contradiction, not the literal surface words.\n3. Distinguish teasing, mock alignment, irony, status play, affiliation signaling, face-saving, deflection, misrecognition, and real conflict escalation.\n4. A line may look like ownership, accusation, agreement, or jealousy on the surface while actually functioning as teasing, sarcasm, pressure, or topic steering. Mark the underlying contradiction only when it meaningfully changes the room's tension structure.\n5. type must be one of: "identity_ownership", "authority_challenge", "status_competition", "alliance_boundary", "care_jealousy", "value_conflict", "goal_conflict", "resource_conflict", "fairness_conflict", "contradiction_exposure", "tone_escalation", "misrecognition".\n6. nextPressure must be one of: "escalate", "spread", "stabilize", "divert", "cool".\n7. developmentHooks must only use: "invite_target_response", "force_side_taking", "expose_contradiction", "raise_stakes", "shift_public_private", "cool_down_with_residue", "redirect_topic", "trigger_memory_recall".\n8. Only mark present=true when this line meaningfully sharpens, reframes, exposes, escalates, redirects, or cools an active contradiction.\n9. Keep summary and why focused on the social essence of the move, not just literal wording.\n10. When uncertain whether something is a real contradiction or playful banter, prefer a lower severity or present=false rather than overcalling it.\n\nAnalytical lenses for contradiction:\n- sociology: identity, boundary, alliance, status, role legitimacy\n- psychology: jealousy, shame, defense, attachment, control, projection\n- economics/game logic: resources, exchange, fairness, strategic incentives, opportunity cost\n- interaction dynamics: misrecognition, contradiction exposure, escalation, redirect, repair\n- narrative development: what pressure this move adds, releases, or redirects in the room\n\nDecide what the move does to the room, not just what words it contains.\n\nAllowed socialEventHints values:\n- eventKind: "pair_private_thread", "social_outing", "post_moment", "status_update", "gift_exchange", "conflict_expression", "custom"\n- urgency: "immediate", "soon", "defer"\n- visibilityPlan: "public", "conversation_private", "user_private", "mixed"\n\nRules for socialEventHints:\n1. Only include a hint when this line strongly suggests an event should happen beyond the message itself.\n2. For pair_private_thread, infer whether the speaker now likely wants a private follow-up with a specific member; do not mirror interactionHint mechanically.\n3. For social_outing, do NOT rely on keywords alone — infer whether a real outing is being proposed, and return structured title/activityType/timeHint/locationHint when possible.\n4. If several speakers are clearly talking about the same outing, reuse a stable dedupeKey so code can merge them.\n5. Prefer generic event titles like “线下活动”; put specifics like 火锅/看展/唱歌 into activityType or source text context instead.\n6. participantIds must come from current member ids.\n7. If nothing should happen, return socialEventHints as null or [].\n8. Do not mention this JSON contract in content.\n\nRecent transcript:\n${transcript}${recentSocialEvents ? `\n\nRecent social events to avoid duplicating:\n${recentSocialEvents}` : ''}`;
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
