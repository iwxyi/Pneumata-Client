import type { AIModelType } from './settings';

export interface PersonalityParams {
  openness: number;
  extroversion: number;
  agreeableness: number;
  neuroticism: number;
  humor: number;
  creativity: number;
  assertiveness: number;
  empathy: number;
}

export interface CharacterBehaviorParams {
  proactivity: number;
  aggressiveness: number;
  humorIntensity: number;
  empathyLevel: number;
  summarizing: number;
  offTopic: number;
}

export interface CharacterRelationshipPreset {
  characterId: string;
  warmth: number;
  competence: number;
  trust: number;
  threat: number;
  note?: string;
  updatedAt?: number;
}

export interface CharacterMemoryConfig {
  longTerm: string[];
  shortTermSummary: string;
  secrets: string[];
  obsessions: string[];
  tabooTopics: string[];
  userMemories: string[];
}

export interface CharacterInterventionConfig {
  allowSpeakAs: boolean;
  allowDirectorPrompt: boolean;
  allowPrivateThread: boolean;
}

export interface CharacterSpeechProfile {
  catchphrases: string[];
  fillers: string[];
  tabooPhrases: string[];
  preferredOpeners: string[];
  preferredClosers: string[];
  sentenceLengthBias: 'short' | 'mixed' | 'long';
  questionBias: number;
  sarcasmBias: number;
}

export interface CharacterCoreProfile {
  coreDesire?: string;
  coreFear?: string;
  valuePriority?: string[];
  socialMask?: string;
  biases?: string[];
  interactionHabits?: string[];
}

export interface EmotionalState {
  irritation: number;
  affection: number;
  insecurity: number;
  excitement: number;
  embarrassment: number;
}

import type { MemoryItem } from '../services/memoryTypes';

export interface AICharacter {
  id: string;
  name: string;
  avatar: string;
  personality: PersonalityParams;
  personalityDrift?: Partial<PersonalityParams>;
  emotionalState?: EmotionalState;
  coreProfile?: CharacterCoreProfile;
  speechProfile?: CharacterSpeechProfile;
  behavior: CharacterBehaviorParams;
  expertise: string[];
  speakingStyle: string;
  background: string;
  group?: string | null;
  relationships: CharacterRelationshipPreset[];
  memory: CharacterMemoryConfig;
  layeredMemories?: MemoryItem[];
  intervention: CharacterInterventionConfig;
  runtimeTimeline?: Array<{ type: 'memory' | 'relationship' | 'drift'; text: string; createdAt: number }>;
  modelProfileId?: string | null;
  modelProfileIds?: Partial<Record<AIModelType, string | null>>;
  bubbleStyleId?: string | null;
  isPreset: boolean;
  deletedAt?: number | null;
  fieldVersions?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export function normalizeCharacterGroup(value?: string | null) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized ? normalized.slice(0, 40) : null;
}

export function getTopicDerivedCharacterGroup(value?: string | null) {
  return normalizeCharacterGroup(value);
}

export function getCharacterGroupList(characters: AICharacter[]) {
  return Array.from(new Set(characters.map((character) => normalizeCharacterGroup(character.group)).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function isSameCharacterGroup(a?: string | null, b?: string | null) {
  return normalizeCharacterGroup(a) === normalizeCharacterGroup(b);
}

export function isCharacterInGroup(character: AICharacter, group?: string | null) {
  const normalized = normalizeCharacterGroup(group);
  return normalized ? normalizeCharacterGroup(character.group) === normalized : true;
}

export function getCharactersInGroup(characters: AICharacter[], group?: string | null) {
  const normalized = normalizeCharacterGroup(group);
  return normalized ? characters.filter((character) => normalizeCharacterGroup(character.group) === normalized) : characters;
}

export function mergeCharacterGroup(existing: string[], suggested?: string[] | null) {
  return Array.from(new Set([...existing, ...((suggested || []).map((item) => item.trim()).filter(Boolean))]));
}

export function hasCharacterGroup(value?: string | null) {
  return Boolean(normalizeCharacterGroup(value));
}

export function clearCharacterGroup() {
  return null;
}

export function getCharacterGroupLabel(value?: string | null) {
  return normalizeCharacterGroup(value) || '';
}

export function canDeleteCharacterGroup(value?: string | null) {
  return Boolean(normalizeCharacterGroup(value));
}

export function normalizeCharacterGroupsForSelection(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeCharacterGroup(value)).filter(Boolean) as string[]));
}

export function appendCharacterGroup(existing: string[], value?: string | null) {
  const normalized = normalizeCharacterGroup(value);
  return normalized && !existing.includes(normalized) ? [...existing, normalized] : existing;
}

export function isPresetCharacterSelectable(character: AICharacter) {
  return !character.isPreset;
}

