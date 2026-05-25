import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { AIModelProfile } from '../types/settings';
import { processRichMessageMedia, retryRichMessageMedia } from './richMessageMedia';
import { generateImageWithAdapter } from './aiGenerationAdapter';

vi.mock('./api', () => ({
  api: {
    createMediaAsset: vi.fn(),
    updateMessageMetadata: vi.fn(),
  },
}));

vi.mock('./aiGenerationAdapter', () => ({
  generateImageWithAdapter: vi.fn(),
  synthesizeSpeechWithAdapter: vi.fn(),
}));

const imageProfile: AIModelProfile = {
  id: 'image-default',
  name: '默认图片',
  type: 'image',
  provider: 'openai',
  apiKey: 'key',
  baseUrl: 'https://example.test',
  model: 'image-model',
  isDefault: true,
};

const character = {
  id: 'mei',
  name: '美羊羊',
  avatar: '',
  modelProfileIds: {},
} as AICharacter;

const subjectCharacter = {
  id: 'hui',
  name: '灰太狼',
  avatar: '',
  visualIdentity: {
    description: '灰色狼，黄色补丁帽，两撇胡子',
    negativePrompt: 'no sheep ears',
    seed: 777,
  },
} as AICharacter;

function buildQueuedImageMessage(patch: Partial<Message> = {}): Message {
  return {
    id: patch.id || 'm-image',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'mei',
    senderName: '美羊羊',
    content: '我把图发你看。',
    emotion: 0,
    timestamp: 123,
    isDeleted: false,
    metadata: {
      attachments: [{
        id: 'image-1',
        kind: 'image',
        status: 'queued',
        promptText: '灰太狼证件照',
        altText: '灰太狼证件照',
        createdAt: 123,
        updatedAt: 123,
      }],
    },
    ...patch,
  };
}

describe('processRichMessageMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the message-level generation state as failed when image generation cannot run', async () => {
    const upserts: Message[] = [];

    await processRichMessageMedia({
      message: buildQueuedImageMessage(),
      character,
      aiProfiles: [],
      upsertMessage: (message) => upserts.push(message),
    });

    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.metadata?.attachments?.[0]?.status).toBe('generating');
    expect(upserts[0]?.metadata?.generation?.status).toBe('generating');
    expect(upserts[1]?.metadata?.attachments?.[0]?.status).toBe('failed');
    expect(upserts[1]?.metadata?.attachments?.[0]?.error).toBe('图片模型未配置');
    expect(upserts[1]?.metadata?.generation?.status).toBe('failed');
  });

  it('marks the message-level generation state as ready after a generated image is attached', async () => {
    vi.mocked(generateImageWithAdapter).mockResolvedValue([{
      dataUrl: 'data:image/png;base64,abc',
      mimeType: 'image/png',
    }]);
    const upserts: Message[] = [];

    await processRichMessageMedia({
      message: buildQueuedImageMessage(),
      character,
      aiProfiles: [imageProfile],
      upsertMessage: (message) => upserts.push(message),
    });

    expect(upserts.at(-1)?.metadata?.attachments?.[0]).toMatchObject({
      status: 'ready',
      url: 'data:image/png;base64,abc',
      mimeType: 'image/png',
    });
    expect(upserts.at(-1)?.metadata?.generation?.status).toBe('ready');
  });

  it('uses referenced subject characters for image generation instead of the sending character', async () => {
    vi.mocked(generateImageWithAdapter).mockResolvedValue([{
      dataUrl: 'data:image/png;base64,subject',
      mimeType: 'image/png',
    }]);
    const upserts: Message[] = [];

    await processRichMessageMedia({
      message: buildQueuedImageMessage({
        metadata: {
          attachments: [{
            id: 'image-1',
            kind: 'image',
            status: 'queued',
            promptText: '灰太狼证件照',
            altText: '灰太狼证件照',
            referenceCharacterIds: ['hui'],
            createdAt: 123,
            updatedAt: 123,
          }],
        },
      }),
      character,
      characters: [character, subjectCharacter],
      aiProfiles: [imageProfile],
      upsertMessage: (message) => upserts.push(message),
    });

    expect(generateImageWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      character: null,
      characters: [subjectCharacter],
      negativePrompt: 'no sheep ears',
      seed: 777,
    }));
    expect(upserts.at(-1)?.metadata?.attachments?.[0]).toMatchObject({
      status: 'ready',
      url: 'data:image/png;base64,subject',
    });
  });

  it('retries a failed media attachment by resetting it to queued and running the same pipeline', async () => {
    vi.mocked(generateImageWithAdapter).mockResolvedValue([{
      dataUrl: 'data:image/png;base64,retry',
      mimeType: 'image/png',
    }]);
    const failedMessage = buildQueuedImageMessage({
      metadata: {
        attachments: [{
          id: 'image-1',
          kind: 'image',
          status: 'failed',
          promptText: '灰太狼证件照',
          altText: '灰太狼证件照',
          error: '上次生成失败',
          createdAt: 123,
          updatedAt: 124,
        }],
        generation: { status: 'failed', updatedAt: 124 },
      },
    });
    const upserts: Message[] = [];

    await retryRichMessageMedia({
      message: failedMessage,
      attachmentId: 'image-1',
      character,
      aiProfiles: [imageProfile],
      upsertMessage: (message) => upserts.push(message),
    });

    expect(upserts[0]?.metadata?.attachments?.[0]).toMatchObject({
      status: 'queued',
      error: undefined,
      url: undefined,
    });
    expect(upserts[1]?.metadata?.attachments?.[0]?.status).toBe('generating');
    expect(upserts.at(-1)?.metadata?.attachments?.[0]).toMatchObject({
      status: 'ready',
      url: 'data:image/png;base64,retry',
    });
    expect(upserts.at(-1)?.metadata?.generation?.status).toBe('ready');
  });
});
