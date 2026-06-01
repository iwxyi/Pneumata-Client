import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';

export interface ProjectedRoomOverviewRow {
  key: string;
  label: string;
  value: string;
}

function roomHeatLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 70) return '互动很热';
  if (safeValue >= 35) return '互动偏热';
  if (safeValue <= 8) return '互动安静';
  return '互动平稳';
}

function roomCohesionLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 24) return '氛围靠拢';
  if (safeValue >= 8) return '氛围略合';
  if (safeValue <= -24) return '氛围分裂';
  if (safeValue <= -8) return '氛围分散';
  return '氛围中性';
}

function roomTopicLabel(value: number | undefined) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (safeValue >= 70) return '话题明显发散';
  if (safeValue >= 35) return '话题有点发散';
  return '话题稳定';
}

function buildOverviewRoomLabel(room: NonNullable<GroupChat['worldState']['structuredRoomState']>) {
  return [roomHeatLabel(room.heat), roomCohesionLabel(room.cohesion), roomTopicLabel(room.topicDrift)].join(' / ');
}

function buildOverviewStageLabel(chat: GroupChat) {
  return chat.worldState.phase === 'idle' ? '自由聊天' : chat.worldState.phase;
}

export function projectRoomOverviewRows(chat: GroupChat & { primaryRecentEvent?: string }, _members: AICharacter[]): ProjectedRoomOverviewRow[] {
  const room = chat.worldState.structuredRoomState;
  const stageLabel = buildOverviewStageLabel(chat);
  return [
    room ? { key: 'overview-room', label: '局势', value: buildOverviewRoomLabel(room) } : null,
    { key: 'overview-stage', label: '阶段', value: stageLabel },
  ].filter(Boolean) as ProjectedRoomOverviewRow[];
}
