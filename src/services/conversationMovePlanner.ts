import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getRelationshipWeight } from './relationshipEngine';
import { resolveSessionFamilyKey } from './sessionEngineKeys';
import type { SpeakerScoreBreakdown } from './speakerScoring';

export type ConversationMoveType =
  | 'react_lightly'
  | 'add_personal_angle'
  | 'ask_followup'
  | 'challenge_playfully'
  | 'add_boundary_condition'
  | 'bring_back_prior_point'
  | 'answer_unresolved_question'
  | 'synthesize'
  | 'shift_topic_softly'
  | 'test_assumption'
  | 'counterexample'
  | 'separate_claims'
  | 'ask_evidence'
  | 'name_tradeoff';

export interface ConversationMovePlan {
  speakerId: string;
  targetMessageId?: string;
  targetActorId?: string;
  targetClaimText?: string;
  moveType: ConversationMoveType;
  socialPosture: {
    warmth: 'warm' | 'neutral' | 'cold';
    directness: 'soft' | 'plain' | 'sharp';
  };
  reason: string;
  confidence: number;
}

function visibleMessages(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event');
}

function recentAiMessages(messages: Message[]) {
  return visibleMessages(messages).filter((message) => message.type === 'ai');
}

function isAnalysisRoom(chat: GroupChat) {
  return resolveSessionFamilyKey(chat) === 'analysis';
}

function isQuestionLike(text: string) {
  return /[?？]|吗|么|为什么|怎么|如何|能不能|会不会|是不是|怎么办|凭什么|难道/.test(text);
}

function isOpenQuestion(text: string) {
  return isQuestionLike(text) && !/(哈哈|笑死|不是吧)$/.test(text.trim());
}

function isExplicitlyAddressedToSpeaker(text: string, speaker: AICharacter) {
  const names = [speaker.name, speaker.id].filter(Boolean);
  return names.some((name) => text.includes(name));
}

function isAgreementOpener(text: string) {
  return /^(这句|这话|这点|这个|他说得|说得|讲得|我认|朕认|我也认|我也接|我接|我站|我同意|同意|赞同|确实|没错|不错|不差|对[，,。 ]|嗯|是这个理|有道理|补得对|说到点子上|稳当|能用|说得好|说得在理|太准|太真实|就是|.*起得好|.*有画面感)/.test(text.trim());
}

function hasCounterMove(text: string) {
  return /(但|不过|可|只是|问题是|先别|未必|不对|不该|不能|凭什么|反过来|前提是|除非|代价|风险|漏洞|误区|我不认|朕不认|不见得|未必如此|倒要问)/.test(text);
}

function normalizeTopicPhrase(text: string) {
  const quoted = text.match(/[“"]([^”"]{2,16})[”"]/);
  if (quoted?.[1]) return quoted[1];
  const compact = text
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, ' ')
    .split(/\s+/)
    .filter((item) => item.length >= 2 && item.length <= 12)
    .slice(-8);
  return compact.at(-1) || '';
}

function findUnresolvedQuestion(messages: Message[], speaker: AICharacter, chat: GroupChat) {
  const recent = visibleMessages(messages).slice(-8);
  const isGroup = chat.type === 'group';
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (message.senderId === speaker.id) continue;
    if (!isOpenQuestion(message.content)) continue;
    if (isGroup && message.type === 'ai' && !isExplicitlyAddressedToSpeaker(message.content, speaker)) continue;
    const later = recent.slice(index + 1);
    const answered = later.some((item) => item.type === 'ai' && item.senderId !== message.senderId && item.content.length >= 24 && !isAgreementOpener(item.content));
    if (!answered) return message;
  }
  return null;
}

function findPriorDroppedPoint(messages: Message[], latestId?: string) {
  const recent = visibleMessages(messages).slice(-10, -2);
  const candidates = recent
    .filter((message) => message.id !== latestId && message.content.length >= 36)
    .filter((message) => isOpenQuestion(message.content) || /但|不过|反过来|问题|成本|边界|风险|前提|如果|怎么办/.test(message.content));
  return candidates.at(-1) || null;
}

function agreementEchoCount(messages: Message[]) {
  return recentAiMessages(messages).slice(-6).filter((message) => isAgreementOpener(message.content) && !hasCounterMove(message.content)).length;
}

function repeatedPhraseCount(messages: Message[]) {
  const phrases = recentAiMessages(messages).slice(-5).map((message) => normalizeTopicPhrase(message.content)).filter(Boolean);
  const counts = phrases.reduce((map, phrase) => {
    map.set(phrase, (map.get(phrase) || 0) + 1);
    return map;
  }, new Map<string, number>());
  return Math.max(0, ...Array.from(counts.values()));
}

