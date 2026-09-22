import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';

describe('parseInlineInteractionEnvelope story events', () => {
  it('keeps social outing participant states from inline diagnostics', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '周末一起去吃火锅吧。',
      extraMessages: null,
      intentionalRepeat: false,
      conflictFocus: null,
      interactionHints: null,
      socialEventHints: [{
        eventKind: 'social_outing',
        participantIds: ['speaker', 'friend'],
        targetIds: ['friend'],
        reasonType: 'chat_activity_invite',
        confidence: 0.88,
        urgency: 'soon',
        seedIntent: '把聊天里的邀约作为候选活动。',
        visibilityPlan: 'public',
        expectedArtifacts: ['outing_summary'],
        title: '吃火锅',
        activityType: '聚餐',
        timeHint: '周末',
        locationHint: null,
        dedupeKey: 'outing-hotpot',
        participantStates: { speaker: 'interested', friend: 'invited', invalid: 'unknown' },
      }],
    }));

    expect(parsed?.socialEventHints?.[0]?.participantStates).toEqual({ speaker: 'interested', friend: 'invited' });
  });

  it('accepts story-reader output with empty content when storyEvents have visible narration', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '',
      storyEvents: [
        { type: 'narration', text: '雨水顺着医院旧楼的铁门往下流。' },
        { type: 'speech', characterId: 'lin', speakerName: '林医生', text: '不要开那扇门。' },
      ],
      storyChoices: null,
      extraMessages: null,
      intentionalRepeat: false,
      conflictFocus: null,
      interactionHints: null,
      socialEventHints: null,
    }));

    expect(parsed?.content).toBe('');
    expect(parsed?.storyEvents).toEqual([
      { type: 'narration', text: '雨水顺着医院旧楼的铁门往下流。' },
      { type: 'speech', characterId: 'lin', speakerName: '林医生', text: '不要开那扇门。' },
    ]);
  });

  it('drops abstract or malformed storyEvents instead of treating them as visible output', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '',
      storyEvents: [
        { type: 'narration', text: '   ' },
        { type: 'choice_point', choices: [{ label: '追查线索' }] },
      ],
      extraMessages: null,
    }));

    expect(parsed).toBeNull();
  });
});

