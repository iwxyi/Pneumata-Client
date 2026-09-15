import { useRef } from 'react';
import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import MicNoneIcon from '@mui/icons-material/MicNone';

type VoiceInputButtonProps = { isRecording: boolean; isTranscribing: boolean; disabled?: boolean; onStart: () => void | Promise<void>; onStop: () => void; sx?: object };

export default function VoiceInputButton({ isRecording, isTranscribing, disabled, onStart, onStop, sx }: VoiceInputButtonProps) {
  const gesture = useRef<{ timer: number | null; longPress: boolean; suppressClick: boolean }>({ timer: null, longPress: false, suppressClick: false });
  const clearTimer = () => { if (gesture.current.timer !== null) window.clearTimeout(gesture.current.timer); gesture.current.timer = null; };
  return <Tooltip title={isTranscribing ? '语音识别中' : isRecording ? '点击结束录音' : '点击切换录音；长按说话、松开结束'} arrow><span><IconButton type="button" color={isRecording ? 'error' : 'default'} aria-label="语音输入" disabled={disabled || isTranscribing} onPointerDown={(event) => { event.preventDefault(); gesture.current.longPress = false; gesture.current.timer = window.setTimeout(() => { gesture.current.longPress = true; gesture.current.suppressClick = true; if (!isRecording) void onStart(); }, 260); }} onPointerUp={() => { clearTimer(); if (gesture.current.longPress) onStop(); }} onPointerCancel={() => { clearTimer(); if (gesture.current.longPress && isRecording) onStop(); }} onPointerLeave={() => { clearTimer(); if (gesture.current.longPress && isRecording) onStop(); }} onClick={() => { if (gesture.current.suppressClick) { gesture.current.suppressClick = false; return; } if (isRecording) onStop(); else void onStart(); }} sx={{ flexShrink: 0, width: 42, height: 42, ...(isRecording ? { bgcolor: 'error.main', color: 'error.contrastText', '&:hover': { bgcolor: 'error.dark' } } : {}), ...sx }}>{isTranscribing ? <CircularProgress size={20} /> : <MicNoneIcon />}</IconButton></span></Tooltip>;
}
