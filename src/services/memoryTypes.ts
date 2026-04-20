export type MemoryLayer = 'working' | 'episodic' | 'long_term';
export type MemoryScope = 'conversation' | 'character_self' | 'relationship' | 'thread' | 'system_runtime';
export type MemoryKind = 'decision' | 'conflict' | 'bond' | 'resentment' | 'status_shift' | 'trait_evidence' | 'bias' | 'taboo' | 'obsession' | 'artifact' | 'thread_effect';

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
  salience: number;
  confidence: number;
  recency: number;
  reinforcementCount: number;
  sourceEventIds: string[];
  createdAt: number;
  updatedAt: number;
  lastActivatedAt?: number | null;
  archivedAt?: number | null;
}

export interface MemoryCandidate {
  scope: MemoryScope;
  layerHint: MemoryLayer;
  kind: MemoryKind;
  ownerId: string;
  subjectIds?: string[];
  text: string;
  sourceEventIds: string[];
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
}
