import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { Box, TextField, IconButton, Chip, CircularProgress, Tooltip, Alert } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/ImageOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MicIcon from '@mui/icons-material/MicNone';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../stores/useUIStore';
import type { UserDraftActivity } from '../../services/userInputBuffer';
import type { MessageAttachment } from '../../types/message';
import type { AIModelInputCapabilities } from '../../types/settings';
import { buildImageAttachmentHoverInfo } from '../../services/messageAttachmentHoverInfo';
import { normalizeInputCapabilities } from '../../types/settings';
import type { ComposerState } from '../../types/composerState';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { normalizeAudioDataUrl, transcribeSpeech, usesManagedSpeechProfile } from '../../services/speech';
import { transcribeAudioWithAdapter } from '../../services/aiGenerationAdapter';
import { readUploadedChatFiles } from '../../services/chatFileTransfer';

interface ChatInputProps {
  mode: 'guide' | 'speakAs' | 'memberSpeak';
  characterName?: string;
  onSend: (content: string, attachments?: MessageAttachment[]) => void | Promise<void>;
  onClose?: () => void;
  placeholderOverride?: string;
  sendingLabel?: string;
  hideSpeakAsChip?: boolean;
  onSendError?: (message: string) => void;
  onOpenPanel?: () => void;
  onDraftActivity?: (activity: UserDraftActivity) => void;
  inputCapabilities?: Partial<AIModelInputCapabilities> | null;
  inputCapabilityWarning?: string;
  autoFocus?: boolean;
  topContent?: ReactNode;
  injectedAttachments?: MessageAttachment[];
  onInjectedAttachmentsConsumed?: () => void;
  isReplyPending?: boolean;
  onStopReply?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  composerState?: ComposerState;
}

function getMobilePanelTravelDistance() {
  if (typeof window === 'undefined') return 640;
  return Math.max(320, window.innerHeight * 0.8);
}

const PANEL_OFFSET_VAR = '--pneumata-right-panel-offset';
const PANEL_BACKDROP_OPACITY_VAR = '--pneumata-right-panel-backdrop-opacity';
const PANEL_BACKDROP_MAX_OPACITY = 0.34;
const PANEL_GESTURE_SETTLE_MS = 370;

function setPanelGestureCss(offset: number) {
  if (typeof document === 'undefined') return;
  const travelDistance = getMobilePanelTravelDistance();
  const progress = 1 - Math.min(1, Math.max(0, offset) / travelDistance);
  document.documentElement.style.setProperty(PANEL_OFFSET_VAR, `${Math.max(0, offset)}px`);
  document.documentElement.style.setProperty(PANEL_BACKDROP_OPACITY_VAR, String(PANEL_BACKDROP_MAX_OPACITY * progress));
}

