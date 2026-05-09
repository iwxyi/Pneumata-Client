import type { AICharacter } from '../types/character';
import type { AIModelProfile, AvatarGenerationSettings } from '../types/settings';
import { getPreferredAIProfile } from '../types/settings';
import { avatarGenerationQueue } from './avatarGenerationQueue';

export interface AvatarPromptCharacterInput {
  id: string;
  name: string;
  background?: string;
  speakingStyle?: string;
  expertise?: string[];
  group?: string | null;
  personality?: Partial<Record<'openness' | 'extroversion' | 'agreeableness' | 'neuroticism' | 'humor' | 'creativity' | 'assertiveness' | 'empathy', number>>;
  speechProfile?: AICharacter['speechProfile'];
  coreProfile?: AICharacter['coreProfile'];
}

function describePersonality(character: AvatarPromptCharacterInput, language: 'zh' | 'en') {
  const p = character.personality || {};
  const traits: string[] = [];
  if ((p.extroversion || 0) >= 65) traits.push(language === 'zh' ? '外向张扬' : 'outgoing and expressive');
  if ((p.agreeableness || 0) >= 65) traits.push(language === 'zh' ? '亲和温柔' : 'warm and kind');
  if ((p.neuroticism || 0) >= 65) traits.push(language === 'zh' ? '敏感脆弱' : 'sensitive and fragile');
  if ((p.openness || 0) >= 65 || (p.creativity || 0) >= 65) traits.push(language === 'zh' ? '想象力强' : 'imaginative');
  if ((p.assertiveness || 0) >= 65) traits.push(language === 'zh' ? '强势有压迫感' : 'assertive and intense');
  if ((p.empathy || 0) >= 65) traits.push(language === 'zh' ? '细腻会照顾人' : 'empathetic and caring');
  if ((p.humor || 0) >= 65) traits.push(language === 'zh' ? '有喜剧感' : 'playful and comedic');
  return traits.join(language === 'zh' ? '、' : ', ');
}

function inferAvatarVisualArchetypes(character: AvatarPromptCharacterInput, language: 'zh' | 'en') {
  const expertiseText = (character.expertise || []).join(' ').toLowerCase();
  const backgroundText = character.background?.toLowerCase() || '';
  const speechText = character.speakingStyle?.toLowerCase() || '';
  const groupText = character.group?.toLowerCase() || '';
  const coreText = [
    character.coreProfile?.coreDesire,
    character.coreProfile?.coreFear,
    character.coreProfile?.socialMask,
    ...(character.coreProfile?.valuePriority || []),
    ...(character.coreProfile?.biases || []),
    ...(character.coreProfile?.interactionHabits || []),
  ].filter(Boolean).join(' ').toLowerCase();
  const merged = [expertiseText, backgroundText, speechText, groupText, coreText].join(' ');
  const p = character.personality || {};
  const archetypes: string[] = [];

  const cuteSignal = /(可爱|萌|少女|软|甜|治愈|猫|兔|玩偶|二次元|宅|acg|anime|cute|soft|sweet|kawaii|cat|bunny|doll)/.test(merged);
  const coupleSignal = /(情侣|恋爱|cp|恋人|夫妻|伴侣|romance|lover|couple)/.test(merged);
  const matureSignal = /(老师|教授|作家|诗|花|茶|园艺|摄影|书法|奶奶|爷爷|中年|elder|teacher|professor|writer|poetry|flower|tea|garden|calligraphy)/.test(merged);
  const hardboiledSignal = /(警察|军|律师|黑道|杀手|保镖|总裁|反派|战士|机甲|硬汉|police|military|lawyer|mafia|assassin|bodyguard|boss|villain|warrior|mecha)/.test(merged);
  const geekSignal = /(程序|黑客|游戏|动漫|漫画|像素|赛博|科技|code|coder|hacker|game|gaming|manga|pixel|cyber|tech)/.test(merged);

  if (cuteSignal || (p.empathy || 0) >= 70 || (p.neuroticism || 0) >= 70) {
    archetypes.push(language === 'zh'
      ? '可偏轻动漫、软萌、绘本感，必要时可用玩偶、小动物、甜点、饰品等物件象征'
      : 'can lean soft anime, cute storybook, or symbolic motifs like plush toys, animals, sweets, or accessories');
  }
  if (geekSignal || (p.openness || 0) >= 70 || (p.creativity || 0) >= 70) {
    archetypes.push(language === 'zh'
      ? '可偏动漫、像素、赛博、概念设定或带亚文化感的图形化表达'
      : 'can lean anime, pixel, cyber, concept-art, or subculture-coded graphic styles');
  }
  if (matureSignal || ((p.extroversion || 0) <= 40 && (p.assertiveness || 0) <= 45)) {
    archetypes.push(language === 'zh'
      ? '可偏花卉、风景、书卷气、生活物件、留白插画，不一定必须是标准人物正脸'
      : 'can lean floral, scenic, literary, lifestyle-object, or minimal illustration rather than a standard face portrait');
  }
  if (coupleSignal) {
    archetypes.push(language === 'zh'
      ? '允许带一点情侣头像感或成对呼应感，但不要依赖双人构图'
      : 'may carry a matching-couple vibe or paired visual language without requiring a two-person composition');
  }
  if (hardboiledSignal || (p.assertiveness || 0) >= 70) {
    archetypes.push(language === 'zh'
      ? '可偏漫画、海报感、概念插画、硬派剪影或强对比风格，不要默认证件照'
      : 'can lean comic, poster-like, concept illustration, hardboiled silhouette, or high-contrast styling instead of a plain portrait');
  }

  return archetypes.slice(0, 4).join(language === 'zh' ? '；' : '; ');
}

