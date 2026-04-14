// Simple keyword-based topic extraction for MVP
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'that', 'this', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'them', 'what', 'which', 'who', 'whom',
  // Chinese stop words
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都',
  '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会',
  '着', '没有', '看', '好', '自己', '这', '他', '她', '它', '们',
  '那', '些', '么', '什么', '吗', '吧', '啊', '呢', '嗯', '哦',
]);

export const extractKeywords = (text: string): string[] => {
  // Split by spaces and Chinese characters
  const words = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  // Count frequency
  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  // Return top keywords sorted by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
};

export const calculateTopicRelevance = (
  keywords: string[],
  expertise: string[]
): number => {
  if (keywords.length === 0 || expertise.length === 0) return 0;

  const expertiseSet = new Set(expertise.map((e) => e.toLowerCase()));
  let matches = 0;

  for (const keyword of keywords) {
    for (const exp of expertiseSet) {
      if (exp.includes(keyword) || keyword.includes(exp)) {
        matches++;
        break;
      }
    }
  }

  return Math.min(matches * 0.2, 1.0);
};
