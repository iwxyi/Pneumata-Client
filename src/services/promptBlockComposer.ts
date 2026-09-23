import type { GroupChat } from '../types/chat';
import { resolveSessionFamilyKey } from './sessionEngineKeys';

export type PromptBlockLayer =
  | 'core'
  | 'scene'
  | 'task'
  | 'character'
  | 'social'
  | 'memory'
  | 'runtime'
  | 'style'
  | 'output'
  | 'suffix';

export type PromptPlayModeId =
  | 'analysis_room'
  | 'story_reader'
  | 'direct_private'
  | 'general_group'
  | 'general_chat';

export interface PromptBlock {
  id: string;
  layer: PromptBlockLayer;
  priority: number;
  content: string;
  applies?: boolean;
  conflictsWith?: string[];
}

export interface PromptPlayModePolicy {
  id: PromptPlayModeId;
  disabledBlocks: string[];
  notes: string[];
}

const LAYER_ORDER: Record<PromptBlockLayer, number> = {
  core: 0,
  character: 10,
  memory: 20,
  scene: 30,
  task: 40,
  social: 50,
  runtime: 60,
  style: 70,
  output: 80,
  suffix: 90,
};

export function resolvePromptPlayMode(chat: GroupChat): PromptPlayModePolicy {
  if (chat.sessionKind?.scenarioId === 'story-reader') {
    return {
      id: 'story_reader',
      disabledBlocks: [],
      notes: [
        'Story reader prioritizes committed scene continuation, storyEvents structure, branch consequences, and character dialogue boundaries.',
        'Character personality shapes speech and choices, but never turns the narrator into an ordinary chat participant.',
      ],
    };
  }
  if (resolveSessionFamilyKey(chat) === 'analysis') {
    return {
      id: 'analysis_room',
      disabledBlocks: [
        'humanization',
        'inner_life',
        'expression_feedback',
        'natural_chat_rhythm',
        'current_intent',
        'expression_surface_choice',
        'turn_length_variety',
        'turn_format_variety',
        'response_surface',
      ],
      notes: [
        'Analysis rooms are not ordinary group chat. Deliberation structure, topic progress, and evidence pressure override social alliance pressure.',
        'Character voice may affect wording, but it must not replace the deliberation job.',
        'If the room has drifted into farewell, praise, or poetic continuation, stop extending that thread and either synthesize or state that no new deliberation point follows.',
      ],
    };
  }
  if (chat.type === 'direct' || chat.type === 'ai_direct') {
    return {
      id: 'direct_private',
      disabledBlocks: [],
      notes: [
        'Direct rooms prioritize the current user or private counterpart request before ambient banter.',
        'Companionship and relationship memory shape care, restraint, and wording; they must not override a concrete task.',
      ],
    };
  }
  if (chat.type === 'group') {
    if (resolveSessionFamilyKey(chat) === 'conversation') {
      return {
        id: 'general_group',
        // Ordinary group chat uses the hybrid prompt architecture: full fact
        // blocks remain, but scattered behavior/style/runtime blocks are
        // replaced by the single Turn Directive. Do not apply this to direct
        // companionship or scenario engines.
        disabledBlocks: [
          'humanization',
          'current_intent',
          'conversation_move',
          'expression_surface_choice',
          'turn_length_variety',
          'turn_format_variety',
          'response_surface',
          'runtime_role_constraint',
          'focused_situational_job_contract',
          'natural_chat_surface_contract',
        ],
        notes: [
          'General group rooms keep social momentum, relationships, and room pressure available.',
          'Ordinary group turns use one Turn Directive for this turn’s social job, emotion, relationship stance, and expression shape.',
        ],
      };
    }
    return {
      id: 'general_group',
      disabledBlocks: [],
      notes: ['General group rooms keep social momentum, relationships, and room pressure available.'],
    };
  }
  return {
    id: 'general_chat',
    disabledBlocks: [],
    notes: ['Default chat mode keeps broad conversational behavior available.'],
  };
}

export function buildPromptPlayModeBlock(policy: PromptPlayModePolicy): PromptBlock {
  return {
    id: 'prompt_play_mode',
    layer: 'scene',
    priority: -10,
    content: `\n## Prompt Play Mode\n- Mode: ${policy.id}\n${policy.notes.map((note) => `- ${note}`).join('\n')}`,
    applies: policy.notes.length > 0,
  };
}

export function composePromptBlocks(blocks: PromptBlock[], policy: PromptPlayModePolicy): string {
  const disabled = new Set(policy.disabledBlocks);
  const accepted = new Map<string, PromptBlock>();
  const ordered = blocks
    .filter((block) => block.applies !== false)
    .filter((block) => block.content.trim().length > 0)
    .sort((left, right) => {
      const layerDelta = LAYER_ORDER[left.layer] - LAYER_ORDER[right.layer];
      if (layerDelta !== 0) return layerDelta;
      const priorityDelta = left.priority - right.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return left.id.localeCompare(right.id);
    });

  for (const block of ordered) {
    if (disabled.has(block.id)) continue;
    if (block.conflictsWith?.some((id) => accepted.has(id))) continue;
    accepted.set(block.id, block);
  }

  return Array.from(accepted.values()).map((block) => block.content).join('');
}
