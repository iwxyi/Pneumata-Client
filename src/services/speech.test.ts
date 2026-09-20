import { describe, expect, it } from 'vitest';
import { normalizeAudioDataUrl, realtimeSpeechUrl } from './speech';

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

describe('realtimeSpeechUrl', () => {
  it('targets the current origin and carries the selected managed STT profile', () => {
    const url = new URL(realtimeSpeechUrl(
      { provider: 'managed:volcengine', model: 'stt-volcengine' },
      { protocol: 'https:', host: 'app.example.test', token: 'token value' },
    ));
    expect(url.host).toBe('app.example.test');
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('token')).toBe('token value');
    expect(url.searchParams.get('providerCode')).toBe('volcengine');
    expect(url.searchParams.get('modelId')).toBe('stt-volcengine');
  });
});
