import { describe, expect, it } from 'vitest';
import { normalizeConversation, type GroupChat } from '../types/chat';
import {
  canUseDirectorIntervention,
  canUseMute,
  canUsePrivateThreads,
  isAutoRunnableSessionAction,
  resolveConversationCapabilities,
  resolveRoomTemplateCapabilityDefaults,
} from './conversationCapabilities';
import { getRoomTemplate } from './roomTemplates';

function buildChat(patch: Partial<GroupChat> = {}) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  });
}

describe('conversation capability resolver', () => {
  it('resolves existing governance, mode and director fields into a capability profile', () => {
    const chat = buildChat();
    expect(resolveConversationCapabilities(chat)).toMatchObject({
      muteMembers: true,
      privateThreads: true,
      directorIntervention: true,
      speakAs: true,
      eventInjection: true,
      forcedReply: true,
      roleActions: true,
    });
  });

  it('keeps old field semantics when features are disabled', () => {
    const chat = buildChat({
      modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: false, showRoleActions: false },
      governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: false, allowPrivateThreads: false },
      directorControls: { allowSpeakAs: false, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    });

    expect(canUseMute(chat)).toBe(false);
    expect(canUsePrivateThreads(chat)).toBe(false);
    expect(canUseDirectorIntervention(chat)).toBe(false);
    expect(resolveConversationCapabilities(chat)).toMatchObject({
      speakAs: false,
      eventInjection: false,
      forcedReply: false,
      roleActions: false,
    });
  });

  it('treats governance actions as manual unless explicitly marked autoRun', () => {
    expect(isAutoRunnableSessionAction({ type: 'mute_member', visibility: 'moderator_only' })).toBe(false);
    expect(isAutoRunnableSessionAction({ type: 'unmute_member' })).toBe(false);
    expect(isAutoRunnableSessionAction({ type: 'start_private_thread' })).toBe(false);
    expect(isAutoRunnableSessionAction({ type: 'assign_study_task' })).toBe(true);
    expect(isAutoRunnableSessionAction({ type: 'mute_member', autoRun: true })).toBe(true);
    expect(isAutoRunnableSessionAction({ type: 'assign_study_task', autoRun: false })).toBe(false);
  });

  it('keeps schema actions with unsatisfied required fields manual by default', () => {
    expect(isAutoRunnableSessionAction({
      type: 'assign_study_task',
      fields: [{ key: 'task', label: '任务内容', type: 'textarea', required: true }],
    })).toBe(false);
    expect(isAutoRunnableSessionAction({
      type: 'ask_question',
      targetIds: ['a'],
      payload: { prompt: '请说明你的判断', round: 1 },
      fields: [
        { key: 'targetId', label: '对象', type: 'single_select', required: true },
        { key: 'round', label: '轮次', type: 'number', required: true },
        { key: 'prompt', label: '问题', type: 'textarea', required: true },
      ],
    })).toBe(true);
  });

  it('derives template capability defaults without mutating stored room schema', () => {
    expect(resolveRoomTemplateCapabilityDefaults(getRoomTemplate('open_chat'), { showRoleActions: true })).toMatchObject({
      showRoleActions: true,
      allowMute: true,
      allowPrivateThreads: true,
      allowCliques: true,
      allowMockery: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });
    expect(resolveRoomTemplateCapabilityDefaults(getRoomTemplate('story_reader'), { showRoleActions: true })).toMatchObject({
      showRoleActions: false,
      allowMute: true,
      allowPrivateThreads: false,
      allowEventInjection: true,
      allowForcedReply: true,
    });
    expect(resolveRoomTemplateCapabilityDefaults(getRoomTemplate('roundtable_discussion'), { showRoleActions: true })).toMatchObject({
      allowPrivateThreads: false,
      allowCliques: false,
      allowMockery: false,
    });
  });
});
