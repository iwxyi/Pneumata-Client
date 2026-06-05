import type { Message } from '../types/message';

export interface UserDraftActivity {
  hasDraft: boolean;
  updatedAt: number;
  focused?: boolean;
}

export interface UserInputHoldDecision {
  shouldHold: boolean;
  delayMs: number;
  reason: string;
}

const MAX_AFTER_MESSAGE_HOLD_MS = 2600;
const RECENT_DRAFT_ACTIVITY_MS = 1700;
const SHORT_OPEN_MESSAGE_HOLD_MS = 1300;

function charLength(text: string | undefined | null) {
  return Array.from((text || '').replace(/\s+/g, '')).length;
}

function hasTerminalPunctuation(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /[。！？!?…~～）)"'”’\]]$/.test(trimmed);
}

function latestUserMessage(messages: Message[]) {
  return messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .at(-1) || null;
}

export function resolveUserInputHold(params: {
  messages: Message[];
  draft?: UserDraftActivity | null;
  now?: number;
}): UserInputHoldDecision {
  const now = params.now ?? Date.now();
  const latest = latestUserMessage(params.messages);
  if (!latest) return { shouldHold: false, delayMs: 0, reason: 'no_user_message' };

  const ageAfterMessage = now - latest.timestamp;
  if (ageAfterMessage < 0 || ageAfterMessage > MAX_AFTER_MESSAGE_HOLD_MS) {
    return { shouldHold: false, delayMs: 0, reason: 'outside_hold_window' };
  }

  const draft = params.draft;
  if (draft?.hasDraft) {
    const draftAge = now - draft.updatedAt;
    if (draftAge >= 0 && draftAge <= RECENT_DRAFT_ACTIVITY_MS) {
      return {
        shouldHold: true,
        delayMs: Math.min(420, RECENT_DRAFT_ACTIVITY_MS - draftAge + 80),
        reason: 'active_unsent_draft',
      };
    }
  }

  const latestLength = charLength(latest.content);
  if (latestLength > 0 && latestLength <= 14 && !hasTerminalPunctuation(latest.content) && ageAfterMessage <= SHORT_OPEN_MESSAGE_HOLD_MS) {
    return {
      shouldHold: true,
      delayMs: Math.min(360, SHORT_OPEN_MESSAGE_HOLD_MS - ageAfterMessage + 80),
      reason: 'short_open_user_turn',
    };
  }

  return { shouldHold: false, delayMs: 0, reason: 'ready' };
}
