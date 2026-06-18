import type { ConversationPhase, GroupChat, StoryBeatKind, StoryChoicePolicy } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message, NarrativeTurnMetadata, StoryChoiceSuggestion } from '../../types/message';
import { hasVisibleStoryChoices, normalizeStoryChoiceSuggestions } from '../storyChoices';

const STORY_PHASES = [
  { key: 'scene', label: 'Scene', allowedActions: ['speak', 'send_message'] as string[] },
  { key: 'branch', label: 'Branch', allowedActions: ['speak', 'send_message'] as string[] },
  { key: 'choice', label: 'Choice', allowedActions: ['branch_choose'] as string[] },
];

interface StoryBeatPlan {
  beatKind: StoryBeatKind;
  choicePolicy: StoryChoicePolicy;
  reason: string;
}

interface StoryAssetPatch {
  openQuestions: string[];
  clues: string[];
  stakes: string[];
  relationshipShifts: string[];
  chapterMemory: string;
}

const STORY_ASSET_LIMIT = 6;
const STORY_ASSET_TEXT_LIMIT = 56;
const CHAPTER_MEMORY_LIMIT = 260;

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

function getCurrentChoiceEpoch(conversation: GroupChat) {
  const explicit = Number(conversation.scenarioState?.choiceEpoch || 0);
  const branchEpochs = (conversation.scenarioState?.branches || []).map((branch) => Number(branch.choiceEpoch || 0));
  return Math.max(explicit, 1, ...branchEpochs);
}

function resolveStoryBeatPlan(conversation: GroupChat): StoryBeatPlan {
  const phase = conversation.scenarioState?.phase || 'scene';
  const sceneBeatCount = Number(conversation.scenarioState?.sceneBeatCount || 0);
  if (phase === 'choice') {
    return { beatKind: 'decision', choicePolicy: 'require', reason: 'runtime is waiting for user decision' };
  }
  if (phase === 'branch') {
    return { beatKind: 'consequence', choicePolicy: 'forbid', reason: 'resolve selected branch before opening another choice' };
  }
  if (sceneBeatCount <= 0) {
    return { beatKind: 'establish', choicePolicy: 'forbid', reason: 'establish scene before choices' };
  }
  if (sceneBeatCount === 1) {
    return { beatKind: 'pressure', choicePolicy: 'forbid', reason: 'build visible pressure before choices' };
  }
  if (sceneBeatCount >= 3) {
    return { beatKind: 'decision', choicePolicy: 'require', reason: 'enough setup beats have accumulated' };
  }
  return { beatKind: 'new_pressure', choicePolicy: 'allow', reason: 'new pressure may become a decision point' };
}

function buildChoicePolicyPrompt(plan: StoryBeatPlan) {
  const common = [
    `Story beat plan: beatKind=${plan.beatKind}; choicePolicy=${plan.choicePolicy}; reason=${plan.reason}.`,
    'A choice_point is a chapter decision, not a routine chat button.',
    'Every choice_point choice should include label, prompt, intent, risk, and reward when possible.',
  ];
  if (plan.choicePolicy === 'forbid') {
    return [
      ...common,
      'Do not output storyEvents.choice_point in this beat.',
      'End with readable pressure, consequence, or an unresolved image instead of options.',
    ];
  }
  if (plan.choicePolicy === 'require') {
    return [
      ...common,
      'This beat must reach a real decision point and output exactly one storyEvents.choice_point with 2-4 concrete choices.',
      'Before the choice_point, make the pressure visible in narration or consequential speech.',
      'Each choice must involve a different cost, risk, or likely reward.',
    ];
  }
  return [
    ...common,
    'Output storyEvents.choice_point only if the current beat has visibly created incompatible actions or stakes.',
    'If the pressure is not concrete yet, continue the scene without choices.',
  ];
}

function compactStoryAssetText(text: string, max = STORY_ASSET_TEXT_LIMIT) {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function mergeStoryAssetList(existing: string[] | undefined, additions: string[], limit = STORY_ASSET_LIMIT) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(existing || []), ...additions]) {
    const compact = compactStoryAssetText(item);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    merged.push(compact);
  }
  return merged.slice(-limit);
}

function splitStorySentences(text: string) {
  return (text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text])
    .map((part) => compactStoryAssetText(part, 96))
    .filter(Boolean);
}

function getVisibleStoryText(message: Pick<Message, 'content' | 'metadata'>) {
  const blockText = message.metadata?.narrativeTurn?.blocks
    .filter((block) => block.displayMode !== 'hidden')
    .map((block) => block.text)
    .filter(Boolean)
    .join(' ');
  return compactStoryAssetText(blockText || message.content || '', 360);
}

