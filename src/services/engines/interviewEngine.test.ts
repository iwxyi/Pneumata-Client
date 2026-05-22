import { describe, expect, it } from 'vitest';
import { INTERVIEW_ENGINE } from './interviewEngine';
import { normalizeConversation } from '../../types/chat';
import type { AICharacter } from '../../types/character';

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'interview',
    modeConfig: {} as never,
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '面试',
    topic: '招聘',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['host', 'candidate-a', 'candidate-b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: false, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildCharacter(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

describe('INTERVIEW_ENGINE', () => {
  it('builds interviewer and candidate participant roles', () => {
    const participants = INTERVIEW_ENGINE.buildParticipants(buildChat());
    expect(participants[0]?.flags.role).toBe('interviewer');
    expect(participants[1]?.flags.role).toBe('candidate');
    expect(participants[2]?.flags.role).toBe('candidate');
  });

  it('exposes interview action schema with candidate-only ask target options', () => {
    const chat = buildChat();
    const schema = INTERVIEW_ENGINE.getActionSchema?.({ conversation: chat, participants: INTERVIEW_ENGINE.buildParticipants(chat) });
    expect(schema?.actions.map((action) => action.type)).toEqual(['ask_question', 'director_intervention']);
    const askQuestion = schema?.actions.find((action) => action.type === 'ask_question');
    const targetField = askQuestion?.fields?.find((field) => field.key === 'targetId');
    expect(targetField?.options?.map((option) => option.value)).toEqual(['candidate-a', 'candidate-b']);
    const director = schema?.actions.find((action) => action.type === 'director_intervention');
    expect(director?.fields?.map((field) => field.key)).toEqual(['intent', 'targetId', 'maxTurns', 'prompt']);
    expect(director?.fields?.find((field) => field.key === 'intent')?.options?.map((option) => option.value)).toContain('force_reply');
  });

  it('resolves turn policy by interview phase', () => {
    const idle = INTERVIEW_ENGINE.resolveTurnPolicy?.({ conversation: buildChat(), characters: [], messages: [] });
    const debating = INTERVIEW_ENGINE.resolveTurnPolicy?.({ conversation: normalizeConversation({ ...buildChat(), worldState: { ...buildChat().worldState, phase: 'debating' } }), characters: [], messages: [] });
    const aligned = INTERVIEW_ENGINE.resolveTurnPolicy?.({ conversation: normalizeConversation({ ...buildChat(), worldState: { ...buildChat().worldState, phase: 'aligned' } }), characters: [], messages: [] });
    expect(idle).toEqual({ runChat: false, runAction: true, interleaveAction: false });
    expect(debating).toEqual({ runChat: true, runAction: false, interleaveAction: true });
    expect(aligned).toEqual({ runChat: true, runAction: true, interleaveAction: false });
  });

  it('builds interviewer prompt context', () => {
    const chat = buildChat();
    const context = INTERVIEW_ENGINE.buildGenerationPromptContext?.({ conversation: chat, characters: [], messages: [], speaker: buildCharacter('host', '面试官') });
    expect(context?.promptPrefix).toContain('structured interview');
    expect(context?.additionalConstraints?.[0]).toContain('high-signal question');
  });

  it('builds candidate prompt context', () => {
    const chat = buildChat();
    const context = INTERVIEW_ENGINE.buildGenerationPromptContext?.({ conversation: chat, characters: [], messages: [], speaker: buildCharacter('candidate-a', '候选人甲') });
    expect(context?.promptPrefix).toContain('replying inside a structured interview');
    expect(context?.responseStyle).toBe('professional');
    expect(context?.allowMarkdown).toBe(true);
    expect(context?.additionalConstraints?.[0]).toContain('do not artificially shorten');
  });

  it('commits interviewer turns into moderator-only structured events and debating phase', async () => {
    const chat = buildChat();
    const result = await INTERVIEW_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('host', '面试官'), buildCharacter('candidate-a', '候选人甲')],
      message: { type: 'ai', senderId: 'host', content: '请你用一分钟介绍一下你主导过的复杂项目。' },
      previousAiMessage: null,
    });
    expect(result.chatPatch.worldState?.phase).toBe('debating');
    expect(result.chatPatch.worldState?.recentEvent).toContain('面试提问');
    expect(result.chatPatch.worldState?.focus).toBe('推进问答');
    expect(result.runtimeEvents[0]?.eventType).toBe('interview_turn');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect(runtimeEvents).toHaveLength(2);
    expect(runtimeEvents.every((event) => event.visibility === 'moderator_only')).toBe(true);
    expect(runtimeEvents.every((event) => event.visibleToRoles?.includes('interviewer'))).toBe(true);
    expect((runtimeEvents[0]?.payload as { speakerRole?: string; round?: number; stageLabel?: string }).speakerRole).toBe('interviewer');
    expect((runtimeEvents[0]?.payload as { speakerRole?: string; round?: number; stageLabel?: string }).round).toBe(1);
    expect((runtimeEvents[0]?.payload as { speakerRole?: string; round?: number; stageLabel?: string }).stageLabel).toBe('question');
  });

  it('marks interviewer follow-ups as follow_up stage', async () => {
    const chat = normalizeConversation({
      ...buildChat(),
      worldState: { ...buildChat().worldState, phase: 'debating' },
      runtimeEventsV2: [{
        id: 'evt-prev-question',
        conversationId: 'chat-1',
        kind: 'message_generated',
        createdAt: 1,
        actorIds: ['host'],
        summary: '先介绍一下项目。',
        visibility: 'moderator_only',
        visibleToRoles: ['interviewer'],
        payload: { text: '先介绍一下项目。', speakerRole: 'interviewer', round: 1, stageLabel: 'question' },
      }],
    });
    const result = await INTERVIEW_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('host', '面试官')],
      message: { type: 'ai', senderId: 'host', content: '你再具体说说当时为什么这么拆？' },
      previousAiMessage: { senderId: 'candidate-a' },
    });
    expect(result.chatPatch.worldState?.recentEvent).toContain('面试追问');
    expect(result.chatPatch.worldState?.focus).toBe('深挖细节');
    expect(result.runtimeEvents[0]?.eventType).toBe('interview_follow_up');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect((runtimeEvents.at(-2)?.payload as { round?: number; stageLabel?: string }).round).toBe(2);
    expect((runtimeEvents.at(-2)?.payload as { round?: number; stageLabel?: string }).stageLabel).toBe('follow_up');
    expect(runtimeEvents.at(-1)?.summary).toContain('面试追问推进');
  });

  it('commits candidate turns into aligned phase with interview answer runtime markers', async () => {
    const chat = normalizeConversation({ ...buildChat(), worldState: { ...buildChat().worldState, phase: 'debating' } });
    const result = await INTERVIEW_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('host', '面试官'), buildCharacter('candidate-a', '候选人甲')],
      message: { type: 'ai', senderId: 'candidate-a', content: '我主导过一次支付链路拆分，核心是先做灰度切流。' },
      previousAiMessage: { senderId: 'host' },
    });
    expect(result.chatPatch.worldState?.phase).toBe('aligned');
    expect(result.chatPatch.worldState?.recentEvent).toContain('候选人作答');
    expect(result.chatPatch.worldState?.mood).toBe('focused');
    expect(result.chatPatch.worldState?.focus).toBe('回答当前问题');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect((runtimeEvents[0]?.payload as { speakerRole?: string; stageLabel?: string }).speakerRole).toBe('candidate');
    expect((runtimeEvents[0]?.payload as { speakerRole?: string; stageLabel?: string }).stageLabel).toBe('answer');
    expect(runtimeEvents[1]?.summary).toContain('候选人回答推进');
    expect(result.runtimeEvents[0]?.eventType).toBe('interview_answer');
  });

  it('commits candidate turns into aligned phase with interview answer runtime markers', async () => {
    const chat = normalizeConversation({ ...buildChat(), worldState: { ...buildChat().worldState, phase: 'debating' } });
    const result = await INTERVIEW_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('host', '面试官'), buildCharacter('candidate-a', '候选人甲')],
      message: { type: 'ai', senderId: 'candidate-a', content: '我主导过一次支付链路拆分，核心是先做灰度切流。' },
      previousAiMessage: { senderId: 'host' },
    });
    expect(result.chatPatch.worldState?.phase).toBe('aligned');
    expect(result.chatPatch.worldState?.recentEvent).toContain('候选人作答');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect((runtimeEvents[0]?.payload as { speakerRole?: string }).speakerRole).toBe('candidate');
    expect(runtimeEvents[1]?.summary).toContain('候选人回答推进');
  });

  it('commits candidate turns into aligned phase with interview answer runtime markers', async () => {
    const chat = normalizeConversation({ ...buildChat(), worldState: { ...buildChat().worldState, phase: 'debating' } });
    const result = await INTERVIEW_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('host', '面试官'), buildCharacter('candidate-a', '候选人甲')],
      message: { type: 'ai', senderId: 'candidate-a', content: '我主导过一次支付链路拆分，核心是先做灰度切流。' },
      previousAiMessage: { senderId: 'host' },
    });
    expect(result.chatPatch.worldState?.phase).toBe('aligned');
    expect(result.chatPatch.worldState?.recentEvent).toContain('候选人作答');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect((runtimeEvents[0]?.payload as { speakerRole?: string }).speakerRole).toBe('candidate');
    expect(runtimeEvents[1]?.summary).toContain('候选人回答推进');
  });
});
