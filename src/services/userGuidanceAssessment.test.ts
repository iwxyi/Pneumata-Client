import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { APIConfig } from '../types/settings';
import { assessUserGuidance } from './userGuidanceAssessment';

const generateJsonResponseMock = vi.fn();
vi.mock('./aiClient', () => ({ generateJsonResponse: (...args: unknown[]) => generateJsonResponseMock(...args) }));

const characters = [{ id: 'a', name: '安安' }, { id: 'z', name: '周策' }] as AICharacter[];
const chat = { id: 'room', name: '项目群', type: 'group', mode: 'open_chat', topic: '' } as GroupChat;
const config = { provider: 'openai', apiKey: 'test', baseUrl: '', model: 'test' } as APIConfig;

describe('assessUserGuidance', () => {
  beforeEach(() => {
    generateJsonResponseMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('uses the model structure for nuanced addressee and suppression decisions', async () => {
    generateJsonResponseMock.mockResolvedValue(JSON.stringify({
      kind: 'direct_reply', actorIds: ['a'], mentionedActorIds: ['a', 'z'],
      suppressedActorIds: ['z'], deferredActorIds: [], hasHardConstraints: false,
      voiceRequest: false, stickerRequest: false, focusText: '让安安继续说完',
      beatType: 'answer', pressure: 0.94, maxTurns: 2, minTargetTurns: 2,
      reason: '用户纠正了上一轮被抢话的对象。', mediaRequest: null,
    }));
    const result = await assessUserGuidance({ config, chat, characters, message: { type: 'user', senderId: 'user', content: '我想听安安说，不是让周策替她答' } });
    expect(result).toMatchObject({ actorIds: ['a'], suppressedActorIds: ['z'], minTargetTurns: 2 });
    expect(generateJsonResponseMock.mock.calls[0]?.[3]).toEqual(expect.objectContaining({ maxTokens: 4_096 }));
  });

  it('falls back to an undirected one-turn response when model analysis fails', async () => {
    generateJsonResponseMock.mockRejectedValue(new Error('offline'));
    const result = await assessUserGuidance({ config, chat, characters, message: { type: 'user', senderId: 'user', content: '接着聊吧' } });
    expect(result).toMatchObject({ kind: 'topic_shift', actorIds: [], maxTurns: 1 });
    expect(generateJsonResponseMock).toHaveBeenCalledTimes(2);
  });

  it('retries truncated structured output without local text matching', async () => {
    generateJsonResponseMock
      .mockResolvedValueOnce('{"kind":"direct_reply","actorIds":["a"]')
      .mockResolvedValueOnce(JSON.stringify({
        kind: 'direct_reply', actorIds: ['a'], mentionedActorIds: [], hardConstraintActorIds: [],
        suppressedActorIds: [], deferredActorIds: [], hasHardConstraints: false,
        voiceRequest: false, stickerRequest: false, focusText: '让安安回答',
        beatType: 'answer', pressure: 0.9, maxTurns: 1, minTargetTurns: 1,
        reason: '用户直接把问题交给安安。', mediaRequest: null,
      }));

    const result = await assessUserGuidance({ config, chat, characters, message: { type: 'user', senderId: 'user', content: '你来回答。' } });

    expect(generateJsonResponseMock).toHaveBeenCalledTimes(2);
    expect(result?.actorIds).toEqual(['a']);
  });
});
