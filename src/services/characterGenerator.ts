import { generateResponse } from './aiClient';
import type { APIConfig } from '../types/settings';
import type { PersonalityParams, CharacterSpeechProfile } from '../types/character';
import { DEFAULT_PERSONALITY, DEFAULT_SPEECH_PROFILE } from '../types/character';
import type { BubbleStyleDefinition, BubbleBorderStyle, BubbleGradientDirection, BubbleShadowLevel } from '../types/bubbleStyle';
import { DEFAULT_BUBBLE_STYLE_FORM } from '../types/bubbleStyle';
import { AVATAR_OPTIONS } from '../constants/presets';

export interface GeneratedCharacterProfile {
  avatar?: string;
  personality?: Partial<PersonalityParams>;
  expertise?: string[];
  speakingStyle?: string;
  background?: string;
  speechProfile?: Partial<CharacterSpeechProfile>;
  bubbleStyle?: Partial<BubbleStyleDefinition>;
  visualIdentity?: {
    description?: string;
    styleHint?: string;
    negativePrompt?: string;
    seed?: string | number | null;
  };
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
  "background": "2-4 concise sentences",
  "speechProfile": {
    "catchphrases": ["0-3 short catchphrases"],
    "fillers": ["0-4 short filler words or spoken tics"],
    "tabooPhrases": ["0-3 phrases they avoid saying"],
    "preferredOpeners": ["0-3 common openers"],
    "preferredClosers": ["0-3 common closers"],
    "sentenceLengthBias": "short|mixed|long",
    "questionBias": 0-100,
    "sarcasmBias": 0-100
  },
  "bubbleStyle": {
    "name": "2-4 word style name",
    "backgroundColor": "#RRGGBB or rgba(...)",
    "textColor": "#RRGGBB or rgba(...)",
    "borderColor": "#RRGGBB or rgba(...)",
    "borderWidth": 0-4,
    "borderStyle": "solid|dashed|dotted",
    "radius": 4-32,
    "shadow": "none|soft|medium|strong",
    "gradientFrom": "optional color string",
    "gradientTo": "optional color string",
    "gradientDirection": "135deg|160deg|180deg"
  },
  "visualIdentity": {
    "description": "optional, 1-3 concise sentences describing a stable visual anchor for image generation",
    "styleHint": "optional style guidance",
    "negativePrompt": "optional negative prompt",
    "seed": "optional seed"
  }
}
Rules:
- Infer the profile from the provided name and likely public persona/archetype.
- If the name is fictional, meme-like, or ambiguous, still create a vivid but usable role profile.
- Keep expertise practical for conversation.
- Make bubbleStyle visually distinctive and aligned with the character's vibe, role, and speaking style.
- Keep bubbleStyle practical for chat readability with strong text/background contrast.
- Do not wrap in markdown fences.
- Output valid JSON only.`;

function clampScore(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeStringList(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : [];
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeBubbleBorderStyle(value: unknown): BubbleBorderStyle {
  return value === 'dashed' || value === 'dotted' ? value : 'solid';
}

function normalizeBubbleShadow(value: unknown): BubbleShadowLevel {
  return value === 'none' || value === 'medium' || value === 'strong' ? value : 'soft';
}

function normalizeBubbleGradientDirection(value: unknown): BubbleGradientDirection {
  return value === '160deg' || value === '180deg' ? value : '135deg';
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeBubbleStyle(raw: Partial<BubbleStyleDefinition> | undefined): BubbleStyleDefinition {
  return {
    id: 'generated-bubble-style',
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : 'Generated Style',
    backgroundColor: normalizeColor(raw?.backgroundColor, DEFAULT_BUBBLE_STYLE_FORM.backgroundColor),
    textColor: normalizeColor(raw?.textColor, DEFAULT_BUBBLE_STYLE_FORM.textColor),
    borderColor: normalizeColor(raw?.borderColor, DEFAULT_BUBBLE_STYLE_FORM.borderColor),
    borderWidth: clampInteger(raw?.borderWidth, 0, 4, DEFAULT_BUBBLE_STYLE_FORM.borderWidth),
    borderStyle: normalizeBubbleBorderStyle(raw?.borderStyle),
    radius: clampInteger(raw?.radius, 4, 32, DEFAULT_BUBBLE_STYLE_FORM.radius),
    shadow: normalizeBubbleShadow(raw?.shadow),
    gradientFrom: typeof raw?.gradientFrom === 'string' && raw.gradientFrom.trim() ? raw.gradientFrom.trim() : undefined,
    gradientTo: typeof raw?.gradientTo === 'string' && raw.gradientTo.trim() ? raw.gradientTo.trim() : undefined,
    gradientDirection: normalizeBubbleGradientDirection(raw?.gradientDirection),
  };
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

  const speechProfile: CharacterSpeechProfile = {
    ...DEFAULT_SPEECH_PROFILE,
    ...(raw.speechProfile || {}),
    catchphrases: normalizeStringList(raw.speechProfile?.catchphrases, 3),
    fillers: normalizeStringList(raw.speechProfile?.fillers, 4),
    tabooPhrases: normalizeStringList(raw.speechProfile?.tabooPhrases, 3),
    preferredOpeners: normalizeStringList(raw.speechProfile?.preferredOpeners, 3),
    preferredClosers: normalizeStringList(raw.speechProfile?.preferredClosers, 3),
    sentenceLengthBias: raw.speechProfile?.sentenceLengthBias === 'short' || raw.speechProfile?.sentenceLengthBias === 'long' ? raw.speechProfile.sentenceLengthBias : 'mixed',
    questionBias: clampScore(raw.speechProfile?.questionBias, DEFAULT_SPEECH_PROFILE.questionBias),
    sarcasmBias: clampScore(raw.speechProfile?.sarcasmBias, DEFAULT_SPEECH_PROFILE.sarcasmBias),
  };

  return {
    avatar: AVATAR_OPTIONS.includes(avatar) ? avatar : '🤖',
    personality,
    expertise,
    speakingStyle: typeof raw.speakingStyle === 'string' ? raw.speakingStyle.trim() : '',
    background: typeof raw.background === 'string' ? raw.background.trim() : '',
    speechProfile,
    bubbleStyle: normalizeBubbleStyle(raw.bubbleStyle),
    visualIdentity: {
      description: typeof raw.visualIdentity?.description === 'string' ? raw.visualIdentity.description.trim() : '',
      styleHint: typeof raw.visualIdentity?.styleHint === 'string' ? raw.visualIdentity.styleHint.trim() : '',
      negativePrompt: typeof raw.visualIdentity?.negativePrompt === 'string' ? raw.visualIdentity.negativePrompt.trim() : '',
      seed: raw.visualIdentity?.seed ?? null,
    },
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

function formatThemeHint(theme?: string | null) {
  const normalizedTheme = theme?.trim();
  return normalizedTheme ? normalizedTheme : '';
}

export function buildGeneratePrompt(name: string, language: 'zh' | 'en', theme?: string | null) {
  const normalizedTheme = formatThemeHint(theme);
  if (language === 'zh') {
    return normalizedTheme
    ? `请基于主题“${normalizedTheme}”中的角色“${name}”生成一个适合多人群聊讨论的 AI 角色档案。务必按该主题理解角色身份，避免混淆同名人物。输出字段必须完整，语气自然，专业领域用简洁短语。请额外生成适合后续图片参考的 visualIdentity 文本锚点。`
      : `请基于名字“${name}”生成一个适合多人群聊讨论的 AI 角色档案。输出字段必须完整，语气自然，专业领域用简洁短语。请额外生成适合后续图片参考的 visualIdentity 文本锚点。`;
  }
  return normalizedTheme
    ? `Generate a complete AI character profile for the character "${name}" from the theme "${normalizedTheme}" for a multi-person group chat app. Use the theme to disambiguate namesakes and keep the fields concise and usable. Also generate a visualIdentity text anchor for later image reference.`
    : `Generate a complete AI character profile for the name "${name}" for a multi-person group chat app. Keep the fields concise and usable. Also generate a visualIdentity text anchor for later image reference.`;
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

function buildBatchGeneratePrompt(names: string[], language: 'zh' | 'en', theme?: string | null) {
  const normalizedNames = sanitizeBatchNames(names);
  const normalizedTheme = formatThemeHint(theme);
  if (language === 'zh') {
    return normalizedTheme
      ? `请基于主题“${normalizedTheme}”为以下角色批量生成档案：${normalizedNames.join('、')}。每个角色都必须按该主题中的身份来理解，避免混淆同名人物。返回严格 JSON 数组，格式必须是 [{"name":"名字1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]。每个名字都必须返回一项，name 必须与输入完全一致，只返回合法 JSON。字符串里的换行请写成 \n，不要输出原始换行。`
      : `请为以下名字批量生成角色档案：${normalizedNames.join('、')}。返回严格 JSON 数组，格式必须是 [{"name":"名字1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]。每个名字都必须返回一项，name 必须与输入完全一致，只返回合法 JSON。字符串里的换行请写成 \n，不要输出原始换行。`;
  }
  return normalizedTheme
    ? `Generate character profiles for these characters from the theme "${normalizedTheme}": ${normalizedNames.join(', ')}. Use the theme to disambiguate namesakes for every character. Return a strict JSON array in this exact shape: [{"name":"name1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]. Every provided name must have one item, and each name must exactly match the input. Escape newlines inside strings as \n. Return only valid JSON.`
    : `Generate character profiles for these names: ${normalizedNames.join(', ')}. Return a strict JSON array in this exact shape: [{"name":"name1","avatar":"😀","personality":{...},"expertise":[...],"speakingStyle":"...","background":"..."}]. Every provided name must have one item, and each name must exactly match the input. Escape newlines inside strings as \n. Return only valid JSON.`;
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

export async function generateCharacterProfilesIndividually(config: APIConfig, names: string[], language: 'zh' | 'en', theme?: string | null) {
  const normalizedNames = sanitizeBatchNames(names);
  const results = await Promise.allSettled(normalizedNames.map(async (name) => ({
    name,
    profile: await generateCharacterProfile(config, name, language, theme),
  })));
  return results.map((result, index) => ({ result, name: normalizedNames[index] }));
}

export async function generateCharacterProfilesSafe(config: APIConfig, names: string[], language: 'zh' | 'en', theme?: string | null) {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return { success: [] as Array<{ name: string; profile: ReturnType<typeof normalizeGeneratedProfile> }>, failed: [] as Array<{ name: string; reason: string }> };
  try {
    const success = await generateCharacterProfiles(config, normalizedNames, language, theme);
    return { success, failed: [] as Array<{ name: string; reason: string }> };
  } catch (error) {
    console.warn('[character-generator:batch:fallback]', error);
    const results = await generateCharacterProfilesIndividually(config, normalizedNames, language, theme);
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

export async function generateCharacterProfiles(config: APIConfig, names: string[], language: 'zh' | 'en', theme?: string | null) {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return [];
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nWhen generating multiple characters, return exactly one valid JSON object with a top-level "profiles" map. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: buildBatchGeneratePrompt(normalizedNames, language, theme) }]
  );
  return parseGeneratedProfileMap(response, normalizedNames);
}

export async function generateCharacterProfile(config: APIConfig, name: string, language: 'zh' | 'en', theme?: string | null) {
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: `${buildGeneratePrompt(name.trim(), language, theme)} ${language === 'zh' ? '只返回合法JSON。' : 'Return only valid JSON.'}` }]
  );
  return parseGeneratedProfile(response);
}
