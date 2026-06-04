import type { ActorRef } from '../types/runtimeEvent';
import type { AICharacter } from '../types/character';

export type ActorRefKind = ActorRef['kind'];
export type SystemAgentSubtype = Extract<ActorRef, { kind: 'system_agent' }>['subtype'];
export type ActorRuntimeCapability = 'speak' | 'guide' | 'moderate' | 'judge' | 'narrate' | 'orchestrate';
export interface ActorRefClassifyOptions {
  aiIds?: Set<string>;
  knownIds?: Set<string>;
  actorKinds?: Map<string, ActorRefKind>;
}

export function inferSystemAgentSubtypeFromId(id: string): SystemAgentSubtype {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/(^|[_:-])(gm|game|game_master|judge|referee)($|[_:-])/.test(normalized)) return 'game_master';
  if (/(^|[_:-])(host|mc|主持)($|[_:-])/.test(normalized)) return 'host';
  if (/(^|[_:-])(guide|guidance|topic|facilitator|引导)($|[_:-])/.test(normalized)) return 'topic_guide';
  if (/(^|[_:-])(narrator|旁白)($|[_:-])/.test(normalized)) return 'narrator';
  if (/(^|[_:-])(director|god|上帝|导演)($|[_:-])/.test(normalized)) return 'director';
  if (/(^|[_:-])(moderator|mod|管理)($|[_:-])/.test(normalized)) return 'moderator';
  if (/(^|[_:-])(system|orchestrator|scheduler|runtime)($|[_:-])/.test(normalized)) return 'orchestrator';
  return undefined;
}

export function classifyActorRefKind(id: string | undefined | null, options: ActorRefClassifyOptions = {}): ActorRefKind {
  if (id === 'user') return 'user_persona';
  if (!id) return 'system_agent';
  const mappedKind = options.actorKinds?.get(id);
  if (mappedKind) return mappedKind;
  if (options.aiIds?.has(id)) return 'ai_character';
  if (options.knownIds?.has(id)) return 'ai_character';
  return 'system_agent';
}

export function isCharacterActorId(id: string | undefined | null, options: ActorRefClassifyOptions = {}) {
  return classifyActorRefKind(id, options) === 'ai_character';
}

export function isReservedNonCharacterActorId(id: string | undefined | null) {
  if (!id) return true;
  if (id === 'user' || id === 'system') return true;
  return Boolean(inferSystemAgentSubtypeFromId(id));
}

export function toActorRef(id: string | undefined | null, options: ActorRefClassifyOptions = {}): ActorRef | undefined {
  if (!id) return undefined;
  const kind = classifyActorRefKind(id, options);
  if (kind === 'system_agent') {
    const subtype = inferSystemAgentSubtypeFromId(id);
    return subtype ? { kind, id, subtype } : { kind, id };
  }
  return { kind, id };
}

export function buildAiIdSet(characters: AICharacter[]) {
  return new Set(characters.map((character) => character.id));
}

export function formatActorRefKindLabel(kind: ActorRefKind) {
  if (kind === 'user_persona') return '用户';
  if (kind === 'system_agent') return '系统';
  return '角色';
}

export function formatSystemAgentSubtypeLabel(subtype: SystemAgentSubtype) {
  if (subtype === 'topic_guide') return '话题引导';
  if (subtype === 'host') return '主持人';
  if (subtype === 'game_master') return '裁判/GM';
  if (subtype === 'narrator') return '旁白';
  if (subtype === 'director') return '导演/上帝';
  if (subtype === 'moderator') return '管理者';
  if (subtype === 'orchestrator') return '系统编排';
  return '系统';
}

export function classifyActorKindLabel(id: string | undefined | null, options: ActorRefClassifyOptions = {}) {
  return formatActorRefKindLabel(classifyActorRefKind(id, options));
}

export function resolveActorRuntimeCapabilities(ref: ActorRef | undefined | null): ActorRuntimeCapability[] {
  if (!ref) return [];
  if (ref.kind === 'ai_character' || ref.kind === 'user_persona') return ['speak'];
  if (ref.subtype === 'topic_guide') return ['guide'];
  if (ref.subtype === 'host' || ref.subtype === 'moderator') return ['moderate'];
  if (ref.subtype === 'game_master') return ['judge', 'moderate'];
  if (ref.subtype === 'narrator') return ['narrate'];
  if (ref.subtype === 'director') return ['guide', 'moderate'];
  return ['orchestrate'];
}
