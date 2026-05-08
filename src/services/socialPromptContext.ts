import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getRelationshipBetween, getRelationshipWeight } from './relationshipEngine';
import { retrieveRelevantMemories } from './memoryRetrieval';

export function findRecentTarget(messages: Message[], characters: Map<string, AICharacter>, selfId: string) {
  const recent = messages.filter((msg) => !msg.isDeleted).slice(-4);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const msg = recent[index];
    if (msg.senderId === selfId) continue;
    const named = Array.from(characters.values()).find((character) => character.id !== selfId && msg.content.includes(character.name));
    if (named) return named;
    if (msg.type === 'ai' && msg.senderId !== selfId) {
      return characters.get(msg.senderId);
    }
  }
  return undefined;
}

export function buildRelationshipPrompt(character: AICharacter, targetCharacter?: AICharacter) {
  if (!targetCharacter) return '';
  const relation = getRelationshipBetween(character, targetCharacter.id);
  const weight = getRelationshipWeight(character, targetCharacter.id);
  if (!relation) {
    return `\n## Social Appraisal\n- You are reacting to ${targetCharacter.name} without a stable interpersonal model yet. Pay attention to reliability, competence, and threat cues.`;
  }

  const cues: string[] = [];
  if (relation.warmth >= 12) cues.push('you feel interpersonal warmth and are more likely to soften, echo, or defend them');
  if (relation.competence >= 12) cues.push('you treat their judgment as credible and may give their claims more weight');
  if (relation.trust >= 12) cues.push('you expect follow-through and are more willing to coordinate or disclose');
  if (relation.threat >= 12) cues.push('you perceive interpersonal threat and are more likely to guard, challenge, deflect, or escalate');
  if (Math.abs(weight) < 0.08) cues.push('your appraisal is mixed and still unstable');

  const baggage: string[] = [];
  if (relation.threat >= 10) baggage.push('you may still carry vigilance, defensiveness, or unresolved conflict from earlier exchanges');
  if (relation.warmth >= 12 || relation.competence >= 12 || relation.trust >= 12) baggage.push('you may feel some loyalty, deference, or willingness to extend the benefit of the doubt');
  if (relation.note?.trim()) baggage.push(`recent interpersonal baggage: ${relation.note}`);

  return `\n## Social Appraisal\n- Current target: ${targetCharacter.name}\n- Dynamic stance: ${weight > 0.3 ? 'supportive / affiliative' : weight < -0.3 ? 'guarded / adversarial' : 'mixed / uncertain'}\n${cues.map((cue) => `- ${cue}`).join('\n')}\n${baggage.map((item) => `- ${item}`).join('\n')}`;
}

export function buildConflictAxesPrompt(chat: GroupChat) {
  const axes = chat.worldState.conflictAxes || [];
  if (!axes.length) return '';
  return `\n## Conflict Axes\n${axes.map((axis) => `- ${axis.title}: ${axis.poles[0]} ↔ ${axis.poles[1]}${typeof axis.currentTilt === 'number' ? ` (tilt ${axis.currentTilt > 0 ? '+' : ''}${axis.currentTilt})` : ''}`).join('\n')}`;
}

export function buildGroupDynamicsPrompt(chat: GroupChat, dramaBoost = false) {
  const dynamics: string[] = [];
  if (chat.dramaRules.allowCliques) dynamics.push('sub-groups and alliances are allowed to form');
  if (chat.dramaRules.allowMockery || dramaBoost) dynamics.push('public teasing and sharp replies are acceptable');
  if (chat.dramaRules.allowContempt || dramaBoost) dynamics.push('open disdain can surface when tensions rise');
  if (dramaBoost) dynamics.push('people should more readily interrupt, needle, misread, push, and escalate local tension instead of politely taking turns');
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
    profile.socialMask ? `- How you want to come across in front of others: ${profile.socialMask}` : '',
  ].filter(Boolean);
  return lines.length ? `\n## Hidden Conflict\n${lines.join('\n')}` : '';
}

export function buildMessageStyleRules(character: AICharacter) {
  const runtimeBehavior = {
    ...character.behavior,
    aggressiveness: Math.max(0, Math.min(100, character.behavior.aggressiveness + Math.round((character.personalityDrift?.neuroticism || 0) * 0.5))),
    empathyLevel: Math.max(0, Math.min(100, character.behavior.empathyLevel + Math.round((character.personalityDrift?.empathy || 0) * 0.8))),
    summarizing: Math.max(0, Math.min(100, character.behavior.summarizing + Math.round((character.personalityDrift?.openness || 0) * 0.3))),
    humorIntensity: character.behavior.humorIntensity,
    proactivity: character.behavior.proactivity,
    offTopic: character.behavior.offTopic,
  };
  const rules: string[] = [
    'Sound like a person in a live chat, not an AI giving a neat answer.',
    'Prefer unfinished, partial, or emotionally colored replies over polished completeness.',
    'Usually write one sentence; only use two when adding a turn or clarifying a misunderstanding.',
    'It is fine to be vague, biased, impatient, playful, repetitive in a human way, or slightly messy.',
    'Do not tidy your tone into a mini speech; react like you are mid-conversation.',
    'You can misread emphasis slightly, latch onto one phrase, or answer only the part you care about.',
  ];
  if (runtimeBehavior.aggressiveness >= 70) rules.push('Be more willing to press, interrupt rhetorically, or push a point.');
  if (runtimeBehavior.empathyLevel >= 70) rules.push('Notice emotional cues and respond with some sensitivity.');
  if (runtimeBehavior.humorIntensity >= 70) rules.push('Let wit or playful phrasing show up naturally.');
  if (runtimeBehavior.summarizing >= 70) rules.push('Only summarize when the room is obviously drifting or confused.');
  if (runtimeBehavior.offTopic >= 60) rules.push('Allow a light tangent, stray association, or side comment when it feels organic.');
  return `\n## Expression Bias\n${rules.map((rule) => `- ${rule}`).join('\n')}`;
}
