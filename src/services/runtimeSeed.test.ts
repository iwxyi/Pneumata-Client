import { describe, expect, it } from 'vitest';
import { classifyRuntimeArtifactSeedLine, normalizeRuntimeSeedArtifactLines, normalizeRuntimeSeedLines } from './runtimeSeed';

describe('runtimeSeed', () => {
  it('keeps declarative artifact seeds', () => {
    expect(normalizeRuntimeSeedLines('待核实线索清单\n计划：明天先核对线索，再整理公开时间线', 'artifact')).toEqual([
      '待核实线索清单',
      '计划：明天先核对线索，再整理公开时间线',
    ]);
  });

  it('rejects dialogue and rhetorical questions as artifact seeds', () => {
    expect(classifyRuntimeArtifactSeedLine('计划：哪里不靠谱了')).toMatchObject({ valid: false, reason: 'question_like' });
    expect(classifyRuntimeArtifactSeedLine('蕉太狼哥哥说得对呀')).toMatchObject({ valid: false, reason: 'dialogue_like' });
    expect(normalizeRuntimeSeedArtifactLines(['计划：哪里不靠谱了', '已公开版本时间线'])).toEqual(['已公开版本时间线']);
  });

  it('preserves note seeds without artifact-shape filtering', () => {
    expect(normalizeRuntimeSeedLines('计划：哪里不靠谱了\n这是一条前情记忆', 'note')).toEqual([
      '计划：哪里不靠谱了',
      '这是一条前情记忆',
    ]);
  });
});
