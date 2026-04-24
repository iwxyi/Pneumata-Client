import type { AICharacter } from '../types/character';
import type { AIModelProfile } from '../types/settings';
import { getPreferredAIProfile } from '../types/settings';
import { avatarGenerationQueue } from './avatarGenerationQueue';

function buildAvatarPrompt(character: Pick<AICharacter, 'id' | 'name' | 'background' | 'speakingStyle'>, language: 'zh' | 'en') {
  return [
    language === 'zh'
      ? `为角色“${character.name.trim() || '未命名角色'}”生成一张聊天头像。`
      : `Generate a chat avatar portrait for the character "${character.name.trim() || 'Unnamed character'}".`,
    character.background?.trim() ? (language === 'zh' ? `背景设定：${character.background.trim()}` : `Background: ${character.background.trim()}`) : '',
    character.speakingStyle?.trim() ? (language === 'zh' ? `说话风格与气质：${character.speakingStyle.trim()}` : `Speech style and vibe: ${character.speakingStyle.trim()}`) : '',
    language === 'zh'
      ? '要求：单人，正方形构图，突出脸部和上半身，适合角色头像，画面干净，不要文字，不要水印。'
      : 'Requirements: single character, square composition, focus on face and upper body, suitable as avatar, clean image, no text, no watermark.',
  ].filter(Boolean).join('\n');
}

export function canAutoGenerateAvatarDraft(input: { name?: string; background?: string }) {
  return Boolean(input.name?.trim() || input.background?.trim());
}

export function enqueueAvatarGenerationForCharacter(
  character: Pick<AICharacter, 'id' | 'name' | 'background' | 'speakingStyle'>,
  aiProfiles: AIModelProfile[],
  language: 'zh' | 'en',
) {
  const imageProfile = getPreferredAIProfile(aiProfiles, 'image');
  if (!imageProfile?.apiKey || !imageProfile?.model) {
    return null;
  }

  return avatarGenerationQueue.enqueue(
    imageProfile,
    buildAvatarPrompt(character, language),
    { targetKey: `character:${character.id}`, characterId: character.id },
  );
}

export function enqueueAvatarGenerationForCharacters(
  characters: Array<Pick<AICharacter, 'id' | 'name' | 'background' | 'speakingStyle'>>,
  aiProfiles: AIModelProfile[],
  language: 'zh' | 'en',
) {
  return characters
    .map((character) => enqueueAvatarGenerationForCharacter(character, aiProfiles, language))
    .filter(Boolean);
}
