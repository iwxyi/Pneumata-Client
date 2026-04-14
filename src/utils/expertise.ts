const expertiseLabels: Record<string, { zh: string; en: string }> = {
  science: { zh: '科学', en: 'Science' },
  logic: { zh: '逻辑', en: 'Logic' },
  research: { zh: '研究', en: 'Research' },
  'data analysis': { zh: '数据分析', en: 'Data Analysis' },
  poetry: { zh: '诗歌', en: 'Poetry' },
  literature: { zh: '文学', en: 'Literature' },
  philosophy: { zh: '哲学', en: 'Philosophy' },
  arts: { zh: '艺术', en: 'Arts' },
  debate: { zh: '辩论', en: 'Debate' },
  rhetoric: { zh: '修辞', en: 'Rhetoric' },
  'critical thinking': { zh: '批判性思维', en: 'Critical Thinking' },
  'conflict resolution': { zh: '冲突解决', en: 'Conflict Resolution' },
  psychology: { zh: '心理学', en: 'Psychology' },
  communication: { zh: '沟通', en: 'Communication' },
  diplomacy: { zh: '外交', en: 'Diplomacy' },
  technology: { zh: '科技', en: 'Technology' },
  ai: { zh: '人工智能', en: 'AI' },
  startups: { zh: '创业', en: 'Startups' },
  programming: { zh: '编程', en: 'Programming' },
  futurism: { zh: '未来学', en: 'Futurism' },
  ethics: { zh: '伦理学', en: 'Ethics' },
  existentialism: { zh: '存在主义', en: 'Existentialism' },
  metaphysics: { zh: '形而上学', en: 'Metaphysics' },
  comedy: { zh: '喜剧', en: 'Comedy' },
  'pop culture': { zh: '流行文化', en: 'Pop Culture' },
  storytelling: { zh: '叙事', en: 'Storytelling' },
  improvisation: { zh: '即兴发挥', en: 'Improvisation' },
  history: { zh: '历史', en: 'History' },
  culture: { zh: '文化', en: 'Culture' },
  civilization: { zh: '文明', en: 'Civilization' },
  politics: { zh: '政治', en: 'Politics' },
  'visual arts': { zh: '视觉艺术', en: 'Visual Arts' },
  design: { zh: '设计', en: 'Design' },
  aesthetics: { zh: '美学', en: 'Aesthetics' },
  'creative thinking': { zh: '创意思维', en: 'Creative Thinking' },
  business: { zh: '商业', en: 'Business' },
  strategy: { zh: '战略', en: 'Strategy' },
  marketing: { zh: '市场营销', en: 'Marketing' },
  economics: { zh: '经济学', en: 'Economics' },
  mysticism: { zh: '神秘学', en: 'Mysticism' },
  spirituality: { zh: '灵性', en: 'Spirituality' },
  mythology: { zh: '神话', en: 'Mythology' },
  symbolism: { zh: '象征学', en: 'Symbolism' },
  criticism: { zh: '评论', en: 'Criticism' },
  media: { zh: '媒体', en: 'Media' },
  'quality assessment': { zh: '质量评估', en: 'Quality Assessment' },
};

export function formatExpertiseLabel(expertise: string, language: string) {
  const normalized = expertise.trim().toLowerCase();
  const mapped = expertiseLabels[normalized];
  if (!mapped) return expertise;
  return language.startsWith('zh') ? mapped.zh : mapped.en;
}

export function formatExpertiseList(expertise: string[], language: string) {
  return expertise.map((item) => formatExpertiseLabel(item, language));
}
