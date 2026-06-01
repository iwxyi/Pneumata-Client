import { describe, expect, it, vi } from 'vitest';
import type { AICharacter } from '../types/character';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY, DEFAULT_PERSONALITY } from '../types/character';
import { buildDefaultRelationshipPatches } from './defaultRelationshipInitializer';

vi.mock('./aiClient', () => ({
  generateResponse: vi.fn(async () => JSON.stringify({
    relationships: [
      { fromName: '新角色', toName: '旧角色', warmth: 42, competence: 8, trust: 24, threat: 3, note: '新角色天然愿意靠近旧角色，但还保留一点试探。', confidence: 0.88, reason: '背景互补' },
      { fromName: '旧角色', toName: '新角色', warmth: 18, competence: 30, trust: 10, threat: 0, note: '旧角色认可新角色的能力，但还不算熟。', confidence: 0.8, reason: '能力线索明确' },
      { fromName: '旧角色', toName: '旁观者', warmth: 70, competence: 70, trust: 70, threat: 0, note: '不应写入完全无关的已有角色关系。', confidence: 0.9, reason: '无关' },
    ],
  })),
}));

function character(id: string, name: string, relationships: AICharacter['relationships'] = []): AICharacter {
  return {
    id,
    name,
    avatar: '🤖',
    personality: DEFAULT_PERSONALITY,
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    expertise: [],
    speakingStyle: `${name} 的说话方式。`,
    background: `${name} 的背景。`,
    relationships,
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('defaultRelationshipInitializer', () => {
  it('builds directional patches involving newly created characters only', async () => {
    const created = character('new', '新角色');
    const old = character('old', '旧角色');
    const bystander = character('side', '旁观者');
    const patches = await buildDefaultRelationshipPatches({
      config: { id: 'p', name: 'Text', type: 'text', provider: 'openai', apiKey: 'k', baseUrl: '', model: 'm' },
      createdCharacters: [created],
      allCharacters: [created, old, bystander],
      language: 'zh',
    });

    expect(patches).toHaveLength(2);
    expect(patches.find((patch) => patch.id === 'new')?.updates.relationships?.[0]).toMatchObject({ characterId: 'old', warmth: 42, trust: 24 });
    expect(patches.find((patch) => patch.id === 'old')?.updates.relationships?.[0]).toMatchObject({ characterId: 'new', competence: 30 });
    expect(patches.some((patch) => patch.id === 'side')).toBe(false);
  });

  it('does not overwrite existing authored relationships', async () => {
    const created = character('new', '新角色');
    const old = character('old', '旧角色', [{ characterId: 'new', warmth: -20, competence: 0, trust: -10, threat: 15, note: '用户手写关系', updatedAt: 2 }]);
    const patches = await buildDefaultRelationshipPatches({
      config: { id: 'p', name: 'Text', type: 'text', provider: 'openai', apiKey: 'k', baseUrl: '', model: 'm' },
      createdCharacters: [created],
      allCharacters: [created, old],
      language: 'zh',
    });

    expect(patches.find((patch) => patch.id === 'old')).toBeUndefined();
    expect(patches.find((patch) => patch.id === 'new')).toBeTruthy();
  });

  it('keeps now=0 as timeline and relationship timestamp', async () => {
    const created = character('new', '新角色');
    const old = character('old', '旧角色');
    const patches = await buildDefaultRelationshipPatches({
      config: { id: 'p', name: 'Text', type: 'text', provider: 'openai', apiKey: 'k', baseUrl: '', model: 'm' },
      createdCharacters: [created],
      allCharacters: [created, old],
      language: 'zh',
      now: 0,
    });
    const newPatch = patches.find((patch) => patch.id === 'new');
    expect(newPatch?.updates.relationships?.[0]?.updatedAt).toBe(0);
    expect(newPatch?.updates.runtimeTimeline?.at(-1)?.createdAt).toBe(0);
  });
});