function countItems<T>(items: T[] | undefined) {
  return Array.isArray(items) ? items.length : 0;
}

function summarizeRecentDeliberationArtifacts(messages: Message[]) {
  const recent = recentAiMessages(messages).slice(-5);
  let claims = 0;
  let evidence = 0;
  let issues = 0;
  let verdicts = 0;
  let summaries = 0;
  let artifactTurns = 0;
  let latestClaimWithoutScrutiny: Message | null = null;

  recent.forEach((message) => {
    const artifacts = message.metadata?.deliberationArtifacts;
    if (!artifacts) return;
    const messageClaims = countItems(artifacts.claims);
    const messageEvidence = countItems(artifacts.evidence);
    const messageIssues = countItems(artifacts.issues);
    const messageVerdicts = countItems(artifacts.verdicts);
    const hasSummary = artifacts.summary?.text ? 1 : 0;
    const total = messageClaims + messageEvidence + messageIssues + messageVerdicts + hasSummary;
    if (!total) return;
    artifactTurns += 1;
    claims += messageClaims;
    evidence += messageEvidence;
    issues += messageIssues;
    verdicts += messageVerdicts;
    summaries += hasSummary;
    if (messageClaims + messageVerdicts + hasSummary > 0 && messageEvidence + messageIssues === 0) {
      latestClaimWithoutScrutiny = message;
    }
  });

  return {
    recentAiTurns: recent.length,
    artifactTurns,
    claims,
    evidence,
    issues,
    verdicts,
    summaries,
    durableCount: claims + verdicts + summaries,
    scrutinyCount: evidence + issues,
    latestClaimWithoutScrutiny,
  };
}

function chooseSocialPosture(speaker: AICharacter, targetActorId?: string) {
  const relationWeight = targetActorId ? getRelationshipWeight(speaker, targetActorId) : 0;
  const warmth = relationWeight > 0.25 || (speaker.emotionalState?.affection || 0) >= 35
    ? 'warm'
    : relationWeight < -0.25 || (speaker.emotionalState?.irritation || 0) >= 45
      ? 'cold'
      : 'neutral';
  const directness = relationWeight < -0.28 || (speaker.behavior?.aggressiveness || 0) >= 70
    ? 'sharp'
    : warmth === 'warm' || (speaker.behavior?.empathyLevel || 0) >= 65
      ? 'soft'
      : 'plain';
  return { warmth, directness } as const;
}

function chooseDefaultMove(chat: GroupChat, speaker: AICharacter, latest: Message | null): ConversationMoveType {
  if (isAnalysisRoom(chat)) {
    if ((speaker.behavior?.summarizing || 0) >= 72) return 'separate_claims';
    if ((speaker.behavior?.aggressiveness || 0) >= 62) return 'test_assumption';
    if ((speaker.behavior?.proactivity || 0) >= 62) return 'name_tradeoff';
    return latest?.type === 'user' ? 'ask_followup' : 'add_boundary_condition';
  }
  if ((speaker.behavior?.humorIntensity || 0) >= 68) return 'challenge_playfully';
  if ((speaker.behavior?.proactivity || 0) >= 68 && latest?.type === 'user') return 'ask_followup';
  return latest?.type === 'user' ? 'add_personal_angle' : 'react_lightly';
}

