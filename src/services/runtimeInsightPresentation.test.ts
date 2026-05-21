import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { RuntimePressureProjection } from './runtimeDecision';
import { buildRuntimeInsightPresentation, formatKnownReason } from './runtimeInsightPresentation';

function buildCharacter(id: string, name: string): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildProjection(): RuntimePressureProjection {
  return {
    primaryLine: null,
    directorIntent: {
      source: 'conflict',
      beatType: 'escalate',
      targetActorIds: ['b'],
      pressure: 0.82,
      reason: 'Active conflict needs a response.',
      targetLineId: 'conflict-1',
    },
    narrativeLines: [{
      id: 'conflict-1',
      conversationId: 'chat-1',
      type: 'conflict',
      title: '当前矛盾',
      summary: '甲乙的价值冲突正在升温，需要有人接住当前压力。',
      participantIds: ['a', 'b'],
      visibility: 'public',
      status: 'escalating',
      tension: 0.8,
      momentum: 0.7,
      salience: 0.9,
      sourceEventIds: ['evt-1'],
      lastTouchedAt: 1,
      openQuestions: ['乙会反击还是缓和？'],
      possibleNextBeats: [{
        beatType: 'escalate',
        targetActorIds: ['b'],
        pressure: 0.84,
        reason: 'Active conflict needs a response.',
      }],
    }],
  };
}

describe('runtimeInsightPresentation', () => {
  it('builds user-facing labels without exposing debug chips by default', () => {
    const presentation = buildRuntimeInsightPresentation({
      projection: buildProjection(),
      members: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      includeDebug: false,
    });
    expect(presentation.directorIntent?.title).toBe('矛盾 · 升级');
    expect(presentation.directorIntent?.reason).toBe('当前矛盾需要有人接话。');
    expect(presentation.directorIntent?.targetNames).toEqual(['乙']);
    expect(presentation.lines[0]).toMatchObject({
      kindLabel: '矛盾线',
      statusLabel: '升温',
      participantNames: ['甲', '乙'],
      tone: 'conflict',
    });
  });

  it('adds debug rows for advanced runtime views', () => {
    const presentation = buildRuntimeInsightPresentation({
      projection: buildProjection(),
      members: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      includeDebug: true,
    });
    expect(presentation.directorIntent?.debugChips).toContain('压力 82%');
    expect(presentation.directorIntent?.debugChips).toContain('线索 conflict-1');
    expect(presentation.lines[0]?.debugChips).toEqual(['显著性 90%', '张力 80%', '动量 70%']);
    expect(presentation.lines[0]?.debugRows[0]).toContain('可能走向');
    expect(presentation.lines[0]?.debugRows.some((row) => row.includes('来源事件 1'))).toBe(true);
  });

  it('does not expose unknown English reasons directly', () => {
    expect(formatKnownReason('Relationship ledger has become salient')).toBe('关系账本中的变化已经足够显著。');
    expect(formatKnownReason('some new english fallback reason')).toBe('已有运行证据支持这个走向。');
  });

  it('cleans raw ids and runtime json from line text', () => {
    const projection = buildProjection();
    projection.narrativeLines[0] = {
      ...projection.narrativeLines[0],
      title: 'a 对 b 的关系正在变化',
      summary: 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67 对 {"eventType":"room_state_snapshot_v2"}',
      participantIds: ['missing-id'],
      openQuestions: ['a 会继续追问 b 吗？'],
    };
    const presentation = buildRuntimeInsightPresentation({
      projection,
      members: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      includeDebug: true,
    });
    expect(presentation.lines[0]?.title).toBe('甲 对 乙 的关系正在变化');
    expect(presentation.lines[0]?.summary).not.toContain('eventType');
    expect(presentation.lines[0]?.summary).not.toContain('e055aa1d');
    expect(presentation.lines[0]?.participantNames).toEqual(['成员']);
    expect(presentation.lines[0]?.debugRows.join('\n')).toContain('甲 会继续追问 乙 吗？');
  });
});
