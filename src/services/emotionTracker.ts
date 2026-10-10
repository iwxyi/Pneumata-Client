import type { InteractionEventPayload, ModelImmediateImpact } from '../types/runtimeEvent';

export const updateEmotion = (
  currentEmotion: number,
  messageEmotion: number,
  decay: number = 0.7,
): number => {
  const newEmotion = currentEmotion * decay + messageEmotion * (1 - decay);
  return Math.max(-1, Math.min(1, newEmotion));
};

const EMOTION_AXIS_POLARITY = {
  irritation: -1,
  affection: 1,
  insecurity: -1,
  excitement: 1,
  embarrassment: -1,
} as const;

type EmotionDelta = NonNullable<ModelImmediateImpact['speakerEmotionDelta']>;

export const collectModelEmotionDeltas = (
  speakerId: string,
  interactions: InteractionEventPayload[],
  incomingEmotionDelta?: ModelImmediateImpact['targetEmotionDelta'],
): Map<string, EmotionDelta> => {
  const updates = new Map<string, EmotionDelta>();
  const speakerDelta: EmotionDelta = { ...(incomingEmotionDelta || {}) };
  for (const interaction of interactions) {
    for (const [axis, value] of Object.entries(interaction.immediateImpact?.speakerEmotionDelta || {})) {
      const key = axis as keyof EmotionDelta;
      speakerDelta[key] = (speakerDelta[key] || 0) + value;
    }
    if (!interaction.targetId || !interaction.immediateImpact?.targetEmotionDelta) continue;
    const targetDelta = updates.get(interaction.targetId) || {};
    for (const [axis, value] of Object.entries(interaction.immediateImpact.targetEmotionDelta)) {
      const key = axis as keyof EmotionDelta;
      targetDelta[key] = (targetDelta[key] || 0) + value;
    }
    updates.set(interaction.targetId, targetDelta);
  }
  if (Object.keys(speakerDelta).length) updates.set(speakerId, speakerDelta);
  return updates;
};

/** Projects explicit model-authored affect changes onto the legacy scalar mood value. */
export const updateEmotionFromModelDelta = (
  currentEmotion: number,
  delta?: EmotionDelta,
  decay = 0.7,
): number => {
  const entries = Object.entries(EMOTION_AXIS_POLARITY).flatMap(([axis, polarity]) => {
    const value = delta?.[axis as keyof EmotionDelta];
    return typeof value === 'number' && Number.isFinite(value) && value !== 0
      ? [value * polarity]
      : [];
  });
  if (!entries.length) return currentEmotion;

  const score = Math.max(-1, Math.min(1, entries.reduce((total, entry) => total + entry, 0) / 40));
  return updateEmotion(currentEmotion, score, decay);
};