export function planConversationMove(params: {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
  speakerScore?: SpeakerScoreBreakdown | null;
}): ConversationMovePlan {
  const messages = visibleMessages(params.messages);
  const latest = messages.at(-1) || null;
  const analysis = isAnalysisRoom(params.chat);
  const unresolvedQuestion = analysis ? null : findUnresolvedQuestion(messages, params.speaker, params.chat);
  const echoCount = analysis ? 0 : agreementEchoCount(messages);
  const repeatedCount = analysis ? 0 : repeatedPhraseCount(messages);
  const priorDroppedPoint = analysis ? null : findPriorDroppedPoint(messages, latest?.id);
  const deliberationArtifacts = analysis ? summarizeRecentDeliberationArtifacts(messages) : null;
  const scoreReasons = params.speakerScore?.reasons || [];
  const isUnspokenBreakIn = scoreReasons.includes('unspoken_member');
  const selectedDespiteSilence = scoreReasons.includes('inner:stay_silent');

  if (!analysis && isUnspokenBreakIn) {
    const target = priorDroppedPoint || latest || undefined;
    const assertive = (params.speaker.behavior?.aggressiveness || 0) >= 55;
    const proactive = (params.speaker.behavior?.proactivity || 0) >= 55;
    return {
      speakerId: params.speaker.id,
      targetMessageId: target?.id,
      targetActorId: target?.senderId,
      targetClaimText: target?.content.slice(0, 120),
      moveType: echoCount >= 2 || assertive
        ? 'counterexample'
        : proactive
          ? 'name_tradeoff'
          : 'add_boundary_condition',
      socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
      reason: selectedDespiteSilence ? 'break_in_selected_despite_silence' : 'unspoken_member_break_in',
      confidence: selectedDespiteSilence ? 0.82 : 0.78,
    };
  }

  if (unresolvedQuestion) {
    return {
      speakerId: params.speaker.id,
      targetMessageId: unresolvedQuestion.id,
      targetActorId: unresolvedQuestion.senderId,
      targetClaimText: unresolvedQuestion.content.slice(0, 120),
      moveType: 'answer_unresolved_question',
      socialPosture: chooseSocialPosture(params.speaker, unresolvedQuestion.senderId),
      reason: 'unresolved_question',
      confidence: 0.86,
    };
  }

  if (analysis && deliberationArtifacts && deliberationArtifacts.artifactTurns === 0) {
    const target = latest || undefined;
    if (deliberationArtifacts.recentAiTurns >= 3 && target) {
      return {
        speakerId: params.speaker.id,
        targetMessageId: target.id,
        targetActorId: target.senderId,
        targetClaimText: target.content.slice(0, 120),
        moveType: 'ask_evidence',
        socialPosture: chooseSocialPosture(params.speaker, target.senderId),
        reason: 'bootstrap_missing_artifacts_needs_scrutiny',
        confidence: 0.78,
      };
    }
    return {
      speakerId: params.speaker.id,
      targetMessageId: target?.id,
      targetActorId: target?.senderId,
      targetClaimText: target?.content.slice(0, 120),
      moveType: target ? 'separate_claims' : 'name_tradeoff',
      socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
      reason: target ? 'bootstrap_without_artifacts' : 'bootstrap_empty_deliberation',
      confidence: 0.76,
    };
  }

  if (analysis && deliberationArtifacts && deliberationArtifacts.artifactTurns >= 2) {
    const target = deliberationArtifacts.latestClaimWithoutScrutiny || latest || priorDroppedPoint || undefined;
    if (deliberationArtifacts.durableCount >= 3 && deliberationArtifacts.evidence === 0) {
      return {
        speakerId: params.speaker.id,
        targetMessageId: target?.id,
        targetActorId: target?.senderId,
        targetClaimText: target?.content.slice(0, 120),
        moveType: 'ask_evidence',
        socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
        reason: 'claims_without_evidence',
        confidence: 0.8,
      };
    }
    if (deliberationArtifacts.durableCount >= 4 && deliberationArtifacts.issues === 0) {
      return {
        speakerId: params.speaker.id,
        targetMessageId: target?.id,
        targetActorId: target?.senderId,
        targetClaimText: target?.content.slice(0, 120),
        moveType: deliberationArtifacts.verdicts >= 2 ? 'test_assumption' : 'counterexample',
        socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
        reason: 'consensus_without_questioning',
        confidence: 0.78,
      };
    }
    if (deliberationArtifacts.durableCount >= 4 && deliberationArtifacts.scrutinyCount <= 1) {
      return {
        speakerId: params.speaker.id,
        targetMessageId: target?.id,
        targetActorId: target?.senderId,
        targetClaimText: target?.content.slice(0, 120),
        moveType: 'separate_claims',
        socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
        reason: 'thin_scrutiny_after_consensus',
        confidence: 0.72,
      };
    }
  }

  if (analysis && (echoCount >= 2 || repeatedCount >= 3)) {
    const target = latest || priorDroppedPoint || undefined;
    return {
      speakerId: params.speaker.id,
      targetMessageId: target?.id,
      targetActorId: target?.senderId,
      targetClaimText: target?.content.slice(0, 120),
      moveType: repeatedCount >= 3 ? 'add_boundary_condition' : 'ask_evidence',
      socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
      reason: repeatedCount >= 3 ? 'repeated_topic_phrase' : 'agreement_echo',
      confidence: 0.74,
    };
  }

  if (!analysis && echoCount >= 3) {
    const target = priorDroppedPoint || latest || undefined;
    return {
      speakerId: params.speaker.id,
      targetMessageId: target?.id,
      targetActorId: target?.senderId,
      targetClaimText: target?.content.slice(0, 120),
      moveType: repeatedCount >= 3 ? 'shift_topic_softly' : 'react_lightly',
      socialPosture: chooseSocialPosture(params.speaker, target?.senderId),
      reason: 'chat_echo_loop',
      confidence: 0.78,
    };
  }

  if (priorDroppedPoint && analysis) {
    return {
      speakerId: params.speaker.id,
      targetMessageId: priorDroppedPoint.id,
      targetActorId: priorDroppedPoint.senderId,
      targetClaimText: priorDroppedPoint.content.slice(0, 120),
      moveType: 'bring_back_prior_point',
      socialPosture: chooseSocialPosture(params.speaker, priorDroppedPoint.senderId),
      reason: 'prior_unresolved_thread',
      confidence: 0.64,
    };
  }

  return {
    speakerId: params.speaker.id,
    targetMessageId: latest?.id,
    targetActorId: latest?.senderId,
    targetClaimText: latest?.content.slice(0, 120),
    moveType: chooseDefaultMove(params.chat, params.speaker, latest),
    socialPosture: chooseSocialPosture(params.speaker, latest?.senderId),
    reason: 'default_room_move',
    confidence: 0.55,
  };
}

