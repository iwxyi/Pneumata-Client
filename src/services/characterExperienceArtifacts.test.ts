import { describe, expect, it, vi } from 'vitest';
import { buildCharacterBirthLetterContext, buildCharacterDailyDiaryContext, buildCharacterExperienceArtifactContext, buildCharacterFinalLetterContext, buildLocalCharacterExperienceArtifact, generateCharacterDailyDiaryArtifact, generateCharacterExperienceArtifact } from './characterExperienceArtifacts';
import type { AICharacter } from '../types/character';

vi.mock('./aiClient', () => ({
  generateResponse: vi.fn(async () => '今天我把那件事记在了心里。'),
}));

function buildCharacter(): Partial<AICharacter> {
  return {
    id: 'c1',
    name: '苏苏',
    background: '时尚穿搭博主。',
    speakingStyle: '活泼亲切。',
    emotionalState: { affection: 62, irritation: 12, insecurity: 20, excitement: 70, embarrassment: 5 },
    relationships: [{
      characterId: 'c2',
      warmth: 34,
      competence: 6,
      trust: 22,
      threat: 4,
      note: '对小雨的审美越来越认可。',
      updatedAt: 200,
    }],
    layeredMemories: [{
      id: 'm1',
      scope: 'character_self',
      layer: 'long_term',
      kind: 'trait_evidence',
      ownerId: 'c1',
      text: '苏苏开始意识到自己不只是分享穿搭，也在影响粉丝的自信。',
      salience: 0.9,
      confidence: 0.88,
      recency: 0.8,
      reinforcementCount: 2,
      sourceEventIds: ['e1'],
      sourceTag: 'llm_memory_growth_signal',
      createdAt: 100,
      updatedAt: 100,
    }],
  };
}

const leakyActorId = '3c78729f-e52d-4dde-b27f-01a9-49960bb8b123';
const leakyTargetId = '8b3d7266-c0c7-4ceb-8dc2-4512-6f3f2321abcd';

function buildLeakyCharacter(): Partial<AICharacter> {
  return {
    id: leakyActorId,
    name: '喜羊羊',
    background: `${leakyActorId} 曾经因为 status_shift 变得更谨慎。`,
    speakingStyle: `会提到 ${leakyTargetId}，但不该暴露内部编号。`,
    coreProfile: {
      coreDesire: `想让 ${leakyTargetId} 重新相信自己`,
      coreFear: '害怕 trait_evidence 被误读成真正的自己',
    },
    soulState: {
      mood: { pleasure: 0, arousal: 20, dominance: 0 },
      energy: 50,
      attention: 40,
      loneliness: 60,
      repression: 58,
      shame: 20,
      envy: 10,
      trustInRoom: 30,
      ignoredStreak: 2,
      lastImpulseReason: `${leakyActorId} 想追问 ${leakyTargetId} 的态度`,
    },
    relationships: [{
      characterId: leakyTargetId,
      warmth: 8,
      competence: 2,
      trust: -10,
      threat: 36,
      note: `${leakyActorId} 对 ${leakyTargetId} 的信任在 relationship_delta 后变低。`,
      updatedAt: 120,
    }],
    layeredMemories: [{
      id: 'leaky-memory',
      scope: 'character_self',
      layer: 'long_term',
      kind: 'status_shift',
      ownerId: leakyActorId,
      text: `${leakyActorId} 在 status_shift 后开始回避 ${leakyTargetId}`,
      evidenceText: `source events: ${leakyActorId} challenge ${leakyTargetId}`,
      salience: 0.75,
      confidence: 0.8,
      recency: 0.7,
      reinforcementCount: 2,
      sourceEventIds: ['evt-raw'],
      sourceTag: 'unknown_internal_source',
      createdAt: 100,
      updatedAt: 100,
    }],
  };
}

