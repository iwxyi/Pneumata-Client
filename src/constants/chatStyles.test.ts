import { describe, expect, it } from 'vitest';
import { CHAT_STYLE_DEFINITIONS, CHAT_STYLE_PROMPT_DESCRIPTIONS, getChatStyleOption } from './chatStyles';
import type { ChatStyle } from '../types/chat';

describe('chatStyles', () => {
  const persistedStyles: ChatStyle[] = ['free', 'debate', 'brainstorm', 'roleplay'];

  it('keeps definitions aligned with persisted chat styles', () => {
    expect(CHAT_STYLE_DEFINITIONS.map((definition) => definition.value)).toEqual(persistedStyles);
  });

  it('provides product copy and prompt semantics for every style', () => {
    persistedStyles.forEach((style) => {
      const option = getChatStyleOption(style);
      expect(option.label.zh).toBeTruthy();
      expect(option.label.en).toBeTruthy();
      expect(option.description.zh).toBeTruthy();
      expect(option.description.en).toBeTruthy();
      expect(CHAT_STYLE_PROMPT_DESCRIPTIONS[style]).toContain('room');
    });
  });
});
