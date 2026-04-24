export interface ParticipantRoleCard {
  key: string;
  title: string;
  summary: string;
  details?: string[];
  tags?: string[];
}

export interface ParticipantPrivateState {
  roleCard?: ParticipantRoleCard | null;
  hiddenFacts?: Array<{ key: string; text: string }>;
  hand?: Array<{ key: string; title: string; text?: string }>;
  notes?: string[];
}

export interface ParticipantPublicState {
  title?: string;
  factionHint?: string | null;
  revealedFacts?: Array<{ key: string; text: string }>;
}
