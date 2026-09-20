import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVoicePlayback } from './useVoicePlayback';

function smoothWaveform(values: number[], radius: number) {
  if (values.length < 2 || radius < 1) return values;
  const sigma = Math.max(1, radius / 2);
  const weights = Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const distance = index - radius;
    return Math.exp(-(distance * distance) / (2 * sigma * sigma));
  });
  return values.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    weights.forEach((weight, weightIndex) => {
      const sourceIndex = Math.max(0, Math.min(values.length - 1, index + weightIndex - radius));
      total += values[sourceIndex] * weight;
      weightTotal += weight;
    });
    return total / weightTotal;
  });
}

function waveformPath(amplitudes: number[], width: number, height: number) {
  if (!amplitudes.length) return '';
  const step = width / Math.max(amplitudes.length - 1, 1);
  const points = amplitudes.map((amplitude, index) => [
    index * step,
    height - (Math.max(0, Math.min(1, amplitude)) * height * 0.86 + height * 0.07),
  ] as const);
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];
    const controlOneX = current[0] + (next[0] - previous[0]) / 9;
    const controlOneY = current[1] + (next[1] - previous[1]) / 9;
    const controlTwoX = next[0] - (following[0] - current[0]) / 9;
    const controlTwoY = next[1] - (following[1] - current[1]) / 9;
    path += ` C ${controlOneX} ${controlOneY} ${controlTwoX} ${controlTwoY} ${next[0]} ${next[1]}`;
  }
  return path;
}

function formatRemainingVoiceTime(milliseconds: number) {
  const rounded = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return minutes > 0 ? `${minutes}′${String(seconds).padStart(2, '0')}″` : `${seconds}″`;
}

