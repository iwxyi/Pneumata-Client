import { describe, expect, it } from 'vitest';
import { formatInnerImpulseLabel, formatInnerToneLabel, formatResponseSurfaceKindLabel, formatRoleFitLabel, formatSoulMetricLabel, formatSurfaceBasisLabel } from './runtimeDecisionLabels';

describe('runtimeDecisionLabels', () => {
  it('formats shared inner-life labels in Chinese and English', () => {
    expect(formatInnerImpulseLabel('show_off')).toBe('证明自己');
    expect(formatInnerImpulseLabel('show_off', 'zh', 'member')).toBe('想证明自己');
    expect(formatInnerImpulseLabel('show_off', 'en', 'insight')).toBe('Show');
    expect(formatInnerToneLabel('defensive')).toBe('防御');
    expect(formatSoulMetricLabel('trustInRoom')).toBe('房间安全感');
  });

  it('formats response surface labels without leaking enum values', () => {
    expect(formatResponseSurfaceKindLabel('professional')).toBe('专业表达');
    expect(formatResponseSurfaceKindLabel('professional', 'zh', 'clue')).toBe('专业讨论');
    expect(formatRoleFitLabel('capable')).toBe('角色能力支持');
    expect(formatRoleFitLabel('capable', 'zh', 'clue')).toBe('角色适合展开');
    expect(formatSurfaceBasisLabel('topic:professional-task')).toBe('主题请求专业表达');
  });
});