function extractStoryAssets(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'metadata'>;
  choices: StoryChoiceSuggestion[];
  summary: string;
}): StoryAssetPatch {
  const text = getVisibleStoryText(params.message);
  const sentences = splitStorySentences(text);
  const openQuestionCandidates = sentences.filter((sentence) => (
    /[?？]$/.test(sentence)
    || /(谁|为何|为什么|是否|哪里|怎么|怎样|什么|真相|秘密|失踪|隐藏|隐瞒)/.test(sentence)
  ));
  const clueCandidates = sentences.filter((sentence) => (
    /(线索|证据|发现|记录|名单|钥匙|档案|病历|血迹|痕迹|照片|录音|门缝|脚印|异常|真相)/.test(sentence)
  ));
  const relationshipCandidates = sentences.filter((sentence) => (
    /(信任|怀疑|保护|隐瞒|背叛|靠近|疏远|敌意|动摇|试探|质问|承认|否认)/.test(sentence)
  ));
  const stakeCandidates = [
    ...sentences.filter((sentence) => /(危险|代价|风险|威胁|暴露|失去|来不及|时间|牺牲|安全|封锁|追上|逃走)/.test(sentence)),
    ...params.choices.flatMap((choice) => [choice.risk, choice.reward].filter(Boolean) as string[]),
  ];
  const chapterMemoryParts = [
    params.conversation.scenarioState?.chapterMemory || '',
    params.summary,
  ].filter(Boolean);
  const chapterMemory = compactStoryAssetText(chapterMemoryParts.join(' / '), CHAPTER_MEMORY_LIMIT);
  return {
    openQuestions: mergeStoryAssetList(params.conversation.scenarioState?.openQuestions, openQuestionCandidates),
    clues: mergeStoryAssetList(params.conversation.scenarioState?.clues, clueCandidates),
    stakes: mergeStoryAssetList(params.conversation.scenarioState?.stakes, stakeCandidates),
    relationshipShifts: mergeStoryAssetList(params.conversation.scenarioState?.relationshipShifts, relationshipCandidates),
    chapterMemory,
  };
}

function buildStoryAssetPrompt(conversation: GroupChat) {
  const state = conversation.scenarioState;
  if (!state) return [];
  const lines = [
    state.chapterMemory ? `Chapter memory: ${state.chapterMemory}` : '',
    state.openQuestions?.length ? `Open questions to preserve or answer deliberately: ${state.openQuestions.slice(-4).join(' / ')}` : '',
    state.clues?.length ? `Known clues to reuse or reframe: ${state.clues.slice(-4).join(' / ')}` : '',
    state.stakes?.length ? `Current stakes: ${state.stakes.slice(-4).join(' / ')}` : '',
    state.relationshipShifts?.length ? `Relationship pressure: ${state.relationshipShifts.slice(-4).join(' / ')}` : '',
    state.choiceHistory?.length ? `Recent user choices: ${state.choiceHistory.slice(-3).map((choice) => [choice.label, choice.risk ? `risk=${choice.risk}` : '', choice.reward ? `reward=${choice.reward}` : ''].filter(Boolean).join(' · ')).join(' / ')}` : '',
  ].filter(Boolean);
  if (!lines.length) return [];
  return [
    'Use these story assets as continuity anchors. Do not list them back to the user; weave at most 1-2 into the scene naturally.',
    ...lines,
  ];
}

function normalizeStoryBranches(conversation: GroupChat, choices: StoryChoiceSuggestion[]) {
  const existing = conversation.scenarioState?.branches || [];
  const currentEpoch = getCurrentChoiceEpoch(conversation);
  const selectedEpoch = Number(conversation.scenarioState?.selectedChoiceEpoch || 0);
  const active = existing.filter((branch) => branch.status !== 'locked' && branch.status !== 'completed' && branch.status !== 'chosen' && Number(branch.choiceEpoch || currentEpoch) === currentEpoch);
  if (choices.length < 2) return { branches: existing, hasOpenChoice: false, openedChoice: false };
  if (active.length >= 2 && selectedEpoch !== currentEpoch) return { branches: existing, hasOpenChoice: true, openedChoice: false };
  const nextEpoch = currentEpoch + 1;
  const prefix = `${conversation.id}:choice:${nextEpoch}`;
  return {
    branches: [
      ...existing,
      ...choices.map((choice, index) => ({
        branchId: `${prefix}:${index + 1}`,
        label: choice.label,
        description: [choice.intent ? `意图：${choice.intent}` : '', choice.risk ? `风险：${choice.risk}` : '', choice.reward ? `收益：${choice.reward}` : ''].filter(Boolean).join('；'),
        prompt: choice.prompt || choice.label,
        intent: choice.intent || undefined,
        risk: choice.risk || undefined,
        reward: choice.reward || undefined,
        status: 'available' as const,
        source: 'suggested' as const,
        choiceEpoch: nextEpoch,
      })),
    ],
    hasOpenChoice: true,
    openedChoice: true,
  };
}