function clearPanelGestureCss() {
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(PANEL_OFFSET_VAR);
  document.documentElement.style.removeProperty(PANEL_BACKDROP_OPACITY_VAR);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function buildAttachmentId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getMicrophoneSupportError() {
  if (typeof window !== 'undefined' && window.location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    return '语音输入需要安全连接，请使用 HTTPS 打开页面（当前是 HTTP）';
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return '语音输入需要安全页面，请使用 HTTPS 或 localhost 打开';
  }
  return '当前浏览器不支持麦克风输入，请检查浏览器权限或更换浏览器';
}

export default function ChatInput({ mode, characterName, onSend, onClose, placeholderOverride, sendingLabel, hideSpeakAsChip, onSendError, onOpenPanel, onDraftActivity, inputCapabilities, inputCapabilityWarning, autoFocus, topContent, injectedAttachments, onInjectedAttachmentsConsumed, isReplyPending = false, onStopReply, disabled = false, disabledReason, composerState }: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const { t } = useTranslation();
  const { setRightPanelGestureOffset, setRightPanelGestureDragging } = useUIStore(useShallow((state) => ({
    setRightPanelGestureOffset: state.setRightPanelGestureOffset,
    setRightPanelGestureDragging: state.setRightPanelGestureDragging,
  })));
  const capabilities = normalizeInputCapabilities(inputCapabilities);
  const canAttachImages = capabilities.imageInput;
  const canAttachFiles = capabilities.fileInput;
  const maxAttachments = capabilities.multiImageInput ? capabilities.maxAttachments : 1;
  const acceptMimeTypes = capabilities.supportedMimeTypes.join(',');
  const hasDraftContent = Boolean(text.trim() || attachments.length > 0);
  const effectivePending = Boolean(isReplyPending || (composerState && composerState.phase !== 'idle' && composerState.phase !== 'error'));
  const showStopReply = Boolean(effectivePending && composerState?.canCancel !== false && onStopReply);
  const effectiveDisabled = disabled || composerState?.canSend === false;
  const panelHandleDragRef = useRef<{ startY: number; latestY: number; moved: boolean; lastDirection: 'up' | 'down' | null } | null>(null);
  const textInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const panelGestureTimerRef = useRef<number | null>(null);
  const panelGestureRafRef = useRef<number | null>(null);
  const pendingPanelOffsetRef = useRef<number | null>(null);
  const panelHandleCleanupRef = useRef<(() => void) | null>(null);
  const panelHandleClickSuppressedRef = useRef(false);
  const imageDragDepthRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingStartingRef = useRef(false);
  const recordedChunksRef = useRef<Blob[]>([]);
  const sttModel = useSettingsStore((state) => state.aiProfiles.find((profile) => profile.type === 'stt' && (profile.isDefault || profile.provider))
    || state.aiProfiles.find((profile) => profile.type === 'audio' && (profile.audioCapability === 'stt' || profile.audioCapability === 'both')));

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      textInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    if (!injectedAttachments?.length) return;
    setAttachments((current) => {
      const existingKeys = new Set(current.map((item) => item.url || item.assetId || item.id));
      const next = [...current];
      for (const attachment of injectedAttachments) {
        const key = attachment.url || attachment.assetId || attachment.id;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        next.push(attachment);
        if (next.length >= maxAttachments) break;
      }
      return next.slice(0, maxAttachments);
    });
    onInjectedAttachmentsConsumed?.();
    window.requestAnimationFrame(() => {
      textInputRef.current?.focus({ preventScroll: true });
    });
  }, [injectedAttachments, maxAttachments, onInjectedAttachmentsConsumed]);

  const cleanupPanelHandleListeners = useCallback(() => {
    panelHandleCleanupRef.current?.();
    panelHandleCleanupRef.current = null;
  }, []);

  const publishDraftActivity = useCallback((nextText: string, focused = inputFocused) => {
    onDraftActivity?.({
      hasDraft: Boolean(nextText.trim()),
      updatedAt: Date.now(),
      focused,
    });
  }, [inputFocused, onDraftActivity]);

  const handleSend = async () => {
    const content = text.trim();
    const outgoingAttachments = attachments;
    if (disabled || (!content && outgoingAttachments.length === 0) || isSending || showStopReply) return;
    setIsSending(true);
    setText('');
    setAttachments([]);
    publishDraftActivity('', inputFocused);
    window.requestAnimationFrame(() => {
      textInputRef.current?.focus({ preventScroll: true });
    });
    try {
      await onSend(content, outgoingAttachments.length ? outgoingAttachments : undefined);
    } catch (error) {
      setText((current) => current || content);
      setAttachments((current) => current.length ? current : outgoingAttachments);
      publishDraftActivity(content, inputFocused);
      const message = error instanceof Error ? error.message : String(error);
      onSendError?.(message || '发送失败，请稍后重试');
    } finally {
      setIsSending(false);
      window.requestAnimationFrame(() => {
        textInputRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const blobToDataUrl = useCallback((blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取录音失败'));
    reader.readAsDataURL(blob);
  }), []);

  const encodeSpeechWav = useCallback(async (blob: Blob) => {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return blob;
    const context = new AudioContextCtor();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const targetRate = 16_000;
      const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, frameCount, targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const wav = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(wav);
      const write = (offset: number, value: string) => Array.from(value).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
      write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, 'data'); view.setUint32(40, samples.length * 2, true);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return new Blob([wav], { type: 'audio/wav' });
    } finally {
      await context.close().catch(() => undefined);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || recordingStartingRef.current || disabled || isSending || isTranscribing || !sttModel || !navigator.mediaDevices?.getUserMedia) {
      if (!sttModel) onSendError?.('请先在模型页面配置语音（STT）模型');
      else if (!navigator.mediaDevices?.getUserMedia) onSendError?.(getMicrophoneSupportError());
      return;
    }
    recordingStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录音');
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordedChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        const recordedBlob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!recordedBlob.size) return;
        setIsTranscribing(true);
        try {
          const blob = usesManagedSpeechProfile(sttModel) && sttModel.provider.includes('volcengine')
            ? await encodeSpeechWav(recordedBlob)
            : recordedBlob;
          const fileName = blob.type.includes('wav') ? 'voice-input.wav' : 'voice-input.webm';
          const result = usesManagedSpeechProfile(sttModel)
            ? await transcribeSpeech({ providerCode: sttModel.provider.startsWith('managed:') ? sttModel.provider.slice('managed:'.length) : undefined, modelId: sttModel.model, audioDataUrl: normalizeAudioDataUrl(await blobToDataUrl(blob)), fileName, language: 'zh' })
            : await transcribeAudioWithAdapter({ profile: sttModel, file: blob, fileName, language: 'zh', intent: 'audio-transcription' });
          if (result.text.trim()) {
            setText((current) => {
              const next = current.trim() ? `${current.trim()} ${result.text.trim()}` : result.text.trim();
              publishDraftActivity(next, inputFocused);
              return next;
            });
          }
        } catch (error) {
          onSendError?.(error instanceof Error ? error.message : '语音转文字失败');
        } finally {
          setIsTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      onSendError?.(error instanceof Error ? error.message : '无法访问麦克风');
    } finally {
      recordingStartingRef.current = false;
    }
  }, [blobToDataUrl, disabled, encodeSpeechWav, inputFocused, isRecording, isSending, isTranscribing, onSendError, publishDraftActivity, sttModel]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const addImageFiles = useCallback(async (selectedFiles: File[]) => {
    if (disabled || isSending || showStopReply) return;
    if (!canAttachImages) {
      onSendError?.(inputCapabilityWarning || '当前模型不支持图片输入');
      return;
    }
    if (!selectedFiles.length) return;
    const remainingSlots = Math.max(0, maxAttachments - attachments.length);
    if (remainingSlots <= 0) {
      onSendError?.(`最多只能添加 ${maxAttachments} 张图片`);
      return;
    }
    const allowed = new Set(capabilities.supportedMimeTypes);
    const files = selectedFiles
      .filter((file) => file.type.startsWith('image/') && (allowed.size === 0 || allowed.has(file.type)))
      .slice(0, remainingSlots);
    if (!files.length) {
      onSendError?.(t('common.unsupportedFileType', { defaultValue: '不支持的文件类型' }));
      return;
    }
    try {
      const now = Date.now();
      const nextAttachments = await Promise.all(files.map(async (file, index) => ({
        id: buildAttachmentId(),
        kind: 'image' as const,
        status: 'ready' as const,
        altText: file.name || `image-${index + 1}`,
        url: await fileToDataUrl(file),
        mimeType: file.type,
        sizeBytes: file.size,
        createdAt: now,
        updatedAt: now,
      })));
      setAttachments((current) => [...current, ...nextAttachments].slice(0, maxAttachments));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onSendError?.(message || '读取图片失败');
    }
  }, [attachments.length, canAttachImages, capabilities.supportedMimeTypes, disabled, inputCapabilityWarning, isSending, maxAttachments, onSendError, showStopReply, t]);

  const addAnyFiles = useCallback(async (selectedFiles: File[]) => {
    if (disabled || isSending || showStopReply || !selectedFiles.length) return;
    if (!canAttachFiles) {
      onSendError?.(inputCapabilityWarning || '当前模型不支持文件输入');
      return;
    }
    try {
      const remaining = Math.max(0, maxAttachments - attachments.length);
      const uploaded = await readUploadedChatFiles(selectedFiles, { maxFiles: remaining || 1 });
      const now = Date.now();
      const next = uploaded.map((file) => ({ id: file.id, kind: 'file' as const, status: 'ready' as const, altText: file.name, fileName: file.name, textContent: file.textContent, url: file.url, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: now, updatedAt: now }));
      setAttachments((current) => [...current, ...next].slice(0, maxAttachments));
    } catch (error) {
      onSendError?.(error instanceof Error ? error.message : '读取文件失败');
    }
  }, [attachments.length, canAttachFiles, disabled, inputCapabilityWarning, isSending, maxAttachments, onSendError, showStopReply]);

  const handlePickImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    await addImageFiles(selectedFiles);
  };

  const dragEventHasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types || []).includes('Files');

  const handleImageDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    imageDragDepthRef.current += 1;
    if (!disabled && !isSending && !showStopReply) setIsImageDragActive(true);
  }, [disabled, isSending, showStopReply]);

  const handleImageDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canAttachImages && !disabled && !isSending && !showStopReply ? 'copy' : 'none';
    if (!disabled && !isSending && !showStopReply) setIsImageDragActive(true);
  }, [canAttachImages, disabled, isSending, showStopReply]);

  const handleImageDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
    if (imageDragDepthRef.current === 0) setIsImageDragActive(false);
  }, []);

  const handleImageDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    imageDragDepthRef.current = 0;
    setIsImageDragActive(false);
    void addImageFiles(Array.from(event.dataTransfer.files || []));
  }, [addImageFiles]);

  useEffect(() => () => {
    cleanupPanelHandleListeners();
    if (panelGestureTimerRef.current !== null) {
      window.clearTimeout(panelGestureTimerRef.current);
    }
    if (panelGestureRafRef.current !== null) {
      window.cancelAnimationFrame(panelGestureRafRef.current);
    }
    clearPanelGestureCss();
  }, [cleanupPanelHandleListeners]);

  const schedulePanelGestureCss = useCallback((offset: number) => {
    pendingPanelOffsetRef.current = offset;
    if (panelGestureRafRef.current !== null) return;
    panelGestureRafRef.current = window.requestAnimationFrame(() => {
      panelGestureRafRef.current = null;
      const nextOffset = pendingPanelOffsetRef.current;
      if (nextOffset !== null) setPanelGestureCss(nextOffset);
    });
  }, []);

  const placeholder = disabled ? (disabledReason || placeholderOverride || '当前会话不可继续') : placeholderOverride || (
    mode === 'speakAs'
      ? t('controls.speakAsPlaceholder', { name: characterName })
      : mode === 'memberSpeak'
        ? t('controls.memberSpeakPlaceholder')
        : t('controls.topicGuidePlaceholder')
  );

  const inputHasTextSelection = useCallback(() => {
    const input = textInputRef.current;
    if (!input) return false;
    return input.selectionStart !== null && input.selectionEnd !== null && input.selectionStart !== input.selectionEnd;
  }, []);

  const updatePanelHandleDrag = useCallback((clientY: number) => {
    const state = panelHandleDragRef.current;
    if (!state) return;
    if (inputHasTextSelection()) {
      panelHandleDragRef.current = null;
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(null);
      clearPanelGestureCss();
      return;
    }
    const stepDeltaY = state.latestY - clientY;
    if (Math.abs(stepDeltaY) > 2) {
      state.lastDirection = stepDeltaY > 0 ? 'up' : 'down';
    }
    state.latestY = clientY;
    const deltaY = state.startY - clientY;
    if (deltaY > 6) {
      if (!state.moved) {
        setRightPanelGestureDragging(true);
        setRightPanelGestureOffset(getMobilePanelTravelDistance());
      }
      state.moved = true;
      schedulePanelGestureCss(Math.max(0, getMobilePanelTravelDistance() - deltaY));
    }
  }, [inputHasTextSelection, schedulePanelGestureCss, setRightPanelGestureDragging, setRightPanelGestureOffset]);

  const finishPanelHandleDrag = useCallback(() => {
    const state = panelHandleDragRef.current;
    panelHandleDragRef.current = null;
    if (!state) return;
    cleanupPanelHandleListeners();
    const travelDistance = getMobilePanelTravelDistance();
    const shouldOpen = state.moved && state.lastDirection === 'up';
    if (state.moved) {
      panelHandleClickSuppressedRef.current = true;
      window.setTimeout(() => {
        panelHandleClickSuppressedRef.current = false;
      }, PANEL_GESTURE_SETTLE_MS);
    }
    if (shouldOpen) {
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(0);
      schedulePanelGestureCss(0);
      onOpenPanel?.();
      panelGestureTimerRef.current = window.setTimeout(() => {
        setRightPanelGestureOffset(null);
        clearPanelGestureCss();
        panelGestureTimerRef.current = null;
      }, PANEL_GESTURE_SETTLE_MS);
      return;
    }
    if (state.moved) {
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(travelDistance);
      schedulePanelGestureCss(travelDistance);
      panelGestureTimerRef.current = window.setTimeout(() => {
        setRightPanelGestureOffset(null);
        clearPanelGestureCss();
        panelGestureTimerRef.current = null;
      }, PANEL_GESTURE_SETTLE_MS);
    }
  }, [cleanupPanelHandleListeners, onOpenPanel, schedulePanelGestureCss, setRightPanelGestureDragging, setRightPanelGestureOffset]);

  const startPanelHandleDrag = useCallback((clientY: number, input: 'pointer' | 'touch') => {
    if (!onOpenPanel || inputHasTextSelection()) {
      panelHandleDragRef.current = null;
      return;
    }
    if (panelGestureTimerRef.current !== null) {
      window.clearTimeout(panelGestureTimerRef.current);
      panelGestureTimerRef.current = null;
    }
    if (panelGestureRafRef.current !== null) {
      window.cancelAnimationFrame(panelGestureRafRef.current);
      panelGestureRafRef.current = null;
    }
    cleanupPanelHandleListeners();
    pendingPanelOffsetRef.current = null;
    panelHandleDragRef.current = { startY: clientY, latestY: clientY, moved: false, lastDirection: null };

    if (input === 'pointer') {
      const handleMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        updatePanelHandleDrag(moveEvent.clientY);
      };
      const handleEnd = (endEvent: PointerEvent) => {
        endEvent.preventDefault();
        cleanupPanelHandleListeners();
        finishPanelHandleDrag();
      };
      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleEnd, { passive: false });
      window.addEventListener('pointercancel', handleEnd, { passive: false });
      panelHandleCleanupRef.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleEnd);
        window.removeEventListener('pointercancel', handleEnd);
      };
      return;
    }

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const touch = moveEvent.touches[0];
      if (!touch) return;
      moveEvent.preventDefault();
      updatePanelHandleDrag(touch.clientY);
    };
    const handleTouchEnd = (endEvent: TouchEvent) => {
      endEvent.preventDefault();
      cleanupPanelHandleListeners();
      finishPanelHandleDrag();
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    panelHandleCleanupRef.current = () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [cleanupPanelHandleListeners, finishPanelHandleDrag, inputHasTextSelection, onOpenPanel, updatePanelHandleDrag]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        px: { xs: 1.5, sm: 2.5, md: 3 },
        pt: 1,
        pb: onOpenPanel ? 'calc(env(safe-area-inset-bottom, 0px) + 7px)' : 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
        bgcolor: 'transparent',
        flexShrink: 0,
        opacity: 1,
        pointerEvents: 'auto',
        position: 'relative',
        overflow: 'visible',
        isolation: 'isolate',
        '& > *': {
          position: 'relative',
          zIndex: 1,
        },
      }}
    >
      <Box
        onDragEnter={handleImageDragEnter}
        onDragOver={handleImageDragOver}
        onDragLeave={handleImageDragLeave}
        onDrop={handleImageDrop}
        sx={{
          width: '100%',
          maxWidth: 760,
          mx: 'auto',
          p: attachments.length || inputCapabilityWarning ? { xs: 0.85, sm: 1 } : { xs: 0.65, sm: 0.75 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(226,232,240,0.12)',
          bgcolor: (theme) => {
            if (isSending) return theme.palette.mode === 'light' ? 'rgba(255,255,255,0.70)' : 'rgba(20,22,30,0.54)';
            return theme.palette.mode === 'light' ? 'rgba(255,255,255,0.64)' : 'rgba(13,15,22,0.50)';
          },
          backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(24px) saturate(1.10)' : 'blur(22px) saturate(1.04)',
          WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(24px) saturate(1.10)' : 'blur(22px) saturate(1.04)',
          boxShadow: (theme) => theme.palette.mode === 'light'
            ? '0 18px 42px rgba(15,23,42,0.12), 0 1px 0 rgba(255,255,255,0.72) inset'
            : '0 18px 44px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.10) inset',
          outline: isImageDragActive ? '1px solid' : '1px solid transparent',
          outlineColor: isImageDragActive ? 'primary.main' : 'transparent',
          outlineOffset: 3,
          transition: 'outline-color 160ms ease, background-color 160ms ease',
        }}
      >
        {topContent ? (
        <Box>
          {topContent}
        </Box>
        ) : null}
        {attachments.length ? (
        <Box
          sx={{
            display: 'flex',
            gap: 0.75,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            overflowY: 'hidden',
            mb: 0.75,
            pb: 0.25,
            scrollbarWidth: 'thin',
            overscrollBehaviorX: 'contain',
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': {
              borderRadius: 999,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.18)' : 'rgba(226,232,240,0.20)',
            },
          }}
        >
          {attachments.map((attachment) => {
            const hoverInfo = buildImageAttachmentHoverInfo(attachment);
            return (
              <Tooltip
                key={attachment.id}
                title={hoverInfo ? <Box sx={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{hoverInfo}</Box> : ''}
                arrow
                enterDelay={450}
                disableHoverListener={!hoverInfo}
              >
                <Chip
                  size="small"
                  label={attachment.altText || 'Image'}
                  onDelete={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  avatar={attachment.url ? <Box component="img" src={attachment.url} alt="" sx={{ width: 24, height: 24, objectFit: 'cover' }} /> : undefined}
                  variant="outlined"
                  sx={{
                    flexShrink: 0,
                    maxWidth: { xs: 150, sm: 190 },
                    '& .MuiChip-label': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
        ) : null}
        {attachments.length > 0 && inputCapabilityWarning ? (
        <Alert severity="warning" sx={{ mb: 1, py: 0 }}>
          {inputCapabilityWarning}
        </Alert>
        ) : null}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          width: '100%',
          touchAction: 'pan-y',
          position: 'relative',
          borderRadius: 2.5,
          bgcolor: isImageDragActive ? 'action.hover' : 'transparent',
        }}
      >
        {mode === 'speakAs' && characterName && !hideSpeakAsChip ? (
          <Chip
            label={characterName}
            onDelete={onClose || undefined}
            deleteIcon={onClose ? <CloseIcon fontSize="small" /> : undefined}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ flexShrink: 0 }}
          />
        ) : null}
        {canAttachImages ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptMimeTypes}
              multiple={capabilities.multiImageInput}
              hidden
              onChange={handlePickImages}
            />
            <Tooltip title={capabilities.multiImageInput ? '添加图片' : '添加图片'}>
              <span>
                <IconButton
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isSending || attachments.length >= maxAttachments}
                  sx={{ flexShrink: 0, width: 42, height: 42 }}
                >
                  <ImageIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        ) : null}
        {canAttachFiles ? (
          <>
            <input id="pneumata-chat-file-upload" type="file" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addAnyFiles(files); }} />
            <Tooltip title="添加文件">
              <span><IconButton onClick={() => document.getElementById('pneumata-chat-file-upload')?.click()} disabled={disabled || isSending || attachments.length >= maxAttachments} sx={{ flexShrink: 0, width: 42, height: 42 }}><AttachFileIcon sx={{ fontSize: 20 }} /></IconButton></span>
            </Tooltip>
          </>
        ) : null}
        <Tooltip title={isTranscribing ? '语音识别中' : isRecording ? '点击结束录音' : '点击开始录音'} arrow>
          <span>
            <IconButton
              color={isRecording ? 'error' : 'default'}
              aria-label="语音输入"
              disabled={disabled || isSending || isTranscribing}
              onClick={() => { if (isRecording) stopRecording(); else void startRecording(); }}
              sx={{
                flexShrink: 0,
                width: 42,
                height: 42,
                ...(canAttachImages ? { ml: -0.75 } : {}),
                ...(isRecording ? {
                  bgcolor: 'error.main',
                  color: 'error.contrastText',
                  '&:hover': { bgcolor: 'error.dark' },
                } : {}),
              }}
            >
              {isTranscribing ? <CircularProgress size={20} /> : <MicIcon />}
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            publishDraftActivity(e.target.value, inputFocused);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setInputFocused(true);
            publishDraftActivity(text, true);
          }}
          onBlur={() => {
            setInputFocused(false);
            publishDraftActivity(text, false);
          }}
          inputRef={textInputRef}
          disabled={effectiveDisabled && composerState?.canDraft !== true}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2.25,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(248,250,252,0.74)' : 'rgba(255,255,255,0.065)',
              alignItems: 'center',
              '& fieldset': {
                borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.09)' : 'rgba(226,232,240,0.11)',
              },
            },
          }}
        />
        <Tooltip title={showStopReply ? '停止当前处理' : effectivePending ? (composerState?.label || '处理中') : isSending ? (sendingLabel || '发送中') : ''} disableHoverListener={!showStopReply && !effectivePending && !isSending} arrow>
          <span>
            <IconButton
              color="primary"
              aria-label={showStopReply ? '停止回答' : '发送'}
              onClick={() => {
                if (showStopReply) {
                  onStopReply?.();
                  return;
                }
                void handleSend();
              }}
              onMouseDown={(event) => event.preventDefault()}
              disabled={effectiveDisabled || (!hasDraftContent && !showStopReply) || isSending}
              sx={{
                flexShrink: 0,
                width: 42,
                height: 42,
                position: 'relative',
                bgcolor: (hasDraftContent && !isSending) || showStopReply ? 'primary.main' : 'action.hover',
                color: (hasDraftContent && !isSending) || showStopReply ? 'primary.contrastText' : 'text.disabled',
                boxShadow: (hasDraftContent && !isSending) || showStopReply ? '0 10px 24px rgba(15,23,42,0.18)' : 'none',
                '&:hover': {
                  bgcolor: (hasDraftContent && !isSending) || showStopReply ? 'primary.dark' : 'action.hover',
                },
              }}
            >
              {showStopReply ? (
                <>
                  <CircularProgress
                    size={34}
                    thickness={3.4}
                    sx={{ position: 'absolute', color: 'currentColor', opacity: 0.82 }}
                  />
                  <StopRoundedIcon fontSize="small" />
                </>
              ) : isSending ? <CircularProgress size={22} /> : <SendIcon />}
            </IconButton>
          </span>
        </Tooltip>
        </Box>
        {onOpenPanel ? (
        <Box
          role="button"
          aria-label="打开会话面板"
          title="点击或向上拖拽打开会话面板"
          draggable={false}
          onClick={() => {
            if (panelHandleClickSuppressedRef.current) {
              panelHandleClickSuppressedRef.current = false;
              return;
            }
            onOpenPanel();
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            event.preventDefault();
            event.stopPropagation();
            if (touch) startPanelHandleDrag(touch.clientY, 'touch');
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'touch') return;
            event.preventDefault();
            event.stopPropagation();
            startPanelHandleDrag(event.clientY, 'pointer');
          }}
          sx={{
            width: '100%',
            height: 18,
            display: 'grid',
            placeItems: 'center',
            mt: 0.2,
            cursor: 'grab',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            '&:active': {
              cursor: 'grabbing',
            },
          }}
        >
          <Box
            sx={{
              width: 42,
              height: 4,
              borderRadius: 2,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.22)' : 'rgba(226,232,240,0.28)',
              boxShadow: (theme) => theme.palette.mode === 'light' ? '0 1px 0 rgba(255,255,255,0.70)' : '0 1px 0 rgba(255,255,255,0.08)',
            }}
          />
        </Box>
        ) : null}
      </Box>
    </Box>
  );
}
