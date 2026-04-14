import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { extractKeywords, calculateTopicRelevance } from './topicExtractor';

export interface WeightedCandidate {
  characterId: string;
  weight: number;
}

export const calculateWeights = (
  characters: AICharacter[],
  recentMessages: Message[],
  cooldownMap: Record<string, number>,
  speed: number,
  baseCooldownMs: number
): WeightedCandidate[] => {
  const now = Date.now();
  const cooldownDuration = baseCooldownMs / speed;

  // Extract keywords from recent messages
  const recentText = recentMessages
    .slice(-5)
    .map((m) => m.content)
    .join(' ');
  const keywords = extractKeywords(recentText);

  return characters
    .filter((char) => {
      // Filter out characters still on cooldown
      const lastSpeak = cooldownMap[char.id];
      if (!lastSpeak) return true;
      return now - lastSpeak >= cooldownDuration;
    })
    .map((char) => {
      // Base weight from extroversion
      let weight = (char.personality.extroversion / 100) * 0.6 + 0.2;

      // Topic relevance bonus
      const relevance = calculateTopicRelevance(keywords, char.expertise);
      weight += relevance * 0.3;

      // Random factor for variety
      weight += Math.random() * 0.2;

      return {
        characterId: char.id,
        weight: Math.max(0.1, weight),
      };
    });
};

export const selectSpeaker = (candidates: WeightedCandidate[]): string | null => {
  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  for (const candidate of candidates) {
    random -= candidate.weight;
    if (random <= 0) {
      return candidate.characterId;
    }
  }

  return candidates[candidates.length - 1].characterId;
};
