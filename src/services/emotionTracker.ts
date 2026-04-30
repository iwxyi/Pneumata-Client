// Simple emotion tracking for MVP
// Values range from -1 (very negative) to 1 (very positive)

const POSITIVE_WORDS = new Set([
  'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic',
  'love', 'like', 'agree', 'yes', 'happy', 'brilliant', 'awesome',
  'interesting', 'perfect', 'nice', 'thank', 'thanks', 'beautiful',
  '好', '棒', '赞', '对', '喜欢', '同意', '优秀', '精彩', '厉害',
  '开心', '高兴', '有趣', '感谢', '谢谢', '不错', '完美', '妙',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'hate', 'disagree', 'no', 'wrong',
  'stupid', 'boring', 'annoying', 'frustrated', 'angry', 'sad',
  'horrible', 'worst', 'never', 'impossible', 'fail', 'ugly',
  '差', '糟', '烂', '不', '错', '讨厌', '反对', '无聊', '生气',
  '难过', '失败', '垃圾', '废', '恶心', '蠢', '笨',
]);

export const analyzeEmotion = (text: string): number => {
  const words = text.toLowerCase().split(/[\s,。，！!？?；;：:]+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positiveCount++;
    if (NEGATIVE_WORDS.has(word)) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return 0;

  return (positiveCount - negativeCount) / total;
};

export const updateEmotion = (
  currentEmotion: number,
  messageEmotion: number,
  decay: number = 0.7,
): number => {
  const newEmotion = currentEmotion * decay + messageEmotion * (1 - decay);
  return Math.max(-1, Math.min(1, newEmotion));
};

export const deriveRelationshipDelta = (text: string) => {
  const emotion = analyzeEmotion(text);
  if (emotion >= 0.35) {
    return { warmth: 8, competence: 3, trust: 5, threat: -2 };
  }
  if (emotion <= -0.35) {
    return { warmth: -6, competence: -2, trust: -5, threat: 8 };
  }
  return { warmth: 1, competence: 0, trust: 1, threat: 0 };
};
