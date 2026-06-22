import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message, NarrativeTurnMetadata } from '../../types/message';
import {
  buildChapterRecap,
  buildChoicePolicyPrompt,
  buildSelectedChoiceConsequencePrompt,
  buildStoryAssetPrompt,
  buildStoryContinuationPrompt,
  extractStoryAssets,
  getCurrentChoiceEpoch,
  getStoryChapterUpdateFromEvents,
  normalizeStoryEvents,
  normalizeStoryBranches,
  resolveStoryBeatPlan,
  updateChoiceHistoryOutcome,
} from '../narrativeRuntime';
import { filterStoryChoicesByReaderRole, getOpenStoryChoiceState, normalizeStoryChoiceSuggestions, resolveStoryReaderRole } from '../storyChoices';
import { logDeveloperDiagnostic } from '../developerDiagnostics';

const STORY_PHASES = [
  { key: 'scene', label: 'Scene', allowedActions: ['speak', 'send_message'] as string[] },
  { key: 'branch', label: 'Branch', allowedActions: ['speak', 'send_message'] as string[] },
  { key: 'choice', label: 'Choice', allowedActions: ['branch_choose'] as string[] },
];

function getPhaseDefinitions() {
  return [...STORY_PHASES];
}

function buildParticipants(conversation: GroupChat) {
  return [
    {
      participantId: `${conversation.id}:narrator`,
      conversationId: conversation.id,
      entityType: 'system_agent' as const,
      entityRefId: 'narrator',
      seatIndex: 0,
      displayName: '旁白',
      canSpeak: true,
      canAct: true,
      flags: { actorRefKind: 'system_agent', systemAgentSubtype: 'narrator', actorCapabilities: 'observe,guide' },
    },
    ...conversation.memberIds.map((memberId, index) => ({
      participantId: `${conversation.id}:${memberId}`,
      conversationId: conversation.id,
      entityType: memberId === 'user' ? 'user' as const : 'ai' as const,
      entityRefId: memberId,
      seatIndex: index + 1,
      displayName: memberId === 'user' ? '我' : undefined,
      canSpeak: true,
      canAct: true,
      flags: { actorRefKind: memberId === 'user' ? 'user_persona' : 'ai_character' },
    })),
  ];
}

function getVisiblePanels() {
  return [
    { key: 'members', title: 'Members', type: 'members' as const, tabKey: 'members' as const },
    { key: 'world', title: 'Story', type: 'runtime' as const, tabKey: 'world' as const },
    { key: 'actions', title: 'Branches', type: 'actions' as const },
  ];
}

function getAvailableActions() {
  return [
    { type: 'choose_story_branch' },
  ];
}

function resolveTurnPolicy(params: { conversation: GroupChat; messages: Message[] }) {
  const waitingForChoice = Boolean(getOpenStoryChoiceState(params.conversation, params.messages));
  return {
    runChat: !waitingForChoice,
    runAction: false,
    interleaveAction: false,
  };
}