function resolveTurnPolicy(params: { conversation: GroupChat; messages: Message[] }) {
  const lastMessage = params.messages[params.messages.length - 1];
  const waitingForChoice = params.conversation.scenarioState?.phase === 'choice' && hasVisibleStoryChoices(lastMessage?.metadata?.storyChoices);
  return {
    runChat: !waitingForChoice,
    runAction: false,
    interleaveAction: false,
  };
}

function buildGenerationPromptContext(params: { conversation: GroupChat }): SessionGenerationPromptContext {
  const phase = params.conversation.scenarioState?.phase || 'scene';
  const beatPlan = resolveStoryBeatPlan(params.conversation);
  const background = params.conversation.scenarioState?.storyBackground ? `\nStory background: ${params.conversation.scenarioState.storyBackground}` : '';
  const direction = params.conversation.scenarioState?.storyDirection ? `\nCurrent story direction / selected branch: ${params.conversation.scenarioState.storyDirection}` : '';
  const outline = params.conversation.scenarioState?.storyOutline ? `\nStory outline: ${params.conversation.scenarioState.storyOutline}` : '';
  return {
    responseStyle: 'creative',
    allowMarkdown: false,
    styleProfile: 'dramatic_room',
    promptPrefix: `Write this story beat as a chat-driven scene using storyEvents as the authoritative visible story body. The narrator is the active actor; narrator prose may carry setting, action, consequences, inner pressure, sensory detail, and scene movement, while the main visible rhythm should be character chat bubbles when characters need to speak. Characters must only say what they can speak aloud, not scene narration, inner monologue, camera direction, or omniscient analysis. Never let a character inherit another character's private object, gesture, memory, wording, or sensory detail unless the transcript explicitly makes it public. Character dialogue is optional and must appear only as storyEvents speech.${background}${direction}${outline}`,
    additionalConstraints: [
      ...buildChoicePolicyPrompt(beatPlan),
      ...buildStoryAssetPrompt(params.conversation),
      ...(phase === 'branch'
        ? [
        'Use storyEvents. At minimum output one narration event. Add speech events only for spoken lines that change the scene.',
        'Resolve the chosen storyDirection through 1 short narrator setup block followed by 2-5 character chat bubbles when dialogue is the right visible rhythm.',
        'Resolve the chosen storyDirection with a concrete consequence: new evidence, danger, location, relationship shift, or goal pressure.',
        'Do not end at a new decision point until the consequence is visible. Any future choices must be specific to the current people, place, clue, threat, or goal.',
        'Avoid abstract option language such as investigate clues, deepen emotion, advance plot, or face the key person without naming what is at stake.',
        'Each character bubble should be 1-3 sentences. Use narrator prose only for external actions or scene changes that cannot be spoken.',
        ]
        : [
        'Use storyEvents. At minimum output one narration event. Add speech events only for spoken lines that change the scene.',
        'Advance the scene through 2-5 short character chat bubbles when dialogue is the right visible rhythm, with at most 1 brief narrator prose block for external action or atmosphere.',
        'Advance the scene with concrete atmosphere, implication, or character pressure instead of plain exposition.',
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
  const choices = currentBeatPlan.choicePolicy === 'forbid'
    ? []
    : normalizeStoryChoiceSuggestions(params.message.metadata?.storyChoices);
  const storyAssets = extractStoryAssets({ conversation: params.conversation, message: params.message, choices, summary });
  const normalized = normalizeStoryBranches(params.conversation, choices);
  const nextEpoch = getCurrentChoiceEpoch({ ...params.conversation, scenarioState: { ...(params.conversation.scenarioState || {}), branches: normalized.branches } });
  const nextScenarioState = {
    ...(params.conversation.scenarioState || {}),
    ...storyAssets,
    phase: normalized.hasOpenChoice ? 'choice' : 'scene',
    sceneBeatCount: normalized.openedChoice ? 0 : Number(params.conversation.scenarioState?.sceneBeatCount || 0) + 1,
    choiceEpoch: nextEpoch,
    selectedChoiceEpoch: normalized.openedChoice ? undefined : params.conversation.scenarioState?.selectedChoiceEpoch,
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
