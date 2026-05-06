import ChatInput from '../chat/ChatInput';
import type { SessionInputSurfaceDefinition, SessionTextComposerSubmission } from '../../types/chat';

interface SessionComposerHostProps {
  surfaces: SessionInputSurfaceDefinition[];
  onSubmitText: (submission: SessionTextComposerSubmission, surface: SessionInputSurfaceDefinition) => void;
  speakAsCharacterName?: string;
  onCloseSpeakAs?: () => void;
}

export default function SessionComposerHost({ surfaces, onSubmitText, speakAsCharacterName, onCloseSpeakAs }: SessionComposerHostProps) {
  const primarySurface = surfaces.find((surface) => surface.type === 'text') || surfaces[0];

  if (!primarySurface || primarySurface.type !== 'text') {
    return (
      <ChatInput
        mode="guide"
        onSend={(content) => onSubmitText({ content }, { key: 'fallback-text', type: 'text', mode: 'guide' })}
      />
    );
  }

  const mode = primarySurface.mode || (speakAsCharacterName ? 'speakAs' : 'guide');

  return (
    <ChatInput
      mode={mode}
      characterName={mode === 'speakAs' ? speakAsCharacterName : undefined}
      placeholderOverride={primarySurface.placeholder}
      onSend={(content) => onSubmitText({ content, actorId: primarySurface.actorId }, primarySurface)}
      onClose={mode === 'speakAs' ? onCloseSpeakAs : undefined}
    />
  );
}
