import { generateResponse } from './aiClient';
import type { APIConfig } from '../types/settings';
import type { PersonalityParams } from '../types/character';
import { DEFAULT_PERSONALITY } from '../types/character';
import { AVATAR_OPTIONS } from '../constants/presets';

interface GeneratedCharacterProfile {
  avatar?: string;
  personality?: Partial<PersonalityParams>;
  expertise?: string[];
  speakingStyle?: string;
  background?: string;
}

export const CHARACTER_GENERATOR_SYSTEM_PROMPT = `You generate structured AI role profiles for a group chat app.
Return strict JSON only, with this shape:
{
  "avatar": "single emoji from common emoji only",
  "personality": {
    "openness": 0-100,
    "extroversion": 0-100,
    "agreeableness": 0-100,
    "neuroticism": 0-100,
    "humor": 0-100,
    "creativity": 0-100,
    "assertiveness": 0-100,
    "empathy": 0-100
  },
  "expertise": ["short domain", "short domain", "short domain", "short domain"],
  "speakingStyle": "1-2 concise sentences",
  "background": "2-4 concise sentences"
}
Rules:
- Infer the profile from the provided name and likely public persona/archetype.
- If the name is fictional, meme-like, or ambiguous, still create a vivid but usable role profile.
- Keep expertise practical for conversation.
- Do not wrap in markdown fences.
- Output valid JSON only.`;

function clampScore(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeGeneratedProfile(raw: GeneratedCharacterProfile) {
  const avatar = typeof raw.avatar === 'string' && raw.avatar.trim() ? raw.avatar.trim() : '🤖';
  const personality = {
    openness: clampScore(raw.personality?.openness, DEFAULT_PERSONALITY.openness),
    extroversion: clampScore(raw.personality?.extroversion, DEFAULT_PERSONALITY.extroversion),
    agreeableness: clampScore(raw.personality?.agreeableness, DEFAULT_PERSONALITY.agreeableness),
    neuroticism: clampScore(raw.personality?.neuroticism, DEFAULT_PERSONALITY.neuroticism),
    humor: clampScore(raw.personality?.humor, DEFAULT_PERSONALITY.humor),
    creativity: clampScore(raw.personality?.creativity, DEFAULT_PERSONALITY.creativity),
    assertiveness: clampScore(raw.personality?.assertiveness, DEFAULT_PERSONALITY.assertiveness),
    empathy: clampScore(raw.personality?.empathy, DEFAULT_PERSONALITY.empathy),
  };

  const expertise = Array.isArray(raw.expertise)
    ? raw.expertise
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    avatar: AVATAR_OPTIONS.includes(avatar) ? avatar : '🤖',
    personality,
    expertise,
    speakingStyle: typeof raw.speakingStyle === 'string' ? raw.speakingStyle.trim() : '',
    background: typeof raw.background === 'string' ? raw.background.trim() : '',
  };
}

export function parseGeneratedProfile(content: string) {
  const trimmed = content.trim();
  const json = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  console.log('[character-generator:raw]', json);
  const parsed = JSON.parse(json) as GeneratedCharacterProfile;
  console.log('[character-generator:parsed]', parsed);
  return normalizeGeneratedProfile(parsed);
}

export function buildGeneratePrompt(name: string, language: 'zh' | 'en') {
  if (language === 'zh') {
    return `请基于名字“${name}”生成一个适合多人群聊讨论的 AI 角色档案。输出字段必须完整，语气自然，专业领域用简洁短语。`;
  }
  return `Generate a complete AI character profile for the name "${name}" for a multi-person group chat app. Keep the fields concise and usable.`;
}

export async function generateCharacterProfile(config: APIConfig, name: string, language: 'zh' | 'en') {
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: `${buildGeneratePrompt(name.trim(), language)} ${language === 'zh' ? '只返回合法JSON。' : 'Return only valid JSON.'}` }]
  );
  return parseGeneratedProfile(response);
}
