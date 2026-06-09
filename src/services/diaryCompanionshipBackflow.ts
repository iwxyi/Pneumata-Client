import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipDiaryReflectionEventPayload } from '../types/companionship';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { CharacterArtifactEntry } from '../stores/useCharacterArtifactStore';
import type { CharacterDailyDiaryContext } from './characterExperienceArtifacts';

const USER_ACTOR_ID = 'user';
const MAX_REFLECTION_EVENTS = 3;

function compactText(text: string | undefined | null, max = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function classifyDiaryCompanionshipSeed(seed: string): CompanionshipDiaryReflectionEventPayload['reflectionType'] | null {
  if (/(未完成约定|约定|承诺|答应|说好|下次一起|以后一起|等你)/.test(seed)) return 'promise';
  if (/(共同秘密|小秘密|保密|只有.*知道|不能告诉)/.test(seed)) return 'shared_secret';
  if (/(共同梗|仪式|暗号|只有.*懂|玩笑)/.test(seed)) return 'ritual';
  if (/(待关心|关心|牵挂|放心不下|想问|后来怎么样|压力|面试|考试|生病|不舒服|低落|焦虑)/.test(seed)) return 'care';
  if (/(第一次|心意确认|冲突|修复|和好|里程碑|纪念日)/.test(seed)) return 'shared_anchor';
  return null;
}

function inferParticipants(seed: string, character: Partial<AICharacter>, relatedCharacters: Array<{ id: string; name: string }>) {
  const ids = [character.id || ''];
  if (/(用户|对方|你|ta|TA)/.test(seed)) ids.push(USER_ACTOR_ID);
  relatedCharacters.forEach((item) => {
    if (item.id && item.name && seed.includes(item.name)) ids.push(item.id);
  });
  if (ids.length === 1) ids.push(USER_ACTOR_ID);
  return Array.from(new Set(ids.filter(Boolean))).slice(0, 6);
}

function cleanSeedForReflection(seed: string) {
  return compactText(seed
    .replace(/^(公开动态|私密日记|日记|关系余波|共同梗\/约定|未完成约定|待关心事项|小秘密|共同秘密)\s*[:：]/, '')
    .replace(/^(可以|只能|不要|把|写成|在日记里成为|公开动态可以)/, '')
    .trim(), 180);
}

export function buildDiaryCompanionshipReflectionEvents(params: {
  entry: CharacterArtifactEntry;
  context: CharacterDailyDiaryContext;
  character: Partial<AICharacter>;
  relatedCharacters: Array<{ id: string; name: string }>;
  conversationId: string;
  createdAt?: number;
}): RuntimeEventV2[] {
  if (params.entry.kind !== 'diary' || !params.character.id) return [];
  const createdAt = params.createdAt || params.entry.updatedAt || Date.now();
  const seen = new Set<string>();
  const seeds = (params.context.companionshipSeeds || [])
    .map((seed) => ({ seed, reflectionType: classifyDiaryCompanionshipSeed(seed) }))
    .filter((item): item is { seed: string; reflectionType: CompanionshipDiaryReflectionEventPayload['reflectionType'] } => Boolean(item.reflectionType))
    .filter((item) => {
      const key = `${item.reflectionType}:${compactText(item.seed, 80).replace(/\s+/g, '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REFLECTION_EVENTS);

  return seeds.map((item, index): RuntimeEventV2 => {
    const text = cleanSeedForReflection(item.seed) || compactText(item.seed, 180);
    const participantIds = inferParticipants(item.seed, params.character, params.relatedCharacters);
    const reflectionId = `diary-${params.entry.id}-${index}`;
    const payload: CompanionshipDiaryReflectionEventPayload = {
      eventType: 'companionship_diary_reflection',
      characterId: params.character.id!,
      userId: participantIds.includes(USER_ACTOR_ID) ? USER_ACTOR_ID : undefined,
      reflectionId,
      diaryEntryId: params.entry.id,
      dateKey: params.entry.dateKey || null,
      reflectionType: item.reflectionType,
      participantIds,
      text,
      sourceSeed: compactText(item.seed, 220),
      diaryExcerpt: compactText(params.entry.text, 180),
      confidence: 0.66,
      decisionSource: 'local_fallback',
    };
    return {
      id: `evt-${reflectionId}`,
      conversationId: params.conversationId,
      kind: 'artifact',
      summary: `${params.entry.characterName} 的日记留下了一条陪伴余波`,
      actorIds: [params.character.id!],
      targetIds: participantIds.filter((id) => id !== params.character.id),
      payload: payload as unknown as Record<string, unknown>,
      visibility: participantIds.includes(USER_ACTOR_ID) ? 'pair_private' : 'role_private',
      visibleToIds: participantIds,
      createdAt: createdAt + index,
    };
  });
}

export function pickChatsForDiaryCompanionshipBackflow(chats: GroupChat[], characterId: string, events: RuntimeEventV2[]) {
  if (!characterId || !events.length) return [];
  const targetIds = new Set(events.flatMap((event) => [...(event.actorIds || []), ...(event.targetIds || [])]));
  return chats
    .filter((chat) => chat.deletedAt == null && chat.memberIds.includes(characterId))
    .map((chat) => {
      const memberHits = chat.memberIds.filter((id) => targetIds.has(id)).length;
      const directBonus = chat.type === 'direct' ? 100 : chat.type === 'ai_direct' ? 60 : 0;
      return { chat, score: directBonus + memberHits * 10 + (chat.updatedAt || 0) / 1_000_000_000_000 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.chat);
}
