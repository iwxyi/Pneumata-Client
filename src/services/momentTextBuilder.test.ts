import { describe, expect, it } from 'vitest';
import { buildMomentPostText } from './momentTextBuilder';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';

function payload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  return {
    eventKind: 'post_moment',
    initiatorId: 'char-a',
    participantIds: ['char-a'],
    targetIds: ['char-b'],
    reasonType: 'world_attention_share_moment_inner',
    confidence: 0.9,
    urgency: 'soon',
    seedIntent: '想把刚才没说完的关系余味发成一条动态。',
    visibilityPlan: 'public',
    expectedArtifacts: ['moment_text'],
    sourceText: '刚才那段话没有说透。',
    ...overrides,
  };
}

describe('momentTextBuilder', () => {
  it('turns companionship seeds into natural public moment text without leaking runtime fields', () => {
    const text = buildMomentPostText('苏苏', payload({
      companionshipSeeds: [
        '公开动态只能把这类用户记忆泛化成“有人/懂的人/一个约定”的余味，不点名用户：用户说下次一起看展。',
        '对小雨的关系纹理可以私下写成余波，不要写成系统记录：小秘密：共同秘密是只有她们知道的暗号。',
      ],
    }));

    expect(text.length).toBeGreaterThan(8);
    expect(text).not.toContain('用户');
    expect(text).not.toContain('companionship');
    expect(text).not.toContain('运行时');
    expect(text).not.toContain('阶段');
    expect(text).not.toContain('分数');
    expect(text).not.toContain('关系纹理');
    expect(text).not.toContain('小秘密：');
    expect(text).not.toContain('发了一条动态');
  });

  it('keeps explicit generated moment text as the highest priority and strips image notes', () => {
    const text = buildMomentPostText('苏苏', payload({
      momentText: '今天的风刚刚好，连没说出口的话都轻了一点。（配图：一张自拍）',
      companionshipSeeds: ['公开动态可以带一点关系余味。'],
    }));

    expect(text).toBe('今天的风刚刚好，连没说出口的话都轻了一点。');
  });
});