describe('characterExperienceArtifacts', () => {
  it('builds a reusable context from existing memory and relationship state', () => {
    const context = buildCharacterExperienceArtifactContext(buildCharacter(), [{ id: 'c2', name: '小雨' } as AICharacter]);
    expect(context.profile.name).toBe('苏苏');
    expect(context.memories[0].lens).toBe('成长信号');
    expect(context.relationships[0].targetName).toBe('小雨');
    expect(context.emotions).toContain('好感 62');
  });

  it('creates local previews without calling a model', () => {
    const context = buildCharacterExperienceArtifactContext(buildCharacter(), [{ id: 'c2', name: '小雨' } as AICharacter]);
    expect(buildLocalCharacterExperienceArtifact('diary', context)).toContain('苏苏的日记');
    expect(buildLocalCharacterExperienceArtifact('final_letter', context)).toContain('最后一次被看见');
  });

  it('builds final letter context from existing memory, relationships, and future handoff', () => {
    const context = buildCharacterFinalLetterContext(buildCharacter(), [{ id: 'c2', name: '小雨' } as AICharacter]);
    expect(context.farewellAnchors.join(' / ')).toContain('最想被记住的一件事');
    expect(context.unresolvedTies.join(' / ')).toContain('小雨');
    expect(context.futureHandoff).toContain('后来');
    expect(buildLocalCharacterExperienceArtifact('final_letter', context)).toContain('我不想只说再见');
  });

  it('builds birth letter context and preview from identity anchors', () => {
    const context = buildCharacterBirthLetterContext(buildCharacter(), [{ id: 'c2', name: '小雨' } as AICharacter]);
    expect(context.creationSignals.length).toBeGreaterThan(0);
    expect(buildLocalCharacterExperienceArtifact('birth_letter', context)).toContain('第一次醒来');
  });

  it('generates artifacts through the text model adapter', async () => {
    const text = await generateCharacterExperienceArtifact({
      config: { provider: 'openai', apiKey: 'k', baseUrl: 'https://example.test', model: 'm' },
      kind: 'diary',
      character: buildCharacter(),
      relatedCharacters: [{ id: 'c2', name: '小雨' } as AICharacter],
      language: 'zh',
    });
    expect(text).toBe('今天我把那件事记在了心里。');
  });

  it('generates birth letters through the text model adapter', async () => {
    const text = await generateCharacterExperienceArtifact({
      config: { provider: 'openai', apiKey: 'k', baseUrl: 'https://example.test', model: 'm' },
      kind: 'birth_letter',
      character: buildCharacter(),
      relatedCharacters: [{ id: 'c2', name: '小雨' } as AICharacter],
      language: 'zh',
    });
    expect(text).toBe('今天我把那件事记在了心里。');
  });

  it('builds date-scoped diary context and generates diary without fixed token caps', async () => {
    const context = buildCharacterDailyDiaryContext(buildCharacter(), [{ id: 'c2', name: '小雨' } as AICharacter], '1970-01-01', ['气死我了，今天又被人误会。']);
    expect(context.dateKey).toBe('1970-01-01');
    expect(context.highlights.length).toBeGreaterThan(0);
    expect(context.narrativeAngle.length).toBeGreaterThan(0);
    expect(context.emotionalAnchors.length).toBeGreaterThan(0);
    expect(context.privateLenses.length).toBeGreaterThan(0);
    expect(context.formHint.length).toBeGreaterThan(0);
    expect(context.recentDiaryOpenings[0]).toContain('气死我了');

    const text = await generateCharacterDailyDiaryArtifact({
      config: { provider: 'openai', apiKey: 'k', baseUrl: 'https://example.test', model: 'm' },
      character: buildCharacter(),
      relatedCharacters: [{ id: 'c2', name: '小雨' } as AICharacter],
      dateKey: '1970-01-01',
      recentDiaryTexts: ['气死我了，今天又被人误会。'],
      language: 'zh',
    });
    expect(text).toBe('今天我把那件事记在了心里。');
  });

  it('sanitizes artifact context before it is sent to narrative generators', () => {
    const context = buildCharacterExperienceArtifactContext(buildLeakyCharacter(), [{ id: leakyTargetId, name: '灰太狼' } as AICharacter]);
    const serialized = JSON.stringify(context);

    expect(context.memories[0].lens).toBe('状态变化');
    expect(context.memories[0].text).toContain('喜羊羊');
    expect(context.memories[0].text).toContain('灰太狼');
    expect(context.relationships[0].targetName).toBe('灰太狼');
    expect(context.relationships[0].note).toContain('喜羊羊');
    expect(context.relationships[0].note).toContain('灰太狼');
    expect(context.innerResidues.join(' / ')).toContain('喜羊羊');
    expect(context.identityAnchors.join(' / ')).toContain('灰太狼');

    expect(serialized).not.toContain(leakyActorId);
    expect(serialized).not.toContain(leakyTargetId);
    expect(serialized).not.toContain('status_shift');
    expect(serialized).not.toContain('trait_evidence');
    expect(serialized).not.toContain('relationship_delta');
    expect(serialized).not.toContain('source events');
    expect(serialized).not.toContain('unknown_internal_source');
  });

  it('sanitizes daily diary context and local previews without raw ids or enum labels', () => {
    const context = buildCharacterDailyDiaryContext(
      buildLeakyCharacter(),
      [{ id: leakyTargetId, name: '灰太狼' } as AICharacter],
      '1970-01-01',
      [`${leakyActorId} 今天又因为 episodic / status_shift 想起 ${leakyTargetId}。`],
    );
    const preview = buildLocalCharacterExperienceArtifact('diary', context);
    const serialized = JSON.stringify(context);

    expect(context.memories[0].lens).toBe('状态变化');
    expect(context.recentDiaryOpenings[0]).toContain('喜羊羊');
    expect(context.recentDiaryOpenings[0]).toContain('灰太狼');
    expect(preview).toContain('喜羊羊');
    expect(preview).toContain('灰太狼');

    expect(serialized + preview).not.toContain(leakyActorId);
    expect(serialized + preview).not.toContain(leakyTargetId);
    expect(serialized + preview).not.toContain('status_shift');
    expect(serialized + preview).not.toContain('episodic');
  });
});
