import { unstable_batchedUpdates } from 'react-dom';
import type { AICharacter } from '../types/character';
import type { DriverCharacterPatch, DriverEventPayload, DriverMessageCommitTransition, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { createRuntimeMemoryTimer } from './runtimeMemoryMonitor';
import { reportRecoverableError } from './diagnostics';

export interface CommitRuntimeServices {
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  updateCharacters?: (patches: Array<{ id: string; patch: Partial<AICharacter> }>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitTransition['runtimeEvents'][number], sourceMessageId?: string) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitTransition['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitTransition['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}

export interface CommitRuntimeRequest {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  currentMessages: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitTransition | Promise<DriverMessageCommitTransition>;
}

function mergeCharacterPatches(patches: DriverCharacterPatch[]) {
  const merged = new Map<string, Partial<AICharacter>>();
  for (const entry of patches) {
    merged.set(entry.characterId, {
      ...(merged.get(entry.characterId) || {}),
      ...entry.patch,
    });
  }
  return Array.from(merged.entries()).map(([characterId, patch]) => ({ characterId, patch }));
}

function dedupeRuntimeEvents(events: DriverEventPayload[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.eventType, event.title, event.summary, event.channelId || '', event.threadRef || ''].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCommitTransition(
  transition: DriverMessageCommitTransition,
  sourceMessageId?: string,
  now?: number,
): DriverMessageCommitTransition {
  let lastEventCreatedAt = 0;
  const baseCreatedAt = typeof now === 'number' && Number.isFinite(now) ? Math.round(now) : Date.now();
  const fallbackFromEvents = transition.runtimeEvents.length
    ? transition.runtimeEvents.reduce((max, event, index) => {
      const value = typeof event.createdAt === 'number' && Number.isFinite(event.createdAt) ? Math.round(event.createdAt) : (baseCreatedAt + index);
      return Math.max(max, value);
    }, 0)
    : 0;
  const fallbackLastMessageAt = fallbackFromEvents || baseCreatedAt;
  const explicitLastMessageAt = typeof transition.chatPatch.lastMessageAt === 'number' && Number.isFinite(transition.chatPatch.lastMessageAt)
    ? Math.round(transition.chatPatch.lastMessageAt)
    : undefined;
  return {
    chatPatch: {
      lastMessageAt: explicitLastMessageAt ?? fallbackLastMessageAt,
      ...transition.chatPatch,
    },
    chatRuntimeDelta: transition.chatRuntimeDelta,
    characterPatches: mergeCharacterPatches(transition.characterPatches),
    runtimeEvents: dedupeRuntimeEvents(transition.runtimeEvents).map((event, index) => {
      const requestedCreatedAt = typeof event.createdAt === 'number' ? event.createdAt : (baseCreatedAt + index);
      const createdAt = requestedCreatedAt <= lastEventCreatedAt ? lastEventCreatedAt + 1 : requestedCreatedAt;
      lastEventCreatedAt = createdAt;
      return {
        ...event,
        createdAt,
        sourceMessageId: event.sourceMessageId || sourceMessageId,
      };
    }),
  };
}

function deferCommitSideEffect(task: () => Promise<void>) {
  const run = () => {
    void task().catch((error) => {
      reportRecoverableError({
        location: 'commit-apply.deferred-side-effect',
        error,
        userMessage: '后台同步更新失败，请稍后重试。',
      });
    });
  };
  const scheduler = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof scheduler === 'function') {
    scheduler(run, { timeout: 300 });
    return;
  }
  setTimeout(run, 0);
}

export async function applyCommitTransition(params: {
  chatId: string;
  speakerId: string;
  transition: DriverMessageCommitTransition;
  services: CommitRuntimeServices;
  sourceMessageId?: string;
  now?: number;
}) {
  const transition = normalizeCommitTransition(params.transition, params.sourceMessageId, params.now);
  const timer = createRuntimeMemoryTimer('commit-apply', {
    chatId: params.chatId,
    speakerId: params.speakerId,
    transition,
    extra: {
      characterPatchCount: transition.characterPatches.length,
      runtimeEventCount: transition.runtimeEvents.length,
      chatPatchKeys: Object.keys(transition.chatPatch),
    },
  });

  const applyCharacterUpdates = () => {
    if (params.services.updateCharacters) {
      return params.services.updateCharacters(transition.characterPatches.map((patch) => ({
        id: patch.characterId,
        patch: patch.patch,
      })));
    }
    return Promise.all(
      transition.characterPatches.map((patch) => params.services.updateCharacter(patch.characterId, patch.patch))
    ).then(() => undefined);
  };

  const applyChatUpdate = () => {
    if (transition.chatRuntimeDelta && params.services.applyChatRuntimeDelta) {
      const runtimePatch = { ...transition.chatPatch };
      delete runtimePatch.runtimeEventsV2;
      delete runtimePatch.relationshipLedger;
      return params.services.applyChatRuntimeDelta(params.chatId, transition.chatRuntimeDelta, runtimePatch);
    }
    if (Object.keys(transition.chatPatch).length > 0) {
      return params.services.updateChat(params.chatId, transition.chatPatch);
    }
    return Promise.resolve();
  };

  let characterUpdatePromise = Promise.resolve();
  let chatUpdatePromise = Promise.resolve();
  unstable_batchedUpdates(() => {
    characterUpdatePromise = applyCharacterUpdates();
    if (params.speakerId) params.services.recordSpeak(params.speakerId);
    chatUpdatePromise = applyChatUpdate();
  });
  await characterUpdatePromise;
  timer.mark('after-character-updates', {
    transition,
    extra: {
      characterPatchCount: transition.characterPatches.length,
    },
  });

  if (params.services.appendEventMessages) {
    deferCommitSideEffect(() => params.services.appendEventMessages!(params.chatId, transition.runtimeEvents, params.sourceMessageId));
  } else {
    for (const eventPayload of transition.runtimeEvents) {
      await params.services.appendEventMessage(params.chatId, eventPayload, eventPayload.sourceMessageId);
    }
  }
  timer.mark('after-event-messages', {
    transition,
    extra: {
      runtimeEventCount: transition.runtimeEvents.length,
    },
  });

  timer.mark('after-record-speak', { transition });

  if (transition.chatRuntimeDelta && params.services.applyChatRuntimeDelta) {
    const runtimePatch = { ...transition.chatPatch };
    delete runtimePatch.runtimeEventsV2;
    delete runtimePatch.relationshipLedger;
    timer.mark('before-update-chat', {
      transition: {
        ...transition,
        chatPatch: runtimePatch,
      },
      extra: {
        chatPatchKeys: Object.keys(runtimePatch),
        runtimeDeltaKeys: Object.keys(transition.chatRuntimeDelta),
      },
    });
    await chatUpdatePromise;
    timer.mark('after-update-chat', {
      transition: {
        ...transition,
        chatPatch: runtimePatch,
      },
      extra: {
        chatPatchKeys: Object.keys(runtimePatch),
        runtimeDeltaKeys: Object.keys(transition.chatRuntimeDelta),
      },
    });
  } else if (Object.keys(transition.chatPatch).length > 0) {
    timer.mark('before-update-chat', {
      transition,
      extra: {
        chatPatchKeys: Object.keys(transition.chatPatch),
      },
    });
    await chatUpdatePromise;
    timer.mark('after-update-chat', {
      transition,
      extra: {
        chatPatchKeys: Object.keys(transition.chatPatch),
      },
    });
  }
  timer.finish({ transition });
}
