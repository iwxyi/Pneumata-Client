import type { AICharacter } from '../types/character';
import type { GroupChat, ChatStyle } from '../types/chat';
import type { Message } from '../types/message';
import { buildMessageStyleRules, buildRelationshipPrompt as buildSocialPromptContext } from './socialPromptContext';
import { getMemoryContext } from './layeredMemoryEngine';
import type { MemoryItem } from './memoryTypes';
import { formatConflictPromptText, formatConflictStageLabel } from './runtimeEventFactory';
import { normalizeRelationshipLedgerEntry } from './relationshipLedger';
import { getExperienceLensLabel } from './experienceChangePresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { getGuidanceMemoryTargetActorIds, parseUserGuidanceIntent, type UserGuidanceIntent } from './userGuidanceIntent';
import { buildCompanionshipPromptBlock, buildSharedMemoryAnchors, buildSharedSecrets } from './companionshipProjection';
import { projectConversationForModel, type ConversationProjectionOptions } from './conversationProjection';
import { resolvePersonaActivation, type PersonaActivation } from './personaActivation';
import { buildInfluenceState, type InfluenceState } from './influenceState';
import { userProfileMemoryPayloadOf } from './directUserProfileMemory';
import type { SharedMemoryAnchor, UserProfileMemoryEventItem, UserProfileMemoryKind } from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';

const styleDescriptions: Record<ChatStyle, string> = {
  free: 'This is a free-form discussion. Participants can talk about anything related to the topic. Be natural and conversational.',
  debate: 'This is a formal debate. Take clear positions, provide evidence, and respectfully challenge others\' arguments. Be structured and logical.',
  brainstorm: 'This is a brainstorming session. Generate creative ideas freely. Build on others\' ideas. No idea is too wild. Be enthusiastic and generative.',
  roleplay: 'This is a role-playing scenario. Stay in character at all times. React to the situation as your character would. Be immersive and creative.',
};

const COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG = 'companionship_shared_anchor';
const COMPANIONSHIP_USER_PROFILE_SOURCE_TAG = 'companionship_user_profile';
const USER_ACTOR_ID = 'user';

export interface PromptMemoryTraceItem {
  id: string;
  scope: string;
  kind: string;
  layer: string;
  summary: string;
  recallReason?: string;
  recallTokens?: string[];
  recallScore?: number;
}

export interface PromptMemoryTrace {
  injectedIds: string[];
  recalledArchives: PromptMemoryTraceItem[];
  sharedSecretGuards?: string[];
  targetActorId?: string;
  targetActorName?: string;
  targetReason?: string;
}

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

function compactPromptText(text: string | undefined | null, max = 240) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function buildPromptDisplayMembers(character: AICharacter, characters: Map<string, AICharacter>): DisplayTextMember[] {
  const members = new Map<string, string>();
  members.set(character.id, character.name || 'this character');
  characters.forEach((item) => {
    if (item.id) members.set(item.id, item.name || 'member');
  });
  return Array.from(members.entries()).map(([id, name]) => ({ id, name }));
}

function cleanPromptText(text: string | undefined | null, members: DisplayTextMember[], max = 240) {
  return compactPromptText(sanitizeUserFacingText(text, members), max);
}

function getPromptMemoryKindLabel(kind: MemoryItem['kind']) {
  const labels: Record<MemoryItem['kind'], string> = {
    trait_evidence: 'trait evidence',
    obsession: 'persistent fixation',
    taboo: 'sensitive boundary',
    bond: 'bond',
    resentment: 'resentment',
    bias: 'bias',
    decision: 'decision',
    conflict: 'conflict',
    status_shift: 'state shift',
    artifact: 'artifact',
    thread_effect: 'thread residue',
  };
  return labels[kind] || sanitizeUserFacingText(kind);
}

function getPromptMemoryLayerLabel(layer: MemoryItem['layer']) {
  const labels: Record<MemoryItem['layer'], string> = {
    long_term: 'long-term',
    episodic: 'episode',
    working: 'recent working',
  };
  return labels[layer] || sanitizeUserFacingText(layer);
}

function getPromptMemoryScopeLabel(scope: MemoryItem['scope']) {
  const labels: Record<MemoryItem['scope'], string> = {
    character_self: 'self',
    relationship: 'relationship',
    conversation: 'conversation',
    thread: 'thread',
    system_runtime: 'room state',
  };
  return labels[scope] || sanitizeUserFacingText(scope);
}

function getPromptMemoryLens(item: MemoryItem) {
  return getExperienceLensLabel(item.sourceTag, 'en') || getPromptMemoryKindLabel(item.kind);
}

function buildPromptMemoryLine(item: MemoryItem, members: DisplayTextMember[]) {
  const lens = getPromptMemoryLens(item);
  const scope = getPromptMemoryScopeLabel(item.scope);
  const layer = getPromptMemoryLayerLabel(item.layer);
  const sourceText = item.summary || item.text;
  const text = cleanPromptText(sourceText, members, 260);
  const evidence = item.evidenceText ? cleanPromptText(item.evidenceText, members, 180) : '';
  const tags = [lens, scope, layer].filter(Boolean).join(' · ');
  return evidence ? `- ${tags}: ${text} Evidence: ${evidence}` : `- ${tags}: ${text}`;
}

