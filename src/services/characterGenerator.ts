import { generateResponse } from './aiClient';
import type { APIConfig } from '../types/settings';
import type { PersonalityParams, CharacterBehaviorParams, CharacterSpeechProfile, CharacterCoreProfile } from '../types/character';
import { DEFAULT_PERSONALITY, DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_SPEECH_PROFILE, DEFAULT_CORE_PROFILE } from '../types/character';
import type { BubbleStyleDefinition, BubbleBorderStyle, BubbleGradientDirection, BubbleShadowLevel } from '../types/bubbleStyle';
import { DEFAULT_BUBBLE_STYLE_FORM } from '../types/bubbleStyle';
import { AVATAR_OPTIONS } from '../constants/presets';

export interface GeneratedCharacterProfile {
  avatar?: string;
  personality?: Partial<PersonalityParams>;
  behavior?: Partial<CharacterBehaviorParams>;
  expertise?: string[];
  speakingStyle?: string;
  background?: string;
  speechProfile?: Partial<CharacterSpeechProfile>;
  coreProfile?: Partial<CharacterCoreProfile>;
  bubbleStyle?: Partial<BubbleStyleDefinition>;
  visualIdentity?: {
    description?: string;
    styleHint?: string;
    negativePrompt?: string;
    seed?: string | number | null;
  };
}

