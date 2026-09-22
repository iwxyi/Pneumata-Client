import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';
import type { UserGuidanceIntent } from './userGuidanceIntent';
import { isVisibleDialogueTurn } from './chatMessageSemantics';

export interface SpeechFingerprint {
  fillers: string[];
  openers: string[];
  closers: string[];
  prefersQuestions: boolean;
  asksForInformation: boolean;
  usesQuestionAsPushback: boolean;
  usesQuestionToSteer: boolean;
  usesQuestionPlayfully: boolean;
  terseBias: number;
  sarcasmBias: number;
}

export interface MessageArchetype {
  key: 'interjection' | 'pushback' | 'backing' | 'probe' | 'side_comment' | 'redirect';
  label: string;
}

export interface StanceMemory {
  targetId: string | null;
  bias: 'lean_in' | 'lean_against' | 'watching' | 'shrug';
  carryLine: string;
  topicLatch: string;
}

export interface SelectiveMisread {
  mode: 'literal' | 'partial' | 'twist';
  instruction: string;
}

function pickTopicLatch(content: string) {
  const match = content.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,10}/g);
  return match?.[0] || '当前这个点';
}

function getLatestTargetText(messages: Message[], recentTargetId?: string | null) {
  if (!recentTargetId) return messages.filter((message) => !message.isDeleted).at(-1)?.content || '';
  return messages.filter((message) => !message.isDeleted && message.senderId === recentTargetId).at(-1)?.content || '';
}

function buildCarryLineFromConversation(relevant: Message[], speakerId: string, recentTargetId?: string | null) {
  const localThread = relevant.filter((message) => message.senderId === speakerId || message.senderId === recentTargetId).slice(-4);
  if (localThread.length >= 3) return '延续这条线里的关系压力和当前气口，但不要复制对方的开头、整句、表情或尾巴。';
  return '';
}

function describeBias(bias: StanceMemory['bias']) {
  if (bias === 'lean_in') return '顺着说';
  if (bias === 'lean_against') return '顶回去';
  if (bias === 'watching') return '盯一个点';
  return '随口接';
}

function buildStanceSummary(memory: StanceMemory) {
  return `${describeBias(memory.bias)} · ${memory.topicLatch}`;
}

function buildArchetypeExecutionHint(archetype: MessageArchetype) {
  if (archetype.key === 'pushback') return '可以直接顶一句、挑一个漏洞、或者在真有压迫感时反问；如果当前任务需要论证，也可以完整展开。';
  if (archetype.key === 'backing') return '可以护住对方的处境、发言权或被误解的部分，但不要把“维护人”自动写成套话复述。你可以只让对方知道自己被站在这一边，也可以保留不同意见；不必硬加条件、代价或下一步。';
  if (archetype.key === 'probe') return '可以短追问，但提问不只用于缺信息：也可以拿来逼表态、转移问题、带节奏、开玩笑、或者把话题拧去你想要的方向；不要用追问逃避需要回答的任务。';
  if (archetype.key === 'side_comment') return '可以像群里插一句，但这只是入口方式；当前场景或用户任务需要时，可以写成完整段落或更长说明。';
  if (archetype.key === 'redirect') return '把话扯回你在意的主线，但依然保持口语。';
  return '像即时聊天接话；不要无故写成解释，但当场景、玩法或用户任务需要解释时要说完整。';
}

function buildCatchphraseHint(character: AICharacter) {
  const catchphrases = character.speechProfile?.catchphrases || [];
  if (!catchphrases.length) return '';
  return `\n- Catchphrases exist but are not required: ${catchphrases.slice(0, 3).join(' / ')}. Never force them as the first token, and never treat them as the topic.`;
}

function buildTabooHint(character: AICharacter) {
  const tabooPhrases = character.speechProfile?.tabooPhrases || [];
  if (!tabooPhrases.length) return '';
  return `\n- Avoid sounding like: ${tabooPhrases.slice(0, 3).join(' / ')}`;
}

function buildSpeechStyleSummary(character: AICharacter) {
  const profile = character.speechProfile;
  if (!profile) return '';
  return `\n- Speech style: length=${profile.sentenceLengthBias}, questionBias=${profile.questionBias}, sarcasmBias=${profile.sarcasmBias}`;
}

function extractSurfacePattern(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const firstClause = normalized.split(/[。！？!?]/)[0] || normalized;
  const prefix = firstClause.split(/[，,、：:]/)[0] || firstClause;
  return prefix.trim().slice(0, 12);
}

