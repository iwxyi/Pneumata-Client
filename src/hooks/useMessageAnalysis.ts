import { useCallback, useState } from 'react';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';

export function useMessageAnalysis(params: {
  api: APIConfig;
  chat: GroupChat | undefined;
  messages: Message[];
  characters: AICharacter[];
  fallbackError: string;
}) {
  const { api, chat, messages, characters, fallbackError } = params;
  const [analysisTarget, setAnalysisTarget] = useState<Message | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);

  const analyzeMessage = useCallback(async (targetMessage: Message) => {
    if (!chat) return;
    setAnalysisTarget(targetMessage);
    setAnalysisDialogOpen(true);
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisText('');
    try {
      const { analyzeChatMessage } = await import('../services/messageAnalysis');
      const result = await analyzeChatMessage(api, {
        chat,
        message: targetMessage,
        messages,
        characters,
      });
      setAnalysisText(result.trim() || '未生成有效分析结果。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAnalysisError(message || fallbackError);
    } finally {
      setAnalysisLoading(false);
    }
  }, [api, characters, chat, fallbackError, messages]);

  const closeAnalysisDialog = useCallback(() => {
    setAnalysisDialogOpen(false);
  }, []);

  return {
    analysisDialogOpen,
    analysisError,
    analysisLoading,
    analysisTarget,
    analysisText,
    analyzeMessage,
    closeAnalysisDialog,
  };
}
