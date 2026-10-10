import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';
import type { UserGuidanceIntent } from './userGuidanceIntent';
import { isVisibleDialogueTurn } from './chatMessageSemantics';

// Voice evidence is shared across room types. The model, not local personality
// thresholds or phrase matching, chooses the live reaction and sentence shape.
export function buildHumanizationPrompt(
  character: AICharacter,
  _intent: SpeakIntent,
  messages: Message[],
  guidance?: UserGuidanceIntent | null,
  context?: { family?: string | null; type?: string | null },
) {
  const profile = character.speechProfile;
  const lines = [
    `Personal speaking style: ${character.speakingStyle || 'use the established character voice'}.`,
    profile ? `Speech style: length=${profile.sentenceLengthBias}, questionBias=${profile.questionBias}, sarcasmBias=${profile.sarcasmBias}. These are tendencies, not a prescribed move.` : '',
    profile?.catchphrases?.length ? `Optional catchphrases: ${profile.catchphrases.slice(0, 3).join(' / ')}; not required openers.` : '',
    profile?.tabooPhrases?.length ? `Avoid sounding like: ${profile.tabooPhrases.slice(0, 3).join(' / ')}` : '',
    !messages.some(isVisibleDialogueTurn)
      ? 'This is the first visible message in the room: open from the topic or setting, with no invented earlier exchange.'
      : '',
    guidance ? `Active human guidance: ${guidance.focusText || guidance.rawText}; apply it before returning to room momentum.` : '',
    context?.family === 'analysis'
      ? 'Speak as this person while maintaining evidence and reasoning standards; personal stakes may affect expression, not factual validity.'
      : '',
  ].filter(Boolean);
  return `\n## Human Chat Fingerprint\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

export function postProcessHumanChat(content: string) {
  return content.trim().replace(/\n{3,}/g, '\n\n');
}
