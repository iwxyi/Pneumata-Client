import { describe, expect, it } from 'vitest';
import { formatScenarioBoardKind, formatScenarioRoleLabel } from './scenarioPresentation';

describe('scenarioPresentation', () => {
  it('formats common scenario role ids for user-facing UI', () => {
    expect(formatScenarioRoleLabel('werewolf')).toBe('狼人');
    expect(formatScenarioRoleLabel('seer')).toBe('预言家');
    expect(formatScenarioRoleLabel('interviewer')).toBe('面试官');
    expect(formatScenarioRoleLabel('candidate')).toBe('候选人');
    expect(formatScenarioRoleLabel('custom_role')).toBe('自定义角色');
    expect(formatScenarioRoleLabel('custom_role', 'en')).toBe('Custom Role');
  });

  it('formats board ids without exposing raw implementation names when known', () => {
    expect(formatScenarioBoardKind('grid')).toBe('网格棋盘');
    expect(formatScenarioBoardKind('gomoku')).toBe('五子棋盘');
    expect(formatScenarioBoardKind('custom-board')).toBe('自定义棋盘');
    expect(formatScenarioBoardKind('custom-board', 'en')).toBe('Custom Board');
  });
});
