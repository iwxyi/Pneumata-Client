import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { __chatEngineTestUtils } from './chatEngine';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';
import type { SpeakIntent } from './intentEngine';

const speaker = { name: '喜羊羊' } as AICharacter;
const defaultIntent: SpeakIntent = {
  shouldSpeak: true,
  reason: 'test',
  target: 'group',
  stance: 'challenge',
  emotionalTone: 'annoyed',
  delivery: 'short_reply',
  messageShape: 'single_sentence',
};

describe('chatEngine streaming preview', () => {
  it('suppresses incomplete JSON envelope chunks before content is available', () => {
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('{')).toBe(true);
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('  {"content"')).toBe(true);
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('```json\n{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"', speaker)).toBe('');
  });

  it('extracts visible content from partial JSON once content starts streaming', () => {
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"喜羊羊：先别急', speaker)).toBe('先别急');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"那也不至于', speaker)).toBe('那也不至于');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('直接纯文本', speaker)).toBe('直接纯文本');
  });

  it('keeps a natural multi-clause reply intact when finalizing the committed message', () => {
    const content = '谁站你这边了？我只是看喜羊羊不顺眼。';
    expect(__chatEngineTestUtils.finalizeResponse(content, defaultIntent, speaker, [])).toBe(content);
  });

  it('exposes image capability from the default image model when the character is not explicitly bound', () => {
    expect(__chatEngineTestUtils.buildMediaCapabilities({ id: 'char-1', modelProfileIds: {} } as AICharacter, [{
      id: 'image-default',
      name: '默认图片',
      type: 'image',
      provider: 'openai',
      apiKey: 'key',
      baseUrl: 'https://example.test',
      model: 'image-model',
      isDefault: true,
    }])).toEqual({ image: true, audio: false });
  });

  it('requires a media decision in the prompt contract when image generation is available', () => {
    const contract = buildInlineInteractionContract({
      chat: { id: 'chat-1', memberIds: ['char-1'], runtimeEventsV2: [] } as never,
      speaker: { id: 'char-1', name: '美羊羊' } as AICharacter,
      characters: [{ id: 'char-1', name: '美羊羊' } as AICharacter],
      recentMessages: [],
      mediaCapabilities: { image: true, audio: false },
    });

    expect(contract).toContain('mediaDecision is required when a media capability is available');
    expect(contract).toContain('Do not pretend the user can see a picture');
    expect(contract).toContain('image.prompt must be a complete image-generation prompt');
    expect(contract).toContain('Treat the requested image type as the center of the prompt');
    expect(contract).toContain('milk tea or food image should detail');
    expect(contract).toContain('while keeping them temporary and context-dependent');
    expect(contract).toContain('natural phone camera perspective');
    expect(contract).toContain('keep stable identity anchors across images');
  });

  it('preserves parsed image decisions and converts them into queued attachments', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '来啦，你看这杯杨枝甘露。',
      mediaDecision: {
        image: {
          shouldGenerate: true,
          reason: '用户明确想看图片',
          prompt: 'A cute WeChat-style photo of mango pomelo sago dessert on a table',
          altText: '一杯杨枝甘露甜品',
        },
      },
      interactionHints: null,
      socialEventHints: null,
      conflictFocus: null,
    }));
    const metadata = __chatEngineTestUtils.buildMessageMetadata({
      decision: parsed?.mediaDecision,
      capabilities: { image: true, audio: false },
      content: parsed?.content || '',
    });

    expect(metadata?.attachments).toHaveLength(1);
    expect(metadata?.attachments?.[0]).toMatchObject({
      kind: 'image',
      status: 'queued',
      promptText: 'A cute WeChat-style photo of mango pomelo sago dessert on a table',
      altText: '一杯杨枝甘露甜品',
    });
  });

  it('stores compact runtime decision metadata without requiring media generation', () => {
    const metadata = __chatEngineTestUtils.buildMessageMetadata({
      decision: null,
      capabilities: { image: false, audio: false },
      content: '我来接一下这个话题。',
      runtimeDecision: {
        directorIntent: {
          source: 'conflict',
          beatType: 'challenge',
          targetLineId: 'conflict-1',
          targetActorIds: ['a', 'b'],
          pressure: 0.8,
          reason: '冲突线正在升温',
        },
        narrativeLines: [{
          id: 'conflict-1',
          type: 'conflict',
          title: '当前矛盾',
          salience: 0.9,
          tension: 0.8,
          status: 'escalating',
          participantIds: ['a', 'b'],
        }],
        speakerScore: { actorId: 'a', finalScore: 1.2, reasons: ['conflict'] },
      },
    });

    expect(metadata?.attachments).toEqual([]);
    expect(metadata?.generationDecision).toBeUndefined();
    expect(metadata?.runtimeDecision?.directorIntent?.targetLineId).toBe('conflict-1');
    expect(metadata?.runtimeDecision?.speakerScore).toMatchObject({ actorId: 'a', finalScore: 1.2 });
  });
});
