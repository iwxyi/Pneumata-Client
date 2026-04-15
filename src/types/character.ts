export interface PersonalityParams {
  openness: number;       // 开放性 0-100
  extroversion: number;   // 外向性 0-100
  agreeableness: number;  // 宜人性 0-100
  neuroticism: number;    // 神经质 0-100
  humor: number;          // 幽默感 0-100
  creativity: number;     // 创造力 0-100
  assertiveness: number;  // 决断力 0-100
  empathy: number;        // 共情力 0-100
}

export interface AICharacter {
  id: string;
  name: string;
  avatar: string;            // emoji or color identifier
  personality: PersonalityParams;
  expertise: string[];       // professional domains
  speakingStyle: string;     // speaking style description
  background: string;        // background description
  modelProfileId?: string | null;
  bubbleStyleId?: string | null;
  isPreset: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PERSONALITY: PersonalityParams = {
  openness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
  humor: 50,
  creativity: 50,
  assertiveness: 50,
  empathy: 50,
};