describe('buildInlineInteractionContract analysis room detection', () => {
  it('requires deliberation artifacts when scenario resolves to analysis even if family is stale', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'group',
        mode: 'group_discussion',
        sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'opinion-review', surfaceProfile: 'text' },
        memberIds: ['speaker'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '审议者' } as AICharacter,
      characters: [{ id: 'speaker', name: '审议者' } as AICharacter],
      recentMessages: [],
    });

    expect(contract).toContain('"deliberationArtifacts": {"claims"');
    expect(contract).not.toContain('"deliberationArtifacts": null');
    expect(contract).toContain('Rules for deliberationArtifacts');
    expect(contract).toContain('visible content must either make a deliberative move');
  });

  it('describes messages protocol as the preferred independent bubble format', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'direct',
        memberIds: ['speaker'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [{ id: 'speaker', name: '说话人' } as AICharacter],
      recentMessages: [],
      turnPlan: {
        rhythm: 'multi_bubble',
        targetBubbleCount: 3,
        lengthBand: 'medium',
        allowExtraMessages: true,
        waitSensitive: false,
        reasons: ['test'],
      },
    });

    expect(contract).toContain('"messages":[{"content":"先发文字"');
    expect(contract).toContain('messages[]: use null when there is only one send');
    expect(contract).toContain('If the answer is yes, prefer messages[] for independent sends');
    expect(contract).toContain('Audio must be the only media in its item');
    expect(contract).toContain('A bubble may contain one or more paragraphs');
  });

  it('exposes room delivery policy without turning it into a media quota', () => {
    const contract = buildInlineInteractionContract({
      chat: { id: 'chat-1', type: 'direct', memberIds: ['speaker'], runtimeEventsV2: [] } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [{ id: 'speaker', name: '说话人' } as AICharacter],
      recentMessages: [],
      mediaCapabilities: { image: true, audio: true, sticker: true },
      richDelivery: {
        multiBubble: { proactivity: 'medium', maxBubbles: 2 },
        image: { proactivity: 'medium', explicitRequest: true },
        audio: { proactivity: 'off', explicitRequest: true },
        sticker: { proactivity: 'off', explicitRequest: true },
      },
    });

    expect(contract).toContain('Delivery policy for this room');
    expect(contract).toContain('proactive image=medium');
    expect(contract).toContain('proactive audio=off');
    expect(contract).toContain('they are never quotas');
  });

  it('parses the messages protocol and keeps per-message media decisions', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '第一句',
      messages: [
        { content: '第一句', mediaDecision: null },
        { content: '第二句', mediaDecision: { audio: { shouldGenerate: true, text: '第二句' } } },
      ],
      extraMessages: null,
    }));
    expect(parsed?.messages).toEqual([
      { content: '第一句', mediaDecision: null },
      { content: '第二句', mediaDecision: { audio: { shouldGenerate: true, text: '第二句' } } },
    ]);
  });

  it('includes generated image prompts as lightweight image reference summaries', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'group',
        memberIds: ['speaker'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [{ id: 'speaker', name: '说话人' } as AICharacter],
      recentMessages: [{
        id: 'message-image',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'speaker',
        senderName: '说话人',
        content: '这张红烧肉照片可以用作封面。',
        emotion: 0,
        timestamp: 10,
        isDeleted: false,
        metadata: {
          attachments: [{
            id: 'image-1',
            kind: 'image',
            status: 'ready',
            altText: '红烧肉照片',
            caption: '红烧肉成品图',
            promptText: 'A realistic braised pork belly dish, glossy sauce, warm restaurant lighting',
            semanticSummary: '模型识别：红烧肉色泽红亮，适合做封面。',
            url: 'data:image/png;base64,AAA',
            mimeType: 'image/png',
            createdAt: 10,
            updatedAt: 10,
          }],
        },
      }],
      mediaCapabilities: { image: true, audio: false },
      mediaRequested: true,
    });

    expect(contract).toContain('imageReferenceRegistry');
    expect(contract).toContain('Infer the user\'s actual image goal from the latest message plus recent conversation');
    expect(contract).toContain('Each image prompt must be final model-ready text');
    expect(contract).toContain('"refId":"message-image:image-1"');
    expect(contract).toContain('"promptText":"A realistic braised pork belly dish');
    expect(contract).toContain('"semanticSummary":"模型识别：红烧肉色泽红亮，适合做封面。"');
    expect(contract).not.toContain('data:image/png;base64,AAA');
  });

  it('still allows paragraph breaks inside one-bubble turns', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'group',
        memberIds: ['speaker'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [{ id: 'speaker', name: '说话人' } as AICharacter],
      recentMessages: [],
      turnPlan: {
        rhythm: 'short_reply',
        targetBubbleCount: 1,
        lengthBand: 'short',
        allowExtraMessages: false,
        waitSensitive: false,
        reasons: ['test'],
      },
    });

    expect(contract).toContain('one bubble is the default');
    expect(contract).toContain('content may still contain paragraph breaks');
  });

  it('documents social outing fields and model-authored follow-up updates', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'group',
        memberIds: ['speaker', 'friend'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [
        { id: 'speaker', name: '说话人' } as AICharacter,
        { id: 'friend', name: '朋友' } as AICharacter,
      ],
      recentMessages: [],
    });

    expect(contract).toContain('social_outing rules');
    expect(contract).toContain('runtime will not invent or patch a social_outing from local keyword matching');
    expect(contract).toContain('You must emit one social_outing');
    expect(contract).toContain('old tea house with the blue curtain');
    expect(contract).toContain('"participantStates":{"speaker-id":"interested","other-id":"invited"}');
    expect(contract).toContain('emit social_outing with the same dedupeKey');
    expect(contract).toContain('the runtime will not extract those updates from keywords');
    expect(contract).toContain('participantIds/targetIds must use member ids');
  });
});
