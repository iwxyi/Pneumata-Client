import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudioWithAdapter } from '../services/aiGenerationAdapter';
import { ApiError, api } from '../services/api';
import { normalizeAudioDataUrl, transcribeSpeech, usesManagedSpeechProfile } from '../services/speech';
import { storageKey } from '../constants/brand';
import type { AIModelProfile } from '../types/settings';

type SpeechInputOptions = {
  profile?: AIModelProfile;
  disabled?: boolean;
  language?: string;
  getBaseText: () => string;
  onTranscript: (text: string) => void;
  onFinalized?: (text: string) => void;
  onError: (message: string) => void;
};

function microphoneError() {
  if (window.location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return '语音输入需要 HTTPS 页面，请使用安全连接打开';
  if (!window.isSecureContext) return '语音输入需要 HTTPS 或 localhost 页面';
  return '当前浏览器不支持麦克风输入，请检查浏览器权限或更换浏览器';
}

function encodeWav(chunks: Float32Array[], sourceRate: number) {
  const sourceLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const source = new Float32Array(sourceLength);
  let offset = 0;
  chunks.forEach((chunk) => { source.set(chunk, offset); offset += chunk.length; });
  const sampleRate = 16_000;
  const samples = new Float32Array(Math.max(1, Math.round(source.length * sampleRate / sourceRate)));
  samples.forEach((_sample, index) => {
    const position = index * sourceRate / sampleRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, source.length - 1);
    samples[index] = (source[left] || 0) * (1 - (position - left)) + (source[right] || 0) * (position - left);
  });
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (at: number, value: string) => Array.from(value).forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff), true));
  return new Blob([buffer], { type: 'audio/wav' });
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error || new Error('读取录音失败')); reader.readAsDataURL(blob); });
}

