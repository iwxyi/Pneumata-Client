import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import ChatInput from '../chat/ChatInput';
import type { SessionInputSurfaceDefinition } from '../../types/chat';
import type { SessionBoardComposerSubmission, SessionFormComposerSubmission, SessionTextComposerSubmission } from '../../types/sessionEngine';
import type { UserDraftActivity } from '../../services/userInputBuffer';
import type { MessageAttachment } from '../../types/message';
import type { AIModelInputCapabilities } from '../../types/settings';

interface SessionComposerHostProps {
  surfaces: SessionInputSurfaceDefinition[];
  onSubmitText: (submission: SessionTextComposerSubmission, surface: SessionInputSurfaceDefinition) => void | Promise<void>;
  onSubmitForm?: (submission: SessionFormComposerSubmission, surface: SessionInputSurfaceDefinition) => void;
  onSubmitBoard?: (submission: SessionBoardComposerSubmission, surface: SessionInputSurfaceDefinition) => void;
  speakAsCharacterName?: string;
  onCloseSpeakAs?: () => void;
  sendingLabel?: string;
  onSendError?: (message: string) => void;
  onOpenPanel?: () => void;
  onDraftActivity?: (activity: UserDraftActivity) => void;
  inputCapabilities?: Partial<AIModelInputCapabilities> | null;
}

function buildInitialFieldState(surfaces: SessionInputSurfaceDefinition[]) {
  return Object.fromEntries(
    surfaces.map((surface) => [
      surface.key,
      Object.fromEntries((surface.fields || []).map((field) => [field.key, ''])),
    ]),
  ) as Record<string, Record<string, string>>;
}

export default function SessionComposerHost({ surfaces, onSubmitText, onSubmitForm, onSubmitBoard, speakAsCharacterName, onCloseSpeakAs, sendingLabel, onSendError, onOpenPanel, onDraftActivity, inputCapabilities }: SessionComposerHostProps) {
  const primarySurface = surfaces.find((surface) => surface.type === 'text') || surfaces[0];
  const secondarySurfaces = surfaces.filter((surface) => surface !== primarySurface && surface.type === 'board');
  const [fieldState, setFieldState] = useState<Record<string, Record<string, string>>>(() => buildInitialFieldState(surfaces));
  const boardSurface = useMemo(() => secondarySurfaces.find((surface) => surface.type === 'board'), [secondarySurfaces]);

  return (
    <Stack spacing={1}>
      {secondarySurfaces.length ? (
        <Stack spacing={1}>
          {secondarySurfaces.map((surface) => surface.type === 'board' ? (
            <Box key={surface.key} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{surface.label || 'Board'}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
                <TextField
                  size="small"
                  label="位置"
                  placeholder="如 A1"
                  value={fieldState[surface.key]?.position || ''}
                  onChange={(e) => setFieldState((current) => ({
                    ...current,
                    [surface.key]: { ...(current[surface.key] || {}), position: e.target.value },
                  }))}
                />
                <TextField
                  size="small"
                  label="棋子"
                  placeholder="如 black-1"
                  value={fieldState[surface.key]?.pieceId || ''}
                  onChange={(e) => setFieldState((current) => ({
                    ...current,
                    [surface.key]: { ...(current[surface.key] || {}), pieceId: e.target.value },
                  }))}
                />
                <TextField
                  size="small"
                  label="走法"
                  placeholder="如 place / move"
                  value={fieldState[surface.key]?.move || ''}
                  onChange={(e) => setFieldState((current) => ({
                    ...current,
                    [surface.key]: { ...(current[surface.key] || {}), move: e.target.value },
                  }))}
                />
                <Button
                  variant="outlined"
                  onClick={() => onSubmitBoard?.({
                    actorId: surface.actorId,
                    position: fieldState[surface.key]?.position,
                    pieceId: fieldState[surface.key]?.pieceId,
                    move: fieldState[surface.key]?.move,
                  }, surface)}
                  disabled={!onSubmitBoard}
                >
                  提交棋盘动作
                </Button>
              </Stack>
            </Box>
          ) : (
            <Box key={surface.key} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">{surface.label || 'Form'}</Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {(surface.fields || []).map((field) => (
                  <TextField
                    key={`${surface.key}-${field.key}`}
                    size="small"
                    multiline={field.type === 'textarea'}
                    minRows={field.type === 'textarea' ? 3 : undefined}
                    label={field.label}
                    placeholder={field.placeholder}
                    value={fieldState[surface.key]?.[field.key] || ''}
                    onChange={(e) => setFieldState((current) => ({
                      ...current,
                      [surface.key]: {
                        ...(current[surface.key] || {}),
                        [field.key]: e.target.value,
                      },
                    }))}
                  />
                ))}
                <Button
                  variant="outlined"
                  onClick={() => onSubmitForm?.({ actorId: surface.actorId, fields: fieldState[surface.key] || {} }, surface)}
                  disabled={!onSubmitForm}
                >
                  提交表单动作
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : null}

      {!primarySurface || primarySurface.type !== 'text' ? (
        <ChatInput
          mode={speakAsCharacterName ? 'speakAs' : 'memberSpeak'}
          characterName={speakAsCharacterName || undefined}
          onSend={(content, attachments?: MessageAttachment[]) => onSubmitText({ content, attachments }, { key: 'fallback-text', type: 'text', mode: speakAsCharacterName ? 'speakAs' : 'memberSpeak' })}
          onClose={speakAsCharacterName ? onCloseSpeakAs : undefined}
          sendingLabel={sendingLabel}
          onSendError={onSendError}
          onOpenPanel={onOpenPanel}
          onDraftActivity={onDraftActivity}
          inputCapabilities={inputCapabilities}
        />
      ) : (() => {
        const mode = speakAsCharacterName
          ? 'speakAs'
          : (primarySurface.mode || (primarySurface.capability === 'speak' ? 'memberSpeak' : 'guide'));
        const placeholderOverride = mode === 'speakAs'
          ? undefined
          : (
            primarySurface.placeholder
            || (mode === 'memberSpeak' ? '输入消息' : undefined)
            || (boardSurface ? '输入聊天内容或解释本次操作' : undefined)
          );
        return (
          <ChatInput
            mode={mode}
            characterName={mode === 'speakAs' ? speakAsCharacterName : undefined}
            placeholderOverride={placeholderOverride}
            onSend={(content, attachments?: MessageAttachment[]) => onSubmitText({ content, actorId: primarySurface.actorId, attachments }, primarySurface)}
            onClose={mode === 'speakAs' ? onCloseSpeakAs : undefined}
            sendingLabel={sendingLabel}
            onSendError={onSendError}
            onOpenPanel={onOpenPanel}
            onDraftActivity={onDraftActivity}
            inputCapabilities={inputCapabilities}
          />
        );
      })()}
    </Stack>
  );
}
