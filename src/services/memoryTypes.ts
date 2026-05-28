export type MemoryLayer = 'working' | 'episodic' | 'long_term';
export type MemoryScope = 'conversation' | 'character_self' | 'relationship' | 'thread' | 'system_runtime';
export type MemoryKind = 'decision' | 'conflict' | 'bond' | 'resentment' | 'status_shift' | 'trait_evidence' | 'bias' | 'taboo' | 'obsession' | 'artifact' | 'thread_effect';

export type MemoryOrigin = 'runtime' | 'distilled' | 'seeded';
export type MemoryDecision = 'create' | 'reinforce' | 'revise' | 'merge' | 'archive' | 'ignore';

export interface MemoryEvidenceEntry {
  id?: string;
  text: string;
  sourceEventIds?: string[];
  sourceTag?: string | null;
  origin?: MemoryOrigin;
  memoryText?: string;
  weight?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  layer: MemoryLayer;
  kind: MemoryKind;
  ownerId: string;
  subjectIds?: string[];
  relatedConversationId?: string | null;
  text: string;
  summary?: string;
  evidenceText?: string;
  evidenceTrail?: MemoryEvidenceEntry[];
  salience: number;
  confidence: number;
  recency: number;
  reinforcementCount: number;
  sourceEventIds: string[];
  sourceTag?: string | null;
  origin?: MemoryOrigin;
  distilledFromIds?: string[];
  distilledAt?: number | null;
  distillationVersion?: string | null;
  createdAt: number;
  updatedAt: number;
  lastActivatedAt?: number | null;
  archivedAt?: number | null;
  recallScore?: number;
  recallCue?: string;
  recallReason?: string;
  recallTokens?: string[];
}

export interface MemoryCandidate {
  scope: MemoryScope;
  layerHint: MemoryLayer;
  kind: MemoryKind;
  ownerId: string;
  subjectIds?: string[];
  text: string;
  evidenceText?: string;
  sourceEventIds: string[];
  sourceTag?: string;
  origin?: MemoryOrigin;
  decision?: MemoryDecision;
  distilledFromIds?: string[];
  distilledAt?: number | null;
  distillationVersion?: string | null;
  scoreBreakdown: {
    stability: number;
    recurrence: number;
    impact: number;
    specificity: number;
    durability: number;
  };
}

export interface MemoryRetrievalContext {
  speakerId: string;
  targetId?: string | null;
  conversationId: string;
  maxItems: number;
  cueText?: string;
  includeArchivedRecall?: boolean;
  maxArchivedItems?: number;
  preferredLayers?: MemoryLayer[];
  preferredScopes?: MemoryScope[];
  preferredSourceTags?: string[];
  allowedSourceTags?: string[];
  blockedSourceTags?: string[];
  includeRuntimeEvidence?: boolean;
  relationshipBoost?: boolean;
  selfMemoryBoost?: boolean;
  conversationBoost?: boolean;
}
