import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SessionGenerationRuntimeBundle } from '../types/sessionEngine';
import type { ChatStyleProfile } from './styleProfileRegistry';
import type { SpeakIntent } from './intentEngine';
import type { InnerLifeProjection } from './innerLifeEngine';
import type { ConversationMovePlan } from './conversationMovePlanner';
import type { NarrativeLineProjection } from './narrativeProjection';
import type { TurnPlan } from './turnPlanner';
import type { UserGuidanceIntent } from './userGuidanceIntent';
import { deriveCharacterTurnDrive, type CharacterTurnDrive } from './characterTurnDrive';
import { resolveSessionFamilyKey } from './sessionEngineKeys';

export interface TurnDirective {
  roomStyle: 'casual' | 'analytical' | 'discovery' | 'dramatic';
  characterDrive: CharacterTurnDrive;
  socialJob: string;
  targetName?: string;
  emotionalUndercurrent: string;
  relationshipEffect: string;
  narrativePressure?: string;
  requiredChange: string;
  expressionShape: string;
  userConstraint?: string;
  situationalConstraints: string[];
  forbiddenDrift: string[];
}

export interface BuildTurnDirectiveInput {
  chat: GroupChat;
  speaker: AICharacter;
  members: AICharacter[];
  messages: Message[];
  styleProfile?: ChatStyleProfile | string | null;
  intent: SpeakIntent;
  innerLife: InnerLifeProjection;
  conversationMovePlan: ConversationMovePlan;
  turnPlan: TurnPlan;
  runtimeBundle?: SessionGenerationRuntimeBundle | null;
  userGuidance?: UserGuidanceIntent | null;
  narrativeLines?: NarrativeLineProjection[];
}

function latestVisible(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function latestHumanPressure(messages: Message[], speakerName?: string) {
  const latestHuman = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god') && message.content.trim())
    .at(-1);
  const text = latestHuman?.content || '';
  return {
    asksDecision: /帮我选|替我选|你们帮我选|直接选|别再问|不用问|给个结论|推荐一个|定一个|怎么选|怎么办/.test(text),
    namesCurrent: Boolean(speakerName && text.includes(speakerName)),
    namesSomeone: /[^\s，。！？、]{1,12}[，,、 ]*(你怎么看|你来说|你说|想听你|直接说)/.test(text) || /我想听/.test(text),
    allowsIntentionalRepeat: /复读|重复|照着说|原话|一起说|接下一句|下一句|口号|喊出来|call[- ]?and[- ]?response/i.test(text),
  };
}

function looksLikeBroadUserClarification(text?: string | null) {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  return /[？?]/.test(normalized)
    || /你先(说|定|选)|你是哪种|你要的是哪种|先把.+定了|再看/.test(normalized);
}

function visibleLength(text: string) {
  return text.replace(/（[^）]{0,80}）|\([^)]{0,80}\)/g, '').trim().length;
}

function nameAddressVariants(name?: string | null) {
  const trimmed = (name || '').trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  if (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length >= 3) {
    variants.add(trimmed.slice(-2));
    if (trimmed.length >= 4) variants.add(trimmed.slice(-3));
  }
  return [...variants].filter((item) => item.length >= 2);
}

function startsWithNameAddress(content: string, names: Set<string>) {
  const trimmed = content.trimStart();
  if (!trimmed) return false;
  for (const name of names) {
    if (trimmed.startsWith(name) && /^[\s,，、:：]/.test(trimmed.slice(name.length, name.length + 1))) {
      return true;
    }
  }
  return false;
}

function nameAddressingDrift(messages: Message[]) {
  const recentAi = messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.content.trim())
    .slice(-6);
  if (recentAi.length < 3) return false;
  const names = new Set<string>();
  for (const message of recentAi) {
    for (const variant of nameAddressVariants(message.senderName)) names.add(variant);
  }
  if (!names.size) return false;
  const addressOpeners = recentAi.filter((message) => startsWithNameAddress(message.content, names));
  return addressOpeners.length >= 3 && addressOpeners.length >= Math.ceil(recentAi.length * 0.5);
}

function speakerName(members: AICharacter[], id?: string) {
  if (!id || id === 'group') return undefined;
  if (id === 'user') return '用户';
  return members.find((member) => member.id === id)?.name || undefined;
}

