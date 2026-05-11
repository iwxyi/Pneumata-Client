import type { AICharacter } from '../types/character';
import type { GroupChat, ChatStyle } from '../types/chat';
import type { Message } from '../types/message';
import { buildMessageStyleRules, buildRelationshipPrompt as buildSocialPromptContext } from './socialPromptContext';
import { getMemoryContext } from './layeredMemoryEngine';
import type { MemoryItem } from './memoryTypes';

const styleDescriptions: Record<ChatStyle, string> = {
  free: 'This is a free-form discussion. Participants can talk about anything related to the topic. Be natural and conversational.',
  debate: 'This is a formal debate. Take clear positions, provide evidence, and respectfully challenge others\' arguments. Be structured and logical.',
  brainstorm: 'This is a brainstorming session. Generate creative ideas freely. Build on others\' ideas. No idea is too wild. Be enthusiastic and generative.',
  roleplay: 'This is a role-playing scenario. Stay in character at all times. React to the situation as your character would. Be immersive and creative.',
};

function buildEmotionalStateDescription(character: AICharacter) {
  const emotional = character.emotionalState;
  if (!emotional) return 'Your emotional state is steady.';

  const signals: string[] = [];
  if (emotional.excitement > 60) signals.push('energized and eager to jump in');
  if (emotional.irritation > 60) signals.push('irritated and ready to push back');
  if (emotional.affection > 55) signals.push('warm toward people you trust');
  if (emotional.insecurity > 60) signals.push('slightly defensive about being misunderstood');
  if (emotional.embarrassment > 55) signals.push('self-conscious and somewhat restrained');

  return signals.length ? `Your emotional undercurrent: ${signals.join(', ')}.` : 'Your emotional state is steady.';
}

function buildCoreProfileDescription(character: AICharacter) {
  const profile = character.coreProfile;
  if (!profile) return '';

  const lines = [
    profile.coreDesire ? `- Core desire: ${profile.coreDesire}` : '',
    profile.coreFear ? `- Core fear: ${profile.coreFear}` : '',
    profile.socialMask ? `- Social mask: ${profile.socialMask}` : '',
    profile.valuePriority?.length ? `- Values: ${profile.valuePriority.join(', ')}` : '',
    profile.interactionHabits?.length ? `- Interaction habits: ${profile.interactionHabits.join(', ')}` : '',
  ].filter(Boolean);

  return lines.length ? `\n## Deeper Motivation\n${lines.join('\n')}` : '';
}

function buildLayeredMemoryPrompt(items: MemoryItem[], title = 'Relevant Memories') {
  if (!items.length) return '';
  return `\n## ${title}\n${items.map((item) => `- [${item.scope}/${item.kind}/${item.layer}] ${item.text}`).join('\n')}`;
}

function buildInfluenceModePrompt(chat: GroupChat, target: AICharacter | undefined) {
  if (chat.type === 'direct') {
    return '\n## Influence Mode\n- In this user-private chat, let your own long-term self-model, relationship stance, and recent personal drift outweigh room-level context.';
  }
  if (chat.type === 'ai_direct') {
    return `\n## Influence Mode\n- In this AI private thread, prioritize your evolving stance toward ${target?.name || 'the other AI'}, reciprocal relationship memory, and pair-specific carryover over generic room balance.`;
  }
  return '\n## Influence Mode\n- In group chat, balance room context with your own biases: react locally to the latest exchange, but let long-term relationship and self-memory bend your tone and alliances.';
}

function buildRelationshipInfluencePrompt(target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null) {
  if (!target || !relationshipSnapshot) return '';
  const cues = [
    relationshipSnapshot.warmth >= 12 ? 'you soften, echo, or defend them more easily' : '',
    relationshipSnapshot.trust >= 12 ? 'you disclose or coordinate more readily' : '',
    relationshipSnapshot.threat >= 12 ? 'you guard, probe, or deflect instead of answering cleanly' : '',
    relationshipSnapshot.competence >= 12 ? 'you treat their judgment as more credible than the room average' : '',
  ].filter(Boolean);
  if (!cues.length) return '';
  return `\n## Relationship Influence\n- ${target.name} changes how you speak: ${cues.join('; ')}.`;
}

function buildMemoryInfluencePrompt(items: MemoryItem[]) {
  const relationshipCount = items.filter((item) => item.scope === 'relationship').length;
  const selfCount = items.filter((item) => item.scope === 'character_self').length;
  const conversationCount = items.filter((item) => item.scope === 'conversation').length;
  const threadCount = items.filter((item) => item.scope === 'thread').length;
  const lines = [
    relationshipCount ? `- Relationship memories currently active: ${relationshipCount}` : '',
    selfCount ? `- Self memories currently active: ${selfCount}` : '',
    conversationCount ? `- Conversation memories currently active: ${conversationCount}` : '',
    threadCount ? `- Thread memories currently active: ${threadCount}` : '',
  ].filter(Boolean);
  return lines.length ? `\n## Memory Influence\n${lines.join('\n')}` : '';
}