function buildGenerationPromptContext(params: { conversation: GroupChat; messages?: Message[] }): SessionGenerationPromptContext {
  const phase = params.conversation.scenarioState?.phase || 'scene';
  const beatPlan = resolveStoryBeatPlan(params.conversation);
  const background = params.conversation.scenarioState?.storyBackground ? `\nStory background: ${params.conversation.scenarioState.storyBackground}` : '';
  const direction = params.conversation.scenarioState?.storyDirection ? `\nCurrent story direction / selected branch: ${params.conversation.scenarioState.storyDirection}` : '';
  const outline = params.conversation.scenarioState?.storyOutline ? `\nStory outline: ${params.conversation.scenarioState.storyOutline}` : '';
  const openingConstraints = beatPlan.beatKind === 'establish'
    ? [
        'Opening beat: start inside the current scene, not with a setting summary. Show a concrete object, sound, gesture, or pressure from storySituation/currentScene/openQuestions within the first narration event.',
        'Opening beat: include at least one spoken line that reveals denial, suspicion, fear, or pressure between present characters when any character is available.',
        'Opening beat: end with a specific unresolved hook tied to an existing clue, secret, threat, or relationship crack; do not ask the user to choose yet.',
      ]
    : [];
  return {
    responseStyle: 'creative',
    allowMarkdown: false,
    styleProfile: 'dramatic_room',
    promptPrefix: `Write this story beat as a chat-driven scene using storyEvents as the authoritative visible story body. The narrator is the active actor; narrator prose may carry setting, action, consequences, inner pressure, sensory detail, and scene movement, while the main visible rhythm should be character chat bubbles when characters need to speak. Characters must only say what they can speak aloud, not scene narration, inner monologue, camera direction, or omniscient analysis. Never let a character inherit another character's private object, gesture, memory, wording, or sensory detail unless the transcript explicitly makes it public. Character dialogue is optional and must appear only as storyEvents speech.${background}${direction}${outline}`,
    additionalConstraints: [
      'When opening, renaming, or settling a chapter, include one storyEvents.chapter_update event with a short concrete title. Do not use generic titles such as "阶段回顾".',
      ...buildChoicePolicyPrompt(beatPlan),
      ...buildStoryAssetPrompt(params.conversation),
      ...buildStoryContinuationPrompt({ conversation: params.conversation, messages: params.messages }),
      ...buildSelectedChoiceConsequencePrompt(params.conversation),
      ...openingConstraints,
      ...(phase === 'branch'
        ? [
        'Use storyEvents. At minimum output one narration event. Add speech events only for spoken lines that change the scene.',
        'Do not output alternate rewrites of the same consequence. If you revise a narration or spoken line, keep only the final version in storyEvents.',
        'Resolve the chosen storyDirection through 1 short narrator setup block followed by 2-5 character chat bubbles when dialogue is the right visible rhythm.',
        'Resolve the chosen storyDirection with a concrete consequence: new evidence, danger, location, relationship shift, or goal pressure.',
        'End the beat with at least one trackable hook: a clue, unanswered question, visible cost, relationship pressure, changed location, or imminent threat.',
        'Do not end at a new decision point until the consequence is visible. Any future choices must be specific to the current people, place, clue, threat, or goal.',
        'Avoid abstract option language such as investigate clues, deepen emotion, advance plot, or face the key person without naming what is at stake.',
        'Each character bubble should be 1-3 sentences. Use narrator prose only for external actions or scene changes that cannot be spoken.',
        ]
        : [
        'Use storyEvents. At minimum output one narration event. Add speech events only for spoken lines that change the scene.',
        'Do not output alternate rewrites of the same moment. If you revise a narration or spoken line, keep only the final version in storyEvents.',
        'Advance the scene through 2-5 short character chat bubbles when dialogue is the right visible rhythm, with at most 1 brief narrator prose block for external action or atmosphere.',
        'Advance the scene with concrete atmosphere, implication, or character pressure instead of plain exposition.',
        'End the beat with at least one trackable hook: a clue, unanswered question, visible cost, relationship pressure, changed location, or imminent threat.',
        'Make the next pressure point specific enough that choices can name the person, place, clue, threat, or goal involved.',
        'Prefer spoken tension, subtext, interruption, denial, probing, or evasion over narrator explanation when characters are present and speaking.',
        'Prefer narrator-led prose with concrete sensory detail and visible consequences. It is valid for the whole response to be narration with no character speech.',
        ]),
    ],
  };
}

function buildRuntimeContextBundle(params: { conversation: GroupChat; speaker: { id: string } }): SessionRuntimeContextBundle {
  const phase = params.conversation.scenarioState?.phase || 'scene';
  const beatPlan = resolveStoryBeatPlan(params.conversation);
  return {
    turnPlan: {
      speakerId: params.speaker.id,
      obligation: 'should',
      moveClass: phase === 'branch' ? 'resolve' : 'perform',
      targetScope: phase === 'branch' ? 'scene' : 'room',
      depth: 'normal',
      channelId: 'public',
      reason: `story:${phase}`,
    },
    expressionPlan: {
      surface: 'dramatic',
      texture: 'rich',
      rhythm: 'scene_beat',
      allowMarkdown: false,
    },
    realizationPlan: {
      moveClass: phase === 'branch' ? 'resolve' : 'perform',
      targetScope: phase === 'branch' ? 'scene' : 'room',
      noveltyGoal: phase === 'branch' ? 'resolve' : 'new_angle',
      surfaceDepth: 'normal',
      emotionalPosture: 'tense',
    },
    trace: {
      policyHits: [`story_phase:${phase}`, `story_beat:${beatPlan.beatKind}`, `story_choice_policy:${beatPlan.choicePolicy}`],
    },
  };
}