/**
 * Hybrid prompt architecture boundary:
 * - Use the unified directive only for ordinary public group conversation turns.
 * - Keep direct/AI-private companionship, analysis rooms, story/mystery/gameplay,
 *   and other scenario engines on their dedicated legacy contracts.
 * - This directive replaces scattered per-turn behavior instructions only; full
 *   character, relationship, memory, companionship, and scenario fact blocks stay intact.
 */
export function shouldUseUnifiedTurnDirective(chat: Pick<GroupChat, 'type' | 'mode' | 'sessionKind'>) {
  return chat.type === 'group' && resolveSessionFamilyKey(chat) === 'conversation';
}

function normalizeRoomStyle(styleProfile?: ChatStyleProfile | string | null): TurnDirective['roomStyle'] {
  if (styleProfile === 'analytical_room') return 'analytical';
  if (styleProfile === 'discovery_room') return 'discovery';
  if (styleProfile === 'dramatic_room') return 'dramatic';
  return 'casual';
}

function describeSocialJob(plan: ConversationMovePlan, intent: SpeakIntent) {
  if (intent.stance === 'challenge' || intent.stance === 'pile_on') return 'press one live assumption or consequence from the latest exchange';
  if (intent.stance === 'comfort') return 'lower the pressure without erasing the unresolved point';
  if (intent.stance === 'change_subject' || plan.moveType === 'shift_topic_softly') return 'move to a nearby live angle that a real room could follow';
  if (plan.moveType === 'counterexample') return 'bring one concrete counterexample or exception';
  if (plan.moveType === 'add_boundary_condition') return 'add one condition, cost, or limit that changes the next response';
  if (plan.moveType === 'ask_followup' || plan.moveType === 'ask_evidence' || plan.moveType === 'test_assumption') return 'ask one situated question that tests the point';
  if (plan.moveType === 'bring_back_prior_point') return 'pull back one dropped earlier point';
  if (plan.moveType === 'name_tradeoff') return 'name one practical tradeoff the room has not faced';
  if (plan.moveType === 'answer_unresolved_question') return 'answer the unresolved address directly, then stop or pivot only if natural';
  if (intent.stance === 'support' || intent.stance === 'back_up') return 'show social support while keeping independent judgment';
  if (intent.stance === 'side_comment' || intent.delivery === 'side_remark') return 'drop a side comment that changes the room temperature or angle';
  return 'make one locally specific conversational move';
}

function describeEmotion(innerLife: InnerLifeProjection) {
  // A strong stored affect or directed interaction is itself pressure. The
  // old threshold used only the generic impulse pressure, so a character with
  // visible irritation could be described as "low pressure / stay silent" in
  // the same prompt. That contradiction made the model average the signals
  // into the detached, agreeable voice users were seeing.
  const affectPressure = innerLife.activeAffect?.pressure || 0;
  const emotionPressure = innerLife.dominantEmotion
    ? Math.min(1, Math.max(0, innerLife.dominantEmotion.value) / 100)
    : 0;
  const pressureValue = Math.max(innerLife.pressure, affectPressure, emotionPressure * 0.9);
  const pressure = pressureValue >= 0.65 ? 'visible' : pressureValue >= 0.42 ? 'subtle' : 'background';
  const impulseMap: Record<string, string> = {
    answer: 'answer because addressed',
    show_off: 'wants a little room authority',
    take_control: 'wants to take control of the room, assign consequence, or draw a boundary',
    defend_face: 'saving face',
    seek_attention: 'wants to be noticed without saying so',
    comfort: 'protective warmth',
    repair: 'awkward repair',
    mock: 'teasing or needling',
    avoid: 'low-energy avoidance',
    change_topic: 'wants to move away from the pressure',
    stay_silent: pressureValue >= 0.42
      ? 'holding the reaction back despite active feeling'
      : 'low internal pressure',
    send_emoji: 'small social signal',
    withdraw: 'pulling back',
  };
  return `${pressure}: ${impulseMap[innerLife.impulse] || innerLife.impulse}; let it alter timing, omission, softness, edge, or brevity, not become a confession.`;
}

