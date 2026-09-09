import { describe, expect, it } from 'vitest';
import { normalizeAudioDataUrl } from './speech';

describe('normalizeAudioDataUrl', () => {
  it('removes MediaRecorder MIME parameters before managed STT upload', () => {
    expect(normalizeAudioDataUrl('data:audio/webm;codecs=opus;base64,AAAA')).toBe('data:audio/webm;base64,AAAA');
  });

  it('keeps canonical data URLs unchanged', () => {
    expect(normalizeAudioDataUrl('data:audio/wav;base64,AAAA')).toBe('data:audio/wav;base64,AAAA');
  });

  it('does not rewrite non-data URLs', () => {
    expect(normalizeAudioDataUrl('blob:https://example.test/audio')).toBe('blob:https://example.test/audio');
  });
});
