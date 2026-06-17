import { describe, expect, it } from 'vitest';
import type { ParticipantInstance } from '../types/chat';
import { projectPrivateParticipantPayloads } from './privateRuntimePayloads';

function participant(id: string, privateState: ParticipantInstance['privateState']): ParticipantInstance {
  return {
    participantId: id,
    conversationId: 'chat-1',
    entityType: 'ai',
    entityRefId: id,
    roleKey: 'pair_private',
    flags: {},
    privateState,
  };
}

describe('privateRuntimePayloads', () => {
  it('deduplicates identical AI private thread context cards and notes', () => {
    const participants = [
      participant('a', {
        roleCard: {
          key: 'private-thread-card-a',
          title: '私聊上下文卡',
          summary: '你拥有该 AI 私聊的完整上下文。',
          details: ['这段私聊的细节不会完整广播回主群。'],
        },
        notes: ['AI私聊的完整上下文只对当前私聊双方可见。'],
      }),
      participant('b', {
        roleCard: {
          key: 'private-thread-card-b',
          title: '私聊上下文卡',
          summary: '你拥有该 AI 私聊的完整上下文。',
          details: ['这段私聊的细节不会完整广播回主群。'],
        },
        notes: ['AI私聊的完整上下文只对当前私聊双方可见。'],
      }),
    ];

    const payloads = projectPrivateParticipantPayloads(participants, 'pair_private');

    expect(payloads.map((item) => `${item.title}:${item.text}`)).toEqual([
      '私聊上下文卡:你拥有该 AI 私聊的完整上下文。 / 这段私聊的细节不会完整广播回主群。',
      '私有备注:AI私聊的完整上下文只对当前私聊双方可见。',
    ]);
  });

  it('keeps distinct private payloads visible', () => {
    const participants = [
      participant('a', { notes: ['A 的私有线索'] }),
      participant('b', { notes: ['B 的私有线索'] }),
    ];

    const payloads = projectPrivateParticipantPayloads(participants, 'pair_private');

    expect(payloads.map((item) => item.text)).toEqual(['A 的私有线索', 'B 的私有线索']);
  });
});
