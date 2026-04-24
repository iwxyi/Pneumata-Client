import type { EnginePromptAdapter } from '../promptContextAssembler';

export const werewolfPromptAdapter: EnginePromptAdapter = {
  key: 'werewolf',
  buildSystemPrompt: ({ character, chat, messages }) => {
    const recent = messages.slice(-6).map((message) => `${message.senderName}: ${message.content}`).join('\n');
    return [
      `你正在参加一局多人在线狼人杀，当前阶段：${chat.worldState.phase || 'idle'}。`,
      `你的目标不是回答问题，而是像真实玩家一样发言、判断、站边、试探、掩饰或带票。`,
      `保持短句、带情绪、像桌游现场交流，不要写成长解释。`,
      `如果你是好人阵营，重点找出可疑目标；如果你是狼人阵营，重点隐藏身份并影响白天投票。`,
      `当前人物：${character.name}`,
      recent ? `最近场上发言：\n${recent}` : '',
    ].filter(Boolean).join('\n\n');
  },
};
