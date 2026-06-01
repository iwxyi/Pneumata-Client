import { describe, expect, it } from 'vitest';
import { buildAiIdSet, classifyActorKindLabel, classifyActorRefKind, formatActorRefKindLabel, formatSystemAgentSubtypeLabel, resolveActorRuntimeCapabilities, toActorRef } from './actorRefPresentation';

describe('actorRefPresentation', () => {
  it('classifies user, ai and system ids', () => {
    const aiIds = new Set(['mei']);
    expect(classifyActorRefKind('user', { aiIds })).toBe('user_persona');
    expect(classifyActorRefKind('mei', { aiIds })).toBe('ai_character');
    expect(classifyActorRefKind('host', { aiIds })).toBe('system_agent');
  });

  it('maps ids into actor refs and preserves id', () => {
    const aiIds = new Set(['mei']);
    expect(toActorRef('user', { aiIds })).toEqual({ kind: 'user_persona', id: 'user' });
    expect(toActorRef('mei', { aiIds })).toEqual({ kind: 'ai_character', id: 'mei' });
    expect(toActorRef('host', { aiIds })).toEqual({ kind: 'system_agent', id: 'host', subtype: 'host' });
    expect(toActorRef('god-director', { aiIds })).toEqual({ kind: 'system_agent', id: 'god-director', subtype: 'director' });
    expect(toActorRef('', { aiIds })).toBeUndefined();
  });

  it('prefers explicit actor kind mapping when available', () => {
    const actorKinds = new Map([
      ['host_moderator', 'system_agent' as const],
      ['mei', 'ai_character' as const],
    ]);
    expect(classifyActorRefKind('host_moderator', { actorKinds })).toBe('system_agent');
    expect(toActorRef('host_moderator', { actorKinds })).toEqual({ kind: 'system_agent', id: 'host_moderator', subtype: 'host' });
    expect(classifyActorKindLabel('host_moderator', { actorKinds })).toBe('系统');
  });

  it('builds ai id set from characters and formats labels', () => {
    const aiIds = buildAiIdSet([
      { id: 'mei', name: '美羊羊' } as never,
      { id: 'hui', name: '灰太狼' } as never,
    ]);
    expect(aiIds.has('mei')).toBe(true);
    expect(aiIds.has('hui')).toBe(true);
    expect(formatActorRefKindLabel('ai_character')).toBe('角色');
    expect(formatActorRefKindLabel('user_persona')).toBe('用户');
    expect(formatActorRefKindLabel('system_agent')).toBe('系统');
    expect(formatSystemAgentSubtypeLabel('host')).toBe('主持人');
    expect(formatSystemAgentSubtypeLabel('director')).toBe('导演/上帝');
    expect(classifyActorKindLabel('mei', { aiIds })).toBe('角色');
    expect(classifyActorKindLabel('user', { aiIds })).toBe('用户');
    expect(classifyActorKindLabel('host', { aiIds })).toBe('系统');
  });

  it('resolves runtime capabilities by actor ref kind/subtype', () => {
    expect(resolveActorRuntimeCapabilities({ kind: 'ai_character', id: 'mei' })).toEqual(['speak']);
    expect(resolveActorRuntimeCapabilities({ kind: 'user_persona', id: 'user' })).toEqual(['speak']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'topic-guide', subtype: 'topic_guide' })).toEqual(['guide']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'room-host', subtype: 'host' })).toEqual(['moderate']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'gm', subtype: 'game_master' })).toEqual(['judge', 'moderate']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'narrator', subtype: 'narrator' })).toEqual(['narrate']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'director', subtype: 'director' })).toEqual(['guide', 'moderate']);
    expect(resolveActorRuntimeCapabilities({ kind: 'system_agent', id: 'runtime' })).toEqual(['orchestrate']);
  });
});