export function useSpeechInput({ profile, disabled, language = 'zh', getBaseText, onTranscript, onFinalized, onError }: SpeechInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const startingRef = useRef(false);
  const recorderRef = useRef<{ context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; muted: GainNode; stream: MediaStream; chunks: Float32Array[] } | null>(null);
  const realtimeRef = useRef<{ socket: WebSocket; ready: boolean; failed: boolean; final: boolean; transcript: string; pending: ArrayBuffer[] } | null>(null);
  const baseTextRef = useRef('');
  const optionsRef = useRef({ getBaseText, onTranscript, onFinalized, onError });
  optionsRef.current = { getBaseText, onTranscript, onFinalized, onError };
  const present = useCallback((speech: string) => {
    const text = speech.trim();
    const base = baseTextRef.current.trim();
    return base && text ? `${base} ${text}` : base || text;
  }, []);
  const cleanup = useCallback(() => {
    const recorder = recorderRef.current; recorderRef.current = null;
    if (recorder) { recorder.processor.disconnect(); recorder.source.disconnect(); recorder.muted.disconnect(); recorder.stream.getTracks().forEach((track) => track.stop()); void recorder.context.close(); }
    const realtime = realtimeRef.current; realtimeRef.current = null; realtime?.socket.close();
  }, []);
  const startRecording = useCallback(async () => {
    if (isRecording || startingRef.current || disabled || isTranscribing) return;
    if (!profile) { optionsRef.current.onError('请先在模型页面配置语音（STT）模型'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { optionsRef.current.onError(microphoneError()); return; }
    startingRef.current = true;
    try {
      // WebSocket cannot reuse the HTTP client's Authorization header. Verify the
      // browser's current login state before opening the microphone, so a rejected
      // realtime handshake never degrades into a misleading post-recording error.
      await api.getMe();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!window.AudioContext) throw new Error('当前浏览器不支持 WAV 语音输入，请使用新版 Chrome、Edge 或 Safari');
      baseTextRef.current = optionsRef.current.getBaseText();
      const context = new AudioContext(); const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1); const muted = context.createGain(); muted.gain.value = 0;
      const session = (() => {
        const token = localStorage.getItem(storageKey('token')); if (!token) return null;
        const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/speech/stt/stream?token=${encodeURIComponent(token)}`);
        const next = { socket, ready: false, failed: false, final: false, transcript: '', pending: [] as ArrayBuffer[] };
        socket.onmessage = (event) => {
          try { const message = JSON.parse(String(event.data || '')) as { type?: string; text?: string };
            if (message.type === 'ready') { next.ready = true; next.pending.forEach((chunk) => socket.send(chunk)); next.pending = []; }
            if (message.type === 'transcript' && typeof message.text === 'string') { next.transcript = message.text; next.final = Boolean((message as { final?: boolean }).final); optionsRef.current.onTranscript(present(message.text)); }
            if (message.type === 'error') next.failed = true;
          } catch (error) { next.failed = true; console.warn('实时语音消息解析失败', error); }
        };
        socket.onerror = () => { next.failed = true; };
        return next;
      })();
      realtimeRef.current = session;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => { const chunk = new Float32Array(event.inputBuffer.getChannelData(0)); chunks.push(chunk); if (!session || session.socket.readyState !== WebSocket.OPEN) return; const ratio = context.sampleRate / 16_000; const pcm = new Int16Array(Math.max(1, Math.round(chunk.length / ratio))); pcm.forEach((_item, index) => { const sample = chunk[Math.min(chunk.length - 1, Math.floor(index * ratio))] || 0; pcm[index] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff); }); if (session.ready) session.socket.send(pcm.buffer); else session.pending.push(pcm.buffer); };
      source.connect(processor); processor.connect(muted); muted.connect(context.destination); recorderRef.current = { context, source, processor, muted, stream, chunks }; setIsRecording(true);
    } catch (error) {
      cleanup();
      if (error instanceof ApiError && error.status === 401) optionsRef.current.onError('当前登录状态未被服务器接受，请重新登录后再使用语音输入');
      else optionsRef.current.onError(error instanceof Error ? error.message : '无法访问麦克风');
    } finally { startingRef.current = false; }
  }, [cleanup, disabled, isRecording, isTranscribing, present, profile]);
  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current; if (!recorder) return; const realtime = realtimeRef.current; recorderRef.current = null; recorder.processor.disconnect(); recorder.source.disconnect(); recorder.muted.disconnect(); recorder.stream.getTracks().forEach((track) => track.stop()); void recorder.context.close(); setIsRecording(false);
    const wav = encodeWav(recorder.chunks, recorder.context.sampleRate);
    const fallback = () => {
      realtime?.socket.close(); realtimeRef.current = null; setIsTranscribing(true);
      void (async () => { try { const result = usesManagedSpeechProfile(profile!) ? await transcribeSpeech({ providerCode: profile!.provider.startsWith('managed:') ? profile!.provider.slice('managed:'.length) : undefined, modelId: profile!.model, audioDataUrl: normalizeAudioDataUrl(await dataUrl(wav)), fileName: 'voice-input.wav', language }) : await transcribeAudioWithAdapter({ profile: profile!, file: wav, fileName: 'voice-input.wav', language, intent: 'audio-transcription' }); const text = present(result.text); if (result.text.trim()) optionsRef.current.onTranscript(text); optionsRef.current.onFinalized?.(text); } catch (error) { optionsRef.current.onError(error instanceof Error ? error.message : '语音转文字失败'); } finally { setIsTranscribing(false); } })();
    };
    if (!realtime || realtime.failed || realtime.socket.readyState !== WebSocket.OPEN) { fallback(); return; }
    realtime.socket.send(JSON.stringify({ type: 'stop' }));
    const deadline = window.setTimeout(() => { if (realtime.transcript.trim() && !realtime.failed) { optionsRef.current.onFinalized?.(present(realtime.transcript)); realtime.socket.close(); realtimeRef.current = null; } else fallback(); }, 1500);
    const handleFinal = () => { if (!realtime.final) return; window.clearTimeout(deadline); realtime.socket.removeEventListener('message', handleFinal); optionsRef.current.onFinalized?.(present(realtime.transcript)); realtime.socket.close(); realtimeRef.current = null; };
    realtime.socket.addEventListener('message', handleFinal);
  }, [cleanup, language, present, profile]);
  useEffect(() => cleanup, [cleanup]);
  return { isRecording, isTranscribing, startRecording, stopRecording };
}
