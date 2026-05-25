import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { formatMessageRuntimeCluesForPrompt, projectMessageRuntimeClues } from './messageRuntimeClues';

function buildMessage(): Message {
  return {
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
            summary: 'episodic / 3c78729f-e52d-4dde-b27f-01a949960bb8b / 雨夜失约',
            recallReason: 'relationship ledger has become salient',
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
  };
}

describe('messageRuntimeClues', () => {
  it('projects message runtime decisions into sanitized display sections', () => {
    const sections = projectMessageRuntimeClues(buildMessage());

    expect(sections.map((section) => section.key)).toEqual(['memory', 'inner', 'surface']);
    expect(sections[0]).toMatchObject({
      statusKind: 'prompt_context',
      statusLabel: '本轮注入',
    });
    expect(sections[1]).toMatchObject({
      statusKind: 'debug_explanation',
      statusLabel: '调试解释',
    });
    const memoryItems = sections[0]?.items || [];
    expect(memoryItems.join(' / ')).toContain('片段记忆');
    expect(memoryItems.join(' / ')).toContain('雨夜失约');
    expect(memoryItems.join(' / ')).not.toContain('3c78729f');
    expect(memoryItems).toContain('原因：关系账本中的变化已经足够显著');
    expect(sections[2]?.items).toEqual(expect.arrayContaining(['长段落表达', '角色适合展开', '允许富文本']));
  });

  it('formats the same projected clues for message analysis prompts', () => {
    const prompt = formatMessageRuntimeCluesForPrompt(buildMessage());

    expect(prompt).toContain('记忆线索：');
    expect(prompt).toContain('- 旧档注入：');
    expect(prompt).toContain('内心线索：语气倾向：低声、别扭');
    expect(prompt).toContain('表达形态：长段落表达');
    expect(prompt).not.toContain('archive-1');
    expect(prompt).not.toContain('3c78729f');
  });

  it('uses member names when runtime clues are projected with member context', () => {
    const sections = projectMessageRuntimeClues(buildMessage(), [{ id: '3c78729f-e52d-4dde-b27f-01a949960bb8b', name: '乙' }]);

    expect((sections[0]?.items || []).join(' / ')).toContain('乙');
    expect((sections[0]?.items || []).join(' / ')).not.toContain('3c78729f');
  });

  it('shows the prompt memory target even when no archived memory was injected', () => {
    const sections = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          memoryContext: {
            targetActorId: 'hui',
            targetActorName: '灰太狼',
            targetReason: '来自人工发图请求的图片对象',
            injectedIds: [],
            recalledArchives: [],
          },
        },
      },
    }, [{ id: 'hui', name: '灰太狼' }]);

    expect(sections.find((section) => section.key === 'memory')?.items).toEqual([
      '召回对象：灰太狼',
      '对象依据：来自人工发图请求的图片对象',
    ]);
  });

  it('localizes runtime enum values before display or prompt use', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          innerLife: {
            impulse: 'show_off',
            tone: 'casual',
            reason: '想证明自己',
            pressure: 0.5,
          },
          responseSurface: {
            kind: 'professional',
            allowMarkdown: true,
            preserveParagraphs: true,
            roleFit: 'capable',
            basis: ['mode:interview', 'topic:professional-task', 'role:capable'],
          },
          directorIntent: {
            source: 'conflict',
            beatType: 'challenge',
            pressure: 0.82,
            reason: 'relationship ledger has become salient',
          },
        },
      },
    };
    const sections = projectMessageRuntimeClues(message);

    expect(sections.find((section) => section.key === 'inner')?.items).toEqual(expect.arrayContaining(['语气倾向：随意', '表达冲动：证明自己']));
    expect(sections.find((section) => section.key === 'surface')?.items).toEqual(expect.arrayContaining(['面试模式', '主题请求专业表达']));
    expect(sections.find((section) => section.key === 'director')?.items).toEqual(expect.arrayContaining(['推进动作：挑战', '原因：关系账本中的变化已经足够显著。']));
    const prompt = formatMessageRuntimeCluesForPrompt(message);
    expect(prompt).not.toContain('show_off');
    expect(prompt).not.toContain('casual');
    expect(prompt).not.toContain('relationship ledger');
  });

  it('shows explicit user guidance with actors and image subjects', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          directorIntent: {
            source: 'user_message',
            beatType: 'answer',
            pressure: 0.98,
            reason: '用户指定角色发送或创作图片。',
            targetActorIds: ['mei'],
            userGuidance: {
              kind: 'media_request',
              rawText: '美羊羊发个灰太狼证件照的图片',
              actorIds: ['mei'],
              mentionedActorIds: ['mei', 'hui'],
              focusText: '美羊羊发个灰太狼证件照的图片',
              beatType: 'answer',
              pressure: 0.98,
              maxTurns: 1,
              reason: '用户指定角色发送或创作图片。',
              mediaRequest: {
                kind: 'image',
                subjectActorIds: ['hui'],
                subjectText: '灰太狼',
                actionText: '发个灰太狼证件照的图片',
              },
            },
          },
        },
      },
    };

    const sections = projectMessageRuntimeClues(message, [
      { id: 'mei', name: '美羊羊' },
      { id: 'hui', name: '灰太狼' },
    ]);
    const guidance = sections.find((section) => section.key === 'guidance');

    expect(guidance).toMatchObject({
      label: '用户引导',
      statusLabel: '显式请求',
    });
    expect(guidance?.items).toEqual(expect.arrayContaining([
      '类型：媒体请求',
      '执行角色：美羊羊',
      '图片对象：灰太狼',
    ]));
    expect(formatMessageRuntimeCluesForPrompt(message, [{ id: 'mei', name: '美羊羊' }, { id: 'hui', name: '灰太狼' }])).toContain('用户引导：类型：媒体请求');
  });

  it('marks expression feedback as retrieved or applied without treating it as a hard fact', () => {
    const retrievedOnly = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          expressionFeedback: [{
            id: 'fb-1',
            label: '减少助手腔',
            text: '用户反馈：这类回复太像通用助手',
            confidence: 0.6,
            applied: false,
          }],
        },
      },
    });
    expect(retrievedOnly.find((section) => section.key === 'feedback')).toMatchObject({
      statusKind: 'soft_signal',
      statusLabel: '已检索',
    });

    const applied = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          expressionFeedback: [{
            id: 'fb-2',
            label: '控制长度',
            text: '用户反馈：这类回复偏长',
            confidence: 0.8,
            applied: true,
            effects: ['收敛长度'],
          }],
        },
      },
    });
    expect(applied.find((section) => section.key === 'feedback')).toMatchObject({
      statusKind: 'applied_signal',
      statusLabel: '已影响',
    });
  });
});
