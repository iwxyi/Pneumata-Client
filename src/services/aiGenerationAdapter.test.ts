import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMAGE_AI_PROFILE } from '../types/settings';
import { generateImageWithAdapter, resolveImageGenerationRequest } from './aiGenerationAdapter';

describe('image generation default resolution', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the profile default while keeping explicit resolution and pixel size overrides', () => {
    const params = {
      profile: { ...DEFAULT_IMAGE_AI_PROFILE, defaultImageSize: '4K' as const },
      prompt: 'a tea cup',
      intent: 'chat-image' as const,
    };
    expect(resolveImageGenerationRequest(params).imageSize).toBe('4K');
    expect(resolveImageGenerationRequest({ ...params, imageSize: '2K' }).imageSize).toBe('2K');
    expect(resolveImageGenerationRequest({ ...params, size: '1024x1024' })).toMatchObject({ size: '1024x1024', imageSize: undefined });
    expect(resolveImageGenerationRequest({ ...params, profile: { ...params.profile, defaultImageSize: undefined } }).imageSize).toBe('1K');
  });

  it.each(['2K', '4K'] as const)('sends %s defaults and chat overrides through the Ace image proxy', async (defaultImageSize) => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AQID' } }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const params = {
      profile: { ...DEFAULT_IMAGE_AI_PROFILE, provider: 'official-ace-nanobanana', model: 'nano-banana-pro:official', defaultImageSize },
      prompt: 'a tea cup',
      intent: 'chat-image' as const,
      aspectRatio: '16:9',
    };
    await generateImageWithAdapter(params);
    await generateImageWithAdapter({ ...params, imageSize: '1K' });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)));
    expect(bodies[0].generationConfig.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: defaultImageSize });
    expect(bodies[1].generationConfig.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '1K' });
  });

  it('translates defaults into pixel sizes for OpenAI compatible image requests', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const params = {
      profile: { ...DEFAULT_IMAGE_AI_PROFILE, provider: 'openai', baseUrl: 'https://example.com/v1', model: 'image-model', defaultImageSize: '2K' as const },
      prompt: 'a tea cup', intent: 'chat-image' as const,
    };
    await generateImageWithAdapter(params);
    await generateImageWithAdapter({ ...params, imageSize: '4K' });
    await generateImageWithAdapter({ ...params, size: '1024x1536' });
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).size)).toEqual(['2048x2048', '4096x4096', '1024x1536']);
  });
});
