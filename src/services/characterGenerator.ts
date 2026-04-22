import { generateResponse } from './aiClient';
import type { APIConfig } from '../types/settings';
import type { PersonalityParams } from '../types/character';
import { DEFAULT_PERSONALITY } from '../types/character';
import { AVATAR_OPTIONS } from '../constants/presets';

export interface GeneratedCharacterProfile {
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

function sanitizeBatchNames(names: string[]) {
  return names.map((name) => name.trim()).filter(Boolean);
}

function extractJsonBlock(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function buildBatchGeneratePrompt(names: string[], language: 'zh' | 'en') {
  const normalizedNames = sanitizeBatchNames(names);
  if (language === 'zh') {
    return `请为以下名字批量生成角色档案：${normalizedNames.join('、')}。返回严格 JSON 数组，格式必须是 [{"name":"名字1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]。每个名字都必须返回一项，name 必须与输入完全一致，只返回合法 JSON。字符串里的换行请写成 \n，不要输出原始换行。`;
  }
  return `Generate character profiles for these names: ${normalizedNames.join(', ')}. Return a strict JSON array in this exact shape: [{"name":"name1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]. Every provided name must have one item, and each name must exactly match the input. Escape newlines inside strings as \n. Return only valid JSON.`;
}

export function parseGeneratedProfileMap(content: string, names: string[]) {
  const json = extractJsonBlock(content);
  console.log('[character-generator:batch:raw]', json);
  const parsed = JSON.parse(json) as Array<GeneratedCharacterProfile & { name?: string }>;
  const items = Array.isArray(parsed) ? parsed : [];
  const nameMap = new Map(items.map((item) => [typeof item.name === 'string' ? item.name.trim() : '', item]));
  return names.map((name) => {
    const normalizedName = name.trim();
    const profile = nameMap.get(normalizedName);
    if (!profile) {
      throw new Error(`Missing generated profile for ${normalizedName}`);
    }
    return { name: normalizedName, profile: normalizeGeneratedProfile(profile) };
  });
}

export async function generateCharacterProfilesIndividually(config: APIConfig, names: string[], language: 'zh' | 'en') {
  const normalizedNames = sanitizeBatchNames(names);
  const results = await Promise.allSettled(normalizedNames.map(async (name) => ({
    name,
    profile: await generateCharacterProfile(config, name, language),
  })));
  return results.map((result, index) => ({ result, name: normalizedNames[index] }));
}

export async function generateCharacterProfilesSafe(config: APIConfig, names: string[], language: 'zh' | 'en') {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return { success: [] as Array<{ name: string; profile: ReturnType<typeof normalizeGeneratedProfile> }>, failed: [] as Array<{ name: string; reason: string }> };
  try {
    const success = await generateCharacterProfiles(config, normalizedNames, language);
    return { success, failed: [] as Array<{ name: string; reason: string }> };
  } catch (error) {
    console.warn('[character-generator:batch:fallback]', error);
    const results = await generateCharacterProfilesIndividually(config, normalizedNames, language);
    const success: Array<{ name: string; profile: ReturnType<typeof normalizeGeneratedProfile> }> = [];
    const failed: Array<{ name: string; reason: string }> = [];
    results.forEach(({ result, name }) => {
      if (result.status === 'fulfilled') {
        success.push(result.value);
        return;
      }
      failed.push({
        name,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });
    return { success, failed };
  }
}

export async function generateCharacterProfiles(config: APIConfig, names: string[], language: 'zh' | 'en') {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return [];
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nWhen generating multiple characters, return exactly one valid JSON object with a top-level "profiles" map. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: buildBatchGeneratePrompt(normalizedNames, language) }]
  );
  return parseGeneratedProfileMap(response, normalizedNames);
}

export async function generateCharacterProfile(config: APIConfig, name: string, language: 'zh' | 'en') {
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: `${buildGeneratePrompt(name.trim(), language)} ${language === 'zh' ? '只返回合法JSON。' : 'Return only valid JSON.'}` }]
  );
  return parseGeneratedProfile(response);
}
