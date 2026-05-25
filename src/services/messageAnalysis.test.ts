import { describe, expect, it, vi } from 'vitest';
import { analyzeChatMessage } from './messageAnalysis';

type GenerateResponseMockArgs = [unknown, string, Array<{ role: string; content: string }>, unknown?, unknown?];
const generateResponseMock = vi.fn(async (..._args: GenerateResponseMockArgs) => '分析结果');

vi.mock('./aiClient', () => ({
  generateResponse: (...args: GenerateResponseMockArgs) => generateResponseMock(...args),
}));

describe('messageAnalysis', () => {
  it('passes human-readable runtime memory and expression clues to the analyzer', async () => {
    await analyzeChatMessage({ provider: 'openai', baseUrl: '', apiKey: '', model: 'test-model' }, {
      chat: {
        id: 'chat-1',
        type: 'group',
        mode: 'open_chat',
        name: '测试群',
        topic: '旧事',
      } as never,
      message: {
        id: 'msg-1',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'char-a',
        senderName: '甲',
        content: '雨夜那次失约，我还留着那块蓝色石头。',
        emotion: 0,
        timestamp: 1,
        isDeleted: false,
        metadata: {
          runtimeDecision: {
            memoryContext: {
              recalledArchives: [{
                id: 'archive-1',
                scope: 'relationship',
                kind: 'resentment',
                layer: 'long_term',
                summary: '雨夜失约和蓝色石头',
                recallReason: '当前发言重新提到了雨夜旧事',
              }],
            },
            innerLife: {
              impulse: '想找补',
              tone: '低声、别扭',
              reason: '旧承诺被再次提起',
              pressure: 0.6,
            },
            responseSurface: {
              kind: 'longform',
              allowMarkdown: true,
              preserveParagraphs: true,
              roleFit: 'capable',
              basis: ['用户要求解释旧事'],
            },
          },
        },
      },
      messages: [],
      characters: [{
        id: 'char-a',
        name: '甲',
        background: '记得旧事',
        speakingStyle: '克制',
        expertise: [],
        coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
      }] as never,
    });

    const messagesArg = generateResponseMock.mock.calls[0]?.[2];
    const userPrompt = messagesArg?.[0]?.content || '';
    expect(userPrompt).toContain('【本轮运行线索】');
    expect(userPrompt).toContain('旧档注入：雨夜失约和蓝色石头');
    expect(userPrompt).toContain('内心线索：语气倾向：低声、别扭');
    expect(userPrompt).toContain('表达形态：长段落表达');
    expect(userPrompt).not.toContain('archive-1');
    expect(userPrompt).not.toContain('runtimeDecision');
  });
});