export function buildConversationMovePrompt(plan: ConversationMovePlan | null | undefined, chat: GroupChat) {
  if (!plan) return '';
  const analysis = isAnalysisRoom(chat);
  const moveLabels: Record<ConversationMoveType, string> = {
    react_lightly: 'make a light situated reaction without copying the previous wording',
    add_personal_angle: 'add a situated angle from this person; it may be ordinary life, taste, mood, practical habit, or expertise only if truly relevant',
    ask_followup: 'ask a useful follow-up that opens the next branch',
    challenge_playfully: 'push back lightly or playfully without turning hostile',
    add_boundary_condition: 'add a boundary condition, cost, risk, or limitation to the current claim instead of merely backing it',
    bring_back_prior_point: 'bring back a relevant earlier point instead of only following the latest line',
    answer_unresolved_question: 'answer or directly engage the unresolved question',
    synthesize: 'synthesize without flattening disagreements',
    shift_topic_softly: 'softly shift to a nearby topic',
    test_assumption: 'test an assumption behind the current claim',
    counterexample: 'offer a concrete counterexample',
    separate_claims: 'separate two claims that have been merged together',
    ask_evidence: 'ask what evidence or condition would make the claim hold',
    name_tradeoff: 'name a tradeoff the room has not made explicit',
  };
  const targetLine = plan.targetClaimText ? '\n- Thread focus: engage the selected prior thread from the transcript without copying its wording.' : '';
  const analysisLine = analysis
    ? '\n- In analysis rooms, warmth is interpersonal tone only. It does not mean viewpoint agreement.'
    : '\n- In casual rooms, keep the move natural and conversational rather than meeting-like. You may ignore part of the previous line, react to the gist, admit a term is outside your lane, or switch to a nearby everyday angle.';
  const echoLoopLine = plan.reason === 'chat_echo_loop'
    ? '\n- The room has already worried the same point enough. Do not manufacture a new condition, risk, counterexample, task, or handoff merely to keep it moving. Let the point land with a brief personal reaction, a change in social temperature, a pause, or a genuinely nearby topic.'
    : '';
  const breakInLine = plan.reason === 'unspoken_member_break_in' || plan.reason === 'break_in_selected_despite_silence'
    ? '\n- You were selected to break a narrow room loop or fill a missing perspective. Do not merely comment that others are right. Enter with one concrete missing angle: a counterexample, boundary condition, practical consequence, fresh fact, or short action implication that gives the next speaker something new to answer.'
    : '';
  const scrutinyLine = analysis && ['ask_evidence', 'counterexample', 'test_assumption', 'separate_claims'].includes(plan.moveType)
    ? '\n- Do not add another supporting analogy. Give the requested scrutiny: evidence condition, counterexample, assumption test, or claim split.\n- This turn is expected to create deliberationArtifacts from your visible reply; do not use a no-new-point response for this move.'
    : '';
  const priorityLine = analysis
    ? 'This is the primary semantic job for the analysis-room turn.'
    : 'This is a secondary realization option. Follow it only where it serves the character drive, personal stake, and relationship action; do not turn it into generic facilitation.';
  return `\n## Conversation Move Guidance
- ${priorityLine}
- Current semantic job: ${moveLabels[plan.moveType] || plan.moveType}.
- Interpersonal posture: ${plan.socialPosture.warmth} warmth, ${plan.socialPosture.directness} directness.${targetLine}${analysisLine}
- Use this as a local choice of what this turn should do. Do not mention the guidance itself.${echoLoopLine}${breakInLine}${scrutinyLine}`;
}
