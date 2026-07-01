import type { SessionGenerationPromptContext } from '../types/sessionEngine';

export type ChatStyleProfile = 'casual_room' | 'discovery_room' | 'analytical_room' | 'companion_room' | 'dramatic_room' | 'task_room';

export interface StyleProfileDefinition {
  key: ChatStyleProfile;
  label: string;
  promptContext: SessionGenerationPromptContext;
}

const styleProfiles = new Map<ChatStyleProfile, StyleProfileDefinition>([
  ['casual_room', {
    key: 'casual_room',
    label: 'Casual room',
    promptContext: {
      additionalConstraints: ['Keep the social flow easy and low-pressure. Do not over-structure ordinary chat.'],
      responseStyle: 'chat',
      allowMarkdown: true,
    },
  }],
  ['discovery_room', {
    key: 'discovery_room',
    label: 'Discovery room',
    promptContext: {
      additionalConstraints: ['Prefer adding materially new examples, angles, or practical discoveries over simply endorsing the latest example.'],
      responseStyle: 'chat',
      allowMarkdown: true,
    },
  }],
  ['analytical_room', {
    key: 'analytical_room',
    label: 'Analytical room',
    promptContext: {
      additionalConstraints: ['Prefer clarifying distinctions, tradeoffs, counterpoints, or synthesis over casual agreement.'],
      responseStyle: 'professional',
      allowMarkdown: true,
    },
  }],
  ['companion_room', {
    key: 'companion_room',
    label: 'Companion room',
    promptContext: {
      additionalConstraints: ['Prioritize emotional acknowledgment, reassurance, and low-pressure companionship before widening the topic.'],
      responseStyle: 'chat',
      allowMarkdown: true,
    },
  }],
  ['dramatic_room', {
    key: 'dramatic_room',
    label: 'Dramatic room',
    promptContext: {
      additionalConstraints: ['Let scene tension, implication, and role-specific friction shape the line more than neutral explanation.'],
      responseStyle: 'creative',
      allowMarkdown: true,
    },
  }],
  ['task_room', {
    key: 'task_room',
    label: 'Task room',
    promptContext: {
      additionalConstraints: ['Answer the actual task directly and completely before adding side banter.'],
      responseStyle: 'professional',
      allowMarkdown: true,
    },
  }],
]);

const scenarioDefaults = new Map<string, ChatStyleProfile>([
  ['open-chat', 'casual_room'],
  ['direct-chat', 'companion_room'],
  ['ai-private-thread', 'companion_room'],
  ['opinion-review', 'analytical_room'],
  ['roundtable-review', 'analytical_room'],
  ['role-debate', 'analytical_room'],
  ['courtroom-deliberation', 'analytical_room'],
  ['expert-review', 'analytical_room'],
  ['public-inquiry', 'analytical_room'],
  ['brainstorm-workshop', 'analytical_room'],
  ['task-retrospective', 'analytical_room'],
  ['panel-interview', 'task_room'],
  ['ielts-coach', 'task_room'],
  ['story-reader', 'dramatic_room'],
  ['werewolf-classic', 'dramatic_room'],
  ['murder-mystery', 'dramatic_room'],
]);

const familyDefaults = new Map<string, ChatStyleProfile>([
  ['conversation', 'casual_room'],
  ['analysis', 'analytical_room'],
  ['interview', 'task_room'],
  ['study', 'task_room'],
  ['deduction', 'dramatic_room'],
  ['mystery', 'dramatic_room'],
  ['simulation', 'dramatic_room'],
]);

export function getStyleProfile(key: ChatStyleProfile | null | undefined) {
  return key ? styleProfiles.get(key) || null : null;
}

export function resolveDefaultStyleProfile(input: { scenarioId?: string; family?: string }) {
  const familyDefault = input.family ? familyDefaults.get(input.family) : undefined;
  const scenarioDefault = input.scenarioId ? scenarioDefaults.get(input.scenarioId) : undefined;
  return (scenarioDefault && (!familyDefault || scenarioDefault === familyDefault || input.family === 'conversation'))
    ? scenarioDefault
    : familyDefault
      || scenarioDefault
      || 'casual_room';
}