function buildManualMemorySeedPrompt(character: AICharacter, members: DisplayTextMember[], chat?: GroupChat) {
  const memory = character.memory;
  if (!memory) return '';
  const canExposeUserMemoryText = !chat || chat.type === 'direct';
  const hasUserMemory = Boolean(memory.userMemories?.length);
  const hasUserBoundaryMemory = (memory.userMemories || []).some((text) => /(不要|不想|别|公开|隐私|边界|禁忌|压力|焦虑|面试|考试|生日|纪念|私下)/.test(text));
  const lines = [
    memory.shortTermSummary?.trim() ? `- Current private summary: ${cleanPromptText(memory.shortTermSummary, members)}` : '',
    memory.longTerm?.length ? `- Stable long-term memories: ${memory.longTerm.slice(-6).map((item) => cleanPromptText(item, members, 160)).join(' / ')}` : '',
    memory.secrets?.length ? `- Private secrets you know but should not reveal casually: ${memory.secrets.slice(-6).map((item) => cleanPromptText(item, members, 160)).join(' / ')}` : '',
    memory.obsessions?.length ? `- Obsessions that may leak into your attention and wording: ${memory.obsessions.slice(-6).map((item) => cleanPromptText(item, members, 160)).join(' / ')}` : '',
    memory.tabooTopics?.length ? `- Taboo or sensitive topics that trigger avoidance, defensiveness, or careful wording: ${memory.tabooTopics.slice(-6).map((item) => cleanPromptText(item, members, 160)).join(' / ')}` : '',
    canExposeUserMemoryText && hasUserMemory ? `- Memories about the user: ${memory.userMemories.slice(-6).map((item) => cleanPromptText(item, members, 160)).join(' / ')}` : '',
    !canExposeUserMemoryText && hasUserMemory ? `- Private user continuity exists but this is not a pair-private channel. Let it shape restraint and care; do not expose the underlying user facts.` : '',
    !canExposeUserMemoryText && hasUserBoundaryMemory ? `- User-related boundaries or sensitive cues exist. Avoid public pressure, public reminders, or revealing private details unless the user states them here.` : '',
  ].filter(Boolean);
  if (!lines.length) return '';
  return `\n## Manual Memory Seeds\n${lines.join('\n')}\n- Treat these as authored character continuity. Let them shape tone, attention, omissions, and reactions; do not list them unless the conversation naturally calls for it.`;
}

function buildLayeredMemoryPrompt(items: MemoryItem[], members: DisplayTextMember[], title = 'Relevant Memories') {
  if (!items.length) return '';
  return `\n## ${title}\n${items.map((item) => buildPromptMemoryLine(item, members)).join('\n')}`;
}

function buildRecallCue(messages: Message[], target?: AICharacter | null) {
  const recentText = messages
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-4)
    .map((item) => item.content)
    .join('\n');
  return [target?.name, recentText].filter(Boolean).join('\n').slice(-900);
}

function buildGroupMemoryPolicyTags() {
  return {
    preferred: ['llm_memory_objective_event', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'group_relationship_shift', COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'interaction', 'relationship_delta', 'room_shift', 'private_thread_effect', 'private_thread_summary'],
    blocked: ['direct_user_message', 'direct_ai_follow_up', 'ai_direct_starter_message', 'ai_direct_target_message'],
  };
}