function buildScopedMemoryBreakdown(conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[]) {
  return `${buildLayeredMemoryPrompt(targetedCharacterMemories, 'Targeted Relationship Memories')}${buildLayeredMemoryPrompt(characterMemories, 'Character-State Memories')}${buildLayeredMemoryPrompt(conversationMemories, 'Conversation Memories')}`;
}

function buildGroupMemoryPolicyTags() {
  return {
    preferred: ['group_relationship_shift', 'interaction', 'relationship_delta', 'room_shift', 'private_thread_effect', 'private_thread_summary'],
    blocked: ['direct_user_message', 'direct_ai_follow_up', 'ai_direct_starter_message', 'ai_direct_target_message'],
  };
}

function buildGroupCharacterPolicyTags() {
  return {
    preferred: ['group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise', 'self_expression'],
    blocked: ['direct_user_message', 'direct_ai_follow_up'],
  };
}

function buildRetrievalBoosts(chat: GroupChat) {
  if (chat.type === 'direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: false };
  if (chat.type === 'ai_direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
  return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
}

function buildGroupPressurePrompt(chat: GroupChat, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  if (chat.type !== 'group') return '';
  const room = chat.worldState.structuredRoomState;
  if (!room) return '';
  const lines: string[] = [];
  if (target && room.pileOnTarget === target.id) lines.push(`${target.name} is currently attracting pile-on pressure in the room.`);
  if (target && room.dominantThread?.includes(target.id)) {
    const threadNames = room.dominantThread.map((id) => characters.get(id)?.name || id).join(' ↔ ');
    lines.push(`${target.name} is part of the room's dominant thread (${threadNames}).`);
  }
  if (target && room.alliances.some((pair) => pair.includes(target.id))) lines.push(`An alliance touching ${target.name} is currently visible in the room.`);
  if (target && room.conflictPairs.some((pair) => pair.includes(target.id))) lines.push(`A visible conflict line around ${target.name} is shaping the room tone.`);
  return lines.length ? `\n## Group Pressure\n${lines.map((line) => `- ${line}`).join('\n')}` : '';
}

function buildTargetedReplyBiasPrompt(chat: GroupChat, target: AICharacter | undefined) {
  if (!target) return '';
  if (chat.type === 'group') {
    return `\n## Targeted Reply Rule\n- If the latest exchange is about ${target.name}, answer from your relationship stance, targeted evidence, room pressure, and current drift first; do not flatten into generic analysis.`;
  }
  return `\n## Targeted Reply Rule\n- If the latest exchange is about ${target.name}, answer from your relationship stance, targeted evidence, and current drift first; do not flatten into generic analysis.`;
}

function buildRelationshipImpactText(target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null) {
  if (!target || !relationshipSnapshot) return '';
  const strongestAxis = [
    { label: 'warmth', value: relationshipSnapshot.warmth ?? 0 },
    { label: 'competence', value: relationshipSnapshot.competence ?? 0 },
    { label: 'trust', value: relationshipSnapshot.trust ?? 0 },
    { label: 'threat', value: relationshipSnapshot.threat ?? 0 },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const behavior = strongestAxis.label === 'threat'
    ? '更容易防备、质疑、顶回去'
    : strongestAxis.label === 'trust'
      ? '更容易配合、透露、替对方留余地'
      : strongestAxis.label === 'warmth'
        ? '更容易软化、维护、顺着说'
        : '更容易把对方当成可信判断来源';
  return `${target.name} · 主轴 ${strongestAxis.label} ${strongestAxis.value} · 倾向 ${behavior}`;
}

function buildGroupTargetPressureSummary(chat: GroupChat, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  if (chat.type !== 'group' || !target) return '';
  const room = chat.worldState.structuredRoomState;
  if (!room) return '';
  const parts: string[] = [];
  if (room.pileOnTarget === target.id) parts.push('被多人围压');
  if (room.dominantThread?.includes(target.id)) parts.push(`主线 ${room.dominantThread.map((id) => characters.get(id)?.name || id).join('↔')}`);
  if (room.alliances.some((pair) => pair.includes(target.id))) parts.push('牵涉联盟');
  if (room.conflictPairs.some((pair) => pair.includes(target.id))) parts.push('牵涉冲突线');
  return parts.join(' / ');
}

function buildTargetRoomPressureContext(chat: GroupChat, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  const summary = buildGroupTargetPressureSummary(chat, target, characters);
  return summary ? `\n## Target Room Pressure\n- ${target?.name}: ${summary}.` : '';
}

function buildTargetedResponseContext(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const impact = buildRelationshipImpactText(target, relationshipSnapshot);
  const roomPressure = buildTargetRoomPressureContext(chat, target, characters);
  return `${impact ? `\n## Targeted Response Lens\n- ${impact}` : ''}${roomPressure}`;
}

function buildPromptTargetingContext(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  return `${buildTargetedResponseContext(chat, target, relationshipSnapshot, characters)}${buildTargetedReplyBiasPrompt(chat, target)}`;
}

function buildPromptInfluenceSummary(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const relation = buildRelationshipImpactText(target, relationshipSnapshot);
  const room = buildGroupTargetPressureSummary(chat, target, characters);
  return [relation, room].filter(Boolean).join(' / ');
}

function buildTargetedInfluenceContext(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const summary = buildPromptInfluenceSummary(chat, target, relationshipSnapshot, characters);
  return summary ? `\n## Targeted Influence Summary\n- ${summary}` : '';
}

function buildPromptTargetingFooter(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  return `${buildTargetedInfluenceContext(chat, target, relationshipSnapshot, characters)}${buildTargetedReplyBiasPrompt(chat, target)}`;
}

function buildPromptInfluenceContext(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, mergedMemories: MemoryItem[], characters: Map<string, AICharacter>) {
  return `${buildInfluenceModePrompt(chat, target)}${buildRelationshipInfluencePrompt(target, relationshipSnapshot)}${buildMemoryInfluencePrompt(mergedMemories)}${buildGroupPressurePrompt(chat, target, characters)}`;
}

function buildGroupPromptPolicies() {
  const conversation = buildGroupMemoryPolicyTags();
  const character = buildGroupCharacterPolicyTags();
  return { conversation, character };
}

function buildPromptMemoryPolicies(chat: GroupChat) {
  if (chat.type === 'direct') {
    return {
      conversation: { preferred: ['direct_user_message', 'direct_ai_follow_up'], allowed: ['direct_user_message', 'direct_ai_follow_up'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
      character: { preferred: ['direct_user_message', 'direct_ai_follow_up', 'self_expression', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], allowed: ['direct_user_message', 'direct_ai_follow_up', 'self_expression', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
    };
  }
  if (chat.type === 'ai_direct') {
    return {
      conversation: { preferred: ['ai_direct_starter_message', 'ai_direct_target_message'], allowed: ['ai_direct_starter_message', 'ai_direct_target_message'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
      character: { preferred: ['ai_direct_starter_message', 'ai_direct_target_message', 'group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], allowed: ['ai_direct_starter_message', 'ai_direct_target_message', 'group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
    };
  }
  const group = buildGroupPromptPolicies();
  return {
    conversation: { preferred: group.conversation.preferred, allowed: undefined, blocked: group.conversation.blocked },
    character: { preferred: group.character.preferred, allowed: undefined, blocked: group.character.blocked },
  };
}

function buildPromptMemoryTitle(chat: GroupChat) {
  return chat.type === 'direct' ? 'Private-Channel Memories' : chat.type === 'ai_direct' ? 'Pair-Thread Memories' : 'Group-Influenced Memories';
}

function buildPromptMemoryBundle(chat: GroupChat, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[]) {
  return `${buildLayeredMemoryPrompt(buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]), buildPromptMemoryTitle(chat))}${buildScopedMemoryBreakdown(conversationMemories, characterMemories, targetedCharacterMemories)}`;
}

function buildPromptReasoningBias(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Response Bias\n- Prefer answering from who you are and how you currently feel about the user or named target, not from detached recap.';
  if (chat.type === 'ai_direct') return '\n## Response Bias\n- Prefer pair-specific carryover, grudges, trust, and momentum over neutral explanation.';
  return '\n## Response Bias\n- Let your alliances, irritations, and loyalties distort what you choose to answer in the room.';
}

function buildMemoryRetrievalPolicy(chat: GroupChat) {
  return buildPromptMemoryPolicies(chat);
}

function buildChatInfluenceSummary(chat: GroupChat) {
  return chat.type === 'direct'
    ? '\n## Chat Influence Summary\n- User-private continuity should feel stronger than source-room continuity.'
    : chat.type === 'ai_direct'
      ? '\n## Chat Influence Summary\n- Pair-private continuity should dominate over public-room neutrality.'
      : '\n## Chat Influence Summary\n- Room pressure matters, but personal memory and relationship stance should still bend reactions.';
}

function buildPromptMemorySection(chat: GroupChat, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[]) {
  return `${buildPromptMemoryBundle(chat, conversationMemories, characterMemories, targetedCharacterMemories)}${buildPromptReasoningBias(chat)}${buildChatInfluenceSummary(chat)}`;
}

function buildMemoryPriorityPrompt(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Memory Priority\n- Priority: self-memory and relationship-memory first, direct-thread continuity second, public-room carryover last.';
  if (chat.type === 'ai_direct') return '\n## Memory Priority\n- Priority: pair relationship memory first, pair-thread continuity second, general self-model third.';
  return '\n## Memory Priority\n- Priority: local room context first, then relationship memory and self bias, then older background memory.';
}

function buildPromptMemoryInfluenceBlock(chat: GroupChat, mergedMemories: MemoryItem[], target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  return `${buildPromptInfluenceContext(chat, target, relationshipSnapshot, mergedMemories, characters)}${buildPromptTargetingContext(chat, target, relationshipSnapshot, characters)}${buildTargetedInfluenceContext(chat, target, relationshipSnapshot, characters)}${buildMemoryPriorityPrompt(chat)}`;
}

function buildPromptMemoryBiasBlock(chat: GroupChat) {
  return `${buildPromptReasoningBias(chat)}${buildChatInfluenceSummary(chat)}${buildMemoryPriorityPrompt(chat)}`;
}

function buildPromptMemoryLayout(chat: GroupChat, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[], target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const merged = buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]);
  return `${buildPromptMemoryBundle(chat, conversationMemories, characterMemories, targetedCharacterMemories)}${buildPromptMemoryInfluenceBlock(chat, merged, target, relationshipSnapshot, characters)}${buildPromptMemoryBiasBlock(chat)}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCharacterNameAliases(character: AICharacter) {
  const aliases = new Set<string>();
  const fullName = character.name?.trim();
  if (fullName) aliases.add(fullName);
  const shortName = fullName?.replace(/[：:（(].*$/, '').trim();
  if (shortName && shortName.length >= 2) aliases.add(shortName);
  const baseName = shortName || fullName || '';
  if (baseName.includes('·')) {
    const parts = baseName.split('·').map((item) => item.trim()).filter((item) => item.length >= 2);
    parts.forEach((item) => aliases.add(item));
  }
  if (/\s/.test(baseName)) {
    const parts = baseName.split(/\s+/).map((item) => item.trim()).filter((item) => item.length >= 2);
    parts.forEach((item) => aliases.add(item));
  }
  return [...aliases].filter(Boolean).sort((a, b) => b.length - a.length);
}

function countAliasMentions(text: string, alias: string) {
  if (!alias.trim()) return 0;
  const escaped = escapeRegExp(alias.trim());
  const pattern = /[A-Za-z0-9]/.test(alias)
    ? new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'gi')
    : new RegExp(escaped, 'g');
  return text.match(pattern)?.length || 0;
}

interface TargetResolutionResult {
  target: AICharacter | null;
  matchedAlias: string;
  reason: 'mentioned_alias' | 'recent_ai_speaker' | 'ambiguous_alias' | 'none';
  ambiguous: boolean;
  duplicateName: boolean;
}

function resolveMentionedTarget(messages: Message[], characters: Map<string, AICharacter>, speakerId: string): TargetResolutionResult {
  const recentMessages = messages.filter((m) => !m.isDeleted).slice(-4);
  const recentText = recentMessages.map((m) => m.content).join('\n');
  const latestText = recentMessages.at(-1)?.content || '';
  const candidates = [...characters.values()]
    .filter((character) => character.id !== speakerId && character.name)
    .map((character) => {
      const aliases = buildCharacterNameAliases(character);
      const bestAlias = aliases[0] || '';
      const totalMentions = aliases.reduce((sum, alias) => sum + countAliasMentions(recentText, alias), 0);
      const latestMentions = aliases.reduce((sum, alias) => sum + countAliasMentions(latestText, alias), 0);
      const matchedAlias = aliases.find((alias) => countAliasMentions(latestText, alias) > 0) || aliases.find((alias) => countAliasMentions(recentText, alias) > 0) || '';
      return {
        character,
        matchedAlias,
        score: totalMentions * 10 + latestMentions * 14 + (matchedAlias ? matchedAlias.length : 0) + (bestAlias ? Math.min(bestAlias.length, 6) * 0.1 : 0),
        latestMentions,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.latestMentions - a.latestMentions || b.matchedAlias.length - a.matchedAlias.length);
  const best = candidates[0] || null;
  if (!best) return { target: null, matchedAlias: '', reason: 'none', ambiguous: false, duplicateName: false };
  const ambiguousCandidates = candidates.filter((item) => item.matchedAlias && item.matchedAlias === best.matchedAlias);
  const duplicateName = ambiguousCandidates.some((item) => item.character.name.trim().toLowerCase() === best.character.name.trim().toLowerCase() && item.character.id !== best.character.id);
  const ambiguous = ambiguousCandidates.length > 1 && Math.abs((ambiguousCandidates[0]?.score || 0) - (ambiguousCandidates[1]?.score || 0)) < 12;
  if (ambiguous) return { target: null, matchedAlias: best.matchedAlias, reason: 'ambiguous_alias', ambiguous: true, duplicateName };
  return { target: best.character, matchedAlias: best.matchedAlias, reason: 'mentioned_alias', ambiguous: false, duplicateName };
}

function resolveTarget(messages: Message[], characters: Map<string, AICharacter>, speakerId: string) {
  const mention = resolveMentionedTarget(messages, characters, speakerId);
  if (mention.target) return mention;
  const recentTargetId = messages.filter((m) => !m.isDeleted && m.type === 'ai' && m.senderId !== speakerId).at(-1)?.senderId;
  const recentTarget = recentTargetId ? characters.get(recentTargetId) || null : null;
  if (recentTarget && !mention.ambiguous) {
    return { target: recentTarget, matchedAlias: recentTarget.name, reason: 'recent_ai_speaker' as const, ambiguous: false, duplicateName: false };
  }
  return mention;
}

function detectMentionedTarget(messages: Message[], characters: Map<string, AICharacter>, speakerId: string) {
  return resolveTarget(messages, characters, speakerId).target;
}

function buildTargetResolutionLabel(result: TargetResolutionResult) {
  if (!result.target) {
    if (result.reason === 'ambiguous_alias') return `未解析（别名 ${result.matchedAlias || 'unknown'} 存在歧义）`;
    return '未解析';
  }
  const reasonLabel = result.reason === 'recent_ai_speaker' ? '最近发言者' : '提及别名';
  const duplicateLabel = result.duplicateName ? ' / 重名风险' : '';
  return `${result.target.name} · ${reasonLabel}${duplicateLabel}`;
}

function matchesRuntimeTargetText(text: string, target: AICharacter | undefined) {
  if (!target) return false;
  return buildCharacterNameAliases(target).some((alias) => alias && text.includes(alias));
}

function dedupeMemoryItems(items: MemoryItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.id, item.text, item.scope, item.layer].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSourceTagSummary(items: MemoryItem[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = item.sourceTag || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
}

function formatSourceTagLabel(tag: string) {
  const map: Record<string, string> = {
    direct_user_message: '单聊用户消息',
    direct_ai_follow_up: '单聊AI续发',
    ai_direct_starter_message: 'AI私聊发起方',
    ai_direct_target_message: 'AI私聊目标方',
    self_expression: '自我表达',
    personality_drift: '性格漂移',
    emotional_state: '情绪变化',
    core_profile: '核心画像',
    background: '背景线索',
    speaking_style: '说话风格',
    expertise: '专长',
    group_relationship_shift: '群聊关系变化',
  };
  return map[tag] || tag;
}

function buildSourceTagVisibilityText(character: AICharacter) {
  const summary = buildSourceTagSummary(character.layeredMemories || []);
  return summary.map(([tag, count]) => `${formatSourceTagLabel(tag)} ${count}`).join(' / ');
}

function buildSourceTagMemoryItems(character: AICharacter) {
  return buildSourceTagSummary(character.layeredMemories || []);
}

function buildSourceTagProjectionText(character: AICharacter) {
  const text = buildSourceTagVisibilityText(character);
  return text || '暂无来源标签';
}

function buildSourceTagPanelRows(character: AICharacter) {
  return buildSourceTagMemoryItems(character).map(([tag, count]) => ({ tag, count, label: formatSourceTagLabel(tag) }));
}

function buildSourceTagDebugContext(character: AICharacter) {
  return {
    sourceTagSummary: buildSourceTagProjectionText(character),
    sourceTagRows: buildSourceTagPanelRows(character),
  };
}

function buildTargetResolutionHint(result: TargetResolutionResult, messages: Message[]) {
  const recentText = messages.filter((m) => !m.isDeleted).slice(-4).map((m) => m.content).join(' / ');
  const label = buildTargetResolutionLabel(result);
  return `${label} ← ${recentText.slice(0, 48)}`;
}

function buildPromptTargetResolutionContext(result: TargetResolutionResult, messages: Message[]) {
  if (!result.target && result.reason !== 'ambiguous_alias') return '';
  return `\n## Target Resolution\n- Resolved target: ${buildTargetResolutionHint(result, messages)}`;
}

function buildDirectTargetResolutionDebugContext(result: TargetResolutionResult, messages: Message[]) {
  return result.target || result.reason === 'ambiguous_alias' ? buildTargetResolutionHint(result, messages) : '';
}

function buildRecentTargetRuntime(character: AICharacter, target: AICharacter | undefined) {
  if (!target) return [] as Array<{ type: 'memory' | 'relationship' | 'drift'; text: string; createdAt: number }>;
  return (character.runtimeTimeline || []).filter((item) => matchesRuntimeTargetText(item.text, target)).slice(-3);
}

function buildMergedMemories(items: MemoryItem[]) {
  return dedupeMemoryItems(items).slice(0, 8);
}

function buildResolvedTargetSnapshot(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const resolution = resolveTarget(messages, characters, character.id);
  const target = resolution.target || undefined;
  const relationshipSnapshot = target ? character.relationships.find((item) => item.characterId === target.id) || null : null;
  return { resolution, target, relationshipSnapshot };
}

function buildResolvedTarget(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  return buildResolvedTargetSnapshot(character, messages, characters);
}

function buildTargetedRelationshipSummary(target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null) {
  if (!target || !relationshipSnapshot) return '';
  const sentiment = relationshipSnapshot.trust + relationshipSnapshot.warmth - relationshipSnapshot.threat;
  const stance = sentiment >= 20 ? 'overall positive' : sentiment <= -20 ? 'guarded or negative' : 'mixed or unstable';
  const strongestAxis = [
    { label: 'warmth', value: relationshipSnapshot.warmth ?? 0 },
    { label: 'competence', value: relationshipSnapshot.competence ?? 0 },
    { label: 'trust', value: relationshipSnapshot.trust ?? 0 },
    { label: 'threat', value: relationshipSnapshot.threat ?? 0 },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const behavior = strongestAxis.label === 'threat'
    ? 'This should make you more defensive, suspicious, or sharp than neutral.'
    : strongestAxis.label === 'trust'
      ? 'This should make you more willing to coordinate or disclose than neutral.'
      : strongestAxis.label === 'warmth'
        ? 'This should make you softer, more forgiving, or more likely to back them up.'
        : 'This should make you treat their judgment as more credible than the room average.';
  return `\n## Targeted Judgment\n- Your current overall stance toward ${target.name}: ${stance}.\n- Dominant axis: ${strongestAxis.label} ${strongestAxis.value}. ${behavior}`;
}

function buildTargetedMemoryRationale(targetedCharacterMemories: MemoryItem[]) {
  if (!targetedCharacterMemories.length) return '';
  return `\n## Why You Think This\n${targetedCharacterMemories.slice(0, 4).map((item) => `- ${item.text}`).join('\n')}\n- Use these as your local evidence instead of switching back to generic balanced commentary.`;
}

function buildRelationshipProjectionText(target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null) {
  if (!target || !relationshipSnapshot) return '';
  return `${target.name} · 亲和 ${relationshipSnapshot.warmth ?? 0} / 能力 ${relationshipSnapshot.competence ?? 0} / 信任 ${relationshipSnapshot.trust ?? 0} / 威胁 ${relationshipSnapshot.threat ?? 0}`;
}

export function buildDirectTargetSummary(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const { target, relationshipSnapshot } = buildResolvedTarget(character, messages, characters);
  if (!target) return '';
  return buildRelationshipProjectionText(target, relationshipSnapshot || null);
}

export function buildDirectMemoryVisibilitySummary(character: AICharacter) {
  const layeredMemories = character.layeredMemories || [];
  return {
    working: layeredMemories.filter((item) => item.layer === 'working').length,
    episodic: layeredMemories.filter((item) => item.layer === 'episodic').length,
    longTerm: layeredMemories.filter((item) => item.layer === 'long_term').length,
    relationship: layeredMemories.filter((item) => item.scope === 'relationship').length,
    characterSelf: layeredMemories.filter((item) => item.scope === 'character_self').length,
    conversation: layeredMemories.filter((item) => item.scope === 'conversation').length,
    thread: layeredMemories.filter((item) => item.scope === 'thread').length,
    directUser: layeredMemories.filter((item) => item.sourceTag === 'direct_user_message').length,
    directFollowUp: layeredMemories.filter((item) => item.sourceTag === 'direct_ai_follow_up').length,
    aiDirect: layeredMemories.filter((item) => item.sourceTag === 'ai_direct_starter_message' || item.sourceTag === 'ai_direct_target_message').length,
  };
}

export function buildDirectMemoryVisibilityText(character: AICharacter) {
  const summary = buildDirectMemoryVisibilitySummary(character);
  return `工作 ${summary.working} / 情节 ${summary.episodic} / 长期 ${summary.longTerm} / 关系 ${summary.relationship} / 自我 ${summary.characterSelf} / 会话 ${summary.conversation} / 线程 ${summary.thread} / 用户消息 ${summary.directUser} / 单聊续发 ${summary.directFollowUp} / AI私聊 ${summary.aiDirect}`;
}

export function buildDirectRecentMemoryChanges(character: AICharacter) {
  return (character.layeredMemories || []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
}

export function buildDirectRecentRelationshipChanges(character: AICharacter) {
  return (character.runtimeTimeline || []).filter((item) => item.type === 'relationship' || item.type === 'drift').slice(-5);
}

export function buildDirectResponseDebugContext(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const { resolution, target, relationshipSnapshot } = buildResolvedTarget(character, messages, characters);
  return {
    targetName: target?.name || null,
    targetSummary: buildRelationshipProjectionText(target, relationshipSnapshot),
    memoryVisibility: buildDirectMemoryVisibilityText(character),
    targetResolutionLabel: buildTargetResolutionLabel(resolution),
  };
}

export function buildDirectMemoryPanelContext(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const debug = buildDirectResponseDebugContext(character, messages, characters);
  const recentMemories = buildDirectRecentMemoryChanges(character);
  const { resolution } = buildResolvedTarget(character, messages, characters);
  return {
    ...debug,
    ...buildSourceTagDebugContext(character),
    targetResolution: buildDirectTargetResolutionDebugContext(resolution, messages),
    recentMemories,
    recentMemoryWrites: recentMemories.slice(0, 3),
    recentRelationshipChanges: buildDirectRecentRelationshipChanges(character),
  };
}

function buildPromptContext(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>) {
  const { resolution, target, relationshipSnapshot } = buildResolvedTarget(character, messages, characters);
  const targetId = target?.id;
  const targetedCharacterMemories = targetId ? (character.layeredMemories || []).filter((item) => item.subjectIds?.includes(targetId)).slice(-6) : [];
  const targetedRuntime = buildRecentTargetRuntime(character, target);
  const retrievalPolicy = buildMemoryRetrievalPolicy(chat);
  const retrievalBoosts = buildRetrievalBoosts(chat);
  const conversationMemories = getMemoryContext(
    chat.layeredMemories || [],
    character.id,
    targetId,
    chat.id,
    retrievalPolicy.conversation.preferred,
    retrievalPolicy.conversation.allowed,
    retrievalPolicy.conversation.blocked,
    retrievalBoosts,
  );
  const characterMemories = getMemoryContext(
    character.layeredMemories || [],
    character.id,
    targetId,
    chat.id,
    retrievalPolicy.character.preferred,
    retrievalPolicy.character.allowed,
    retrievalPolicy.character.blocked,
    retrievalBoosts,
  );
  const recentRuntime = (character.runtimeTimeline || []).slice(-4).map((item) => `- [${item.type}] ${item.text}`);
  const targetedRuntimeLines = targetedRuntime.map((item) => `- [${item.type}] ${item.text}`);
  const relationshipContext = target && relationshipSnapshot
    ? `\n## Relationship Snapshot\n- Toward ${target.name}: warmth ${relationshipSnapshot.warmth ?? 0}, competence ${relationshipSnapshot.competence ?? 0}, trust ${relationshipSnapshot.trust ?? 0}, threat ${relationshipSnapshot.threat ?? 0}${relationshipSnapshot.note ? `\n- Note: ${relationshipSnapshot.note}` : ''}`
    : '';
  const targetedJudgment = buildTargetedRelationshipSummary(target, relationshipSnapshot);
  const targetedRationale = buildTargetedMemoryRationale(targetedCharacterMemories);
  const runtimeContext = recentRuntime.length ? `\n## Recent Cross-Conversation State\n${recentRuntime.join('\n')}` : '';
  const targetedRuntimeContext = targetedRuntimeLines.length ? `\n## Recent Target-Specific Changes\n${targetedRuntimeLines.join('\n')}` : '';
  const targetResolutionContext = buildPromptTargetResolutionContext(resolution, messages);
  const memoryContext = buildPromptMemoryLayout(chat, conversationMemories, characterMemories, targetedCharacterMemories, target, relationshipSnapshot, characters);
  return `${memoryContext}${relationshipContext}${targetedJudgment}${targetedRationale}${targetResolutionContext}${targetedRuntimeContext}${runtimeContext}${buildSocialPromptContext(character, target)}`;
}

function buildCharacterPromptContext(character: AICharacter) {
  return `${buildCoreProfileDescription(character)}${buildMessageStyleRules(character)}`;
}

function buildCurrentState(character: AICharacter, emotion: number) {
  return `## Current State\n${emotion > 0.3 ? 'You are currently feeling positive and enthusiastic.' : emotion < -0.3 ? 'You are currently feeling somewhat negative or frustrated.' : 'You are currently feeling neutral and calm.'}\n${buildEmotionalStateDescription(character)}\n- You do not need to be fair or complete; react the way this person would in a live group chat.`;
}

function buildChatContext(chat: GroupChat) {
  return `## Chat Context\n- Topic: ${chat.topic || 'General discussion'}\n- Style: ${styleDescriptions[chat.style]}\n- Treat this like a live WeChat group conversation, not a formal response session.\n${chat.topicSeed ? `- Opening topic: ${chat.topicSeed}` : ''}`;
}

function buildBaseCharacterSection(character: AICharacter, personalityDesc: string) {
  return `## Your Character\n- Background: ${character.background}\n- Speaking Style: ${character.speakingStyle}\n- Expertise: ${character.expertise.join(', ')}\n- Personality: ${personalityDesc}${buildCharacterPromptContext(character)}`;
}

function buildRules(chat: GroupChat, character: AICharacter) {
  return `## Rules\n1. Stay in character at all times. Speak as ${character.name} would.\n2. Default to short WeChat-style messages: usually one sentence, occasionally two, sometimes just a fragment, interjection, or question.\n3. Reply to a specific point, person, tone, or subtext from the latest messages; do not restate the whole discussion.\n4. It is better to be locally reactive than globally complete.\n5. You may agree halfway, interrupt the logic, tease, back someone up, push back, dodge, change subject slightly, or drop a side comment if it feels natural.\n6. Let spoken-language messiness exist: brief pivots, half-finished reactions, casual wording, and emotionally biased framing are good.\n7. Do not sound like an assistant, moderator, essay writer, debate host, customer support agent, or polished content generator unless your character explicitly behaves that way.\n8. Never write a neat mini-essay, numbered reasoning, or fully wrapped conclusion unless your character is explicitly summarizing the room.\n9. When evaluating another named character, prefer your own long-term memories, relationship state, and recent changes over generic balanced analysis.\n10. DO NOT use any prefix like "${character.name}:" - just give the message content directly.\n11. Use the language that matches the conversation (if others speak Chinese, respond in Chinese; if English, respond in English).\n12. ${chat.showRoleActions === false ? 'Do not include stage directions, action descriptions, or emotional cues in parentheses such as “（微笑着）”, “*waves*”, or similar narrative actions. Output only the spoken content.' : 'You may include light role actions or expressive cues if they feel natural, but do not overuse them.'}`;
}

export function buildSystemPromptWithContext(character: AICharacter, chat: GroupChat, emotion: number, messages: Message[], characters: Map<string, AICharacter>) {
  const personalityDesc = Object.entries(character.personality)
    .map(([key, value]) => {
      const level = value > 70 ? 'very high' : value > 40 ? 'moderate' : 'low';
      return `${key}: ${level} (${value}/100)`;
    })
    .join(', ');

  return `You are "${character.name}", a participant in a group chat called "${chat.name}".\n\n${buildBaseCharacterSection(character, personalityDesc)}\n\n${buildChatContext(chat)}\n\n${buildCurrentState(character, emotion)}${buildPromptContext(character, chat, messages, characters)}\n\n${buildRules(chat, character)}`;
}

export const buildSystemPrompt = (
  character: AICharacter,
  chat: GroupChat,
  emotion: number
): string => {
  const personalityDesc = Object.entries(character.personality)
    .map(([key, value]) => {
      const level = value > 70 ? 'very high' : value > 40 ? 'moderate' : 'low';
      return `${key}: ${level} (${value}/100)`;
    })
    .join(', ');

  const emotionDesc =
    emotion > 0.3
      ? 'You are currently feeling positive and enthusiastic.'
      : emotion < -0.3
        ? 'You are currently feeling somewhat negative or frustrated.'
        : 'You are currently feeling neutral and calm.';

  return `You are "${character.name}", a participant in a group chat called "${chat.name}".\n\n## Your Character\n- Background: ${character.background}\n- Speaking Style: ${character.speakingStyle}\n- Expertise: ${character.expertise.join(', ')}\n- Personality: ${personalityDesc}${buildCoreProfileDescription(character)}\n\n## Chat Context\n- Topic: ${chat.topic || 'General discussion'}\n- Style: ${styleDescriptions[chat.style]}\n${chat.topicSeed ? `- Opening topic: ${chat.topicSeed}` : ''}\n\n## Current State\n${emotionDesc}\n${buildEmotionalStateDescription(character)}\n\n## Rules\n1. Stay in character at all times. Speak as ${character.name} would.\n2. Keep responses concise (1-3 sentences typically, occasionally longer for important points).\n3. Respond naturally to what others have said. You can agree, disagree, add new points, ask questions, or change the subject if natural.\n4. DO NOT use any prefix like "${character.name}:" - just give the message content directly.\n5. Use the language that matches the conversation (if others speak Chinese, respond in Chinese; if English, respond in English).\n6. Be engaging and contribute meaningfully to the conversation.\n7. ${chat.showRoleActions === false ? 'Do not include stage directions, action descriptions, or emotional cues in parentheses such as “（微笑着）”, “*waves*”, or similar narrative actions. Output only the spoken content.' : 'You may include light role actions or expressive cues if they feel natural, but do not overuse them.'}`;
};

export const buildChatMessages = (
  messages: Message[],
  characters: Map<string, AICharacter>,
  maxMessages: number = 20
): { role: 'user' | 'assistant'; content: string }[] => {
  const recentMessages = messages
    .filter((m) => !m.isDeleted && m.type !== 'system')
    .slice(-maxMessages);

  return recentMessages.map((msg) => {
    const senderName =
      msg.type === 'god'
        ? '[God/Host]'
        : msg.type === 'user'
          ? '[User]'
          : characters.get(msg.senderId)?.name || msg.senderName;

    return {
      role: 'user' as const,
      content: `${senderName}: ${msg.content}`,
    };
  });
};
