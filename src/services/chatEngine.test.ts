import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { __chatEngineTestUtils } from './chatEngine';
import type { SpeakIntent } from './intentEngine';

const speaker = { name: '喜羊羊' } as AICharacter;
const defaultIntent: SpeakIntent = {
  shouldSpeak: true,
  reason: 'test',
  target: 'group',
  stance: 'challenge',
  emotionalTone: 'annoyed',
  delivery: 'short_reply',
  messageShape: 'single_sentence',
};

describe('chatEngine streaming preview', () => {
  it('suppresses incomplete JSON envelope chunks before content is available', () => {
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('{')).toBe(true);
    expect(__chatEngineTestUtils.isPendingJsonEnvelopeChunk('  {"content"')).toBe(true);
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('```json\n{', speaker)).toBeNull();
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"', speaker)).toBe('');
  });

  it('extracts visible content from partial JSON once content starts streaming', () => {
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"喜羊羊：先别急', speaker)).toBe('先别急');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('{"content":"那也不至于', speaker)).toBe('那也不至于');
    expect(__chatEngineTestUtils.buildStreamingDisplayContent('直接纯文本', speaker)).toBe('直接纯文本');
  });

  it('keeps a natural multi-clause reply intact when finalizing the committed message', () => {
    const content = '谁站你这边了？我只是看喜羊羊不顺眼。';
    expect(__chatEngineTestUtils.finalizeResponse(content, defaultIntent, speaker, [])).toBe(content);
  });
});
