import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { buildGenerationRuntimeDebugRows } from './generationRuntimePresentation';

function buildMessage(): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-a',
    senderName: '甲',
    content: '测试内容',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    metadata: {
      runtimeDecision: {
        generationRuntime: {
          turnPlan: { moveClass: 'deepen', targetScope: 'topic', depth: 'deep', reason: 'group-discussion:discussion' },
          expressionPlan: { surface: 'analytical', texture: 'rich', rhythm: 'back_and_forth' },
          trace: { policyHits: ['analytical_room', 'deepen'], scenarioChecks: ['group-discussion', 'analysis'], duplicateDecision: 'none' },
        },
      },
    },
  } as Message;
}

describe('generationRuntimePresentation', () => {
  it('builds debug rows from generation runtime metadata', () => {
    const rows = buildGenerationRuntimeDebugRows(buildMessage());
    expect(rows.some((row) => row.label === 'Move' && row.value === 'deepen')).toBe(true);
    expect(rows.some((row) => row.label === 'Surface' && row.value === 'analytical')).toBe(true);
    expect(rows.some((row) => row.label === 'Scenario' && row.value.includes('group-discussion'))).toBe(true);
  });
});