function describeRelationship(input: BuildTurnDirectiveInput, targetName?: string) {
  const posture = input.conversationMovePlan.socialPosture;
  const target = targetName ? `with ${targetName} in mind` : 'toward the room';
  const fallback = `${posture.warmth} warmth and ${posture.directness} directness`;
  return `treat ${fallback} ${target} as a weak surface fallback only. The current Character Mind relationship continuity and relational consequence are more specific evidence: let them decide what this speaker risks, permits, withholds, protects, tests, resents, or needs from this person. Do not reduce a close, unequal, competitive, indebted, wounded, desired, feared, or professional relationship to that scalar, friendly teamwork, or neutral professionalism`;
}

function describeNarrativePressure(input: BuildTurnDirectiveInput, targetActorId?: string) {
  const relevant = (input.narrativeLines || [])
    .filter((line) => line.participantIds.includes(input.speaker.id))
    .sort((left, right) => {
      const leftTargets = targetActorId && left.participantIds.includes(targetActorId) ? 1 : 0;
      const rightTargets = targetActorId && right.participantIds.includes(targetActorId) ? 1 : 0;
      return rightTargets - leftTargets || right.salience - left.salience;
    })[0];
  if (!relevant) return undefined;
  const open = relevant.openQuestions[0] ? ` Unresolved dramatic question: ${relevant.openQuestions[0]}` : '';
  return `${relevant.type} line "${relevant.title}": ${relevant.summary}.${open}`;
}

function describeRequiredChange(input: BuildTurnDirectiveInput, hasNarrativePressure: boolean) {
  const recentAi = input.messages.filter((message) => message.type === 'ai' && !message.isDeleted).slice(-5);
  const repeatedPracticalAdvance = recentAi.length >= 4
    && recentAi.every((message) => message.content.length >= 24);
  if (hasNarrativePressure) {
    return 'make one observable state change: shift who has leverage, expose a preference or vulnerability, impose or accept a cost, deepen or strain a bond, force a choice, or make the prior plan emotionally harder to carry out. Advancing the task with one more fact or assignment is not enough';
  }
  if (input.innerLife.pressure >= 0.58 || (input.innerLife.activeAffect?.pressure || 0) >= 0.35) {
    return 'let the active feeling cause one perceptible change in timing, confidence, closeness, face, permission, or choice; do not replace it with another task summary';
  }
  if (repeatedPracticalAdvance) {
    return 'the room has already advanced the practical plan several times; an honest reaction, doubt, joke, refusal, side concern, or clean landing is more useful than another assignment';
  }
  return 'no mandatory plot or task change; a specific reaction, partial answer, changed attention, or natural landing is enough';
}

function describeExpression(input: BuildTurnDirectiveInput) {
  const latest = latestVisible(input.messages);
  const latestFromHuman = latest?.type === 'user' || latest?.type === 'god';
  const style = normalizeRoomStyle(input.styleProfile);
  const depth = latestFromHuman && (latest.content || '').trim().length >= 40
    ? 'answer with enough substance for the user'
    : input.turnPlan.rhythm === 'micro_ack'
      ? 'a tiny reaction is valid'
      : input.turnPlan.rhythm === 'multi_bubble'
        ? 'a real afterthought may change the turn, but rhythm does not decide message count'
        : 'one compact live-chat move by default';
  const styleLine = style === 'analytical'
    ? 'use distinctions or tradeoffs only when they advance the point'
    : style === 'discovery'
      ? 'prefer a fresh observation, example, or practical possibility'
      : style === 'dramatic'
        ? 'allow tension and implication, but keep it spoken chat'
        : 'ordinary wording, uneven human rhythm, no meeting-style recap';
  return `${depth}; ${styleLine}; natural presence can be biased, teasing, mildly annoyed, evasive, distracted, over-specific, or incomplete when the moment earns it; a statement, dodge, concession, gripe, pause, or question can all be the right move.`;
}

function describeUserConstraint(userGuidance?: UserGuidanceIntent | null) {
  if (!userGuidance) return undefined;
  if (userGuidance.kind === 'media_request') return 'the user asked for media; handle the media request before social drift';
  if (userGuidance.kind === 'direct_reply') return 'the user directed this turn; answer the addressed need before room momentum';
  if (userGuidance.kind === 'topic_shift') return 'the user steered the topic; keep the room on that steer unless another user need is clearer';
  return 'user guidance is active; do not let AI-to-AI momentum override it';
}

