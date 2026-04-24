import type { GroupChat } from '../types/chat';

export function getInterviewRunnerPolicy(chat: GroupChat) {
  if (chat.mode !== 'interview') return null;
  const phase = chat.worldState.phase || 'idle';
  return {
    actionChance: phase === 'warming' ? 0.4 : phase === 'debating' ? 0.18 : phase === 'aligned' ? 0.25 : 0.08,
    allowSpeak: phase !== 'idle',
    favorInterviewer: phase === 'warming' || phase === 'debating',
    favorCandidate: phase === 'aligned',
  };
}

export function shouldInterviewRunAction(chat: GroupChat) {
  const policy = getInterviewRunnerPolicy(chat);
  return policy ? Math.random() < policy.actionChance : false;
}

export function shouldInterviewAllowSpeak(chat: GroupChat) {
  const policy = getInterviewRunnerPolicy(chat);
  return policy ? policy.allowSpeak : true;
}