function extractOpeningMove(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const firstClause = normalized.split(/[。！？!?]/)[0] || normalized;
  const firstPhrase = firstClause.split(/[，,、：:；;]/)[0] || firstClause;
  return firstPhrase.trim().slice(0, 18);
}

function getRecentSurfacePatterns(messages: Message[]) {
  const patternMap = new Map<string, number>();
  messages
    .filter((message) => !message.isDeleted)
    .slice(-8)
    .forEach((message) => {
      const pattern = extractSurfacePattern(message.content);
      if (!pattern) return;
      patternMap.set(pattern, (patternMap.get(pattern) || 0) + 1);
    });
  return Array.from(patternMap.entries()).sort((a, b) => b[1] - a[1]);
}

function getSharedPrefixLength(a: string, b: string) {
  let index = 0;
  const max = Math.min(a.length, b.length);
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function getRecentSelfOpeningPattern(messages: Message[], speakerId: string) {
  const openings = messages
    .filter((message) => !message.isDeleted && message.type === 'ai' && message.senderId === speakerId)
    .slice(-5)
    .map((message) => extractOpeningMove(message.content))
    .filter((opening) => opening.length >= 4);
  if (openings.length < 2) return { count: openings.length, similarPairs: 0 };
  let similarPairs = 0;
  for (let index = 1; index < openings.length; index += 1) {
    const shared = getSharedPrefixLength(openings[index - 1], openings[index]);
    if (shared >= Math.min(6, Math.floor(Math.min(openings[index - 1].length, openings[index].length) * 0.6))) {
      similarPairs += 1;
    }
  }
  return { count: openings.length, similarPairs };
}

function buildRecentSurfaceHint(messages: Message[]) {
  const patterns = getRecentSurfacePatterns(messages).slice(0, 4);
  if (!patterns.length) return '';
  return '\n- Some surface forms are repeating in the room. Use them only as evidence of social momentum; do not copy their wording, punctuation rhythm, or sentence architecture.';
}

function buildRecentPhraseConstraint(messages: Message[]) {
  const repeatedPatterns = getRecentSurfacePatterns(messages).filter(([, count]) => count >= 2);
  if (!repeatedPatterns.length) return '';
  return '\n- The room is already echoing repeated phrasing. Preserve the social pressure, but deliberately change sentence architecture instead of matching the same catchphrase, prefix, cadence, or framing.';
}

function isAgreementEchoOpener(content: string) {
  return /^(这句|这话|这点|这个|他说得|说得|讲得|我认|朕认|我也认|我也接|我接|我站|我同意|同意|赞同|确实|没错|不错|不差|对[，,。 ]|嗯|是这个理|有道理|补得对|说到点子上|稳当|能用|说得好|说得在理|太准|太真实|就是)/.test(content.trim());
}

function hasCounterMove(content: string) {
  return /(但|不过|可|只是|问题是|先别|未必|不对|不该|不能|凭什么|反过来|前提是|除非|代价|风险|漏洞|误区|我不认|朕不认|不见得|未必如此|倒要问)/.test(content);
}

function isAgreementEchoLoop(messages: Message[]) {
  const recentAi = messages
    .filter((message) => !message.isDeleted && message.type === 'ai')
    .slice(-6);
  if (recentAi.length < 3) return false;
  return recentAi.filter((message) => isAgreementEchoOpener(message.content) && !hasCounterMove(message.content)).length >= 3;
}

function buildAgreementEchoLoopHint(messages: Message[], archetype: MessageArchetype) {
  if (!isAgreementEchoLoop(messages)) return '';
  const backingLine = archetype.key === 'backing'
    ? '\n- Even if the local archetype says backing, do not recycle the room\'s wording. A brief personal show of support, a changed temperature, or a pause can be enough; do not invent a condition or task just to add content.'
    : '';
  return `${backingLine}
- The room has fallen into an agreement echo. Stop restating the shared conclusion.
- Let it land, show a character-specific reaction, change the social temperature, go briefly quiet, or move only to a genuinely nearby topic. Do not manufacture a counterexample, boundary condition, cost, or sharp question merely to keep the exchange going.`;
}

function extractEmojiTokens(content: string) {
  return content.match(/\p{Extended_Pictographic}/gu) || [];
}

function buildRecentEmojiContagionHint(messages: Message[]) {
  const counts = new Map<string, number>();
  messages
    .filter((message) => !message.isDeleted && message.type === 'ai')
    .slice(-10)
    .flatMap((message) => extractEmojiTokens(message.content))
    .forEach((emoji) => counts.set(emoji, (counts.get(emoji) || 0) + 1));
  const repeated = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  if (!repeated.length) return '';
  return '\n- Recent emoji/sticker-like markers are contagious surface noise, not room emotion memory. Do not inherit them unless this character deliberately sends one for a new reason.';
}

function buildRecentSelfOpeningHint(messages: Message[], speakerId: string) {
  const pattern = getRecentSelfOpeningPattern(messages, speakerId);
  if (pattern.count < 2) return '';
  const similarityLine = pattern.similarPairs > 0
    ? ` ${pattern.similarPairs} adjacent pair(s) look structurally similar.`
    : '';
  return `\n- Your recent ${pattern.count} turns have opening-frame history.${similarityLine} Treat repeated opening frames as exhausted surface moves, not as your voice identity.
- If your last turns used the same acknowledgement-then-framework move, skip the acknowledgement and start from a different discourse move: direct conclusion, concrete example, calculation, caveat, counterpoint, next step, or a sharper question.
- Do not solve repetition by swapping one stock phrase for another. Change the sentence architecture and the job of the first sentence.`;
}

function buildInnerResidueChatHint(character: AICharacter) {
  const soul = character.soulState;
  if (!soul) return '';
  const hints = [
    soul.loneliness >= 68 && soul.ignoredStreak >= 2
      ? 'You feel a little unseen. Let it leak as a small test, a half-joke, or a brief “fine, ignore me then” energy; do not directly explain loneliness.'
      : '',
    soul.repression >= 66
      ? 'You have swallowed words for a while. A tiny edge, correction, or delayed “actually...” is more human than a clean explanation.'
      : '',
    soul.shame >= 64
      ? 'There is face-saving pressure. You may dodge, soften, or repair without fully admitting fault.'
      : '',
    soul.lastImpulse === 'repair'
      ? 'You want to repair a bruise without becoming sentimental: a small concession, a softened joke, or “算了我刚才话重了点” energy works better than a formal apology.'
      : '',
    soul.trustInRoom >= 68 && soul.repression <= 35
      ? 'The room feels safe enough for a warmer, slightly clumsy line.'
      : '',
  ].filter(Boolean);
  return hints.length ? `\n- Inner residue style: ${hints.join(' ')}` : '';
}

export function buildSpeechFingerprint(character: AICharacter): SpeechFingerprint {
  const speechProfile = character.speechProfile;
  const openers = speechProfile?.preferredOpeners?.length
    ? speechProfile.preferredOpeners
    : [];
  const fillers = speechProfile?.fillers?.length
    ? speechProfile.fillers
    : [];
  const closers = speechProfile?.preferredClosers?.length
    ? speechProfile.preferredClosers
    : [];
  const explicitQuestionBias = speechProfile?.questionBias ?? 50;
  const asksForInformation = explicitQuestionBias >= 62 || (explicitQuestionBias >= 55 && character.behavior.empathyLevel >= 58);
  const usesQuestionAsPushback = character.behavior.aggressiveness >= 68 || (explicitQuestionBias >= 58 && character.personality.assertiveness >= 60);
  const usesQuestionToSteer = character.behavior.summarizing >= 68 || (explicitQuestionBias >= 56 && character.behavior.proactivity >= 60);
  const usesQuestionPlayfully = character.behavior.humorIntensity >= 68 || (explicitQuestionBias >= 54 && character.personality.creativity >= 60);
  return {
    fillers,
    openers,
    closers,
    prefersQuestions: asksForInformation || usesQuestionAsPushback || usesQuestionToSteer || usesQuestionPlayfully,
    asksForInformation,
    usesQuestionAsPushback,
    usesQuestionToSteer,
    usesQuestionPlayfully,
    terseBias: speechProfile?.sentenceLengthBias === 'short'
      ? 85
      : speechProfile?.sentenceLengthBias === 'long'
        ? 30
        : Math.max(0, Math.min(100, 70 - character.behavior.summarizing + character.behavior.proactivity / 2)),
    sarcasmBias: speechProfile?.sarcasmBias ?? Math.max(0, Math.min(100, character.behavior.aggressiveness + character.behavior.humorIntensity / 2)),
  };
}

export function pickMessageArchetype(intent: SpeakIntent): MessageArchetype {
  if (intent.stance === 'challenge' || intent.stance === 'pile_on') return { key: 'pushback', label: '顶回去' };
  if (intent.stance === 'back_up' || intent.stance === 'support') return { key: 'backing', label: '护住关系' };
  if (intent.stance === 'probe') return { key: 'probe', label: '追问一下' };
  if (intent.stance === 'summarize' || intent.delivery === 'group_redirect') return { key: 'redirect', label: '把话题扯回来' };
  if (intent.delivery === 'side_remark' || intent.delivery === 'quick_question') return { key: 'side_comment', label: '插一句' };
  return { key: 'interjection', label: '短接话' };
}

export function buildStanceMemory(messages: Message[], speakerId: string, recentTargetId?: string | null): StanceMemory {
  const relevant = messages.filter((message) => !message.isDeleted && message.type === 'ai').slice(-8);
  const recentTargetMessages = recentTargetId ? relevant.filter((message) => message.senderId === recentTargetId) : [];
  const latestTarget = recentTargetMessages.at(-1);
  if (!latestTarget) {
    return {
      targetId: recentTargetId || null,
      bias: 'shrug',
      carryLine: '别重新分析全局；可以顺着当前气口说，也可以只插一句旁边的观察。',
      topicLatch: '当前这个点',
    };
  }
  const content = latestTarget.content;
  const conversationCarry = buildCarryLineFromConversation(relevant, speakerId, recentTargetId);
  return { targetId: recentTargetId || null, bias: 'watching', carryLine: conversationCarry || '可以抓住你在意的一个点，也可以只回应大意、跳过不懂的术语，或换一个更日常的入口。', topicLatch: pickTopicLatch(content) };
}

export function buildSelectiveMisread(intent: SpeakIntent, latestTargetText: string): SelectiveMisread {
  const topicLatch = pickTopicLatch(latestTargetText);
  if (intent.stance === 'challenge' || intent.stance === 'pile_on') {
    return { mode: 'twist', instruction: `把注意力优先钉在“${topicLatch}”这一点上，顺手放大、反问或挑刺；如果用户任务需要完整回应，不要故意漏答。` };
  }
  if (intent.delivery === 'side_remark' || intent.messageShape === 'fragment') {
    return { mode: 'partial', instruction: `可以从“${topicLatch}”这一小点切入，像群里顺手插一句；但这不是长度上限，任务需要时要继续说完整。` };
  }
  return { mode: 'literal', instruction: `“${topicLatch}”只是可用入口；你可以回应它、回应大意、承认没接住其中的术语，或换一个更自然的生活角度。不要省掉用户当前真正需要的内容。` };
}

function buildGuidanceCarryoverOverride(guidance?: UserGuidanceIntent | null) {
  if (!guidance) return '';
  const actionLine = guidance.kind === 'media_request'
    ? '- This is an execution request, not a new joke seed: complete the requested media action before any banter.'
    : guidance.kind === 'topic_shift'
      ? '- This replaces the stale room tangent: anchor the next line in this exact focus before reacting to older banter.'
      : '- This is a direct user request: answer the requested point before drifting back into room momentum.';
  return `\n- Active human guidance: ${guidance.focusText || guidance.rawText}
${actionLine}
- Treat old carry-over, repeated jokes, and the previous AI line as lower priority than this human guidance.`;
}

export function buildHumanizationPrompt(character: AICharacter, intent: SpeakIntent, messages: Message[], guidance?: UserGuidanceIntent | null) {
  const fingerprint = buildSpeechFingerprint(character);
  const archetype = pickMessageArchetype(intent);
  const recentTargetId = intent.target === 'group' ? null : intent.target;
  const latestTargetText = guidance?.focusText || guidance?.rawText || getLatestTargetText(messages, recentTargetId);
  const guidanceOverride = buildGuidanceCarryoverOverride(guidance);
  const hasChatHistory = messages.some(isVisibleDialogueTurn);
  if (!hasChatHistory) {
    return `\n## Human Chat Fingerprint
- This is the first visible message in the room. Open the conversation from the chat topic or setting; do not act like you are replying to earlier lines.
- Do not mention, quote, or riff on a catchphrase/opening filler as if it were already being repeated.
- Do not start with a forced opener, filler, or catchphrase. If the character has verbal tics, keep them subtle and optional.
- Write one natural opening chat message, not a summary, not a host announcement, and not a reaction to imaginary context.
- For opening turns, do not mechanically default to asking. Open with whatever fits this person in this room: a view, a joke, a vibe check, a side-eye, a provocation, or occasionally a question.
- If a question appears, it should feel socially motivated: seeking information, fishing for reactions, steering the room, changing the subject, teasing, or putting someone on the spot.
- Question tendency: ${fingerprint.prefersQuestions ? [fingerprint.asksForInformation ? 'info-seeking' : '', fingerprint.usesQuestionAsPushback ? 'pushback' : '', fingerprint.usesQuestionToSteer ? 'steering' : '', fingerprint.usesQuestionPlayfully ? 'playful' : ''].filter(Boolean).join(' / ') : 'not preferred'}
- Terse bias: ${fingerprint.terseBias}/100${buildInnerResidueChatHint(character)}
- Sarcasm bias: ${fingerprint.sarcasmBias}/100${buildSpeechStyleSummary(character)}${buildCatchphraseHint(character)}${buildTabooHint(character)}${guidanceOverride}`;
  }
  const stanceMemory = buildStanceMemory(messages, character.id, recentTargetId);
  const selectiveMisread = buildSelectiveMisread(intent, latestTargetText);
  const latchLine = isAgreementEchoLoop(messages)
    ? '- Latch rule: repeated agreement phrases are exhausted. Do not latch onto them; respond to the underlying unresolved tension instead.'
    : `- Latch onto this phrase or point if useful: ${pickTopicLatch(latestTargetText)}`;
  return `\n## Human Chat Fingerprint
- Preferred archetype: ${archetype.label} (${archetype.key})
- Archetype execution: ${buildArchetypeExecutionHint(archetype)}
- Carry-over stance: ${stanceMemory.bias}
- Carry-over rule: ${stanceMemory.carryLine}
- Thread carryover: ${buildStanceSummary(stanceMemory)}
${latchLine}
- Selective response mode: ${selectiveMisread.mode}
- ${selectiveMisread.instruction}
- Selective focus is an attention prior only. It must not cap answer length, forbid paragraphs, or override the current scene, play mode, or user task.
- Do not force a fixed opener, filler, closer, or catchphrase. Use character flavor only when it naturally fits this exact turn.
- In realistic group chat, many turns are statements, reactions, stance-taking, jokes, fragments, or casual questions; do not make every turn a neat question-response pair.
- Natural group chat often leaves part of the previous message untouched. Do not prove you understood every metaphor, acronym, or example.
- If a prior speaker used jargon, a niche metaphor, or a professional analogy, you may answer the human meaning, ask what it means, or ignore that surface term. Do not pretend every character fluently understands every domain.
- Do not route every example through the character's listed job or expertise. People also speak from food, commute, family, money, sleep, habits, annoyances, taste, mood, memory, or plain uncertainty.
- Questions are welcome when they feel socially useful: to get information, pressure someone, test a stance, redirect the topic, dodge a point, fish for alignment, or make the room more playful.
- If you ask, let it sound like a live human move rather than a formal interviewer move.
- Question tendency: ${fingerprint.prefersQuestions ? [fingerprint.asksForInformation ? 'info-seeking' : '', fingerprint.usesQuestionAsPushback ? 'pushback' : '', fingerprint.usesQuestionToSteer ? 'steering' : '', fingerprint.usesQuestionPlayfully ? 'playful' : ''].filter(Boolean).join(' / ') : 'not preferred'}
- Terse bias: ${fingerprint.terseBias}/100${buildRecentSelfOpeningHint(messages, character.id)}${buildInnerResidueChatHint(character)}
- Sarcasm bias: ${fingerprint.sarcasmBias}/100${buildSpeechStyleSummary(character)}${buildCatchphraseHint(character)}${buildTabooHint(character)}${buildRecentSurfaceHint(messages)}${buildRecentPhraseConstraint(messages)}${buildAgreementEchoLoopHint(messages, archetype)}${buildRecentEmojiContagionHint(messages)}
- Keep the reply socially sticky: continue the social situation, not the room's wording, punctuation rhythm, or sentence mold.${guidanceOverride}`;
}

export function postProcessHumanChat(content: string, _intent: SpeakIntent, character?: AICharacter, messages: Message[] = [], intentionalRepeat = false) {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  void character;
  void messages;
  void intentionalRepeat;
  return trimmed.replace(/\n{3,}/g, '\n\n').trim();
}