function describeSituationalConstraints(input: BuildTurnDirectiveInput) {
  const visible = input.messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event');
  const previous = visible.at(-1);
  const previousSpeakerSame = previous?.type === 'ai' && previous.senderId === input.speaker.id;
  const recentAiLengths = visible
    .filter((message) => message.type === 'ai')
    .slice(-6)
    .map((message) => visibleLength(message.content))
    .filter((length) => length > 0);
  const longCount = recentAiLengths.filter((length) => length >= 120).length;
  const longRunRisk = recentAiLengths.length >= 3 && longCount >= Math.ceil(recentAiLengths.length * 0.5);
  const recentOwnCount = visible
    .filter((message) => message.type === 'ai' && message.senderId === input.speaker.id)
    .slice(-3).length;
  const latestHuman = latestHumanPressure(visible, input.speaker.name);
  const previousAskedUserFollowup = latestHuman.asksDecision
    && previous?.type === 'ai'
    && looksLikeBroadUserClarification(previous.content);
  const constraints = [
    previousSpeakerSame ? 'the previous visible speaker was also this character; continue only if the situation has moved' : '',
    latestHuman.asksDecision ? 'the latest user asks for a decision or recommendation; state one concrete preference or shortlist first, and do not pass the choice back to the room before giving the user something usable' : '',
    previousAskedUserFollowup ? 'the previous AI already pushed a broad clarification back to the user; do not repeat that move, add a concrete option, condition, or recommendation instead' : '',
    latestHuman.namesSomeone && !latestHuman.namesCurrent ? 'the latest user appears to name someone else; if this character is not that person, make a short clean handoff instead of taking over' : '',
    latestHuman.allowsIntentionalRepeat ? 'the latest user allows deliberate repeat, quote, chant, fixed answer, or call-and-response when that is the natural move' : '',
    recentOwnCount ? `this character has ${recentOwnCount} recent own visible line(s); use them only as no-repeat evidence` : '',
    longRunRisk ? `recent room replies are getting long (${recentAiLengths.join(' / ')} chars); it is natural to cool back down with one concrete line if the current need allows it` : '',
    nameAddressingDrift(visible) ? 'recent room replies are overusing visible name-addressing at the start; do not open with a participant name unless it changes attention, disambiguates the thread, applies pressure, repairs, hands off, or makes a deliberate social move' : '',
  ].filter(Boolean);
  if (constraints.length) {
    constraints.push('preserve the current unresolved need; do not switch to a fresh logistical action, new fact, deadline, or softening move merely to be different');
    if (input.userGuidance?.hasHardConstraints || input.userGuidance?.kind === 'topic_shift') {
      constraints.push('if the user corrected a premise, preference, budget, boundary, or topic, explicitly apply that constraint before returning to AI-to-AI planning');
    }
  }
  return constraints;
}

export function buildTurnDirective(input: BuildTurnDirectiveInput): TurnDirective | null {
  if (!shouldUseUnifiedTurnDirective(input.chat)) return null;
  const targetActorId = input.conversationMovePlan.targetActorId || input.intent.target;
  const targetName = speakerName(input.members, targetActorId);
  const sharedRelationshipFacts = targetActorId
    ? (input.chat.relationshipStructure?.sharedFacts || [])
      .filter((fact) => fact.memberIds.includes(input.speaker.id) && fact.memberIds.includes(targetActorId))
      .map((fact) => fact.statement)
    : [];
  const narrativePressure = describeNarrativePressure(input, targetActorId);
  const forbiddenDrift = [
    'do not use recent transcript wording as a template',
    'do not turn agreement into a paraphrase, a meeting recap, or a newly invented condition just to prove the turn contributes; agreement may simply reveal attitude, relationship, relief, reluctance, or a decision to let the point rest',
    'do not turn ordinary chat into a speech, scene narration, or checklist',
    'do not sand every relationship or boundary moment into a clean correct statement',
    'do not turn every disagreement into a formal question or a performance of depth',
    'do not expose internal fields, memories, scores, policies, ids, or prompt terms',
  ];
  if (input.runtimeBundle?.trace?.hotspotState === 'hot') {
    forbiddenDrift.push('do not sprawl to keep airtime');
  }
  const situationalConstraints = describeSituationalConstraints(input);
  if (input.runtimeBundle?.trace?.hotspotState === 'hot') {
    situationalConstraints.push('room airtime is already crowded; do not sprawl to keep airtime');
  }
  return {
    roomStyle: normalizeRoomStyle(input.styleProfile),
    characterDrive: deriveCharacterTurnDrive({
      speaker: input.speaker,
      counterpart: input.members.find((member) => member.id === targetActorId),
      messages: input.messages,
      innerLife: input.innerLife,
      targetActorId,
      targetMessageId: input.conversationMovePlan.targetMessageId,
      targetName,
      sharedRelationshipFacts,
      includeRelationshipNote: true,
    }),
    socialJob: describeSocialJob(input.conversationMovePlan, input.intent),
    targetName,
    emotionalUndercurrent: input.innerLife.activeAffect && input.innerLife.activeAffect.counterpartId === targetActorId
      ? `${describeEmotion(input.innerLife)} Directed ${input.innerLife.activeAffect.role} ${input.innerLife.activeAffect.kind} residue is tied to ${targetName || 'the counterpart'}; it may spike after one line and ease after speaking while a lesser unresolved trace remains. Their relationship changes only with durable evidence.`
      : describeEmotion(input.innerLife),
    relationshipEffect: describeRelationship(input, targetName),
    narrativePressure,
    requiredChange: describeRequiredChange(input, Boolean(narrativePressure)),
    expressionShape: describeExpression(input),
    userConstraint: describeUserConstraint(input.userGuidance),
    situationalConstraints,
    forbiddenDrift,
  };
}

