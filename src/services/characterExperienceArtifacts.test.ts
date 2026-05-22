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
});
