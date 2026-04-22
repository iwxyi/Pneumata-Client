import { DEFAULT_RUNTIME_EVOLUTION_INTENSITY, type RuntimeEvolutionIntensity } from '../types/chat';

export interface RuntimeEvolutionConfig {
  key: RuntimeEvolutionIntensity;
  label: string;
  relationshipMultiplier: number;
  reciprocalRelationshipMultiplier: number;
  emotionMultiplier: number;
  emotionDecayBias: number;
  driftMultiplier: number;
  worldMultiplier: number;
  memoryMultiplier: number;
  maxNotes: number;
  maxArtifacts: number;
  maxTimeline: number;
}

export const RUNTIME_EVOLUTION_PRESETS: Record<RuntimeEvolutionIntensity, RuntimeEvolutionConfig> = {
  slow: {
    key: 'slow',
    label: '慢',
    relationshipMultiplier: 0.65,
    reciprocalRelationshipMultiplier: 0.35,
    emotionMultiplier: 0.65,
    emotionDecayBias: 1.12,
    driftMultiplier: 0.6,
    worldMultiplier: 0.75,
    memoryMultiplier: 0.8,
    maxNotes: 10,
    maxArtifacts: 6,
    maxTimeline: 16,
  },
  balanced: {
    key: 'balanced',
    label: '平衡',
    relationshipMultiplier: 1,
    reciprocalRelationshipMultiplier: 0.55,
    emotionMultiplier: 1,
    emotionDecayBias: 1,
    driftMultiplier: 1,
    worldMultiplier: 1,
    memoryMultiplier: 1,
    maxNotes: 12,
    maxArtifacts: 8,
    maxTimeline: 20,
  },
  fast: {
    key: 'fast',
    label: '快',
    relationshipMultiplier: 1.75,
    reciprocalRelationshipMultiplier: 1,
    emotionMultiplier: 1.5,
    emotionDecayBias: 0.84,
    driftMultiplier: 1.45,
    worldMultiplier: 1.4,
    memoryMultiplier: 1.35,
    maxNotes: 16,
    maxArtifacts: 10,
    maxTimeline: 28,
  },
};

export function resolveRuntimeEvolutionConfig(intensity?: RuntimeEvolutionIntensity | null): RuntimeEvolutionConfig {
  return RUNTIME_EVOLUTION_PRESETS[intensity || DEFAULT_RUNTIME_EVOLUTION_INTENSITY] || RUNTIME_EVOLUTION_PRESETS[DEFAULT_RUNTIME_EVOLUTION_INTENSITY];
}

export function getRuntimeEvolutionLabel(intensity?: RuntimeEvolutionIntensity | null) {
  return resolveRuntimeEvolutionConfig(intensity).label;
}
