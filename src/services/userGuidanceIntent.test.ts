import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { getGuidanceMemoryTargetActorIds, normalizeUserGuidanceIntent, parseUserGuidanceIntent } from './userGuidanceIntent';

function character(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

describe('userGuidanceIntent', () => {
  const members = [character('mei', '美羊羊'), character('hui', '灰太狼'), character('xi', '喜羊羊')];

  it('does not infer semantic guidance from prose in the compatibility path', () => {
    const intent = parseUserGuidanceIntent('让美羊羊帮灰太狼画一张证件照', members);
    expect(intent).toMatchObject({ kind: 'topic_shift', actorIds: [], mentionedActorIds: [], maxTurns: 1 });
    expect(intent?.mediaRequest).toBeUndefined();
  });

  it('normalizes a structured model decision and keeps valid member ids only', () => {
    const intent = normalizeUserGuidanceIntent({
      kind: 'media_request',
      actorIds: ['mei', 'unknown', 'mei'],
      mentionedActorIds: ['mei', 'hui'],
      suppressedActorIds: ['xi', 'mei'],
      deferredActorIds: ['hui', 'xi'],
      hasHardConstraints: true,
      hardConstraintActorIds: ['hui'],
      voiceRequest: false,
      stickerRequest: true,
      focusText: '由美羊羊给灰太狼制作证件照',
      beatType: 'answer',
      pressure: 2,
      maxTurns: 20,
      minTargetTurns: 2,
      reason: '用户明确指定了执行者和图片主体。',
      mediaRequest: { kind: 'image', subjectActorIds: ['hui', 'unknown'], subjectText: '灰太狼', actionText: '制作证件照' },
    }, '让美羊羊帮灰太狼画一张证件照', members);

    expect(intent).toMatchObject({
      kind: 'media_request', actorIds: ['mei'], mentionedActorIds: ['mei', 'hui'],
      suppressedActorIds: ['xi'], deferredActorIds: ['hui'], pressure: 1, maxTurns: 8,
      minTargetTurns: 2, stickerRequest: true,
      mediaRequest: { subjectActorIds: ['hui'] },
    });
  });

  it('uses structured discussed actors as memory targets', () => {
    const intent = normalizeUserGuidanceIntent({
      kind: 'direct_reply', actorIds: ['mei'], mentionedActorIds: ['mei', 'hui'],
      focusText: '美羊羊评价灰太狼', beatType: 'answer', pressure: 0.8, maxTurns: 1,
    }, '请她说说看法', members);
    expect(getGuidanceMemoryTargetActorIds(intent, members, 'mei')).toEqual(['hui']);
  });
});