function buildGroupCharacterPolicyTags() {
  return {
    preferred: ['expression_feedback', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'group_relationship_shift', COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'self_expression'],
    allowed: ['expression_feedback', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', 'group_relationship_shift', COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'self_expression', 'core_profile', 'background', 'speaking_style', 'expertise'],
    blocked: ['direct_user_message', 'direct_ai_follow_up'],
  };
}

function buildRetrievalBoosts(chat: GroupChat) {
  if (chat.type === 'direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: false };
  if (chat.type === 'ai_direct') return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
  return { relationshipBoost: true, selfMemoryBoost: true, conversationBoost: true };
}

function sharedAnchorMemoryKind(kind: SharedMemoryAnchor['kind']): MemoryItem['kind'] {
  if (kind === 'conflict') return 'conflict';
  if (kind === 'repair' || kind === 'first_time' || kind === 'confession' || kind === 'inside_joke' || kind === 'promise' || kind === 'milestone') return 'bond';
  if (kind === 'shared_secret') return 'artifact';
  return 'bond';
}

function sharedAnchorToPromptMemory(anchor: SharedMemoryAnchor, character: AICharacter, chat: GroupChat): MemoryItem | null {
  if (!anchor.participantIds.includes(character.id)) return null;
  if (anchor.kind === 'shared_secret') return null;
  const salience = Math.max(0.25, Math.min(1, anchor.salience / 100));
  const confidence = Math.max(0.25, Math.min(1, anchor.confidence / 100));
  const recency = Math.max(0.2, Math.min(1, (anchor.updatedAt || chat.updatedAt || Date.now()) / Math.max(Date.now(), 1)));
  return {
    id: `companionship-anchor-memory-${anchor.id}`,
    ownerId: character.id,
    scope: 'relationship',
    layer: anchor.source === 'runtime_event' ? 'episodic' : 'long_term',
    kind: sharedAnchorMemoryKind(anchor.kind),
    subjectIds: anchor.participantIds.filter((id) => id !== character.id),
    relatedConversationId: chat.id,
    text: anchor.text,
    summary: `${anchor.title}: ${anchor.text}`,
    evidenceText: anchor.evidence,
    salience,
    confidence,
    recency,
    reinforcementCount: Math.max(1, Math.round(anchor.salience / 35)),
    sourceEventIds: anchor.sourceId ? [anchor.sourceId] : [],
    sourceTag: COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG,
    origin: anchor.source === 'runtime_event' ? 'runtime' : 'distilled',
    distilledFromIds: anchor.sourceId ? [anchor.sourceId] : [],
    distilledAt: anchor.source === 'runtime_event' ? null : anchor.updatedAt || null,
    distillationVersion: null,
    createdAt: anchor.createdAt || chat.createdAt || 0,
    updatedAt: anchor.updatedAt || chat.updatedAt || 0,
    archivedAt: null,
  };
}

function buildCompanionshipAnchorPromptMemories(character: AICharacter, chat: GroupChat): MemoryItem[] {
  return buildSharedMemoryAnchors(character, chat.updatedAt || Date.now(), chat)
    .map((anchor) => sharedAnchorToPromptMemory(anchor, character, chat))
    .filter((item): item is MemoryItem => Boolean(item));
}

function userProfileMemoryKind(item: UserProfileMemoryEventItem): MemoryItem['kind'] {
  if (item.kind === 'boundary' || item.kind === 'dislike') return 'taboo';
  if (item.kind === 'emotional_pattern' || item.kind === 'pressure_source') return 'status_shift';
  if (item.kind === 'address_preference' || item.kind === 'display_name') return 'bond';
  return 'trait_evidence';
}

function userProfileKindLabel(kind: UserProfileMemoryKind) {
  const labels: Record<UserProfileMemoryKind, string> = {
    display_name: 'display name',
    address_preference: 'address preference',
    schedule_hint: 'schedule',
    pressure_source: 'pressure source',
    preference: 'preference',
    dislike: 'dislike',
    boundary: 'boundary',
    important_date: 'important date',
    recent_plan: 'recent plan',
    emotional_pattern: 'emotional pattern',
  };
  return labels[kind];
}

function userProfileEventItemKey(item: Pick<UserProfileMemoryEventItem, 'kind' | 'text'>) {
  return `${item.kind}:${compactPromptText(item.text, 140)}`;
}

function userProfileEventItemsMatch(left: Pick<UserProfileMemoryEventItem, 'kind' | 'text'>, right: Pick<UserProfileMemoryEventItem, 'kind' | 'text'>) {
  if (left.kind !== right.kind) return false;
  const leftText = compactPromptText(left.text, 140);
  const rightText = compactPromptText(right.text, 140);
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;
  if (leftText.length >= 6 && rightText.length >= 6) return leftText.includes(rightText) || rightText.includes(leftText);
  return false;
}

function normalizePromptSourceIds(...sources: Array<unknown>) {
  return sources
    .flatMap((source) => Array.isArray(source) ? source : [])
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    .map((id) => id.trim())
    .filter((id, index, list) => list.indexOf(id) === index)
    .slice(0, 8);
}

function collectUserProfilePromptItems(chat: GroupChat, character: AICharacter) {
  const byKey = new Map<string, UserProfileMemoryEventItem & { updatedAt: number; sourceEventIds: string[] }>();
  (chat.runtimeEventsV2 || [])
    .filter((event): event is RuntimeEventV2 => Boolean(event?.payload))
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((event) => {
      const payload = userProfileMemoryPayloadOf(event);
      if (!payload || payload.characterId !== character.id || (payload.userId || USER_ACTOR_ID) !== USER_ACTOR_ID) return;
      const actorMatches = !event.actorIds?.length || event.actorIds.includes(character.id) || event.actorIds.includes(USER_ACTOR_ID);
      const targetMatches = !event.targetIds?.length || event.targetIds.includes(character.id) || event.targetIds.includes(USER_ACTOR_ID);
      if (!actorMatches || !targetMatches) return;
      payload.items.forEach((item) => {
        const text = compactPromptText(item.text, 140);
        if (!text || item.confidence < 0.6) return;
        const resolved = {
          ...item,
          text,
          evidence: compactPromptText(item.evidence || event.summary, 140),
          sourceMessageIds: normalizePromptSourceIds(item.sourceMessageIds, payload.sourceMessageIds, event.evidenceMessageIds),
          updatedAt: event.createdAt || chat.updatedAt || 0,
          sourceEventIds: normalizePromptSourceIds([event.id]),
        };
        if (payload.action === 'revoke') {
          Array.from(byKey.entries()).forEach(([key, active]) => {
            if (userProfileEventItemsMatch(active, resolved)) byKey.delete(key);
          });
          return;
        }
        byKey.set(userProfileEventItemKey(resolved), resolved);
      });
    });
  return Array.from(byKey.values())
    .sort((left, right) => {
      const leftSensitiveBoost = left.sensitive ? 0.08 : 0;
      const rightSensitiveBoost = right.sensitive ? 0.08 : 0;
      return (right.confidence + rightSensitiveBoost) - (left.confidence + leftSensitiveBoost) || right.updatedAt - left.updatedAt;
    })
    .slice(0, 8);
}

function userProfileItemToPromptMemory(item: UserProfileMemoryEventItem & { updatedAt: number; sourceEventIds: string[] }, character: AICharacter, chat: GroupChat): MemoryItem {
  const confidence = Math.max(0.25, Math.min(1, item.confidence > 1 ? item.confidence / 100 : item.confidence));
  const salience = Math.max(0.35, Math.min(1, confidence + (item.sensitive ? 0.18 : 0)));
  return {
    id: `companionship-user-profile-memory-${character.id}-${userProfileEventItemKey(item).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)}`,
    ownerId: character.id,
    scope: 'relationship',
    layer: item.sensitive || item.kind === 'boundary' || item.kind === 'important_date' ? 'long_term' : 'working',
    kind: userProfileMemoryKind(item),
    subjectIds: [USER_ACTOR_ID],
    relatedConversationId: chat.id,
    text: item.text,
    summary: `${userProfileKindLabel(item.kind)}: ${item.text}`,
    evidenceText: item.evidence,
    salience,
    confidence,
    recency: 1,
    reinforcementCount: item.sensitive ? 2 : 1,
    sourceEventIds: item.sourceEventIds,
    sourceTag: COMPANIONSHIP_USER_PROFILE_SOURCE_TAG,
    origin: 'runtime',
    distilledFromIds: item.sourceEventIds,
    distilledAt: null,
    distillationVersion: null,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    archivedAt: null,
  };
}

function buildCompanionshipUserProfilePromptMemories(character: AICharacter, chat: GroupChat): MemoryItem[] {
  if (chat.type !== 'direct') return [];
  return collectUserProfilePromptItems(chat, character).map((item) => userProfileItemToPromptMemory(item, character, chat));
}

function buildPromptMemoryPolicies(chat: GroupChat) {
  if (chat.type === 'direct') {
    return {
      conversation: { preferred: ['direct_user_message', 'direct_ai_follow_up'], allowed: ['direct_user_message', 'direct_ai_follow_up'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
      character: { preferred: ['expression_feedback', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', COMPANIONSHIP_USER_PROFILE_SOURCE_TAG, COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'direct_user_message', 'direct_ai_follow_up', 'self_expression'], allowed: ['expression_feedback', 'direct_user_message', 'direct_ai_follow_up', COMPANIONSHIP_USER_PROFILE_SOURCE_TAG, COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'self_expression', 'core_profile', 'background', 'speaking_style', 'expertise', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal'], blocked: ['ai_direct_starter_message', 'ai_direct_target_message'] },
    };
  }
  if (chat.type === 'ai_direct') {
    return {
      conversation: { preferred: ['ai_direct_starter_message', 'ai_direct_target_message'], allowed: ['ai_direct_starter_message', 'ai_direct_target_message'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
      character: { preferred: ['expression_feedback', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal', COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'ai_direct_starter_message', 'ai_direct_target_message', 'group_relationship_shift'], allowed: ['expression_feedback', 'ai_direct_starter_message', 'ai_direct_target_message', COMPANIONSHIP_SHARED_ANCHOR_SOURCE_TAG, 'group_relationship_shift', 'core_profile', 'background', 'speaking_style', 'expertise', 'llm_memory_character_perspective', 'llm_memory_relationship_imprint', 'llm_memory_emotion_effect', 'llm_memory_growth_signal'], blocked: ['direct_user_message', 'direct_ai_follow_up'] },
    };
  }
  const group = { conversation: buildGroupMemoryPolicyTags(), character: buildGroupCharacterPolicyTags() };
  return {
    conversation: { preferred: group.conversation.preferred, allowed: undefined, blocked: group.conversation.blocked },
    character: { preferred: group.character.preferred, allowed: group.character.allowed, blocked: group.character.blocked },
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

function buildScopedMemoryBreakdown(conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[], members: DisplayTextMember[]) {
  return `${buildLayeredMemoryPrompt(targetedCharacterMemories, members, 'Targeted Relationship Memories')}${buildLayeredMemoryPrompt(characterMemories, members, 'Character-State Memories')}${buildLayeredMemoryPrompt(conversationMemories, members, 'Conversation Memories')}`;
}

function buildPromptMemoryBundle(chat: GroupChat, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[], members: DisplayTextMember[]) {
  return `${buildLayeredMemoryPrompt(buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]), members, buildPromptMemoryTitle(chat))}${buildScopedMemoryBreakdown(conversationMemories, characterMemories, targetedCharacterMemories, members)}`;
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
  const members = target ? buildPromptDisplayMembers(target, characters) : Array.from(characters.values()).map((item) => ({ id: item.id, name: item.name }));
  const lines: string[] = [];
  if (target && room.pileOnTarget === target.id) lines.push(`${target.name} is currently attracting pile-on pressure in the room.`);
  if (target && room.dominantThread?.includes(target.id)) {
    const threadNames = room.dominantThread.map((id) => characters.get(id)?.name || cleanPromptText(id, members, 80) || 'member').join(' ↔ ');
    lines.push(`${target.name} is part of the room's dominant thread (${threadNames}).`);
  }
  if (target && room.alliances.some((pair) => pair.includes(target.id))) lines.push(`An alliance touching ${target.name} is currently visible in the room.`);
  if (target && room.conflictPairs.some((pair) => pair.includes(target.id))) lines.push(`A visible conflict line around ${target.name} is shaping the room tone.`);
  return lines.length ? `\n## Group Pressure\n${lines.map((line) => `- ${line}`).join('\n')}` : '';
}

function buildRelationshipSemanticPrompt(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  const members = buildPromptDisplayMembers(character, characters);
  const relevant = (chat.relationshipLedger || [])
    .map(normalizeRelationshipLedgerEntry)
    .filter((entry) => entry.actorId === character.id && (!target || entry.targetId === target.id))
    .filter((entry) => entry.derived?.semantic?.summary)
    .sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0))
    .slice(0, target ? 1 : 3);
  if (!relevant.length) return '';
  return `\n## Relationship Semantics\n${relevant.map((entry) => {
    const targetName = characters.get(entry.targetId)?.name || cleanPromptText(entry.targetId, members, 80) || 'member';
    return `- Toward ${targetName}: ${cleanPromptText(entry.derived?.semantic?.summary, members, 220)}`;
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
  const members = buildPromptDisplayMembers(target, characters);
  const parts: string[] = [];
  if (room.pileOnTarget === target.id) parts.push('被多人围压');
  if (room.dominantThread?.includes(target.id)) parts.push(`主线 ${room.dominantThread.map((id) => characters.get(id)?.name || cleanPromptText(id, members, 80) || '成员').join('↔')}`);
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

function buildSharedSecretPromptBlock(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  const secrets = buildSharedSecrets(character, chat.updatedAt || Date.now(), chat)
    .filter((secret) => secret.participantIds.includes(character.id))
    .slice(0, 4);
  if (!secrets.length) return '';

  const members = buildPromptDisplayMembers(character, characters);
  if (chat.type === 'ai_direct' && target) {
    const privateSecrets = secrets
      .filter((secret) => secret.participantIds.includes(target.id))
      .slice(0, 2);
    if (!privateSecrets.length) return '';
    return `\n## Pair-Private Shared Secrets\n${privateSecrets.map((secret) => `- With ${target.name}: ${cleanPromptText(secret.privateText, members, 180)}${secret.leakState !== 'sealed' ? ` (state: ${secret.leakState})` : ''}`).join('\n')}\n- This is a pair-private thread: you may use these as subtext or recall them directly if it feels natural, but do not turn them into exposition.`;
  }

  if (chat.type !== 'group') return '';
  const visibleMemberIds = new Set(chat.memberIds || []);
  const publicMasks = secrets
    .filter((secret) => secret.participantIds.some((id) => visibleMemberIds.has(id)))
    .map((secret) => {
      const participantNames = secret.participantIds
        .filter((id) => id !== character.id)
        .map((id) => characters.get(id)?.name || cleanPromptText(id, members, 60))
        .filter(Boolean)
        .join('、');
      const leak = secret.leakState === 'sealed'
        ? 'sealed'
        : secret.leakState === 'hinted_publicly'
          ? 'already hinted'
          : 'already exposed';
      return `- ${participantNames ? `Around ${participantNames}: ` : ''}${cleanPromptText(secret.publicMask, members, 120)} (${leak}).`;
    })
    .slice(0, 3);
  if (!publicMasks.length) return '';
  return `\n## Public Shared-Secret Guard\n${publicMasks.join('\n')}\n- This is a public group room. Do not reveal privateText, exact evidence, or hidden details. Let the secret shape hesitation, glances, omissions, coded replies, topic changes, or protective deflection instead.`;
}

function buildSharedSecretTraceLines(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, characters: Map<string, AICharacter>) {
  const secrets = buildSharedSecrets(character, chat.updatedAt || Date.now(), chat)
    .filter((secret) => secret.participantIds.includes(character.id))
    .slice(0, 4);
  if (!secrets.length) return [];
  const members = buildPromptDisplayMembers(character, characters);
  if (chat.type === 'ai_direct' && target) {
    return secrets
      .filter((secret) => secret.participantIds.includes(target.id))
      .slice(0, 2)
      .map((secret) => `AI私聊可召回：${target.name} · ${cleanPromptText(secret.publicMask, members, 120)} · ${secret.leakState}`);
  }
  if (chat.type !== 'group') return [];
  const visibleMemberIds = new Set(chat.memberIds || []);
  return secrets
    .filter((secret) => secret.participantIds.some((id) => visibleMemberIds.has(id)))
    .slice(0, 3)
    .map((secret) => `群聊避嫌：${cleanPromptText(secret.publicMask, members, 120)} · ${secret.leakState}`);
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
  const state = chat.worldState.conflictState;
  const primary = state?.primaryConflict;
  if (!primary) return '';
  const members = buildPromptDisplayMembers(character, characters);
  const participantNames = (primary.participantIds || []).map((id) => characters.get(id)?.name || cleanPromptText(id, members, 80) || '成员').join('、');
  const targetNames = (primary.targetIds || []).map((id) => characters.get(id)?.name || cleanPromptText(id, members, 80) || '成员').join('、');
  const involved = (primary.participantIds || []).includes(character.id) || (primary.targetIds || []).includes(character.id);
  const formatted = cleanPromptText(formatConflictPromptText(primary.type, primary.nextPressure, primary.developmentHooks), members, 260);
  const summary = cleanPromptText(primary.summary, members, 220);
  return `\n## Active Conflict\n- Stage: ${formatConflictStageLabel(primary.stage)}\n- Severity: ${primary.severity.toFixed(2)}\n- Summary: ${summary}${participantNames ? `\n- Participants: ${participantNames}` : ''}${targetNames ? `\n- Targets: ${targetNames}` : ''}${formatted ? `\n${formatted}` : ''}${involved ? '\n- You are directly implicated in this contradiction; react from your position inside it, not as a neutral commentator.' : '\n- Even if you are not central, the room tension should subtly shape what you choose to notice, support, dodge, or escalate.'}`;
}

function buildPromptInfluenceContext(chat: GroupChat, character: AICharacter, target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, mergedMemories: MemoryItem[], characters: Map<string, AICharacter>) {
  return `${buildInfluenceModePrompt(chat, target)}${buildRelationshipInfluencePrompt(target, relationshipSnapshot)}${buildRelationshipSemanticPrompt(chat, character, target, characters)}${buildMemoryInfluencePrompt(mergedMemories)}${buildGroupPressurePrompt(chat, target, characters)}${buildConflictPromptBundle(chat, character, characters)}`;
}

function buildChatInfluenceSummary(chat: GroupChat) {
  if (chat.type === 'direct') return '\n## Channel Bias\n- This is a private user-facing channel: intimacy, continuity, and personal stance matter more than room theatrics.\n- The latest User line is what you are answering. Do not output it as your own line unless the user explicitly asked you to repeat or quote it.';
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

function buildPromptMemorySection(chat: GroupChat, character: AICharacter, conversationMemories: MemoryItem[], characterMemories: MemoryItem[], targetedCharacterMemories: MemoryItem[], target: AICharacter | undefined, relationshipSnapshot: AICharacter['relationships'][number] | null, characters: Map<string, AICharacter>, influenceState: import('./influenceState').InfluenceState) {
  const merged = buildMergedMemories([...targetedCharacterMemories, ...characterMemories, ...conversationMemories]);
  const members = buildPromptDisplayMembers(character, characters);
  const cleanInfluence = (item: string) => cleanPromptText(item, members, 80);
  const influenceSummary = `\n## Influence State\n${influenceState.topicBias.map((item: string) => `- Topic bias: ${cleanInfluence(item)}`).join('\n')}${influenceState.relationshipBias.map((item: string) => `\n- Relationship bias: ${cleanInfluence(item)}`).join('')}${influenceState.careBias.map((item: string) => `\n- Care bias: ${cleanInfluence(item)}`).join('')}${influenceState.avoidanceBias.map((item: string) => `\n- Avoidance bias: ${cleanInfluence(item)}`).join('')}${influenceState.noveltyBias !== 'neutral' ? `\n- Novelty bias: ${influenceState.noveltyBias}` : ''}`;
  return `${buildManualMemorySeedPrompt(character, members, chat)}${buildPromptMemoryBundle(chat, conversationMemories, characterMemories, targetedCharacterMemories, members)}${influenceSummary}${buildPromptInfluenceContext(chat, character, target, relationshipSnapshot, merged, characters)}${buildPromptTargetingContext(chat, target, relationshipSnapshot, characters)}${buildTargetedInfluenceContext(chat, target, relationshipSnapshot, characters)}${buildSharedSecretPromptBlock(chat, character, target, characters)}${buildPromptReasoningSummary(chat)}${buildMemoryPriorityPrompt(chat)}`;
}

function traceMemoryItem(item: MemoryItem, members: DisplayTextMember[]): PromptMemoryTraceItem {
  return {
    id: item.id,
    scope: item.scope,
    kind: item.kind,
    layer: item.layer,
    summary: cleanPromptText(item.summary || item.text, members, 160),
    recallReason: item.recallReason ? cleanPromptText(item.recallReason, members, 160) : undefined,
    recallTokens: item.recallTokens?.map((token) => cleanPromptText(token, members, 48)).filter(Boolean).slice(0, 6),
    recallScore: typeof item.recallScore === 'number' ? Number(item.recallScore.toFixed(3)) : undefined,
  };
}

function buildTraceFromPromptMemories(items: MemoryItem[], members: DisplayTextMember[], sharedSecretGuards: string[], target?: { actorId: string; actorName: string; reason: string }): PromptMemoryTrace {
  const merged = buildMergedMemories(items);
  return {
    injectedIds: merged.map((item) => item.id),
    recalledArchives: merged
      .filter((item) => item.archivedAt && item.recallReason)
      .map((item) => traceMemoryItem(item, members))
      .slice(0, 4),
    sharedSecretGuards: sharedSecretGuards.slice(0, 4),
    targetActorId: target?.actorId,
    targetActorName: target?.actorName ? cleanPromptText(target.actorName, members, 80) : undefined,
    targetReason: target?.reason ? cleanPromptText(target.reason, members, 120) : undefined,
  };
}

function resolvePromptMemoryContext(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>) {
  const targetResolution = resolvePromptTarget(chat, messages, characters, character);
  const target = targetResolution?.target;
  const relationshipSnapshot = getRelationshipSnapshot(character, target);
  const policies = buildPromptMemoryPolicies(chat);
  const boosts = buildRetrievalBoosts(chat);
  const allMemories = buildMergedMemories([
    ...(character.layeredMemories || []),
    ...buildCompanionshipAnchorPromptMemories(character, chat),
    ...buildCompanionshipUserProfilePromptMemories(character, chat),
  ]);
  const members = buildPromptDisplayMembers(character, characters);
  const recallCue = buildRecallCue(messages, target);
  const conversationMemories = getMemoryContext(allMemories, character.id, null, chat.id, policies.conversation.preferred, policies.conversation.allowed, policies.conversation.blocked, boosts, recallCue);
  const characterMemories = getMemoryContext(allMemories, character.id, null, chat.id, policies.character.preferred, policies.character.allowed, policies.character.blocked, boosts, recallCue);
  const targetedCharacterMemories = target
    ? getMemoryContext(allMemories, character.id, target.id, chat.id, policies.character.preferred, policies.character.allowed, policies.character.blocked, boosts, recallCue)
    : [];
  const influenceState: InfluenceState = buildInfluenceState({
    conversationMemories,
    characterMemories,
    targetedCharacterMemories,
  });
  return {
    target,
    relationshipSnapshot,
    conversationMemories,
    characterMemories,
    targetedCharacterMemories,
    influenceState,
    trace: buildTraceFromPromptMemories(
      [...targetedCharacterMemories, ...characterMemories, ...conversationMemories],
      members,
      buildSharedSecretTraceLines(chat, character, target, characters),
      target ? {
        actorId: target.id,
        actorName: target.name,
        reason: targetResolution.reason,
      } : undefined,
    ),
  };
}

export function buildPromptMemoryTrace(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>): PromptMemoryTrace {
  return resolvePromptMemoryContext(character, chat, messages, characters).trace;
}

export function buildCrossModeMemoryPrompt(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>) {
  const memoryContext = resolvePromptMemoryContext(character, chat, messages, characters);
  const merged = buildMergedMemories([
    ...memoryContext.targetedCharacterMemories,
    ...memoryContext.characterMemories,
    ...memoryContext.conversationMemories,
  ]);
  const members = buildPromptDisplayMembers(character, characters);
  return `${buildManualMemorySeedPrompt(character, members, chat)}${buildPromptMemoryBundle(chat, memoryContext.conversationMemories, memoryContext.characterMemories, memoryContext.targetedCharacterMemories, members)}${buildPromptInfluenceContext(chat, character, memoryContext.target, memoryContext.relationshipSnapshot, merged, characters)}${buildPromptTargetingContext(chat, memoryContext.target, memoryContext.relationshipSnapshot, characters)}${buildTargetedInfluenceContext(chat, memoryContext.target, memoryContext.relationshipSnapshot, characters)}${buildSharedSecretPromptBlock(chat, character, memoryContext.target, characters)}${buildCompanionshipPromptBlock({ chat, character, messages })}${buildMemoryPriorityPrompt(chat)}`;
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

function buildCharacterSection(character: AICharacter, emotion: number, personaActivation: PersonaActivation) {
  const expertise = character.expertise?.length ? character.expertise.join(', ') : 'Generalist';
  return [
    `You are ${character.name}. Stay in character through situated judgment, relationships, memory, limits, and voice.`,
    '',
    '## Character Background Reference',
    `- Background: ${character.background || 'No background provided.'}`,
    `- Speaking style: ${character.speakingStyle || 'Natural and conversational.'}`,
    `- Expertise: ${expertise}`,
    `- Current emotion intensity: ${emotion}`,
    '- Use this profile as private context. Do not make every reply prove the profile, profession, or label.',
    '- Explicitly mention background, job, expertise, or identity only when the current turn makes it relevant.',
    buildEmotionalStateDescription(character),
    buildCoreProfileDescription(character),
    personaActivation.prompt,
  ].filter(Boolean).join('\n');
}

function buildRelationshipSection(character: AICharacter, target: AICharacter | undefined) {
  if (!target) return '';
  return buildSocialPromptContext(character, target);
}

function getPromptMessageSpeakerName(message: Message, characters: Map<string, AICharacter>) {
  if (message.type === 'user' || message.type === 'god') return 'User';
  if (message.type === 'system') return 'System';
  if (message.type === 'event') return 'Event';
  return message.senderName || characters.get(message.senderId)?.name || 'Unknown';
}

function getPromptMessageTypeLabel(message: Message) {
  if (message.type === 'user' || message.type === 'god') return 'human';
  if (message.type === 'ai') return 'AI';
  return message.type;
}

function buildRecentMessagesSection(messages: Message[], characters: Map<string, AICharacter>, limit = 12) {
  const visible = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-limit);
  if (!visible.length) return '\n## Conversation Window\n- No messages yet.';
  const latest = visible.at(-1);
  const latestAi = visible.slice().reverse().find((message) => message.type === 'ai');
  const humanCount = visible.filter((message) => message.type === 'user' || message.type === 'god').length;
  const aiCount = visible.filter((message) => message.type === 'ai').length;
  const activeSpeakers = Array.from(new Set(visible.map((message) => getPromptMessageSpeakerName(message, characters)))).slice(-6);
  return `\n## Conversation Window\n- The complete recent transcript is provided separately as chat messages. Only your own prior visible turns are assistant messages; other speakers are user-side transcript context. This system section intentionally does not repeat raw dialogue.\n- Recent visible turns: ${visible.length} (${humanCount} human / ${aiCount} AI).\n- Latest visible turn: ${latest ? `${getPromptMessageTypeLabel(latest)} from ${getPromptMessageSpeakerName(latest, characters)}` : 'none'}.\n- Latest AI speaker in window: ${latestAi ? getPromptMessageSpeakerName(latestAi, characters) : 'none'}.\n- Active speakers in window: ${activeSpeakers.join(', ') || 'none'}.\n- Treat the transcript messages as factual context and relationship evidence, not style samples. Do not copy their emoji/sticker markers, opening fillers, endings, cadence, or full sentence shape unless you are explicitly quoting someone on purpose.`;
}

function normalizeStoredGuidance(message: Message): UserGuidanceIntent | null {
  const stored = message.metadata?.runtimeDecision?.directorIntent?.userGuidance;
  if (!stored?.rawText || !stored.kind) return null;
  return {
    kind: stored.kind === 'media_request' || stored.kind === 'direct_reply' ? stored.kind : 'topic_shift',
    rawText: stored.rawText,
    actorIds: stored.actorIds || [],
    mentionedActorIds: stored.mentionedActorIds || [],
    mediaRequest: stored.mediaRequest?.kind === 'image' ? {
      kind: 'image',
      subjectActorIds: stored.mediaRequest.subjectActorIds || [],
      subjectText: stored.mediaRequest.subjectText || '',
      actionText: stored.mediaRequest.actionText || stored.rawText,
    } : undefined,
    focusText: stored.focusText || stored.rawText,
    beatType: stored.beatType as UserGuidanceIntent['beatType'] || 'invite',
    pressure: stored.pressure || 0,
    maxTurns: stored.maxTurns || 1,
    reason: stored.reason || '用户明确引导当前互动。',
  };
}

function parsePromptGuidance(message: Message, characters: Map<string, AICharacter>) {
  const members = Array.from(characters.values());
  return parseUserGuidanceIntent(message.content, members) || normalizeStoredGuidance(message);
}

function pickGuidanceTarget(guidance: UserGuidanceIntent, speaker: AICharacter, characters: Map<string, AICharacter>) {
  const candidateId = getGuidanceMemoryTargetActorIds(guidance, Array.from(characters.values()), speaker.id)[0];
  return candidateId ? characters.get(candidateId) : undefined;
}

function describeGuidanceMemoryTarget(guidance: UserGuidanceIntent) {
  if (guidance.kind === 'media_request') return '来自人工发图请求的图片对象';
  if (guidance.kind === 'direct_reply') return '来自人工点名中的被谈论对象';
  return '来自人工话题引导中提到的角色';
}

function resolveHumanGuidanceTarget(messages: Message[], characters: Map<string, AICharacter>, speaker: AICharacter) {
  const latestHumanMessage = messages
    .filter((item) => !item.isDeleted && (item.type === 'user' || item.type === 'god'))
    .at(-1);
  if (!latestHumanMessage) return undefined;
  const guidance = parsePromptGuidance(latestHumanMessage, characters);
  if (!guidance) return undefined;
  const target = pickGuidanceTarget(guidance, speaker, characters);
  if (target) return { target, reason: describeGuidanceMemoryTarget(guidance) };
  return undefined;
}

function resolvePromptTarget(chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>, speaker: AICharacter) {
  const guidanceTarget = resolveHumanGuidanceTarget(messages, characters, speaker);
  if (guidanceTarget) return guidanceTarget;
  if (chat.type === 'direct') {
    return messages.filter((item) => !item.isDeleted).slice().reverse().find((item) => item.senderId !== speaker.id && item.type !== 'system' && item.type !== 'event')
      ? undefined
      : undefined;
  }
  const latestAi = messages
    .filter((item) => !item.isDeleted && item.senderId !== speaker.id && item.type === 'ai')
    .slice()
    .reverse()[0];
  if (!latestAi) return undefined;
  if (chat.type !== 'group') {
    const recentTarget = characters.get(latestAi.senderId);
    return recentTarget ? { target: recentTarget, reason: '来自最近 AI 发言者' } : undefined;
  }
  const addressedMessage = latestAi as Message & { addressedTargetIds?: string[] | null; primaryAddressedTargetId?: string | null };
  const addressedTargetIds = [
    addressedMessage.primaryAddressedTargetId,
    ...(addressedMessage.addressedTargetIds || []),
  ].filter(Boolean);
  const explicitlyAddressed = addressedTargetIds.includes(speaker.id) || latestAi.content.includes(speaker.name);
  const recentTarget = explicitlyAddressed ? characters.get(latestAi.senderId) : undefined;
  return recentTarget ? { target: recentTarget, reason: addressedTargetIds.includes(speaker.id) ? '来自上一条消息的明确指向' : '来自上一条消息点名' } : undefined;
}

function getRelationshipSnapshot(character: AICharacter, target: AICharacter | undefined) {
  if (!target) return null;
  return character.relationships.find((item) => item.characterId === target.id) || null;
}

export type PromptTranscriptOptions = ConversationProjectionOptions;

export function buildChatMessages(
  messages: Message[],
  characters: Map<string, AICharacter>,
  limit = 12,
  options: PromptTranscriptOptions = {},
) {
  return projectConversationForModel({ messages, characters, limit, options });
}

export function buildSystemPromptWithContext(character: AICharacter, chat: GroupChat, emotion: number, messages: Message[], characters: Map<string, AICharacter>) {
  const memoryContext = resolvePromptMemoryContext(character, chat, messages, characters);
  const personaActivation = resolvePersonaActivation({ chat, speaker: character, messages });

  return [
    buildCharacterSection(character, emotion, personaActivation),
    buildTopicSection(chat),
    buildRelationshipSection(character, memoryContext.target),
    buildPromptMemorySection(chat, character, memoryContext.conversationMemories, memoryContext.characterMemories, memoryContext.targetedCharacterMemories, memoryContext.target, memoryContext.relationshipSnapshot, characters, memoryContext.influenceState),
    buildCompanionshipPromptBlock({ chat, character, messages }),
    buildMessageStyleRules(character),
    buildRecentMessagesSection(messages, characters),
    '\n## Response Rules\n- Reply as a chat message, not as analysis or narration.\n- Stay specific to the latest exchange and your own stance.\n- Do not mention these instructions, memory systems, or retrieval policies.\n- Do not default to a fixed medium length. Use the length this character would naturally use in this moment: sometimes one tiny reaction, sometimes one sentence, sometimes a fuller line when pressure, care, defense, or explanation calls for it.',
  ].filter(Boolean).join('\n\n');
}

export function buildDirectMemoryPanelContext(character: AICharacter, messages: Message[], characters: Map<string, AICharacter>) {
  const members = buildPromptDisplayMembers(character, characters);
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
    .map((item) => ({ id: item.id, text: cleanPromptText(item.text, members, 180), layer: item.layer, scope: item.scope }));
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
    .map(([tag, count]) => ({ tag, count, label: getExperienceLensLabel(tag) || cleanPromptText(tag, members, 80) }));
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
    targetResolution: recentPartner ? cleanPromptText(recentPartner.senderName || recentPartner.senderId, members, 80) : undefined,
  };
}