function splitNarrativeParagraphs(text: string) {
  const explicit = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g)?.map((part) => part.trim()).filter(Boolean) || [text];
  const paragraphs: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence;
    if (current && next.length > 180) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.length ? paragraphs : [text];
}

function buildNarrativeTurnMetadata(params: { conversation: GroupChat; speaker: { id: string }; content: string; blocks?: NarrativeTurnMetadata['blocks'] | null }): NarrativeTurnMetadata | null {
  const text = params.content.trim();
  const blocks = params.blocks?.filter((block) => block.text.trim()) || [];
  if ((!text && !blocks.length) || params.speaker.id !== 'narrator') return null;
  const phase = params.conversation.scenarioState?.phase || 'scene';
  const paragraphs = blocks.length ? [] : splitNarrativeParagraphs(text);
  return {
    turnId: `${params.conversation.id}:${Date.now().toString(36)}`,
    turnKind: phase === 'branch' ? 'choice_prompt' : 'narrative_beat',
    sceneId: String(params.conversation.scenarioState?.sceneId || 'main'),
    phase,
    povActorId: 'narrator',
    blocks: blocks.length ? blocks : (paragraphs.length ? paragraphs : [text]).map((paragraph, index) => ({
      id: `block-${index + 1}`,
      actorId: 'narrator',
      actorKind: 'narrator',
      kind: 'prose',
      displayMode: 'paragraph',
      text: paragraph,
    })),
  };
}

function getActionSchema(_conversation: GroupChat) {
  return {
    title: '故事动作',
    actions: [],
  };
}

function buildStoryChapters(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
  summary: string;
  openedChoice: boolean;
  chapterUpdate?: ReturnType<typeof getStoryChapterUpdateFromEvents>;
}) {
  const existing = params.conversation.scenarioState?.storyChapters || [];
  const messageId = (params.message as Partial<Message>).id || `${params.conversation.id}:story-message:${Date.now()}`;
  const timestamp = Number((params.message as Partial<Message>).timestamp || Date.now());
  const update = params.chapterUpdate;
  const updateTitle = update?.title?.trim() || '';
  const updateSummary = update?.summary?.trim() || '';
  const updateChoices = update?.keyChoices || [];
  if (!existing.length) {
    return [{
      id: `${params.conversation.id}:chapter:1`,
      index: 1,
      title: updateTitle,
      status: update?.status || 'active' as const,
      startMessageId: messageId,
      startBeatId: `${params.conversation.id}:beat:${timestamp}`,
      summary: updateSummary || undefined,
      keyChoices: updateChoices,
      openedAt: timestamp,
      ...(update?.status === 'completed' ? { endMessageId: messageId, endBeatId: `${params.conversation.id}:beat:${timestamp}`, closedAt: timestamp } : {}),
    }];
  }
  const latestIndex = existing.length - 1;
  const latest = existing[latestIndex];
  const selectedChoiceLabels = params.openedChoice
    ? (params.conversation.scenarioState?.choiceHistory || []).slice(-1).map((choice) => choice.label)
    : [];
  if (update?.startNewChapter) {
    const closedLatest = latest.status === 'completed' ? latest : {
      ...latest,
      status: 'completed' as const,
      endMessageId: messageId,
      endBeatId: `${params.conversation.id}:beat:${timestamp}`,
      closedAt: timestamp,
    };
    return [
      ...existing.slice(0, latestIndex),
      closedLatest,
      {
        id: `${params.conversation.id}:chapter:${existing.length + 1}`,
        index: existing.length + 1,
        title: updateTitle,
        status: update.status || 'active' as const,
        startMessageId: messageId,
        startBeatId: `${params.conversation.id}:beat:${timestamp}`,
        summary: updateSummary || undefined,
        keyChoices: updateChoices,
        openedAt: timestamp,
        ...(update.status === 'completed' ? { endMessageId: messageId, endBeatId: `${params.conversation.id}:beat:${timestamp}`, closedAt: timestamp } : {}),
      },
    ];
  }
  return existing.map((chapter, index) => {
    if (index !== latestIndex) return chapter;
    const keyChoices = Array.from(new Set([...(chapter.keyChoices || []), ...selectedChoiceLabels, ...updateChoices])).filter(Boolean);
    return {
      ...chapter,
      ...(updateTitle ? { title: updateTitle } : {}),
      ...(updateSummary ? { summary: updateSummary } : {}),
      ...(keyChoices.length ? { keyChoices } : {}),
      ...(update?.status ? { status: update.status } : {}),
      ...(update?.status === 'completed' ? { endMessageId: messageId, endBeatId: `${params.conversation.id}:beat:${timestamp}`, closedAt: timestamp } : {}),
    };
  });
}

