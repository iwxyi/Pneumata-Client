import type { InteractionEventPayload, RoomShiftPayload, RoomStateSnapshotV2 } from '../types/runtimeEvent';

function createBaseRoomState(): RoomStateSnapshotV2 {
  return {
    heat: 0,
    cohesion: 0,
    topicDrift: 0,
    dominantThread: null,
    alliances: [],
    conflictPairs: [],
    pileOnTarget: null,
    silencedActors: [],
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampSigned(value: number) {
  return Math.max(-100, Math.min(100, value));
}

function normalizeCohesion(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return safeValue > 50 ? safeValue - 50 : safeValue;
}

function coolHeat(value: number) {
  if (value <= 0) return 0;
  return Math.max(0, value - Math.max(2, Math.round(value * 0.08)));
}

function relaxCohesion(value: number) {
  if (value === 0) return 0;
  const direction = value > 0 ? -1 : 1;
  return clampSigned(value + direction * Math.max(1, Math.round(Math.abs(value) * 0.06)));
}

function relaxTopicDrift(value: number) {
  if (value <= 0) return 0;
  return Math.max(0, value - Math.max(1, Math.round(value * 0.12)));
}

function pushUniquePair(list: Array<[string, string]>, pair: [string, string]) {
  const key = pair.join('->');
  const next = [...list.filter((item) => item.join('->') !== key), pair];
  return next.slice(-6);
}

export function calculateRoomShift(current: RoomStateSnapshotV2 | null, interaction: InteractionEventPayload): { nextState: RoomStateSnapshotV2; shift: RoomShiftPayload } {
  const base = current ? { ...current, cohesion: normalizeCohesion(current.cohesion) } : createBaseRoomState();
  const conflict = interaction.kind === 'challenge' || interaction.kind === 'mock' || interaction.kind === 'dismiss' || interaction.kind === 'pile_on';
  const support = interaction.kind === 'support' || interaction.kind === 'defend';
  const cooledBase = {
    ...base,
    heat: coolHeat(base.heat),
    cohesion: relaxCohesion(base.cohesion),
    topicDrift: relaxTopicDrift(base.topicDrift),
  };
  const delta = {
    heat: conflict ? interaction.intensity * 4 : support ? 1 : 2,
    cohesion: support ? 3 : conflict ? -4 : 0,
    topicDrift: interaction.kind === 'side_comment' ? 10 : interaction.kind === 'support' || interaction.kind === 'defend' || interaction.kind === 'challenge' ? -2 : 0,
  };
  const dominantThread = interaction.targetId ? [interaction.actorId, interaction.targetId] as [string, string] : base.dominantThread;
  const nextState: RoomStateSnapshotV2 = {
    ...base,
    heat: clamp(cooledBase.heat + delta.heat),
    cohesion: clampSigned(cooledBase.cohesion + delta.cohesion),
    topicDrift: clamp(cooledBase.topicDrift + delta.topicDrift),
    dominantThread,
    alliances: support && interaction.targetId ? pushUniquePair(base.alliances, [interaction.actorId, interaction.targetId] as [string, string]) : base.alliances,
    conflictPairs: conflict && interaction.targetId ? pushUniquePair(base.conflictPairs, [interaction.actorId, interaction.targetId] as [string, string]) : base.conflictPairs,
    pileOnTarget: interaction.kind === 'pile_on' ? interaction.targetId || null : (conflict && interaction.targetId === base.pileOnTarget ? interaction.targetId : base.pileOnTarget),
    silencedActors: interaction.targetId && conflict ? Array.from(new Set([...base.silencedActors, interaction.targetId])).slice(-6) : base.silencedActors.filter((actorId) => actorId !== interaction.actorId).slice(-6),
  };

  return {
    nextState,
    shift: {
      heat: nextState.heat,
      cohesion: nextState.cohesion,
      topicDrift: nextState.topicDrift,
      dominantThread: nextState.dominantThread,
      pileOnTarget: nextState.pileOnTarget,
      delta,
    },
  };
}

export function synthesizeRoomState(current: RoomStateSnapshotV2 | null, interaction: InteractionEventPayload): RoomStateSnapshotV2 {
  return calculateRoomShift(current, interaction).nextState;
}

export function createInitialRoomState() {
  return createBaseRoomState();
}

void createInitialRoomState;
