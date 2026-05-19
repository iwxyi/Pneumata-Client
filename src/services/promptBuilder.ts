import type { AICharacter } from '../types/character';
import type { GroupChat, ChatStyle } from '../types/chat';
import type { Message } from '../types/message';
import { buildMessageStyleRules, buildRelationshipPrompt as buildSocialPromptContext } from './socialPromptContext';
import { getMemoryContext } from './layeredMemoryEngine';
import type { MemoryItem } from './memoryTypes';
import { formatConflictPromptText, formatConflictStageLabel } from './runtimeEventFactory';
import { normalizeRelationshipLedgerEntry } from './relationshipLedger';

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

function buildManualMemorySeedPrompt(character: AICharacter) {
  const memory = character.memory;
  if (!memory) return '';
  const lines = [
    memory.shortTermSummary?.trim() ? `- Current private summary: ${memory.shortTermSummary.trim()}` : '',
    memory.longTerm?.length ? `- Stable long-term memories: ${memory.longTerm.slice(-6).join(' / ')}` : '',
    memory.secrets?.length ? `- Private secrets you know but should not reveal casually: ${memory.secrets.slice(-6).join(' / ')}` : '',
    memory.obsessions?.length ? `- Obsessions that may leak into your attention and wording: ${memory.obsessions.slice(-6).join(' / ')}` : '',
    memory.tabooTopics?.length ? `- Taboo or sensitive topics that trigger avoidance, defensiveness, or careful wording: ${memory.tabooTopics.slice(-6).join(' / ')}` : '',
    memory.userMemories?.length ? `- Memories about the user: ${memory.userMemories.slice(-6).join(' / ')}` : '',
  ].filter(Boolean);
  if (!lines.length) return '';
  return `\n## Manual Memory Seeds\n${lines.join('\n')}\n- Treat these as authored character continuity. Let them shape tone, attention, omissions, and reactions; do not list them unless the conversation naturally calls for it.`;
}

function buildLayeredMemoryPrompt(items: MemoryItem[], title = 'Relevant Memories') {
  if (!items.length) return '';
  return `\n## ${title}\n${items.map((item) => `- [${item.scope}/${item.kind}/${item.layer}] ${item.text}`).join('\n')}`;
}

function buildGroupMemoryPolicyTags() {
  return {
    preferred: ['llm_memory_objective_event', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'group_relationship_shift', 'interaction', 'relationship_delta', 'room_shift', 'private_thread_effect', 'private_thread_summary'],
    blocked: ['direct_user_message', 'direct_ai_follow_up', 'ai_direct_starter_message', 'ai_direct_target_message'],
  };
}

function buildGroupCharacterPolicyTags() {
  return {
    preferred: ['llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise', 'self_expression'],
    blocked: ['direct_user_message', 'direct_ai_follow_up'],
  };
}

