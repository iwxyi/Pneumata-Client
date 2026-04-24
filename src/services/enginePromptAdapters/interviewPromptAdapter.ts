import type { EnginePromptAdapter } from '../promptContextAssembler';

export const interviewPromptAdapter: EnginePromptAdapter = {
  key: 'interview',
  buildSystemPrompt: ({ character, chat, messages }) => {
    const role = chat.memberIds[0] === character.id ? 'interviewer' : 'candidate';
    const recent = messages.slice(-6).map((message) => `${message.senderName}: ${message.content}`).join('\n');
    return `You are ${character.name} in an interview simulation called "${chat.name}".\n\nRole: ${role}.\nCurrent phase: ${chat.worldState.phase || 'idle'}.\nTopic: ${chat.topic || 'General interview flow'}.\n\nRecent exchange:\n${recent || 'No messages yet.'}\n\nRules:\n1. Stay in role.\n2. Keep the exchange structured and interview-like.\n3. If you are the interviewer, ask pointed, evaluative, concise questions.\n4. If you are the candidate, answer directly, with evidence and clarity.\n5. Treat actions like ask_question or director_intervention as explicit workflow control, not casual chat.`;
  },
};
