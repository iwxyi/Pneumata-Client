import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { resolveSessionDefinition } from '../types/sessionEngine';
import { generateResponse } from './aiClient';
import { formatMessageRuntimeCluesForPrompt } from './messageRuntimeClues';

type AnalysisContext = {
  chat: GroupChat;
  message: Message;
  messages: Message[];
  characters: AICharacter[];
};

function formatMessageLabel(message: Message, characters: AICharacter[]) {
  if (message.type === 'user') return '用户';
  if (message.type === 'god') return 'God Mode';
  if (message.type === 'event') return '事件';
  if (message.type === 'system') return '系统';
  return characters.find((character) => character.id === message.senderId)?.name || message.senderName || 'AI角色';
}

function buildContextWindow(target: Message, messages: Message[], characters: AICharacter[]) {
  const visibleMessages = messages.filter((message) => !message.isDeleted);
  const targetIndex = visibleMessages.findIndex((message) => message.id === target.id);
  const start = Math.max(0, targetIndex - 4);
  const end = targetIndex >= 0 ? Math.min(visibleMessages.length, targetIndex + 5) : visibleMessages.length;
  const slice = visibleMessages.slice(start, end);

  return slice.map((message, index) => {
    const prefix = message.id === target.id ? '【目标消息】' : targetIndex >= 0 && start + index < targetIndex ? '【上文】' : '【下文】';
    return `${prefix} ${formatMessageLabel(message, characters)}: ${message.content}`;
  }).join('\n');
}

function buildSpeakerProfile(message: Message, characters: AICharacter[]) {
  const character = characters.find((item) => item.id === message.senderId);
  if (!character) {
    return `发送者：${formatMessageLabel(message, characters)}\n消息类型：${message.type}`;
  }

  return [
    `发送者：${character.name}`,
    `消息类型：${message.type}`,
    `背景：${character.background || '无'}`,
    `表达风格：${character.speakingStyle || '无'}`,
    `擅长领域：${character.expertise.join('、') || '无'}`,
    character.coreProfile?.coreDesire ? `核心诉求：${character.coreProfile.coreDesire}` : '',
    character.coreProfile?.coreFear ? `核心顾虑：${character.coreProfile.coreFear}` : '',
    character.coreProfile?.valuePriority?.length ? `价值优先级：${character.coreProfile.valuePriority.join('、')}` : '',
    character.coreProfile?.biases?.length ? `可能偏见：${character.coreProfile.biases.join('、')}` : '',
    character.coreProfile?.interactionHabits?.length ? `互动习惯：${character.coreProfile.interactionHabits.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function buildSystemPrompt() {
  return `你是一个聊天消息分析助手。你的任务不是继续对话，而是解释一条聊天消息为何会这样表达。

请用中文输出。可以使用常见 Markdown 增强可读性，例如小标题、加粗、斜体、无序/有序列表、引用、行内代码。
不要使用 Markdown 表格，不要输出 JSON，不要写代码块，不要输出原始 HTML。
必须结合目标消息、上下文和发送者设定进行分析，避免空泛套话。
如果看到“本轮运行线索”，可以解释它的人类可读含义，但不要原样输出内部字段名、分数、ID 或调试术语。
如果使用 Markdown 小标题，仍必须保留下面的编号，例如“## 1. 一句话总评”，不要改写或省略编号。

按下面结构输出：
1. 一句话总评
2. 这句话在表层上表达了什么
3. 潜台词与真实意图
4. 为什么会这样回答（结合上文、角色设定、情绪、关系或场景）
5. 专业名词 / 知识点解释（没有就写“无明显专业名词”）
6. 语气、措辞与修辞特点
7. 这句话回应了哪些上下文线索
8. 可能没说出口但在影响回答的因素
9. 用户可以进一步追问什么
10. 其他值得注意的观察

“其他值得注意的观察”里优先覆盖这些角度里实际存在的项：
- 立场与利益驱动
- 假设前提
- 回避或省略的信息
- 是否在纠偏、迎合、试探、施压、安抚、总结
- 可能的误解点
- 与前文是否一致
- 如果换个角色/立场，回答可能会怎样变化`;
}

function buildUserPrompt({ chat, message, messages, characters }: AnalysisContext) {
  const runtimeDecisionContext = formatMessageRuntimeCluesForPrompt(message, characters);
  const session = resolveSessionDefinition(chat);
  return [
    `聊天名称：${chat.name}`,
    `聊天类型：${chat.type}`,
    `会话场景：${session.scenario.label}`,
    `会话族类：${session.family.label}`,
    `聊天主题：${chat.topic || '无'}`,
    chat.topicSeed ? `开场话题：${chat.topicSeed}` : '',
    '',
    '【发送者画像】',
    buildSpeakerProfile(message, characters),
    '',
    '【目标消息】',
    `${formatMessageLabel(message, characters)}: ${message.content}`,
    '',
    '【附近上下文】',
    buildContextWindow(message, messages, characters),
    runtimeDecisionContext ? '' : '',
    runtimeDecisionContext ? '【本轮运行线索】' : '',
    runtimeDecisionContext,
  ].filter(Boolean).join('\n');
}

export async function analyzeChatMessage(config: APIConfig, context: AnalysisContext) {
  return generateResponse(config, buildSystemPrompt(), [{ role: 'user', content: buildUserPrompt(context) }], undefined, { maxTokens: 1800 });
}
