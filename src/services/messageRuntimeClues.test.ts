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

  it('projects shared-secret guards as memory debug clues', () => {
    const sections = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          memoryContext: {
            targetActorId: 'hui',
            targetActorName: '灰太狼',
            targetReason: '来自最近 AI 发言者',
            injectedIds: [],
            recalledArchives: [],
            sharedSecretGuards: ['群聊避嫌：一个只有熟人懂的暗号 · sealed'],
          },
        },
      },
    }, [{ id: 'hui', name: '灰太狼' }]);

    expect(sections.find((section) => section.key === 'memory')?.items).toEqual([
      '召回对象：灰太狼',
      '对象依据：来自最近 AI 发言者',
      '秘密边界：群聊避嫌：一个只有熟人懂的暗号 · sealed',
    ]);
  });

  it('projects companionship runtime trace as developer-visible clues', () => {
    const sections = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          companionshipContext: {
            style: 'ambiguous',
            phase: 'ambiguous',
            currentAddress: '小夏',
            sharedAnchors: ['第一次: 第一次深夜聊天后还记得对方没有离开'],
            sharedPhrases: ['安慰话语：慢慢来，我在'],
            sharedSecrets: ['有一件只适合留在心里的事'],
            rituals: ['私下称呼可以自然使用“小夏”'],
            pendingCareTopics: ['明天面试有点紧张。'],
            pendingPromises: ['说好周末一起看那部电影。'],
            rememberedUserPlans: ['用户明天有面试。'],
            boundaries: ['用户不想恋爱暧昧，只想当朋友。'],
            boundaryReasons: ['user does not want romantic framing'],
            userProfileCues: [],
            carePolicy: {
              dailyInitiationBudget: 2,
              triggerSensitivity: 62,
              silenceAnxietyThresholdHours: 24,
              expressionIntensity: 58,
              allowGoodMorning: true,
              allowGoodNight: true,
              allowMissYou: true,
            },
            addressingHistory: [],
            careTopicHistory: [],
            promiseHistory: [],
            sharedAnchorHistory: [],
            sharedSecretHistory: [],
            sharedPhraseHistory: [],
            ritualHistory: [],
            phaseHistory: [],
            userProfileHistory: [],
            conflictHistory: [],
            attachmentHistory: [],
            diagnostics: ['care_topic: source=local_fallback confidence=62% event=evt-care-1'],
            evidence: ['深度绑定：喜欢、深度牵挂'],
            intimacy: { attraction: 72, intimacy: 68, attachment: 66, longing: 50, exclusivity: 18, security: 76 },
            userProfileConfidence: 68,
          },
        },
      },
    });

    const companionship = sections.find((section) => section.key === 'companionship');
    expect(companionship).toMatchObject({
      label: '陪伴',
      promptLabel: '陪伴上下文',
      statusKind: 'prompt_context',
      statusLabel: 'ambiguous · ambiguous',
    });
    expect(companionship?.items).toEqual(expect.arrayContaining([
      '阶段：ambiguous',
      '称呼：小夏',
      '共同锚点：第一次: 第一次深夜聊天后还记得对方没有离开',
      '共同话语：安慰话语：慢慢来，我在',
      '关心事项：明天面试有点紧张。',
      '未完成约定：说好周末一起看那部电影。',
      '用户边界：用户不想恋爱暧昧，只想当朋友。',
      '克制原因：user does not want romantic framing',
      '运行诊断：care_topic: source=local_fallback confidence=62% event=evt-care-1',
      '画像置信：68%',
    ]));
  });

  it('redacts high-risk private companionship clues while keeping care topics useful', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          companionshipContext: {
            style: 'ambiguous',
            phase: 'ambiguous',
            currentAddress: '小夏',
            sharedAnchors: ['秘密: 共同秘密是雨夜便利店暗号，不能公开说'],
            sharedPhrases: ['秘密暗号：雨夜便利店'],
            sharedSecrets: ['有一件只适合留在心里的事'],
            rituals: [],
            pendingCareTopics: ['明天面试有点紧张。'],
            pendingPromises: ['私下约定：周末去雨夜便利店碰头'],
            rememberedUserPlans: ['用户明天有面试。'],
            boundaries: ['不要公开提雨夜便利店暗号'],
            boundaryReasons: ['only private promise should stay private'],
            userProfileCues: [],
            carePolicy: {
              dailyInitiationBudget: 2,
              triggerSensitivity: 62,
              silenceAnxietyThresholdHours: 24,
              expressionIntensity: 58,
              allowGoodMorning: true,
              allowGoodNight: true,
              allowMissYou: true,
            },
            addressingHistory: [],
            careTopicHistory: [],
            promiseHistory: [],
            sharedAnchorHistory: [],
            sharedSecretHistory: [],
            sharedPhraseHistory: [],
            ritualHistory: [],
            phaseHistory: [],
            userProfileHistory: [],
            conflictHistory: [],
            attachmentHistory: [],
            diagnostics: [],
            evidence: ['共同秘密是雨夜便利店暗号，不能公开说'],
            intimacy: { attraction: 72, intimacy: 68, attachment: 66, longing: 50, exclusivity: 18, security: 76 },
            userProfileConfidence: 68,
          },
        },
      },
    };
    const sections = projectMessageRuntimeClues(message);
    const companionshipText = (sections.find((section) => section.key === 'companionship')?.items || []).join(' / ');

    expect(companionshipText).toContain('明天面试有点紧张');
    expect(companionshipText).toContain('有一条私域共同经历已隐藏原文');
    expect(companionshipText).toContain('有一句私域共同话语已隐藏原文');
    expect(companionshipText).toContain('有一条私域约定已隐藏原文');
    expect(companionshipText).toContain('有一条私域边界已隐藏原文');
    expect(companionshipText).toContain('有一条私域证据已隐藏原文');
    expect(companionshipText).not.toContain('雨夜便利店');
    expect(companionshipText).not.toContain('不能公开说');

    const prompt = formatMessageRuntimeCluesForPrompt(message);
    expect(prompt).toContain('明天面试有点紧张');
    expect(prompt).not.toContain('雨夜便利店');
    expect(prompt).not.toContain('不能公开说');
  });

  it('tolerates partial companionship context from older message metadata', () => {
    const sections = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          companionshipContext: {
            style: 'fond',
            phase: 'fond',
            currentAddress: '小夏',
            userProfileConfidence: 42,
            attachmentProfile: {
              inferredStyle: 'secure',
              confidence: 55,
            },
          },
        },
      },
    } as unknown as Pick<Message, 'metadata'>);

    const companionship = sections.find((section) => section.key === 'companionship');
    expect(companionship?.items).toEqual(expect.arrayContaining([
      '阶段：fond',
      '称呼：小夏',
      '依恋适配：secure · 置信 55%',
      '画像置信：42%',
    ]));
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
          guidanceExecution: {
            status: 'accepted_after_retry',
            validated: true,
            retryCount: 1,
            rejectedDraftCount: 1,
            rejectedReasons: ['missing_requested_image'],
            finalReason: 'matched',
            forcedMediaQueued: true,
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
      '执行身份：角色',
      '图片对象：灰太狼',
    ]));
    const execution = sections.find((section) => section.key === 'guidance_execution');
    expect(execution).toMatchObject({
      label: '引导执行',
      statusKind: 'applied_signal',
      statusLabel: '重试后执行',
    });
    expect(execution?.items).toEqual(expect.arrayContaining([
      '状态：重试后执行',
      '重试：1 次',
      '丢弃原因：没有执行发图动作',
      '媒体动作：已按显式请求补入图片队列',
    ]));
    const prompt = formatMessageRuntimeCluesForPrompt(message, [{ id: 'mei', name: '美羊羊' }, { id: 'hui', name: '灰太狼' }]);
    expect(prompt).toContain('用户引导：类型：媒体请求');
    expect(prompt).toContain('引导执行：状态：重试后执行');
    expect(prompt).not.toContain('missing_requested_image');
  });

  it('marks failed guidance execution as actionable diagnostics', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          directorIntent: {
            source: 'user_message',
            beatType: 'answer',
            pressure: 0.95,
            reason: '用户指定角色先回答新问题。',
            targetActorIds: ['mei'],
            userGuidance: {
              kind: 'topic_shift',
              rawText: '新话题：狼抓羊有过错吗？',
              actorIds: [],
              mentionedActorIds: ['mei'],
              focusText: '狼抓羊有过错吗？',
              beatType: 'answer',
              pressure: 0.95,
              maxTurns: 1,
              reason: '用户要求先回答新问题。',
            },
          },
          guidanceExecution: {
            status: 'failed_after_retry',
            validated: false,
            retryCount: 2,
            rejectedDraftCount: 2,
            rejectedReasons: ['missing_question_answer'],
            finalReason: 'missing_question_answer',
            forcedMediaQueued: false,
          },
        },
      },
    };
    const sections = projectMessageRuntimeClues(message, [{ id: 'mei', name: '美羊羊' }]);
    const execution = sections.find((section) => section.key === 'guidance_execution');
    expect(execution).toMatchObject({
      statusKind: 'debug_explanation',
      statusLabel: '重试后仍偏航',
    });
    expect(execution?.items).toEqual(expect.arrayContaining([
      '状态：重试后仍偏航',
      '重试：2 次',
      '丢弃原因：没有先回答新问题',
      '最终校验：没有先回答新问题',
    ]));
  });

  it('degrades unknown guidance member ids to generic member labels', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          directorIntent: {
            source: 'user_message',
            beatType: 'answer',
            pressure: 0.9,
            reason: '用户点名角色回应。',
            targetActorIds: ['unknown-actor'],
            userGuidance: {
              kind: 'direct_reply',
              rawText: 'unknown 说说看',
              actorIds: ['unknown-actor'],
              mentionedActorIds: ['unknown-actor'],
              focusText: 'unknown 说说看',
              beatType: 'answer',
              pressure: 0.9,
              maxTurns: 1,
              reason: '用户点名角色回应。',
            },
          },
        },
      },
    };
    const sections = projectMessageRuntimeClues(message, [{ id: 'mei', name: '美羊羊' }]);
    const guidance = sections.find((section) => section.key === 'guidance');
    expect(guidance?.items).toEqual(expect.arrayContaining([
      '执行角色：成员',
      '执行身份：系统',
    ]));
    expect((guidance?.items || []).join(' / ')).not.toContain('unknown-actor');
  });

  it('projects user guidance actor identity as 用户', () => {
    const message: Pick<Message, 'metadata'> = {
      metadata: {
        runtimeDecision: {
          directorIntent: {
            source: 'user_message',
            beatType: 'answer',
            pressure: 0.9,
            reason: '用户自己补充说明。',
            targetActorIds: ['user'],
            userGuidance: {
              kind: 'direct_reply',
              rawText: '我先补充一下背景',
              actorIds: ['user'],
              mentionedActorIds: ['user'],
              focusText: '我先补充一下背景',
              beatType: 'answer',
              pressure: 0.9,
              maxTurns: 1,
              reason: '用户自己补充说明。',
            },
          },
        },
      },
    };
    const sections = projectMessageRuntimeClues(message, [{ id: 'mei', name: '美羊羊' }]);
    const guidance = sections.find((section) => section.key === 'guidance');
    expect(guidance?.items).toEqual(expect.arrayContaining([
      '执行角色：成员',
      '执行身份：用户',
    ]));
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

  it('projects world influence rules into runtime clues', () => {
    const sections = projectMessageRuntimeClues({
      metadata: {
        runtimeDecision: {
          worldInfluence: {
            attentionScore: 0.78,
            attentionRestraint: 0.33,
            activeRuleIds: ['comfort_first', 'urgent_calendar_first'],
            activeRuleTexts: [
              'Before expanding into analysis or room banter, start with one concrete caring move toward the user.',
              'You have an upcoming schedule (晚餐) within 6 hours.',
            ],
          },
        },
      },
    });
    const world = sections.find((section) => section.key === 'world_influence');
    expect(world).toMatchObject({
      statusKind: 'applied_signal',
      statusLabel: '规则命中',
    });
    expect(world?.items).toEqual(expect.arrayContaining([
      '关注强度：78%',
      '克制强度：33%',
    ]));
    expect(world?.items.some((item) => item.includes('规则：Before expanding'))).toBe(true);
  });
});