function buildAvatarStyleDirectives(character: AvatarPromptCharacterInput, language: 'zh' | 'en', settings: AvatarGenerationSettings) {
  const expertise = (character.expertise || []).slice(0, 6).join(language === 'zh' ? '、' : ', ');
  const personality = describePersonality(character, language);
  const speech = character.speakingStyle?.trim() || '';
  const catchphrases = (character.speechProfile?.catchphrases || []).slice(0, 3).join(language === 'zh' ? '、' : ', ');
  const socialMask = character.coreProfile?.socialMask?.trim() || '';
  const coreDesire = character.coreProfile?.coreDesire?.trim() || '';
  const coreFear = character.coreProfile?.coreFear?.trim() || '';
  const archetypes = inferAvatarVisualArchetypes(character, language);
  const nonPhotoreal = settings.preferNonPhotorealAvatar;
  if (language === 'zh') {
    return [
      nonPhotoreal
        ? '风格要求：优先非写实头像，并根据角色身份、兴趣、专长、气质选择最贴切的视觉表达，可以是插画、动漫、绘本、图形化、概念设定、卡通、物件象征、花卉、情侣头像感、风景化头像等；也允许脸模板、写真风或偏写实方案，但不要长期收敛成单一画风或几乎全都长得一样。风格必须服从角色特征，整体上保持丰富度与角色差异。'
        : '风格要求：头像应贴合角色人设，可以是写实或风格化，但要避免廉价模板感，并让视觉气质真正反映角色差异。',
      expertise ? `角色专长/兴趣：${expertise}` : '',
      personality ? `角色气质：${personality}` : '',
      speech ? `说话感觉：${speech}` : '',
      catchphrases ? `口头表达线索：${catchphrases}` : '',
      socialMask ? `对外给人的感觉：${socialMask}` : '',
      coreDesire ? `核心欲望：${coreDesire}` : '',
      coreFear ? `核心恐惧：${coreFear}` : '',
      character.group ? `角色圈层/标签：${character.group}` : '',
      archetypes ? `可考虑的视觉方向：${archetypes}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    nonPhotoreal
      ? 'Style requirement: prefer non-photoreal avatars. Choose a character-appropriate visual expression based on identity, interests, expertise, and vibe. It may be illustration, anime, storybook, graphic, concept-art, stylized cartoon, symbolic object motif, floral imagery, matching-couple aesthetic, or scenic/iconic avatar language. Face-template, idol-photo, and more realistic portrait solutions are still allowed, but the overall output should not collapse into one repetitive look or make nearly everyone feel visually the same. The style must follow the character and preserve variety across roles.'
      : 'Style requirement: the avatar should fit the character and may be realistic or stylized, but should avoid generic template-like portraits and reflect clear differences between characters.',
    expertise ? `Expertise and interests: ${expertise}` : '',
    personality ? `Vibe and personality: ${personality}` : '',
    speech ? `Speaking vibe: ${speech}` : '',
    catchphrases ? `Speech clues: ${catchphrases}` : '',
    socialMask ? `How they present themselves: ${socialMask}` : '',
    coreDesire ? `Core desire: ${coreDesire}` : '',
    coreFear ? `Core fear: ${coreFear}` : '',
    character.group ? `Social/cultural group tag: ${character.group}` : '',
    archetypes ? `Possible visual direction: ${archetypes}` : '',
  ].filter(Boolean).join('\n');
}

export function buildAvatarPrompt(character: AvatarPromptCharacterInput, language: 'zh' | 'en', settings: AvatarGenerationSettings) {
  return [
    language === 'zh'
      ? `为角色“${character.name.trim() || '未命名角色'}”生成一张聊天头像。`
      : `Generate a chat avatar portrait for the character "${character.name.trim() || 'Unnamed character'}".`,
    character.background?.trim() ? (language === 'zh' ? `背景设定：${character.background.trim()}` : `Background: ${character.background.trim()}`) : '',
    buildAvatarStyleDirectives(character, language, settings),
    language === 'zh'
      ? '构图要求：单主体，适合头像使用，正方形构图，突出面部和上半身或最有代表性的视觉主体，画面干净，不要文字，不要水印。'
      : 'Composition requirements: single subject, suitable for avatar use, square composition, focus on face and upper body or the most representative visual subject, clean image, no text, no watermark.',
  ].filter(Boolean).join('\n');
}

export function canAutoGenerateAvatarDraft(input: { name?: string; background?: string; expertise?: string[]; speakingStyle?: string }) {
  return Boolean(input.name?.trim() || input.background?.trim() || input.speakingStyle?.trim() || input.expertise?.length);
}

export function enqueueAvatarGenerationForCharacter(
  character: AvatarPromptCharacterInput,
  aiProfiles: AIModelProfile[],
  language: 'zh' | 'en',
  settings: AvatarGenerationSettings,
  options?: { targetKey?: string; characterId?: string | null },
) {
  const imageProfile = getPreferredAIProfile(aiProfiles, 'image');
  if (!imageProfile?.apiKey || !imageProfile?.model) {
    throw new Error(language === 'zh' ? '请先配置可用的默认图片模型' : 'Configure an available default image model first.');
  }
  return avatarGenerationQueue.enqueue(
    imageProfile,
    buildAvatarPrompt(character, language, settings),
    { targetKey: options?.targetKey || `character:${character.id}`, characterId: options?.characterId ?? character.id },
  );
}

export function enqueueAvatarGenerationForCharacters(
  characters: AvatarPromptCharacterInput[],
  aiProfiles: AIModelProfile[],
  language: 'zh' | 'en',
  settings: AvatarGenerationSettings,
) {
  return characters.map((character) => enqueueAvatarGenerationForCharacter(character, aiProfiles, language, settings));
}