export const DEFAULT_PERSONALITY: PersonalityParams = {
  openness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
  humor: 50,
  creativity: 50,
  assertiveness: 50,
  empathy: 50,
};

export const DEFAULT_CHARACTER_BEHAVIOR: CharacterBehaviorParams = {
  proactivity: 50,
  aggressiveness: 50,
  humorIntensity: 50,
  empathyLevel: 50,
  summarizing: 50,
  offTopic: 50,
};

export const DEFAULT_CHARACTER_MEMORY: CharacterMemoryConfig = {
  longTerm: [],
  shortTermSummary: '',
  secrets: [],
  obsessions: [],
  tabooTopics: [],
  userMemories: [],
};

export const DEFAULT_CHARACTER_INTERVENTION: CharacterInterventionConfig = {
  allowSpeakAs: true,
  allowDirectorPrompt: true,
  allowPrivateThread: true,
};

export const DEFAULT_EMOTIONAL_STATE: EmotionalState = {
  irritation: 0,
  affection: 0,
  insecurity: 0,
  excitement: 0,
  embarrassment: 0,
};

export const DEFAULT_CORE_PROFILE: CharacterCoreProfile = {
  coreDesire: '',
  coreFear: '',
  valuePriority: [],
  socialMask: '',
  biases: [],
  interactionHabits: [],
};

export const DEFAULT_SPEECH_PROFILE: CharacterSpeechProfile = {
  catchphrases: [],
  fillers: [],
  tabooPhrases: [],
  preferredOpeners: [],
  preferredClosers: [],
  sentenceLengthBias: 'mixed',
  questionBias: 50,
  sarcasmBias: 50,
};

export const DEFAULT_CHARACTER_MODEL_PROFILE_IDS: Partial<Record<AIModelType, string | null>> = {
  text: null,
  image: null,
  audio: null,
  document: null,
};

export function normalizeCharacterModelProfileIds(input?: Partial<Record<AIModelType, string | null>> | null, legacyTextId?: string | null) {
  return {
    ...DEFAULT_CHARACTER_MODEL_PROFILE_IDS,
    ...(input || {}),
    text: input?.text ?? legacyTextId ?? null,
  } satisfies Partial<Record<AIModelType, string | null>>;
}

export function getCharacterModelProfileId(character: Pick<AICharacter, 'modelProfileIds' | 'modelProfileId'>, type: AIModelType) {
  const profileIds = normalizeCharacterModelProfileIds(character.modelProfileIds, character.modelProfileId);
  return profileIds[type] ?? null;
}

export function normalizeCharacter(input: Partial<AICharacter> & Pick<AICharacter, 'id' | 'name' | 'avatar' | 'personality' | 'expertise' | 'speakingStyle' | 'background' | 'isPreset' | 'createdAt' | 'updatedAt'>): AICharacter {
  return {
    ...input,
    personalityDrift: input.personalityDrift || {},
    emotionalState: {
      ...DEFAULT_EMOTIONAL_STATE,
      ...(input.emotionalState || {}),
    },
    coreProfile: {
      ...DEFAULT_CORE_PROFILE,
      ...(input.coreProfile || {}),
      valuePriority: input.coreProfile?.valuePriority || [],
      biases: input.coreProfile?.biases || [],
      interactionHabits: input.coreProfile?.interactionHabits || [],
    },
    speechProfile: {
      ...DEFAULT_SPEECH_PROFILE,
      ...(input.speechProfile || {}),
      catchphrases: input.speechProfile?.catchphrases || [],
      fillers: input.speechProfile?.fillers || [],
      tabooPhrases: input.speechProfile?.tabooPhrases || [],
      preferredOpeners: input.speechProfile?.preferredOpeners || [],
      preferredClosers: input.speechProfile?.preferredClosers || [],
    },
    behavior: {
      ...DEFAULT_CHARACTER_BEHAVIOR,
      ...(input.behavior || {}),
    },
    group: normalizeCharacterGroup(input.group),
    relationships: input.relationships || [],
    runtimeTimeline: input.runtimeTimeline || [],
    memory: {
      ...DEFAULT_CHARACTER_MEMORY,
      ...(input.memory || {}),
      longTerm: input.memory?.longTerm || [],
      secrets: input.memory?.secrets || [],
      obsessions: input.memory?.obsessions || [],
      tabooTopics: input.memory?.tabooTopics || [],
      userMemories: input.memory?.userMemories || [],
    },
    layeredMemories: input.layeredMemories || [],
    intervention: {
      ...DEFAULT_CHARACTER_INTERVENTION,
      ...(input.intervention || {}),
    },
    modelProfileId: input.modelProfileId || null,
    modelProfileIds: normalizeCharacterModelProfileIds(input.modelProfileIds, input.modelProfileId),
  };
}
