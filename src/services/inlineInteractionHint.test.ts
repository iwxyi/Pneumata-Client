import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { normalizeInteractionHintCollection } from '../types/runtimeEvent';
import { buildInlineInteractionContract, parseInlineInteractionEnvelope } from './inlineInteractionHint';

describe('parseInlineInteractionEnvelope story events', () => {
  it('keeps immediate social effects even when no relationship delta is warranted', () => {
    const hints = normalizeInteractionHintCollection({
      primary: { targetId: 'target', kind: 'probe', tone: 'cold', intensity: 4, confidence: 0.93, evidenceText: '为什么不敢看我', relationship: undefined },
      secondary: [],
    }, 'speaker', '你为什么不敢看我？');

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ actorId: 'speaker', targetId: 'target', kind: 'probe', intensity: 4 });
    expect(hints[0].relationship).toBeUndefined();
  });

  it('keeps bounded model-authored immediate impact without interpreting the prose locally', () => {
    const hints = normalizeInteractionHintCollection({
      primary: {
        targetId: 'target',
        kind: 'boundary',
        tone: 'defensive',
        intensity: 4,
        confidence: 0.94,
        evidenceText: '过不了我不签',
        immediateImpact: {
          speakerEmotionDelta: { irritation: -9, insecurity: -6 },
          targetEmotionDelta: { irritation: 7, insecurity: 53 },
          roomDelta: { heat: 8, cohesion: -3, topicDrift: 40 },
        },
      },
      secondary: [],
    }, 'speaker', '过不了我不签。');

    expect(hints[0].immediateImpact).toEqual({
      speakerEmotionDelta: { irritation: -9, insecurity: -6 },
      targetEmotionDelta: { irritation: 7, insecurity: 40 },
      roomDelta: { heat: 8, cohesion: -3, topicDrift: 20 },
    });
  });

  it('drops an interaction hint without a verifiable visible quote', () => {
    const hints = normalizeInteractionHintCollection({
      primary: { targetId: 'target', kind: 'support', tone: 'warm', intensity: 3, confidence: 0.9 },
      secondary: [],
    }, 'speaker', '把话写清楚，别只留两个字。');

    expect(hints).toEqual([]);
  });

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
  it('asks study rooms for structured evidence instead of local text guessing', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'study-1', type: 'group', mode: 'classroom', memberIds: ['teacher', 'user'], runtimeEventsV2: [],
        sessionKind: { topology: 'group', family: 'study', scenarioId: 'learning-progress', surfaceProfile: 'hybrid' },
      } as unknown as GroupChat,
      speaker: { id: 'teacher', name: '老师' } as AICharacter,
      characters: [{ id: 'teacher', name: '老师' } as AICharacter],
      recentMessages: [],
    });

    expect(contract).toContain('"studyUpdate"');
    expect(contract).toContain("teacher's explicit judgement of the most recent learner turn");
    expect(contract).toContain('studyUpdate is required for every learning-progress reply');
    expect(contract).toContain('knowledgeObservations:[]');
    expect(contract).toContain('Never infer mastery from encouragement');
  });

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

  it('lets conversational follow-ups be separate sends without making each a self-contained point', () => {
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
      richDelivery: { multiBubble: { proactivity: 'high', maxBubbles: 5, organization: 'conversational' }, image: { proactivity: 'off', explicitRequest: true }, audio: { proactivity: 'off', explicitRequest: true }, sticker: { proactivity: 'off', explicitRequest: true } },
      turnPlan: {
        rhythm: 'multi_bubble',
        maxBubbleCount: 3,
        lengthBand: 'medium',
        allowExtraMessages: true,
        waitSensitive: false,
        reasons: ['test'],
      },
    });

    expect(contract).toContain('"messages":null');
    expect(contract).toContain('messages[] is the ordered list only when');
    expect(contract).toContain('When messages[] is used');
    expect(contract).toContain('a thought can follow a beat later');
    expect(contract).toContain('typed in one sitting');
    expect(contract).toContain('does not automatically require another send');
    expect(contract).toContain('rather than a checklist of content types');
    expect(contract).toContain('most turns naturally settle into one send');
    expect(contract).toContain('need not be a self-contained point');
    expect(contract).toContain('Message count is a delivery choice');
    expect(contract).not.toContain('independently sendable communicative act');
    expect(contract).not.toContain('Most ordinary turns stay in one bubble');
    expect(contract).toContain('terminal punctuation is optional');
    expect(contract).toContain('this is chat even when the topic is serious');
    expect(contract).toContain('Do not make every bubble a complete written sentence');
    expect(contract).toContain('set content equal to messages[0].content');
    expect(contract).toContain('Audio must be the only media in its item');
    expect(contract).toContain('Do not split merely because the text has several sentences');
  });

  it('distinguishes reply targets from members who are only mentioned or affected', () => {
    const contract = buildInlineInteractionContract({
      chat: {
        id: 'chat-1',
        type: 'group',
        memberIds: ['speaker', 'mentioned', 'answerer'],
        runtimeEventsV2: [],
      } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '闻溪' } as AICharacter,
      characters: [
        { id: 'speaker', name: '闻溪' } as AICharacter,
        { id: 'mentioned', name: '程野' } as AICharacter,
        { id: 'answerer', name: '许棠' } as AICharacter,
      ],
      recentMessages: [],
    });

    expect(contract).toContain('"addressedTargets":null');
    expect(contract).toContain('addressedTargets tracks reply debt');
    expect(contract).toContain('not every person mentioned or emotionally affected');
    expect(contract).toContain('merely affected by the line is not addressed');
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
    expect(contract).toContain('image=medium');
    expect(contract).toContain('audio=off');
    expect(contract).toContain('not a quota or target');
  });

  it('uses the style policy ceiling rather than a fixed target bubble count', () => {
    const contract = buildInlineInteractionContract({
      chat: { id: 'chat-1', type: 'direct', memberIds: ['speaker'], runtimeEventsV2: [] } as unknown as GroupChat,
      speaker: { id: 'speaker', name: '说话人' } as AICharacter,
      characters: [{ id: 'speaker', name: '说话人' } as AICharacter], recentMessages: [],
      richDelivery: { multiBubble: { proactivity: 'high', maxBubbles: 5 }, image: { proactivity: 'off', explicitRequest: true }, audio: { proactivity: 'off', explicitRequest: true }, sticker: { proactivity: 'off', explicitRequest: true } },
      turnPlan: { rhythm: 'multi_bubble', maxBubbleCount: 2, lengthBand: 'short', allowExtraMessages: true, waitSensitive: false, reasons: ['test'] },
    });
    expect(contract).toContain('usual soft ceiling is 5');
    expect(contract).not.toContain('usual soft ceiling is 2');
    expect(contract).toContain('One bubble is appropriate when the thought would be typed in one sitting');
    expect(contract).toContain('Use separate messages[] items only when');
    expect(contract).toContain('Do not merge those distinct sends into one paragraph merely to be tidy');
    expect(contract).toContain('do not split a single sentence mechanically');
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

  it('uses a defensive message cap without dropping overflow text', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '一',
      messages: Array.from({ length: 10 }, (_, index) => ({ content: String(index + 1), mediaDecision: null })),
      extraMessages: null,
    }));
    expect(parsed?.messages).toHaveLength(8);
    expect(parsed?.messages?.[7]?.content).toBe('8\n9\n10');
  });

  it('keeps an overflow send with its own media decision', () => {
    const parsed = parseInlineInteractionEnvelope(JSON.stringify({
      content: '一',
      messages: Array.from({ length: 9 }, (_, index) => ({
        content: String(index + 1),
        mediaDecision: index === 8 ? { audio: { shouldGenerate: true, text: '9' } } : null,
      })),
      extraMessages: null,
    }));
    expect(parsed?.messages).toHaveLength(9);
    expect(parsed?.messages?.[8]?.mediaDecision?.audio?.shouldGenerate).toBe(true);
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
        maxBubbleCount: 1,
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

    expect(contract).toContain('socialEventHints: null unless the visible turn itself proposes');
    expect(contract).toContain('runtime will not infer them from keywords');
    expect(contract).toContain('participantIds/targetIds');
    expect(contract).toContain('existing dedupeKey when updating');
  });
});