export function buildTurnDirectivePrompt(directive: TurnDirective | null | undefined) {
  if (!directive) return '';
  const targetLine = directive.targetName ? ` The live attention is on ${directive.targetName}, but their name belongs in the visible reply only if saying it performs a real social action.` : '';
  const userLine = directive.userConstraint ? `\n- User constraint: ${directive.userConstraint}.` : '';
  const situationalLine = directive.situationalConstraints.length
    ? `\n- Situational constraints: ${directive.situationalConstraints.join('; ')}.`
    : '';
  const relationshipAction = directive.characterDrive.relationalAction === 'situated'
    ? 'not predetermined; infer it from the target-specific evidence below'
    : directive.characterDrive.relationalAction;
  const affectBeat = directive.emotionalUndercurrent.includes('Directed')
    ? '\n- Fast-emotion beat: make the first visible beat acknowledge the spike through a choice of wording, interruption, defensiveness, warmth, or a sudden stop. If the speaker expresses it, let the pressure ease somewhat afterward, but leave one specific residue that can affect the next turn; do not resolve it with a polished apology or generic reassurance.'
    : directive.emotionalUndercurrent.startsWith('visible:')
      ? '\n- Fast-emotion beat: let the opening beat visibly carry this pressure before facts, repair, or logistics take over. If the turn softens, make that change of footing perceptible instead of beginning at the already-calm conclusion.'
    : '';
  return `\n## Turn Directive — This Person in This Moment
- Read the exchange from inside this person, not as a moderator planning the next useful contribution.${targetLine}
- Personal meaning: ${directive.characterDrive.stake}. The latest moment lands as ${directive.characterDrive.feltReaction}. They want to ${directive.characterDrive.immediateWant}, while risking ${directive.characterDrive.immediateRisk}.
- Relationship pull: ${relationshipAction}. ${directive.relationshipEffect}. Do not announce or explain the relationship; let it bend what is noticed, forgiven, challenged, joked about, withheld, or remembered.
- Attention: ${directive.characterDrive.attentionLens}. ${directive.socialJob} is one available move, not an obligation. They may answer only part, react to an earlier line, interrupt, tease, misunderstand, dodge, change footing, send a low-information social signal, or let the moment rest.
- Emotional weather: ${directive.emotionalUndercurrent}.${affectBeat}
- Possible consequence, not a quota: ${directive.requiredChange}. Dramatic line: ${directive.narrativePressure || 'none; do not invent one'}.
- Visible shape: ${directive.expressionShape}. Before writing, silently decide what this moment means to this person and what they would rather not say; write the imperfect line that escapes through their habits, not a complete explanation of the plan.${userLine}${situationalLine}
- Keep only essential constraints: do not copy a recent sentence frame, expose internal fields, or use a name as automatic reply formatting. Other recent lines remain available as social history; the last line is not automatically the only target.`;
}
