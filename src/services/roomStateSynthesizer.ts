import type { InteractionEventPayload, RoomShiftPayload, RoomStateSnapshotV2 } from '../types/runtimeEvent';

function createBaseRoomState(): RoomStateSnapshotV2 {
  return {
    heat: 0,
    cohesion: 50,
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

function pushUniquePair(list: Array<[string, string]>, pair: [string, string]) {
  const key = pair.join('->');
  const next = [...list.filter((item) => item.join('->') !== key), pair];
  return next.slice(-6);
}

export function calculateRoomShift(current: RoomStateSnapshotV2 | null, interaction: InteractionEventPayload): { nextState: RoomStateSnapshotV2; shift: RoomShiftPayload } {
  const base = current || createBaseRoomState();
  const conflict = interaction.kind === 'challenge' || interaction.kind === 'mock' || interaction.kind === 'dismiss' || interaction.kind === 'pile_on';
  const support = interaction.kind === 'support' || interaction.kind === 'defend';
  const delta = {
    heat: conflict ? interaction.intensity * 4 : support ? 1 : 2,
    cohesion: support ? 3 : conflict ? -4 : 0,
    topicDrift: interaction.kind === 'side_comment' ? 3 : 0,
  };
  const dominantThread = interaction.targetId ? [interaction.actorId, interaction.targetId] as [string, string] : base.dominantThread;
  const nextState: RoomStateSnapshotV2 = {
    ...base,
    heat: clamp(base.heat + delta.heat),
    cohesion: clamp(base.cohesion + delta.cohesion),
    topicDrift: clamp(base.topicDrift + delta.topicDrift),
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
