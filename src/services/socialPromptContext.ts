import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getRelationshipBetween, getRelationshipWeight } from './relationshipEngine';
import { retrieveRelevantMemories } from './memoryRetrieval';

export function findRecentTarget(messages: Message[], characters: Map<string, AICharacter>, selfId: string) {
  const recentAiMessages = messages.filter((msg) => !msg.isDeleted && msg.type === 'ai' && msg.senderId !== selfId);
  const targetId = recentAiMessages.at(-1)?.senderId;
  return targetId ? characters.get(targetId) : undefined;
}

export function buildRelationshipPrompt(character: AICharacter, targetCharacter?: AICharacter) {
  if (!targetCharacter) return '';
  const relation = getRelationshipBetween(character, targetCharacter.id);
  const weight = getRelationshipWeight(character, targetCharacter.id);
  if (!relation) {
    return `\n## Social Tension\n- You are reacting to ${targetCharacter.name} without an established bond yet. Stay attentive to status and tone.`;
  }

  const cues: string[] = [];
  if (relation.affinity >= 65) cues.push('you feel personal warmth and are more likely to echo or protect them');
  if (relation.respect >= 65) cues.push('you take their ideas seriously even when disagreeing');
  if (relation.hostility >= 55) cues.push('you are primed to challenge or needle them');
  if (relation.contempt >= 55) cues.push('you tend to be dismissive, ironic, or impatient with them');
  if (Math.abs(weight) < 0.15) cues.push('your stance toward them is still mixed and unstable');

  return `\n## Social Tension\n- Current target: ${targetCharacter.name}\n- Relationship note: ${relation.note || 'no explicit note'}\n- Dynamic bias: ${weight > 0.3 ? 'lean supportive' : weight < -0.3 ? 'lean adversarial' : 'lean uncertain'}\n${cues.map((cue) => `- ${cue}`).join('\n')}`;
}

export function buildConflictAxesPrompt(chat: GroupChat) {
  const axes = chat.worldState.conflictAxes || [];
  if (!axes.length) return '';
  return `\n## Conflict Axes\n${axes.map((axis) => `- ${axis.title}: ${axis.poles[0]} ↔ ${axis.poles[1]}${typeof axis.currentTilt === 'number' ? ` (tilt ${axis.currentTilt > 0 ? '+' : ''}${axis.currentTilt})` : ''}`).join('\n')}`;
}

export function buildGroupDynamicsPrompt(chat: GroupChat) {
  const dynamics: string[] = [];
  if (chat.dramaRules.allowCliques) dynamics.push('sub-groups and alliances are allowed to form');
  if (chat.dramaRules.allowMockery) dynamics.push('public teasing and sharp replies are acceptable');
  if (chat.dramaRules.allowContempt) dynamics.push('open disdain can surface when tensions rise');
  if (chat.worldState.mood) dynamics.push(`group mood: ${chat.worldState.mood}`);
  if (chat.worldState.focus) dynamics.push(`current focus: ${chat.worldState.focus}`);
  if (chat.worldState.recentEvent) dynamics.push(`recent event: ${chat.worldState.recentEvent}`);
  return `${dynamics.length ? `\n## Group Dynamics\n${dynamics.map((item) => `- ${item}`).join('\n')}` : ''}${buildConflictAxesPrompt(chat)}`;
}

function buildCharacterLayeredMemoryPrompt(character: AICharacter, messages: Message[]) {
  const targetId = messages.filter((msg) => !msg.isDeleted && msg.type === 'ai' && msg.senderId !== character.id).at(-1)?.senderId;
  const memories = retrieveRelevantMemories(character.layeredMemories || [], {
    speakerId: character.id,
    targetId,
    conversationId: `character:${character.id}`,
    maxItems: 4,
  });
  if (!memories.length) return '';
  return `\n## Character Memory\n${memories.map((item) => `- [${item.scope}/${item.kind}/${item.layer}] ${item.text}`).join('\n')}`;
}

export function buildMemoryPressurePrompt(character: AICharacter, messages: Message[]) {
  const lines = [
    character.memory.obsessions?.length ? `- Obsessions likely to leak into the conversation: ${character.memory.obsessions.join(', ')}` : '',
    character.memory.tabooTopics?.length ? `- Topics that trigger avoidance or defensiveness: ${character.memory.tabooTopics.join(', ')}` : '',
    character.memory.longTerm?.length ? `- Long-term memories shaping your reactions: ${character.memory.longTerm.slice(-3).join(' / ')}` : '',
  ].filter(Boolean);
  const legacyPrompt = lines.length ? `\n## Personal Pressure\n${lines.join('\n')}` : '';
  return `${buildCharacterLayeredMemoryPrompt(character, messages)}${legacyPrompt}`;
}

export function buildConflictPrompt(character: AICharacter) {
  const profile = character.coreProfile;
  if (!profile) return '';
  const lines = [
    profile.coreDesire ? `- What you want from this interaction: ${profile.coreDesire}` : '',
    profile.coreFear ? `- What you are trying to avoid: ${profile.coreFear}` : '',
    profile.biases?.length ? `- Biases that may color your response: ${profile.biases.join(', ')}` : '',
  ].filter(Boolean);
  return lines.length ? `\n## Hidden Conflict\n${lines.join('\n')}` : '';
}

export function buildMessageStyleRules(character: AICharacter) {
  const rules: string[] = [];
  if (character.behavior.aggressiveness >= 70) rules.push('Be more willing to press, interrupt rhetorically, or push a point.');
  if (character.behavior.empathyLevel >= 70) rules.push('Notice emotional cues and respond with some sensitivity.');
  if (character.behavior.humorIntensity >= 70) rules.push('Let wit or playful phrasing show up naturally.');
  if (character.behavior.summarizing >= 70) rules.push('You may impose structure or summarize the room when useful.');
  return rules.length ? `\n## Expression Bias\n${rules.map((rule) => `- ${rule}`).join('\n')}` : '';
}

export function buildSocialPromptContext(character: AICharacter, chat: GroupChat, messages: Message[], characters: Map<string, AICharacter>) {
  const recentTarget = findRecentTarget(messages, characters, character.id);
  return `${buildRelationshipPrompt(character, recentTarget)}${buildGroupDynamicsPrompt(chat)}${buildMemoryPressurePrompt(character, messages)}${buildConflictPrompt(character)}`;
}