function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: Parameters<SessionEngineDefinition['onMessageCommitted']>[0]['characters'];
  message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
}) {
  const metadataText = params.message.metadata?.narrativeTurn?.blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join(' ');
  const summary = (params.message.content.trim() || metadataText || '剧情推进').slice(0, 72);
  const currentBeatPlan = resolveStoryBeatPlan(params.conversation);
  const readerRole = params.conversation.scenarioState?.readerRole || resolveStoryReaderRole(params.conversation);
  const shouldValidateChoiceSubject = Boolean(params.conversation.scenarioState?.readerRole);
  const rawModelChoices = normalizeStoryChoiceSuggestions(params.message.metadata?.storyChoices);
  const roleValidChoices = shouldValidateChoiceSubject ? filterStoryChoicesByReaderRole(rawModelChoices, readerRole) : rawModelChoices;
  const modelChoices = currentBeatPlan.choicePolicy === 'forbid' ? [] : roleValidChoices;
  const diagnostics = [...(params.conversation.scenarioState?.storyProtocolDiagnostics || [])];
  const appendDiagnostic = (diagnostic: Omit<NonNullable<NonNullable<GroupChat['scenarioState']>['storyProtocolDiagnostics']>[number], 'createdAt' | 'beatKind' | 'choicePolicy' | 'choiceEpoch'>) => {
    const item = {
      ...diagnostic,
      beatKind: currentBeatPlan.beatKind,
      choicePolicy: currentBeatPlan.choicePolicy,
      choiceEpoch: params.conversation.scenarioState?.choiceEpoch,
      createdAt: Date.now(),
    };
    diagnostics.push(item);
    logDeveloperDiagnostic(`story-protocol:${item.code}`, {
      chatId: params.conversation.id,
      readerRole,
      diagnostic: item,
      rawChoiceCount: rawModelChoices.length,
      roleValidChoiceCount: roleValidChoices.length,
    }, item.level);
  };
  if (currentBeatPlan.choicePolicy === 'forbid' && rawModelChoices.length >= 2) {
    appendDiagnostic({
      code: 'choice_forbidden',
      level: 'error',
      message: '模型在禁止抉择的叙事节拍输出了 choice_point。',
    });
  }
  if (currentBeatPlan.choicePolicy !== 'forbid' && rawModelChoices.length >= 2 && roleValidChoices.length < 2) {
    appendDiagnostic({
      code: 'choice_subject_mismatch',
      level: 'error',
      message: readerRole === 'participant'
        ? '用户作为群成员时，候选项必须以“我”作为行动主体。'
        : '用户作为场外读者时，候选项必须使用具体角色名作为行动主体，不能使用“让 xxx”。',
    });
  }
  if (currentBeatPlan.choicePolicy === 'require' && modelChoices.length < 2) {
    appendDiagnostic({
      code: 'choice_required_missing',
      level: 'error',
      message: '模型在必须形成关键抉择的节拍没有输出 2-4 个合格候选项。',
    });
  }
  const storyAssets = extractStoryAssets({ conversation: params.conversation, message: params.message, choices: modelChoices, summary, characters: params.characters });
  const normalized = normalizeStoryBranches(params.conversation, modelChoices);
  const storyEvents = normalizeStoryEvents(params.message.metadata?.storyEvents);
  const chapterUpdate = getStoryChapterUpdateFromEvents(storyEvents);
  const nextEpoch = getCurrentChoiceEpoch({ ...params.conversation, scenarioState: { ...(params.conversation.scenarioState || {}), branches: normalized.branches } });
  const previousChoiceHistory = params.conversation.scenarioState?.choiceHistory || [];
  const nextChoiceHistory = updateChoiceHistoryOutcome(params.conversation, summary, storyAssets);
  const selectedEpoch = Number(params.conversation.scenarioState?.selectedChoiceEpoch || 0);
  const resolvedActiveChoice = params.conversation.scenarioState?.phase !== 'branch'
    || !params.conversation.scenarioState?.selectedChoice
    || nextChoiceHistory.some((choice, index) => (
      Boolean(choice.outcome)
      && !previousChoiceHistory[index]?.outcome
      && (!selectedEpoch || Number(choice.choiceEpoch || 0) === selectedEpoch)
    ));
  const keepResolvingChoice = params.conversation.scenarioState?.phase === 'branch'
    && Boolean(params.conversation.scenarioState?.selectedChoice)
    && !resolvedActiveChoice;
  const nextSceneBeatCount = normalized.openedChoice || keepResolvingChoice ? 0 : Number(params.conversation.scenarioState?.sceneBeatCount || 0) + 1;
  const chapterRecap = buildChapterRecap({
    conversation: {
      ...params.conversation,
      scenarioState: {
        ...(params.conversation.scenarioState || {}),
        choiceHistory: nextChoiceHistory,
      },
    },
    storyAssets,
    summary,
    openedChoice: normalized.openedChoice,
    nextSceneBeatCount,
  });
  const storyChapters = buildStoryChapters({
    conversation: params.conversation,
    message: params.message,
    summary,
    openedChoice: normalized.openedChoice,
    chapterUpdate,
  });
  if (storyChapters.length && !storyChapters[storyChapters.length - 1]?.title) {
    appendDiagnostic({
      code: 'chapter_title_missing',
      level: 'warn',
      message: '章节索引已创建，但模型尚未提供协议化章节标题。',
    });
  }
  const nextScenarioState = {
    ...(params.conversation.scenarioState || {}),
    ...storyAssets,
    chapterRecap,
    storyChapters,
    choiceHistory: nextChoiceHistory,
    ...(params.conversation.scenarioState?.readerRole ? { readerRole } : {}),
    storyProtocolDiagnostics: diagnostics.slice(-20),
    phase: normalized.hasOpenChoice ? 'choice' : keepResolvingChoice ? 'branch' : 'scene',
    sceneBeatCount: nextSceneBeatCount,
    choiceEpoch: nextEpoch,
    selectedChoiceEpoch: normalized.openedChoice || (params.conversation.scenarioState?.phase === 'branch' && !keepResolvingChoice) ? undefined : params.conversation.scenarioState?.selectedChoiceEpoch,
    selectedChoice: params.conversation.scenarioState?.phase === 'branch' && !keepResolvingChoice ? null : params.conversation.scenarioState?.selectedChoice,
    branches: normalized.branches,
  };
  const nextBeatPlan = resolveStoryBeatPlan({ ...params.conversation, scenarioState: nextScenarioState });
  return {
    chatPatch: {
      scenarioState: {
        ...nextScenarioState,
        storyBeatKind: nextBeatPlan.beatKind,
        storyChoicePolicy: nextBeatPlan.choicePolicy,
        storyBeatReason: nextBeatPlan.reason,
      },
      worldState: {
        ...params.conversation.worldState,
        phase: 'warming' as ConversationPhase,
        focus: params.conversation.scenarioState?.storyDirection || params.conversation.topic || '剧情推进',
        recentEvent: `剧情推进：${summary}${params.message.content.trim().length > 72 ? '…' : ''}`,
        mood: params.conversation.scenarioState?.storyBackground ? 'immersive' : 'warming',
      },
    },
    characterPatches: [],
    runtimeEvents: [{
      eventType: 'story_scene_progress',
      title: '剧情推进',
      summary,
      eventClass: 'phase',
      visibilityScope: 'public',
      channelId: 'public',
    }],
  };
}

export const STORY_ENGINE: SessionEngineDefinition = {
  key: 'scripted_play',
  createInitialConfig: () => ({ structuredTurns: false, mode: 'scripted_play', sessionFamily: 'conversation', scenarioId: 'story-reader' }),
  createInitialState: () => ({ phase: 'scene', round: 0 }),
  buildParticipants,
  getPhaseDefinitions,
  resolveTurnPolicy,
  getVisiblePanels,
  getAvailableActions,
  getActionSchema: ({ conversation }) => getActionSchema(conversation),
  buildGenerationPromptContext,
  buildRuntimeContextBundle,
  buildNarrativeTurnMetadata,
  onMessageCommitted,
};
