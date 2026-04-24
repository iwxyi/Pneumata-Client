import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';

export interface SpeechFingerprint {
  fillers: string[];
  openers: string[];
  closers: string[];
  prefersQuestions: boolean;
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

function pick<T>(items: T[], seed: number) {
  if (!items.length) return undefined;
  return items[Math.abs(seed) % items.length];
}

function getSeedFromCharacter(character: AICharacter) {
  return Array.from(character.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
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
  const recentBundle = localThread.map((message) => message.content).join(' / ');
  if (/不是|你这|别扯|离谱|笑死|怎么就/i.test(recentBundle)) return '延续这条线里的不耐烦或抬杠，不要突然切回客观模式。';
  if (/对|确实|有道理|我也觉得|就这意思/i.test(recentBundle)) return '延续这条线里的站边和顺势附和，不要突然转成总结口吻。';
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
  if (archetype.key === 'pushback') return '可以直接顶一句、挑一个漏洞、或者反问。';
  if (archetype.key === 'backing') return '可以顺着站边、补半句、或者替对方递刀。';
  if (archetype.key === 'probe') return '优先短追问，不要展开成长回答。';
  if (archetype.key === 'side_comment') return '像群里插一句，不要自成完整段落。';
  if (archetype.key === 'redirect') return '把话扯回你在意的主线，但依然保持口语。';
  return '像即时聊天接话，不要写成解释。';
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

function buildRecentSurfaceHint(messages: Message[]) {
  const patterns = getRecentSurfacePatterns(messages).slice(0, 4);
  if (!patterns.length) return '';
  return `\n- Avoid reusing the room's current high-frequency speech patterns: ${patterns.map(([pattern, count]) => `${pattern}×${count}`).join(' / ')}`;
}

function buildRecentPhraseConstraint(messages: Message[]) {
  const repeatedPatterns = getRecentSurfacePatterns(messages).filter(([, count]) => count >= 2);
  if (!repeatedPatterns.length) return '';
  return '\n- The room is already echoing repeated phrasing. Deliberately enter from another angle instead of matching the same catchphrase, prefix, or framing.';
}

export function buildSpeechFingerprint(character: AICharacter): SpeechFingerprint {
  const speechProfile = character.speechProfile;
  const openers = speechProfile?.preferredOpeners?.length
    ? speechProfile.preferredOpeners
    : character.behavior.aggressiveness >= 60
      ? ['不是', '等下', '你先别', '说真的']
      : character.behavior.humorIntensity >= 60
        ? ['笑死', '行吧', '不是我说', '哈哈']
        : ['我感觉', '说实话', '其实', '行'];
  const fillers = speechProfile?.fillers?.length
    ? speechProfile.fillers
    : character.behavior.humorIntensity >= 60
      ? ['啊', '哈', '欸', '行吧']
      : character.behavior.aggressiveness >= 60
        ? ['啧', '不是', '你这', '就这']
        : ['嗯', '其实', '感觉', '还行'];
  const closers = speechProfile?.preferredClosers?.length
    ? speechProfile.preferredClosers
    : character.behavior.summarizing >= 65
      ? ['先这样', '反正我是这意思']
      : character.behavior.offTopic >= 60
        ? ['算了扯远了', '先不说这个']
        : ['就这样', '差不多'];
  return {
    fillers,
    openers,
    closers,
    prefersQuestions: (speechProfile?.questionBias ?? 50) >= 55 || character.behavior.proactivity >= 58 || character.behavior.aggressiveness >= 60,
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
  if (intent.stance === 'back_up' || intent.stance === 'support') return { key: 'backing', label: '顺手站边' };
  if (intent.stance === 'probe' || intent.delivery === 'quick_question') return { key: 'probe', label: '追问一下' };
  if (intent.stance === 'summarize' || intent.delivery === 'group_redirect') return { key: 'redirect', label: '把话题扯回来' };
  if (intent.delivery === 'side_remark') return { key: 'side_comment', label: '插一句' };
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
      carryLine: '别重新分析全局，像群里顺着当前气口说。',
      topicLatch: '当前这个点',
    };
  }
  const content = latestTarget.content;
  const conversationCarry = buildCarryLineFromConversation(relevant, speakerId, recentTargetId);
  if (/不是|凭什么|怎么就|你这|扯|离谱|有病|笑死/i.test(content)) {
    return { targetId: recentTargetId || null, bias: 'lean_against', carryLine: conversationCarry || '延续上一轮的不耐烦或抬杠感，不要忽然变客观。', topicLatch: pickTopicLatch(content) };
  }
  if (/对|确实|行|就是|我也觉得|有道理/i.test(content)) {
    return { targetId: recentTargetId || null, bias: 'lean_in', carryLine: conversationCarry || '可以顺着站边、附和半句，别突然换成中立评述。', topicLatch: pickTopicLatch(content) };
  }
  return { targetId: recentTargetId || null, bias: 'watching', carryLine: conversationCarry || '只抓住你在意的一个点回应，不必完整覆盖对方。', topicLatch: pickTopicLatch(content) };
}

export function buildSelectiveMisread(intent: SpeakIntent, latestTargetText: string): SelectiveMisread {
  const topicLatch = pickTopicLatch(latestTargetText);
  if (intent.stance === 'challenge' || intent.stance === 'pile_on') {
    return { mode: 'twist', instruction: `不要完整回应，把注意力钉在“${topicLatch}”这一点上，顺手放大、反问或挑刺。` };
  }
  if (intent.delivery === 'side_remark' || intent.messageShape === 'fragment') {
    return { mode: 'partial', instruction: `只接“${topicLatch}”这一小点，像群里顺手插一句。` };
  }
  return { mode: 'literal', instruction: `主要回应“${topicLatch}”这一点，不必覆盖整段。` };
}

export function buildHumanizationPrompt(character: AICharacter, intent: SpeakIntent, messages: Message[]) {
  const fingerprint = buildSpeechFingerprint(character);
  const archetype = pickMessageArchetype(intent);
  const recentTargetId = intent.target === 'group' ? null : intent.target;
  const latestTargetText = getLatestTargetText(messages, recentTargetId);
  const hasChatHistory = messages.some((message) => !message.isDeleted && (message.type === 'ai' || message.type === 'god' || message.type === 'user'));
  if (!hasChatHistory) {
    return `\n## Human Chat Fingerprint
- This is the first visible message in the room. Open the conversation from the chat topic or setting; do not act like you are replying to earlier lines.
- Do not mention, quote, or riff on a catchphrase/opening filler as if it were already being repeated.
- Do not start with a forced opener, filler, or catchphrase. If the character has verbal tics, keep them subtle and optional.
- Write one natural opening chat message, not a summary, not a host announcement, and not a reaction to imaginary context.
- Question bias: ${fingerprint.prefersQuestions ? 'high' : 'normal'}
- Terse bias: ${fingerprint.terseBias}/100
- Sarcasm bias: ${fingerprint.sarcasmBias}/100${buildSpeechStyleSummary(character)}${buildCatchphraseHint(character)}${buildTabooHint(character)}`;
  }
  const stanceMemory = buildStanceMemory(messages, character.id, recentTargetId);
  const selectiveMisread = buildSelectiveMisread(intent, latestTargetText);
  return `\n## Human Chat Fingerprint
- Preferred archetype: ${archetype.label} (${archetype.key})
- Archetype execution: ${buildArchetypeExecutionHint(archetype)}
- Carry-over stance: ${stanceMemory.bias}
- Carry-over rule: ${stanceMemory.carryLine}
- Thread carryover: ${buildStanceSummary(stanceMemory)}
- Latch onto this phrase or point if useful: ${pickTopicLatch(latestTargetText)}
- Selective response mode: ${selectiveMisread.mode}
- ${selectiveMisread.instruction}
- Do not force a fixed opener, filler, closer, or catchphrase. Use character flavor only when it naturally fits this exact turn.
- Question bias: ${fingerprint.prefersQuestions ? 'high' : 'normal'}
- Terse bias: ${fingerprint.terseBias}/100
- Sarcasm bias: ${fingerprint.sarcasmBias}/100${buildSpeechStyleSummary(character)}${buildCatchphraseHint(character)}${buildTabooHint(character)}${buildRecentSurfaceHint(messages)}${buildRecentPhraseConstraint(messages)}
- Keep the reply socially sticky: continue the same vibe instead of resetting into neutral analysis.`;
}

function collapseRepeatedSurface(content: string) {
  return content
    .replace(/^(\S{1,12})(?:\s*[，,、]\s*\1){1,}/, '$1')
    .replace(/(\S{1,12})(?:\s*\1){2,}/g, '$1')
    .trim();
}

function trimRepeatedSentenceEnding(content: string) {
  return content.replace(/([。！？!?])\1+/g, '$1');
}

function stripFormalLeadIn(content: string) {
  return content.replace(/^(我觉得|我认为|从我的角度看|总结一下|简单来说)[，,:：\s]*/i, '').trim();
}

function removeRepeatedSurfacePattern(content: string, messages: Message[]) {
  const repeatedPatterns = getRecentSurfacePatterns(messages).filter(([, count]) => count >= 2).map(([pattern]) => pattern);
  if (!repeatedPatterns.length) return content;
  let next = content.trim();
  for (const pattern of repeatedPatterns) {
    if (next.startsWith(pattern)) {
      next = next.slice(pattern.length).replace(/^[，,、：:\s]+/, '').trim();
    }
  }
  return next || content.trim();
}

function normalizeCatchphraseEcho(content: string, character?: AICharacter) {
  const catchphrases = character?.speechProfile?.catchphrases || [];
  const duplicated = catchphrases.find((phrase) => content.startsWith(`${phrase}${phrase}`));
  if (!duplicated) return content;
  return content.replace(new RegExp(`^(${duplicated})+`), duplicated).trim();
}

export function postProcessHumanChat(content: string, intent: SpeakIntent, character?: AICharacter, messages: Message[] = []) {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  const normalized = trimRepeatedSentenceEnding(collapseRepeatedSurface(stripFormalLeadIn(trimmed))).replace(/\n{2,}/g, '\n').trim();
  const surfaceControlled = normalizeCatchphraseEcho(removeRepeatedSurfacePattern(normalized, messages), character);
  if (intent.messageShape === 'question_only') {
    const question = surfaceControlled.split(/(?<=[。！？!?])/).find((part) => /[?？]|吗|怎么|凭什么|是不是|要不/.test(part)) || surfaceControlled;
    return question.trim();
  }
  if (intent.messageShape === 'fragment') {
    return surfaceControlled.split(/(?<=[。！？!?])/)[0].trim();
  }
  return surfaceControlled;
}