export function VoicePlaybackBar({
  src,
  initialDurationMs,
  estimatedDurationMs,
  transcript,
  autoPlay = false,
  onAutoPlayStarted,
  onToggleReady,
  onPlaybackError,
}: {
  src: string;
  initialDurationMs?: number;
  estimatedDurationMs?: number;
  transcript?: string;
  autoPlay?: boolean;
  onAutoPlayStarted?: () => void;
  onToggleReady?: (toggle: () => Promise<void>) => void;
  onPlaybackError?: (message: string) => void;
}) {
  const waveformStyle = useSettingsStore((state) => state.chatAppearance.voiceWaveformStyle || 'wave');
  const playback = useVoicePlayback({ src, initialDurationMs, estimatedDurationMs, onError: onPlaybackError });
  const { audioRef, audioProps, playing, progress, remainingDurationMs, playbackError, seek, toggle } = playback;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const autoPlayedSourceRef = useRef<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const gradientId = useId().replace(/:/g, '');
  const waveformPathValue = useMemo(() => waveformPath(waveform, 260, 38), [waveform]);
  const visibleBars = waveform.length ? waveform.map((sample) => 20 + sample * 80) : Array.from({ length: 36 }, () => 28);
  const constellationPoints = useMemo(() => {
    const samples = (waveform.length ? waveform : Array.from({ length: 7 }, (_, index) => 0.3 + (index % 3) * 0.2));
    const step = Math.max(1, Math.floor(samples.length / 7));
    return Array.from({ length: 7 }, (_, index) => {
      const sample = samples[Math.min(samples.length - 1, index * step)] || 0.5;
      return { x: 8 + index * 40.5, y: 31 - sample * 24 };
    });
  }, [waveform]);

  useEffect(() => {
    let cancelled = false;
    const loadWaveform = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`无法读取语音波形：${response.status}`);
        const audioData = await response.arrayBuffer();
        const AudioContextConstructor = window.AudioContext;
        if (!AudioContextConstructor) return;
        const context = new AudioContextConstructor();
        try {
          const decoded = await context.decodeAudioData(audioData.slice(0));
          const samples = decoded.getChannelData(0);
          const barCount = 96;
          const samplesPerBar = Math.max(1, Math.floor(samples.length / barCount));
          const rawEnergy = Array.from({ length: barCount }, (_, index) => {
            const start = index * samplesPerBar;
            const end = Math.min(samples.length, start + samplesPerBar);
            let energy = 0;
            for (let position = start; position < end; position += 1) energy += (samples[position] || 0) ** 2;
            return Math.sqrt(energy / Math.max(1, end - start));
          });
          const smoothed = smoothWaveform(rawEnergy, 7);
          const ordered = [...smoothed].sort((left, right) => left - right);
          const quiet = ordered[Math.floor(ordered.length * 0.08)] || 0;
          const loud = ordered[Math.max(0, Math.ceil(ordered.length * 0.92) - 1)] || quiet;
          const range = loud - quiet;
          const normalized = range > 0.000001
            ? smoothWaveform(smoothed.map((energy) => Math.max(0, Math.min(1, 0.5 + ((energy - quiet) / range - 0.5) * 1.22))), 2)
            : Array.from({ length: barCount }, () => 0.5);
          if (!cancelled) setWaveform(normalized);
        } finally {
          await context.close();
        }
      } catch {
        if (!cancelled) setWaveform([]);
      }
    };
    void loadWaveform();
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    if (!autoPlay || autoPlayedSourceRef.current === src) return;
    autoPlayedSourceRef.current = src;
    onAutoPlayStarted?.();
    void toggle();
  }, [autoPlay, onAutoPlayStarted, src, toggle]);

  useEffect(() => {
    onToggleReady?.(toggle);
  }, [onToggleReady, toggle]);

  const seekAt = (clientX: number) => seek(clientX, trackRef.current);
  return (
    <Box sx={(theme) => ({
      '--voice-accent': theme.palette.primary.main,
      '--voice-secondary': theme.palette.secondary.main,
      '--voice-muted': theme.palette.mode === 'dark' ? 'rgba(255,255,255,.24)' : 'rgba(15,23,42,.18)',
      display: 'grid', gap: transcript ? 0.55 : 0, width: 'min(320px, 100%)', maxWidth: '100%',
    })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.65, px: 0.9, py: 0.55, borderRadius: 2.5, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
        <audio {...audioProps} style={{ display: 'none' }} />
        <IconButton size="small" onClick={() => void toggle()} aria-label={playing ? '暂停语音' : '播放语音'}>
          {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
        </IconButton>
        <Box
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="语音播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          sx={{ position: 'relative', flex: 1, height: 30, cursor: 'pointer', touchAction: 'none', outline: 'none', '&:focus-visible': { borderRadius: 1, boxShadow: '0 0 0 2px rgba(255,112,67,.48)' }, '@keyframes voiceEchoRing': { '0%': { transform: 'scale(.55)', opacity: 0 }, '35%': { opacity: 0.75 }, '100%': { transform: 'scale(1.08)', opacity: 0 } }, '@keyframes voiceStarPulse': { '0%, 100%': { transform: 'scale(.72)', opacity: 0.55 }, '50%': { transform: 'scale(1.35)', opacity: 1 } }, '@keyframes voiceHelix': { '0%, 100%': { transform: 'translateY(-5px)' }, '50%': { transform: 'translateY(5px)' } }, '@keyframes voiceComet': { from: { strokeDashoffset: 280 }, to: { strokeDashoffset: -30 } }, '@media (prefers-reduced-motion: reduce)': { '& .voice-playback-motion': { animation: 'none !important' } } }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekAt(event.clientX); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX); }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); seekAt(event.clientX); }}
          onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio?.duration) return;
            const stepSeconds = event.shiftKey ? 10 : 5;
            if (event.key === 'ArrowLeft') { event.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - stepSeconds); }
            else if (event.key === 'ArrowRight') { event.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + stepSeconds); }
            else if (event.key === 'Home') { event.preventDefault(); audio.currentTime = 0; }
            else if (event.key === 'End') { event.preventDefault(); audio.currentTime = audio.duration; }
          }}
        >
          {waveformStyle === 'blocks' || waveformStyle === 'pulse' ? (
            <Box aria-hidden="true" sx={{ height: '100%', display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden' }}>
              {visibleBars.map((peak, index) => <Box key={index} sx={{ flex: 1, minWidth: 2, height: `${Math.max(waveformStyle === 'pulse' ? 18 : 26, peak)}%`, borderRadius: 99, bgcolor: 'var(--voice-accent)', opacity: waveformStyle === 'pulse' ? 0.42 + (peak / 100) * 0.58 : 0.82, transformOrigin: 'center', animation: waveformStyle === 'pulse' && playing ? `voicePulse ${0.78 + (index % 5) * 0.11}s ease-in-out ${-(index % 4) * 0.12}s infinite alternate` : 'none', '@keyframes voicePulse': { from: { transform: 'scaleY(.72)' }, to: { transform: 'scaleY(1.08)' } }, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} />)}
            </Box>
          ) : waveformStyle === 'spectrum' ? (
            <Box aria-hidden="true" sx={{ height: '100%', display: 'flex', alignItems: 'center', gap: '2px', overflow: 'hidden' }}>
              {visibleBars.map((peak, index) => <Box key={index} sx={{ flex: 1, minWidth: 2, height: `${Math.max(24, peak)}%`, borderRadius: 1, background: 'linear-gradient(180deg, var(--voice-secondary), var(--voice-accent))', opacity: 0.44 + (index % 5) * 0.11, boxShadow: '0 0 6px color-mix(in srgb, var(--voice-secondary) 55%, transparent)' }} />)}
            </Box>
          ) : waveformStyle === 'echo' ? (
            <Box aria-hidden="true" sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-around', overflow: 'hidden' }}>
              {Array.from({ length: 7 }, (_, index) => <Box key={index} sx={{ position: 'relative', width: 26, height: 22, display: 'grid', placeItems: 'center' }}><Box sx={{ width: 3.5, height: 3.5, borderRadius: '50%', bgcolor: index % 2 ? 'var(--voice-secondary)' : 'var(--voice-accent)' }} />{[0, 1].map((ring) => <Box key={ring} className="voice-playback-motion" sx={{ position: 'absolute', width: 24, height: 14, border: '1px solid', borderColor: index % 2 ? 'var(--voice-secondary)' : 'var(--voice-accent)', borderRadius: '50%', animation: playing ? `voiceEchoRing 1.8s ease-out ${ring * 0.7 + index * 0.08}s infinite` : 'none' }} />)}</Box>)}
            </Box>
          ) : waveformStyle === 'constellation' ? (
            <svg viewBox="0 0 260 38" preserveAspectRatio="none" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
              <polyline points={constellationPoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="var(--voice-accent)" strokeWidth="1" opacity=".34" vectorEffect="non-scaling-stroke" />
              {constellationPoints.map((point, index) => <circle key={point.x} className="voice-playback-motion" cx={point.x} cy={point.y} r={index % 3 === 0 ? 3 : 2.2} fill={index % 2 ? 'var(--voice-secondary)' : 'var(--voice-accent)'} style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: playing ? `voiceStarPulse 1.7s ease-in-out ${index * 0.16}s infinite` : 'none', filter: 'drop-shadow(0 0 3px var(--voice-accent))' }} />)}
            </svg>
          ) : waveformStyle === 'helix' ? (
            <Box aria-hidden="true" sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-around', overflow: 'hidden' }}>
              {Array.from({ length: 18 }, (_, index) => <Box key={index} sx={{ width: 2, height: 14, position: 'relative', bgcolor: 'divider' }}><Box className="voice-playback-motion" sx={{ position: 'absolute', left: -1.5, top: -1.5, width: 5, height: 5, borderRadius: '50%', bgcolor: 'var(--voice-accent)', animation: playing ? `voiceHelix 1.5s ease-in-out ${index * 0.085}s infinite` : 'none' }} /><Box className="voice-playback-motion" sx={{ position: 'absolute', left: -1.5, bottom: -1.5, width: 5, height: 5, borderRadius: '50%', bgcolor: 'var(--voice-secondary)', animation: playing ? `voiceHelix 1.5s ease-in-out ${index * 0.085 + 0.75}s infinite reverse` : 'none' }} /></Box>)}
            </Box>
          ) : waveformStyle === 'comet' ? (
            <svg viewBox="0 0 260 38" preserveAspectRatio="none" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
              {waveformPathValue ? <><path d={waveformPathValue} fill="none" stroke="var(--voice-accent)" strokeWidth="1.5" opacity=".2" vectorEffect="non-scaling-stroke" /><path className="voice-playback-motion" d={waveformPathValue} fill="none" stroke="var(--voice-secondary)" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 275" vectorEffect="non-scaling-stroke" style={{ animation: playing ? 'voiceComet 2.1s linear infinite' : 'none', filter: 'drop-shadow(0 0 4px var(--voice-secondary))' }} /></> : null}
            </svg>
          ) : waveformStyle === 'orbit' ? (
            <Box aria-hidden="true" sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
              {visibleBars.filter((_, index) => index % 5 === 0).map((peak, index) => <Box key={index} sx={{ position: 'absolute', left: `${index * 7.15}%`, top: `${50 - peak * 0.25}%`, width: 4 + peak * 0.03, height: 4 + peak * 0.03, borderRadius: '50%', bgcolor: index % 2 ? 'var(--voice-secondary)' : 'var(--voice-accent)', opacity: 0.46 + peak / 190, boxShadow: '0 0 8px color-mix(in srgb, var(--voice-accent) 65%, transparent)', animation: playing ? `voiceOrbit ${1.1 + (index % 4) * 0.2}s ease-in-out ${-index * 0.13}s infinite alternate` : 'none', '@keyframes voiceOrbit': { from: { transform: 'translateY(-4px) scale(.84)' }, to: { transform: 'translateY(4px) scale(1.12)' } }, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} />)}
            </Box>
          ) : (
            <svg viewBox="0 0 260 38" preserveAspectRatio="none" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0"><stop stopColor="var(--voice-accent)" /><stop offset="1" stopColor="var(--voice-secondary)" /></linearGradient></defs>
              {waveformPathValue ? <path d={waveformPathValue} fill="none" stroke={waveformStyle === 'ribbon' ? `url(#${gradientId})` : waveformStyle === 'neon' ? 'var(--voice-secondary)' : 'var(--voice-accent)'} strokeWidth={waveformStyle === 'ribbon' ? '3.2' : waveformStyle === 'neon' ? '2.1' : '2'} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={waveformStyle === 'neon' ? { filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--voice-secondary) 90%, transparent)) drop-shadow(0 0 9px color-mix(in srgb, var(--voice-accent) 62%, transparent))' } : undefined} /> : null}
            </svg>
          )}
          <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${progress * 100}% - 1px)`, width: 2, borderRadius: 2, bgcolor: 'var(--voice-accent)', boxShadow: '0 0 8px color-mix(in srgb, var(--voice-accent) 66%, transparent)', transform: 'translateX(-1px)', pointerEvents: 'none', willChange: 'left' }} />
        </Box>
        <Typography component="span" variant="caption" aria-label="剩余播放时长" sx={{ minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'text.secondary', fontWeight: 650 }}>
          {formatRemainingVoiceTime(remainingDurationMs)}
        </Typography>
      </Box>
      {playbackError ? <Typography variant="caption" sx={{ color: 'error.main' }}>{playbackError}</Typography> : null}
      {transcript ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.secondary' }}>{transcript}</Typography> : null}
    </Box>
  );
}
