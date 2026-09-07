import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_AI_PROFILE, inferTextInputCapabilities, normalizeAIProfiles } from './settings';

describe('normalizeAIProfiles', () => {
  it('treats official GPT text providers as vision-capable even without a GPT model alias', () => {
    expect(inferTextInputCapabilities('official-2', 'official-2')).toMatchObject({
      imageInput: true,
      multiImageInput: true,
    });
    expect(inferTextInputCapabilities('official-deepseek', 'deepseek-v4-flash')).toMatchObject({
      imageInput: true,
    });
  });

  it('provides official text and image profiles by default', () => {
    const profiles = normalizeAIProfiles();

    expect(profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        provider: 'official-deepseek',
        model: 'deepseek-v4-flash',
        isDefault: true,
      }),
      expect.objectContaining({
        type: 'image',
        provider: 'official-nanobanana',
        model: DEFAULT_IMAGE_AI_PROFILE.model,
        isDefault: true,
      }),
    ]));
  });

  it('backfills the official image profile when cloud settings only contain text profiles', () => {
    const profiles = normalizeAIProfiles([{
      id: 'default',
      name: 'Text',
      type: 'text',
      isDefault: true,
      provider: 'official-deepseek',
      apiKey: '',
      baseUrl: '/api/ai',
      model: 'deepseek-chat',
    }]);

    expect(profiles.find((profile) => profile.type === 'text')).toEqual(expect.objectContaining({
      provider: 'official-deepseek',
      model: 'deepseek-v4-flash',
      isDefault: true,
    }));
    expect(profiles.find((profile) => profile.type === 'image')).toEqual(expect.objectContaining({
      provider: 'official-nanobanana',
      model: DEFAULT_IMAGE_AI_PROFILE.model,
      isDefault: true,
    }));
  });

  it('migrates legacy official DeepSeek reasoner settings to the configured v4 pro model', () => {
    const profiles = normalizeAIProfiles([{
      id: 'default',
      name: 'Text',
      type: 'text',
      isDefault: true,
      provider: 'official-deepseek',
      apiKey: '',
      baseUrl: '/api/ai',
      model: 'deepseek-reasoner',
    }]);

    expect(profiles.find((profile) => profile.type === 'text')).toEqual(expect.objectContaining({
      provider: 'official-deepseek',
      model: 'deepseek-v4-pro',
      isDefault: true,
    }));
  });

  it('migrates legacy custom DeepSeek model settings to supported v4 names', () => {
    const profiles = normalizeAIProfiles([{
      id: 'custom-deepseek',
      name: 'DeepSeek',
      type: 'text',
      isDefault: true,
      provider: 'deepseek',
      apiKey: 'key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    }]);

    expect(profiles.find((profile) => profile.type === 'text')).toEqual(expect.objectContaining({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      isDefault: true,
    }));
  });
});
