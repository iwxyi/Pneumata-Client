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
    heat: Math.max(0, Math.min(100, base.heat + delta.heat)),
    cohesion: Math.max(0, Math.min(100, base.cohesion + delta.cohesion)),
    topicDrift: Math.max(0, Math.min(100, base.topicDrift + delta.topicDrift)),
    dominantThread,
    alliances: support && interaction.targetId ? [...base.alliances, [interaction.actorId, interaction.targetId] as [string, string]].slice(-6) : base.alliances,
    conflictPairs: conflict && interaction.targetId ? [...base.conflictPairs, [interaction.actorId, interaction.targetId] as [string, string]].slice(-6) : base.conflictPairs,
    pileOnTarget: interaction.kind === 'pile_on' ? interaction.targetId || null : base.pileOnTarget,
    silencedActors: base.silencedActors,
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
