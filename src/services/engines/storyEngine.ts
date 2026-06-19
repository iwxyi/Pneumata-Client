import type { ConversationPhase, GroupChat } from '../../types/chat';
import type { SessionEngineDefinition, SessionGenerationPromptContext, SessionRuntimeContextBundle } from '../../types/sessionEngine';
import type { Message, NarrativeTurnMetadata } from '../../types/message';
import {
  buildChapterRecap,
  buildChoicePolicyPrompt,
  buildSelectedChoiceConsequencePrompt,
  buildStoryAssetPrompt,
  extractStoryAssets,
  getCurrentChoiceEpoch,
  normalizeStoryBranches,
  resolveStoryBeatPlan,
  updateChoiceHistoryOutcome,
} from '../narrativeRuntime';
import { normalizeStoryChoiceSuggestions } from '../storyChoices';

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

function findLatestVisibleStoryChoices(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const choices = normalizeStoryChoiceSuggestions(message.metadata?.storyChoices);
    if (choices.length) return { messageId: message.id, count: choices.length };
  }
  return null;
}

function resolveTurnPolicy(params: { conversation: GroupChat; messages: Message[] }) {
  const waitingForChoice = params.conversation.scenarioState?.phase === 'choice' && Boolean(findLatestVisibleStoryChoices(params.messages));
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
      ...buildSelectedChoiceConsequencePrompt(params.conversation),
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
  const nextSceneBeatCount = normalized.openedChoice ? 0 : Number(params.conversation.scenarioState?.sceneBeatCount || 0) + 1;
  const chapterRecap = buildChapterRecap({
    conversation: params.conversation,
    storyAssets,
    summary,
    openedChoice: normalized.openedChoice,
    nextSceneBeatCount,
  });
  const nextScenarioState = {
    ...(params.conversation.scenarioState || {}),
    ...storyAssets,
    chapterRecap,
    choiceHistory: updateChoiceHistoryOutcome(params.conversation, summary),
    phase: normalized.hasOpenChoice ? 'choice' : 'scene',
    sceneBeatCount: nextSceneBeatCount,
    choiceEpoch: nextEpoch,
    selectedChoiceEpoch: normalized.openedChoice || params.conversation.scenarioState?.phase === 'branch' ? undefined : params.conversation.scenarioState?.selectedChoiceEpoch,
    selectedChoice: params.conversation.scenarioState?.phase === 'branch' ? null : params.conversation.scenarioState?.selectedChoice,
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
