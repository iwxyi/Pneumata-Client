export interface CandidateInfo {
  characterId: string;
  weight: number;
  cooldownEndsAt: number;
  topicRelevance: number;
}

export interface SchedulerState {
  isRunning: boolean;
  isPaused: boolean;
  currentSpeakerId: string | null;
  candidates: CandidateInfo[];
  lastSpeakTimestamps: Record<string, number>;
  baseCooldownMs: number;
}
