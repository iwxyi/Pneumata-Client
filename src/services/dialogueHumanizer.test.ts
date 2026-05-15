import { describe, expect, it } from 'vitest';
import { postProcessHumanChat } from './dialogueHumanizer';
import type { SpeakIntent } from './intentEngine';

function questionOnlyIntent(): SpeakIntent {
  return {
    shouldSpeak: true,
    reason: 'test',
    target: 'group',
    stance: 'challenge',
    emotionalTone: 'annoyed',
    delivery: 'quick_question',
    messageShape: 'question_only',
  };
}

describe('dialogueHumanizer', () => {
  it('keeps a short follow-up stance after a question instead of truncating to the first sentence', () => {
    expect(
      postProcessHumanChat(
        '谁站你这边了？我只是看喜羊羊不顺眼',
        questionOnlyIntent(),
      ),
    ).toBe('谁站你这边了？我只是看喜羊羊不顺眼');
  });
});
