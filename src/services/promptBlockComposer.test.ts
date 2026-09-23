import { describe, expect, it } from 'vitest';
import type { GroupChat } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { buildPromptPlayModeBlock, composePromptBlocks, resolvePromptPlayMode, type PromptBlock } from './promptBlockComposer';

function chat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '群聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: [],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    sourceChatId: null,
    sourceMemberIds: [],
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  };
}

describe('promptBlockComposer', () => {
  it('orders blocks by layer before local priority', () => {
    const blocks: PromptBlock[] = [
      { id: 'output', layer: 'output', priority: 0, content: '[output]' },
      { id: 'task', layer: 'task', priority: 0, content: '[task]' },
      { id: 'character', layer: 'character', priority: 0, content: '[character]' },
      { id: 'core', layer: 'core', priority: 0, content: '[core]' },
      { id: 'scene', layer: 'scene', priority: 0, content: '[scene]' },
    ];

    expect(composePromptBlocks(blocks, resolvePromptPlayMode(chat()))).toBe('[core][character][scene][task][output]');
  });

  it('disables blocks through play mode policy without changing callers', () => {
    const policy = resolvePromptPlayMode(chat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
    }));
    const prompt = composePromptBlocks([
      { id: 'core', layer: 'core', priority: 0, content: '[core]' },
      { id: 'humanization', layer: 'character', priority: 0, content: '[humanization]' },
      { id: 'inner_life', layer: 'character', priority: 1, content: '[inner life]' },
      { id: 'current_intent', layer: 'task', priority: 0, content: '[intent]' },
      { id: 'natural_chat_rhythm', layer: 'style', priority: 0, content: '[chat rhythm]' },
      { id: 'response_surface', layer: 'style', priority: 1, content: '[surface]' },
    ], policy);

    expect(policy.id).toBe('analysis_room');
    expect(prompt).toBe('[core]');
  });

  it('uses the unified directive with only the compact group-presence delivery inputs', () => {
    const policy = resolvePromptPlayMode(chat());
    const prompt = composePromptBlocks([
      { id: 'core', layer: 'core', priority: 0, content: '[core]' },
      { id: 'turn_directive', layer: 'task', priority: 0, content: '[directive]' },
      { id: 'humanization', layer: 'character', priority: 0, content: '[humanization]' },
      { id: 'inner_life', layer: 'character', priority: 1, content: '[inner life]' },
      { id: 'natural_chat_rhythm', layer: 'style', priority: 0, content: '[chat rhythm]' },
      { id: 'current_intent', layer: 'task', priority: 0, content: '[intent]' },
      { id: 'conversation_move', layer: 'task', priority: 1, content: '[move]' },
      { id: 'response_surface', layer: 'style', priority: 2, content: '[surface]' },
      { id: 'turn_plan', layer: 'runtime', priority: 0, content: '[turn plan]' },
      { id: 'focused_situational_job_contract', layer: 'output', priority: 0, content: '[focused job]' },
      { id: 'natural_chat_surface_contract', layer: 'output', priority: 1, content: '[natural surface]' },
    ], policy);

    expect(policy.id).toBe('general_group');
    expect(prompt).toBe('[core][inner life][directive][turn plan][chat rhythm]');
  });

  it('does not disable scenario group blocks outside ordinary conversation rooms', () => {
    const policy = resolvePromptPlayMode(chat({
      mode: 'werewolf',
      sessionKind: { topology: 'group', family: 'deduction', scenarioId: 'werewolf-classic', surfaceProfile: 'hybrid' },
    }));
    const prompt = composePromptBlocks([
      { id: 'core', layer: 'core', priority: 0, content: '[core]' },
      { id: 'natural_chat_rhythm', layer: 'style', priority: 0, content: '[chat rhythm]' },
      { id: 'conversation_move', layer: 'task', priority: 1, content: '[move]' },
    ], policy);

    expect(policy.id).toBe('general_group');
    expect(prompt).toBe('[core][move][chat rhythm]');
  });

  it('selects story-reader play mode from the session scenario', () => {
    const policy = resolvePromptPlayMode(chat({
      sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    }));

    expect(policy.id).toBe('story_reader');
    expect(policy.notes.join(' ')).toContain('committed scene continuation');
  });

  it('selects direct-private play mode for user and AI private rooms', () => {
    expect(resolvePromptPlayMode(chat({ type: 'direct' })).id).toBe('direct_private');
    expect(resolvePromptPlayMode(chat({ type: 'ai_direct' })).id).toBe('direct_private');
  });

  it('skips lower-priority blocks that conflict with accepted blocks', () => {
    const prompt = composePromptBlocks([
      { id: 'scene_task', layer: 'task', priority: 0, content: '[scene]' },
      { id: 'social_task', layer: 'task', priority: 10, content: '[social]', conflictsWith: ['scene_task'] },
    ], resolvePromptPlayMode(chat()));

    expect(prompt).toBe('[scene]');
  });

  it('renders a play-mode arbitration block', () => {
    const block = buildPromptPlayModeBlock(resolvePromptPlayMode(chat({
      sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
    })));

    expect(block.content).toContain('Mode: analysis_room');
    expect(block.content).toContain('not ordinary group chat');
  });
});
