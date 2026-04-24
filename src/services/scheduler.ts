import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { extractKeywords, calculateTopicRelevance } from './topicExtractor';
import { getRelationshipWeight } from './relationshipEngine';
import { applyDriftToBehavior } from './personalityDrift';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getEmotionalMomentum(character: AICharacter) {
  const emotional = character.emotionalState;
  if (!emotional) return 0;

  const positiveDrive = emotional.excitement * 0.008 + emotional.affection * 0.004;
  const tensionDrive = emotional.irritation * 0.006 + emotional.insecurity * 0.004;
  const inhibition = emotional.embarrassment * 0.007;
  return clamp(positiveDrive + tensionDrive - inhibition, -0.18, 0.26);
}

function getEmotionalReplyBias(character: AICharacter, lastSpeakerId?: string) {
  if (!lastSpeakerId) return 0;
  const relationWeight = getRelationshipWeight(character, lastSpeakerId);
  const emotional = character.emotionalState;
  if (!emotional) return relationWeight > 0 ? relationWeight * 0.08 : Math.abs(relationWeight) * 0.1;

  const irritationBias = emotional.irritation > 55 ? Math.max(0, -relationWeight) * 0.14 : 0;
  const affectionBias = emotional.affection > 45 ? Math.max(0, relationWeight) * 0.12 : 0;
  const insecurityPenalty = emotional.insecurity > 65 && relationWeight < 0 ? -0.08 : 0;

  return (relationWeight > 0 ? relationWeight * 0.08 : Math.abs(relationWeight) * 0.1) + irritationBias + affectionBias + insecurityPenalty;
}

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
      const runtimeBehavior = applyDriftToBehavior(char);
      const wasLastSpeaker = char.id === lastSpeakerId;
      let weight = (char.personality.extroversion / 100) * 0.32 + (runtimeBehavior.proactivity / 100) * 0.22 + 0.25;
      const relevance = calculateTopicRelevance(keywords, char.expertise);
      weight += relevance * 0.2;
      weight += getEmotionalMomentum(char);
      const recentCount = recentSpeakCounts[char.id] || 0;
      weight -= recentCount * 0.5;
      if (recentCount === 0) weight += 0.06;
      if (recentCount >= 2) weight -= 0.12;
      const lastAiMessage = recentAiMessages.at(-1);
      if (lastAiMessage && lastAiMessage.senderId !== char.id) {
        weight += getEmotionalReplyBias(char, lastAiMessage.senderId);
        const relationWeight = getRelationshipWeight(char, lastAiMessage.senderId);
        const repliedRecentlyToSameSpeaker = recentAiMessages.slice(-4, -1).some((message) => message.senderId === char.id) && recentAiMessages.slice(-4, -1).some((message) => message.senderId === lastAiMessage.senderId);
        if (repliedRecentlyToSameSpeaker) weight += 0.1;
        if (Math.abs(relationWeight) >= 0.2) {
          weight += relationWeight > 0 ? 0.12 : 0.16;
        }
        const directCue = lastAiMessage.content.includes(char.name) || /你|你这|不是吧|等等|可问题是|那你|你咋|你是不是|你先别/.test(lastAiMessage.content);
        if (directCue) weight += 0.28;
        if (lastAiMessage.content.length <= 18) weight += 0.08;
        if (lastAiMessage.content.length >= 90) weight -= 0.1;
      }
      if (runtimeBehavior.proactivity >= 65 && recentAiMessages.length > 0) {
        const latestContentLength = recentAiMessages[recentAiMessages.length - 1]?.content.length || 0;
        if (latestContentLength > 60) {
          weight += 0.08;
        }
      }
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
