import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { APIConfig, AIModelProfile } from '../../types/settings';
import type { AICharacter } from '../../types/character';
import type { ChatStyle } from '../../types/chat';
import HotTopicDialog from './HotTopicDialog';
import { useHotTopicDialog } from './useHotTopicDialog';

interface HotTopicDialogContainerProps {
  openSignal: number;
  language: string;
  apiConfig: APIConfig;
  aiProfiles: AIModelProfile[];
  autoGenerateCharacterAvatar?: boolean;
  characters: AICharacter[];
  name: string;
  topic: string;
  setName: (value: string) => void;
  setTopic: (value: string) => void;
  setStyle: (value: ChatStyle) => void;
  setSelectedMembers: Dispatch<SetStateAction<string[]>>;
  addCharacters: (chars: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) => Promise<AICharacter[]>;
  maxMembers: number;
  onError: (message: string) => void;
  setSnackbar: Dispatch<SetStateAction<{ open: boolean; message: string; severity: 'success' | 'error' }>>;
  getStyleLabel: (styleValue: ChatStyle) => string;
}

export default function HotTopicDialogContainer({
  openSignal,
  getStyleLabel,
  ...params
}: HotTopicDialogContainerProps) {
  const { hotDialogProps, openHotDialog } = useHotTopicDialog(params);
  const handledOpenSignalRef = useRef(0);

  useEffect(() => {
    if (openSignal <= 0) return;
    if (handledOpenSignalRef.current === openSignal) return;
    handledOpenSignalRef.current = openSignal;
    void openHotDialog();
  }, [openSignal, openHotDialog]);

  return (
    <HotTopicDialog
      {...hotDialogProps}
      getStyleLabel={getStyleLabel}
    />
  );
}