export interface CharacterVisualIdentityDraftInput {
  name: string;
  background?: string;
  speakingStyle?: string;
  expertise?: string[];
  group?: string | null;
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
  "behavior": {
    "proactivity": 0-100,
    "aggressiveness": 0-100,
    "humorIntensity": 0-100,
    "empathyLevel": 0-100,
    "summarizing": 0-100,
    "offTopic": 0-100
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
  "coreProfile": {
    "coreDesire": "long-term desire or need",
    "coreFear": "long-term fear, avoidance, or vulnerable point",
    "socialMask": "how they protect themselves in public interactions",
    "values": ["0-5 value priorities"],
    "sensitivities": ["0-5 sensitive points"],
    "perceptionBiases": ["0-5 likely misreadings or attention filters"],
    "interactionHabits": ["0-5 interaction habits"],
    "attachmentStyle": "relationship or attachment tendency",
    "conflictStyle": "how they handle conflict",
    "unmetNeeds": ["0-5 unmet emotional needs"],
    "selfImage": "how they tend to see themselves",
    "hiddenSoftSpots": ["0-5 private soft spots"]
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
- Make personality and behavior numerically distinctive for the role. Avoid leaving all axes at 50 unless the role is intentionally neutral on that exact axis.
- behavior controls social expression and discussion style: proactivity = initiates topics, aggressiveness = confronts/pushes back, humorIntensity = jokes/playfulness, empathyLevel = emotional attunement, summarizing = organizes/summarizes, offTopic = tangent-prone.
- If the name is fictional, meme-like, or ambiguous, still create a vivid but usable role profile.
- Keep expertise practical for conversation.
- Make coreProfile psychologically specific to this role, not generic labels. It should describe long-term inner drives, vulnerabilities, relationship style, conflict style, self-image, and likely perception filters.
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

function normalizeShortText(value: unknown, limit = 220) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
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
  const behavior = {
    proactivity: clampScore(raw.behavior?.proactivity, DEFAULT_CHARACTER_BEHAVIOR.proactivity),
    aggressiveness: clampScore(raw.behavior?.aggressiveness, DEFAULT_CHARACTER_BEHAVIOR.aggressiveness),
    humorIntensity: clampScore(raw.behavior?.humorIntensity, DEFAULT_CHARACTER_BEHAVIOR.humorIntensity),
    empathyLevel: clampScore(raw.behavior?.empathyLevel, DEFAULT_CHARACTER_BEHAVIOR.empathyLevel),
    summarizing: clampScore(raw.behavior?.summarizing, DEFAULT_CHARACTER_BEHAVIOR.summarizing),
    offTopic: clampScore(raw.behavior?.offTopic, DEFAULT_CHARACTER_BEHAVIOR.offTopic),
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

  const rawCoreProfile = raw.coreProfile || {};
  const values = normalizeStringList(rawCoreProfile.values || rawCoreProfile.valuePriority, 6);
  const perceptionBiases = normalizeStringList(rawCoreProfile.perceptionBiases || rawCoreProfile.biases, 6);
  const coreProfile: CharacterCoreProfile = {
    ...DEFAULT_CORE_PROFILE,
    coreDesire: normalizeShortText(rawCoreProfile.coreDesire),
    coreFear: normalizeShortText(rawCoreProfile.coreFear),
    socialMask: normalizeShortText(rawCoreProfile.socialMask),
    values,
    valuePriority: values,
    sensitivities: normalizeStringList(rawCoreProfile.sensitivities, 6),
    perceptionBiases,
    biases: perceptionBiases,
    interactionHabits: normalizeStringList(rawCoreProfile.interactionHabits, 6),
    attachmentStyle: normalizeShortText(rawCoreProfile.attachmentStyle),
    conflictStyle: normalizeShortText(rawCoreProfile.conflictStyle),
    unmetNeeds: normalizeStringList(rawCoreProfile.unmetNeeds, 6),
    selfImage: normalizeShortText(rawCoreProfile.selfImage),
    hiddenSoftSpots: normalizeStringList(rawCoreProfile.hiddenSoftSpots, 6),
  };

  return {
    avatar: AVATAR_OPTIONS.includes(avatar) ? avatar : '🤖',
    personality,
    behavior,
    expertise,
    speakingStyle: typeof raw.speakingStyle === 'string' ? raw.speakingStyle.trim() : '',
    background: typeof raw.background === 'string' ? raw.background.trim() : '',
    speechProfile,
    coreProfile,
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
  const parsed = JSON.parse(json) as GeneratedCharacterProfile;
  return normalizeGeneratedProfile(parsed);
}

type CharacterGenerationContext = string | { theme?: string | null; description?: string | null } | null | undefined;

function formatThemeHint(theme?: string | null) {
  const normalizedTheme = theme?.trim();
  return normalizedTheme ? normalizedTheme : '';
}

function normalizeGenerationContext(context?: CharacterGenerationContext) {
  if (typeof context === 'string') return { theme: formatThemeHint(context), description: '' };
  return {
    theme: formatThemeHint(context?.theme),
    description: context?.description?.trim() || '',
  };
}

export function buildGeneratePrompt(name: string, language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const { theme, description } = normalizeGenerationContext(context);
  if (language === 'zh') {
    return theme || description
      ? `请基于以下用户需求生成一个适合多人群聊讨论的 AI 角色档案。\n主题/分组：${theme || '未指定'}\n描述：${description || '未指定'}\n目标角色：${name}\n必须同时遵守主题和描述，描述里的数量、身份结构、时代、题材和关系约束优先；不要因为角色名或括号内身份而偏离用户需求。输出字段必须完整，语气自然，专业领域用简洁短语。请额外生成适合后续图片参考的 visualIdentity 文本锚点，以及适合长期演化的 coreProfile 心理画像。`
      : `请基于名字“${name}”生成一个适合多人群聊讨论的 AI 角色档案。输出字段必须完整，语气自然，专业领域用简洁短语。请额外生成适合后续图片参考的 visualIdentity 文本锚点，以及适合长期演化的 coreProfile 心理画像。`;
  }
  return theme || description
    ? `Generate a complete AI character profile for a multi-person group chat app from this user request.\nTheme/group: ${theme || 'not specified'}\nDescription: ${description || 'not specified'}\nTarget character: ${name}\nFollow both the theme and description; counts, role composition, era, genre, and relationship constraints in the description take priority. Do not let the name or parenthesized role drift away from the user's requested context. Keep fields concise and usable. Also generate a visualIdentity text anchor for later image reference and a coreProfile psychological profile for long-term evolution.`
    : `Generate a complete AI character profile for the name "${name}" for a multi-person group chat app. Keep the fields concise and usable. Also generate a visualIdentity text anchor for later image reference and a coreProfile psychological profile for long-term evolution.`;
}

function sanitizeBatchNames(names: string[]) {
  return names.map((name) => name.trim()).filter(Boolean);
}

function extractJsonBlock(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function buildBatchGeneratePrompt(names: string[], language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const normalizedNames = sanitizeBatchNames(names);
  const { theme, description } = normalizeGenerationContext(context);
  if (language === 'zh') {
    return theme || description
      ? `请基于以下用户需求为角色批量生成档案。\n主题/分组：${theme || '未指定'}\n描述：${description || '未指定'}\n角色名单：${normalizedNames.join('、')}\n每个角色都必须同时贴合主题和描述，描述里的数量、身份结构、时代、题材和关系约束优先；不要因为角色名或括号内身份而带偏整体设定。返回严格 JSON 数组，每项都包含 name、avatar、personality、behavior、expertise、speakingStyle、background、speechProfile、coreProfile、bubbleStyle、visualIdentity。personality 和 behavior 要按角色差异给出有区分度的 0-100 数值，不要全部填 50。每个名字都必须返回一项，name 必须与输入完全一致，只返回合法 JSON。字符串里的换行请写成 \n，不要输出原始换行。`
      : `请为以下名字批量生成角色档案：${normalizedNames.join('、')}。返回严格 JSON 数组，每项都包含 name、avatar、personality、behavior、expertise、speakingStyle、background、speechProfile、coreProfile、bubbleStyle、visualIdentity。personality 和 behavior 要按角色差异给出有区分度的 0-100 数值，不要全部填 50。每个名字都必须返回一项，name 必须与输入完全一致，只返回合法 JSON。字符串里的换行请写成 \n，不要输出原始换行。`;
  }
  return theme || description
    ? `Generate character profiles from this user request.\nTheme/group: ${theme || 'not specified'}\nDescription: ${description || 'not specified'}\nCharacter list: ${normalizedNames.join(', ')}\nEvery character must fit both the theme and description; counts, role composition, era, genre, and relationship constraints in the description take priority. Do not let names or parenthesized roles drift the overall setting away from the user's request. Return a strict JSON array. Every item must include name, avatar, personality, behavior, expertise, speakingStyle, background, speechProfile, coreProfile, bubbleStyle, and visualIdentity. personality and behavior must use distinctive 0-100 values for each role; do not set every axis to 50. Every provided name must have one item, and each name must exactly match the input. Escape newlines inside strings as \n. Return only valid JSON.`
    : `Generate character profiles for these names: ${normalizedNames.join(', ')}. Return a strict JSON array. Every item must include name, avatar, personality, behavior, expertise, speakingStyle, background, speechProfile, coreProfile, bubbleStyle, and visualIdentity. personality and behavior must use distinctive 0-100 values for each role; do not set every axis to 50. Every provided name must have one item, and each name must exactly match the input. Escape newlines inside strings as \n. Return only valid JSON.`;
}

export function parseGeneratedProfileMap(content: string, names: string[]) {
  const json = extractJsonBlock(content);
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

export async function generateCharacterProfilesIndividually(config: APIConfig, names: string[], language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const normalizedNames = sanitizeBatchNames(names);
  const results = await Promise.allSettled(normalizedNames.map(async (name) => ({
    name,
    profile: await generateCharacterProfile(config, name, language, context),
  })));
  return results.map((result, index) => ({ result, name: normalizedNames[index] }));
}

export async function generateCharacterProfilesSafe(config: APIConfig, names: string[], language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return { success: [] as Array<{ name: string; profile: ReturnType<typeof normalizeGeneratedProfile> }>, failed: [] as Array<{ name: string; reason: string }> };
  try {
    const success = await generateCharacterProfiles(config, normalizedNames, language, context);
    return { success, failed: [] as Array<{ name: string; reason: string }> };
  } catch (error) {
    console.warn('[character-generator:batch:fallback]', error);
    const results = await generateCharacterProfilesIndividually(config, normalizedNames, language, context);
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

export async function generateCharacterProfiles(config: APIConfig, names: string[], language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const normalizedNames = sanitizeBatchNames(names);
  if (!normalizedNames.length) return [];
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nWhen generating multiple characters, return exactly one valid JSON array. Each item must include the requested name plus the same profile fields as a single-character result. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: buildBatchGeneratePrompt(normalizedNames, language, context) }]
  );
  return parseGeneratedProfileMap(response, normalizedNames);
}

export async function generateCharacterProfile(config: APIConfig, name: string, language: 'zh' | 'en', context?: CharacterGenerationContext) {
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
    [{ role: 'user', content: `${buildGeneratePrompt(name.trim(), language, context)} ${language === 'zh' ? '只返回合法JSON。' : 'Return only valid JSON.'}` }],
    undefined,
    { maxTokens: 2400 }
  );
  return parseGeneratedProfile(response);
}

export async function generateCharacterVisualIdentityDraft(config: APIConfig, input: CharacterVisualIdentityDraftInput, language: 'zh' | 'en') {
  const expertise = (input.expertise || []).filter(Boolean).join(language === 'zh' ? '、' : ', ');
  const prompt = language === 'zh'
    ? [
        `请为聊天角色“${input.name.trim() || '未命名角色'}”生成稳定视觉形象描述。`,
        input.group?.trim() ? `分组/主题：${input.group.trim()}` : '',
        input.background?.trim() ? `背景：${input.background.trim()}` : '',
        input.speakingStyle?.trim() ? `说话气质：${input.speakingStyle.trim()}` : '',
        expertise ? `兴趣/专长：${expertise}` : '',
        '返回严格 JSON：{"description":"1-3句稳定外观锚点，包含年龄感、发型、气质、常见穿搭或标志性元素，但不要写死每个场景","styleHint":"适合聊天图片的风格提示","negativePrompt":"需要避免的内容","seed":null}',
        '不要输出 markdown，不要解释。',
      ].filter(Boolean).join('\n')
    : [
        `Generate a stable visual identity draft for the chat character "${input.name.trim() || 'Unnamed character'}".`,
        input.group?.trim() ? `Group/theme: ${input.group.trim()}` : '',
        input.background?.trim() ? `Background: ${input.background.trim()}` : '',
        input.speakingStyle?.trim() ? `Speaking vibe: ${input.speakingStyle.trim()}` : '',
        expertise ? `Interests/expertise: ${expertise}` : '',
        'Return strict JSON: {"description":"1-3 sentences with stable appearance anchors such as age impression, hair, vibe, common outfit, or signature elements, without locking every scene","styleHint":"style guidance suitable for chat images","negativePrompt":"things to avoid","seed":null}',
        'Do not output markdown or explanations.',
      ].filter(Boolean).join('\n');
  const response = await generateResponse(
    config,
    `${CHARACTER_GENERATOR_SYSTEM_PROMPT}\nOutput exactly one valid JSON object containing only visualIdentity draft fields.`,
    [{ role: 'user', content: prompt }],
    undefined,
    { maxTokens: 700 }
  );
  const parsed = JSON.parse(extractJsonBlock(response)) as GeneratedCharacterProfile['visualIdentity'];
  return {
    description: typeof parsed?.description === 'string' ? parsed.description.trim() : '',
    styleHint: typeof parsed?.styleHint === 'string' ? parsed.styleHint.trim() : '',
    negativePrompt: typeof parsed?.negativePrompt === 'string' ? parsed.negativePrompt.trim() : '',
    seed: parsed?.seed ?? null,
  };
}