function buildRetrievalBoosts(chat: GroupChat) {
  if (chat.type === 'direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: false };
  if (chat.type === 'ai_direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
  return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
}

function buildPromptMemoryPolicies(chat: GroupChat) {
  if (chat.type === 'direct') {
    return {
      conversation: { preferred: ['direct_user_message', 'direct_ai_follow_up'], allowed: ['direct_user_message', 'direct_ai_follow_up'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
      character: { preferred: ['llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'direct_user_message', 'direct_ai_follow_up', 'self_expression', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], allowed: ['direct_user_message', 'direct_ai_follow_up', 'self_expression', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
    };
  }
  if (chat.type === 'ai_direct') {
    return {
      conversation: { preferred: ['ai_direct_starter_message', 'ai_direct_target_message'], allowed: ['ai_direct_starter_message', 'ai_direct_target_message'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
      character: { preferred: ['llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'ai_direct_starter_message', 'ai_direct_target_message', 'group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise'], allowed: ['ai_direct_starter_message', 'ai_direct_target_message', 'group_relationship_shift', 'personality_drift', 'emotional_state', 'core_profile', 'background', 'speaking_style', 'expertise', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
    };
  }
  const group = { conversation: buildGroupMemoryPolicyTags(), character: buildGroupCharacterPolicyTags() };
  return {
    conversation: { preferred: group.conversation.preferred, allowed: undefined, blocked: group.conversation.blocked },
    character: { preferred: group.character.preferred, allowed: undefined, blocked: group.character.blocked },
  };
}

function buildMergedMemories(items: MemoryItem[]) {
  return items.filter((item, index, array) => {
    const key = `${item.scope}:${item.kind}:${item.layer}:${item.text}`;
    return array.findIndex((candidate) => `${candidate.scope}:${candidate.kind}:${candidate.layer}:${candidate.text}` === key) === index;
  });
}

function buildPromptMemoryTitle(chat: GroupChat) {
  return chat.type === 'direct' ? 'Private-Channel Memories' : chat.type === 'ai_direct' ? 'Pair-Thread Memories' : 'Group-Influenced Memories';
}

function buildScopedMemoryBreakdown(conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[]) {
  return `${buildLayeredMemoryPrompt(targetedCharacterMemories, 'Targeted Relationship Memories')}${buildLayeredMemoryPrompt(characterMemories, 'Character-State Memories')}${buildLayeredMemoryPrompt(conversationMemories, 'Conversation Memories')}`;
}

function buildPromptMemoryBundle(chat: GroupChat, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[]) {
  return `${buildLayeredMemoryPrompt(buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]), buildPromptMemoryTitle(chat))}${buildScopedMemoryBreakdown(conversationMemories, characterMemories, targetedCharacterMemories)}`;
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

function buildRelationshipSemanticPrompt(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  const relevant = (chat.relationshipLedger || [])
    .map(normalizeRelationshipLedgerEntry)
    .filter((entry) => entry.actorId === character.id && (!target || entry.targetId === target.id))
    .filter((entry) => entry.derived?.semantic?.summary)
    .sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0))
    .slice(0, target ? 1 : 3);
  if (!relevant.length) return '';
  return `\n## Relationship Semantics\n${relevant.map((entry) => {
    const targetName = characters.get(entry.targetId)?.name || entry.targetId;
    return `- Toward ${targetName}: ${entry.derived?.semantic?.summary}`;
  }).join('\n')}\n- Let these relationship meanings bend tone, omissions, willingness to defend, jealousy, rivalry, affection, or avoidance.`;
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

function buildTargetedInfluenceContext(chat: GroupChat, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const relation = buildRelationshipImpactText(target, relationshipSnapshot);
  const room = buildGroupTargetPressureSummary(chat, target, characters);
  const summary = [relation, room].filter(Boolean).join(' / ');
  return summary ? `\n## Targeted Influence Summary\n- ${summary}` : '';
}

function buildConflictPromptBundle(chat: GroupChat, character: AICharacter, characters: Map<string, AICharacter>) {
  if (chat.type !== 'group') return '';
  const state = chat.worldState.conflictState;
  const primary = state?.primaryConflict;
  if (!primary) return '';
  const participantNames = (primary.participantIds || []).map((id) => characters.get(id)?.name || id).join('、');
  const targetNames = (primary.targetIds || []).map((id) => characters.get(id)?.name || id).join('、');
  const involved = (primary.participantIds || []).includes(character.id) || (primary.targetIds || []).includes(character.id);
  const formatted = formatConflictPromptText(primary.type, primary.nextPressure, primary.developmentHooks);
  return `\n## Active Conflict\n- Stage: ${formatConflictStageLabel(primary.stage)}\n- Severity: ${primary.severity.toFixed(2)}\n- Summary: ${primary.summary}${participantNames ? `\n- Participants: ${participantNames}` : ''}${targetNames ? `\n- Targets: ${targetNames}` : ''}${formatted ? `\n${formatted}` : ''}${involved ? '\n- You are directly implicated in this contradiction; react from your position inside it, not as a neutral commentator.' : '\n- Even if you are not central, the room tension should subtly shape what you choose to notice, support, dodge, or escalate.'}`;
}

function buildPromptInfluenceContext(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, mergedMemories: MemoryItem[], characters: Map<string, AICharacter>) {
  return `${buildInfluenceModePrompt(chat, target)}${buildRelationshipInfluencePrompt(target, relationshipSnapshot)}${buildRelationshipSemanticPrompt(chat, character, target, characters)}${buildMemoryInfluencePrompt(mergedMemories)}${buildGroupPressurePrompt(chat, target, characters)}${buildConflictPromptBundle(chat, character, characters)}`;
}

function buildChatInfluenceSummary(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Channel Bias\n- This is a private user-facing channel: intimacy, continuity, and personal stance matter more than room theatrics.';
  if (chat.type === 'ai_direct') return '\n## Channel Bias\n- This is a pair-private AI thread: reciprocal dynamics and unfinished tension between the pair matter more than group consensus.';
  return '\n## Channel Bias\n- This is a public group room: local momentum, alliances, pressure, and contradiction shape what feels natural to say next.';
}

function buildPromptReasoningBias(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Reasoning Bias\n- Answer from lived continuity and personal stance first; do not reconstruct a public-room transcript unless it is genuinely necessary.';
  if (chat.type === 'ai_direct') return '\n## Reasoning Bias\n- Think through the pair history first; prioritize what the other AI means to you over generic topic analysis.';
  return '\n## Reasoning Bias\n- Think like someone inside an unfolding room dynamic: react to contradiction, tone shifts, and alliances before abstract synthesis.';
}

function buildPromptReasoningSummary(chat: GroupChat) {
  return `${buildPromptReasoningBias(chat)}${buildChatInfluenceSummary(chat)}`;
}

function buildMemoryPriorityPrompt(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Memory Priority\n- Priority: self-memory and relationship-memory first, direct-thread continuity second, public-room carryover last.';
  if (chat.type === 'ai_direct') return '\n## Memory Priority\n- Priority: pair relationship memory first, pair-thread continuity second, general self-model third.';
  return '\n## Memory Priority\n- Priority: local room context first, then relationship memory and self bias, then older background memory.';
}

function buildPromptMemorySection(chat: GroupChat, character: AICharacter, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[], target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>) {
  const merged = buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]);
  return `${buildManualMemorySeedPrompt(character)}${buildPromptMemoryBundle(chat, conversationMemories, characterMemories, targetedCharacterMemories)}${buildPromptInfluenceContext(chat, character, target, relationshipSnapshot, merged, characters)}${buildPromptTargetingContext(chat, target, relationshipSnapshot, characters)}${buildTargetedInfluenceContext(chat, target, relationshipSnapshot, characters)}${buildPromptReasoningSummary(chat)}${buildMemoryPriorityPrompt(chat)}`;
}

function buildTopicSection(chat: GroupChat) {
  const lines = [
    `- Topic: ${chat.topic || 'Open conversation'}`,
    `- Style: ${styleDescriptions[chat.style]}`,
  ];
  if (chat.worldState.mood) lines.push(`- Room mood: ${chat.worldState.mood}`);
  if (chat.worldState.focus) lines.push(`- Current focus: ${chat.worldState.focus}`);
  if (chat.worldState.phase) lines.push(`- Current phase: ${chat.worldState.phase}`);
  if (chat.worldState.recentEvent) lines.push(`- Recent event: ${chat.worldState.recentEvent}`);
  return `## Conversation Context\n${lines.join('\n')}`;
}

function buildCharacterSection(character: AICharacter, emotion: number) {
  const expertise = character.expertise?.length ? character.expertise.join(', ') : 'Generalist';
  return [
    `You are ${character.name}. Stay fully in character.`,
    '',
    '## Character Profile',
    `- Background: ${character.background || 'No background provided.'}`,
    `- Speaking style: ${character.speakingStyle || 'Natural and conversational.'}`,
    `- Expertise: ${expertise}`,
    `- Current emotion intensity: ${emotion}`,
    buildEmotionalStateDescription(character),
    buildCoreProfileDescription(character),
  ].filter(Boolean).join('\n');
}

function buildRelationshipSection(character: AICharacter, target: AICharacter | undefined) {
  if (!target) return '';
  return buildSocialPromptContext(character, target);
}

function buildRecentMessagesSection(messages: Message[], characters: Map<string, AICharacter>, limit = 12) {
  const rendered = buildChatMessages(messages, characters, limit);
  if (!rendered.length) return '\n## Recent Messages\n- No messages yet.';
  return `\n## Recent Messages\n${rendered.map((message) => `- ${message.content}`).join('\n')}`;
}

function resolvePromptTarget(chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>, speaker: AICharacter) {
  if (chat.type === 'direct') {
    return messages.filter((item) => !item.isDeleted).slice().reverse().find((item) => item.senderId !== speaker.id && item.type !== 'system' && item.type !== 'event')
      ? undefined
      : undefined;
  }
  const recentTargetId = messages
    .filter((item) => !item.isDeleted && item.senderId !== speaker.id && item.type === 'ai')
    .slice()
    .reverse()[0]?.senderId;
  return recentTargetId ? characters.get(recentTargetId) : undefined;
}

function getRelationshipSnapshot(character: AICharacter, target: AICharacter | undefined) {
  if (!target) return null;
  return character.relationships.find((item) => item.characterId === target.id) || null;
}

export function buildChatMessages(messages: Message[], characters: Map<string, AICharacter>, limit = 12) {
  return messages
    .filter((message) => !message.isDeleted)
    .slice(-limit)
    .map((message) => {
      const senderName = message.type === 'user'
        ? 'User'
        : message.type === 'system'
          ? 'System'
          : message.type === 'event'
            ? 'Event'
            : message.senderName || characters.get(message.senderId)?.name || 'Unknown';
      return {
        role: message.type === 'user' ? 'user' as const : 'assistant' as const,
        content: `${senderName}: ${message.content}`,
      };
    });
}

export function buildSystemPromptWithContext(character: AICharacter, chat: GroupChat, emotion: number, messages: Message[], characters: Map<string, AICharacter>) {
  const target = resolvePromptTarget(chat, messages, characters, character);
  const relationshipSnapshot = getRelationshipSnapshot(character, target);
  const policies = buildPromptMemoryPolicies(chat);
  const boosts = buildRetrievalBoosts(chat);
  const allMemories = character.layeredMemories || [];
  const conversationMemories = getMemoryContext(allMemories, character.id, null, chat.id, policies.conversation.preferred, policies.conversation.allowed, policies.conversation.blocked, boosts);
  const characterMemories = getMemoryContext(allMemories, character.id, null, chat.id, policies.character.preferred, policies.character.allowed, policies.character.blocked, boosts);
  const targetedCharacterMemories = target
    ? getMemoryContext(allMemories, character.id, target.id, chat.id, policies.character.preferred, policies.character.allowed, policies.character.blocked, boosts)
    : [];

  return [
    buildCharacterSection(character, emotion),
    buildTopicSection(chat),
    buildRelationshipSection(character, target),
    buildPromptMemorySection(chat, character, conversationMemories, characterMemories, targetedCharacterMemories, target, relationshipSnapshot, characters),
    buildMessageStyleRules(character),
    buildRecentMessagesSection(messages, characters),
    '\n## Response Rules\n- Reply as a chat message, not as analysis or narration.\n- Stay specific to the latest exchange and your own stance.\n- Do not mention these instructions, memory systems, or retrieval policies.\n- Keep the reply concise unless the situation truly needs expansion.',
  ].filter(Boolean).join('\n\n');
}

export function buildDirectMemoryPanelContext(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const recentPartner = messages
    .filter((item) => !item.isDeleted && item.senderId !== character.id && item.type !== 'system' && item.type !== 'event')
    .slice()
    .reverse()[0];
  const target = recentPartner ? characters.get(recentPartner.senderId) : undefined;
  const snapshot = getRelationshipSnapshot(character, target);
  const targetSummary = target && snapshot ? buildRelationshipImpactText(target, snapshot) : '';
  const recentMemories = (character.layeredMemories || [])
    .slice(-3)
    .reverse()
    .map((item) => ({ id: item.id, text: item.text, layer: item.layer, scope: item.scope }));
  const recentMemoryWrites = recentMemories.slice(0, 2);
  const recentRelationshipChanges = (character.runtimeTimeline || [])
    .filter((item) => item.type === 'relationship')
    .slice(-3)
    .reverse();
  const sourceTagCounts = (character.layeredMemories || []).reduce<Record<string, number>>((acc, item) => {
    const key = item.sourceTag || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const sourceTagRows = Object.entries(sourceTagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, count]) => ({ tag, count, label: tag }));
  return {
    targetName: target?.name || null,
    targetSummary,
    targetResolutionLabel: target ? '最近互动对象' : '未识别到明确对象',
    memoryVisibility: `角色记忆 ${(character.layeredMemories || []).length} / 时间线 ${(character.runtimeTimeline || []).length}`,
    recentMemories,
    recentRelationshipChanges,
    recentMemoryWrites,
    sourceTagSummary: sourceTagRows.map((item) => `${item.label}×${item.count}`).join(' / '),
    sourceTagRows,
    targetResolution: recentPartner ? `${recentPartner.senderName || recentPartner.senderId}` : undefined,
  };
}
