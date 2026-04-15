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
  const recentAiMessages = recentMessages.filter((m) => m.type === 'ai' && !m.isDeleted);
  const lastSpeakerId = recentAiMessages.at(-1)?.senderId;
  const recentSpeakerIds = recentAiMessages.slice(-6).map((m) => m.senderId);
  const recentSpeakCounts = recentSpeakerIds.reduce<Record<string, number>>((acc, speakerId) => {
    acc[speakerId] = (acc[speakerId] || 0) + 1;
    return acc;
  }, {});
  const consecutiveByLastSpeaker = (() => {
    if (!lastSpeakerId) return 0;
    let count = 0;
    for (let i = recentAiMessages.length - 1; i >= 0; i -= 1) {
      if (recentAiMessages[i].senderId !== lastSpeakerId) break;
      count += 1;
    }
    return count;
  })();

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
      const lastSpeak = cooldownMap[char.id];
      if (!lastSpeak) return true;
      return now - lastSpeak >= cooldownDuration;
    })
    .map((char) => {
      const wasLastSpeaker = char.id === lastSpeakerId;
      let weight = (char.personality.extroversion / 100) * 0.45 + 0.25;
      const relevance = calculateTopicRelevance(keywords, char.expertise);
      weight += relevance * 0.2;
      const recentCount = recentSpeakCounts[char.id] || 0;
      weight -= recentCount * 0.42;
      if (wasLastSpeaker) {
        weight *= consecutiveByLastSpeaker >= 3 ? 0.02 : consecutiveByLastSpeaker >= 2 ? 0.06 : 0.18;
      }
      weight += Math.random() * 0.03;

      return {
        characterId: char.id,
        weight: Math.max(0.05, weight),
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
