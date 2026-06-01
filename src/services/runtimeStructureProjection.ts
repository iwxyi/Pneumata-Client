import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { formatScenarioBoardKind, formatScenarioRoleLabel } from './scenarioPresentation';

export interface RuntimeStructureRow {
  key: string;
  label: string;
  value: string;
}

function projectScenarioRows(chat: GroupChat, members: AICharacter[], language: string): RuntimeStructureRow[] {
  const scenario = chat.scenarioState;
  if (!scenario) return [];
  const roleSummary = (scenario.roleAssignments || [])
    .slice(0, 4)
    .map((item) => `${members.find((member) => member.id === item.actorId)?.name || '成员'}${item.roleId ? `：${formatScenarioRoleLabel(item.roleId, language)}` : ''}`)
    .join(' / ');
  const factionSummary = (scenario.factions || []).slice(0, 4).map((item) => item.label).join(' / ');
  const rows: RuntimeStructureRow[] = [];
  if (roleSummary) rows.push({ key: 'roles', label: '角色位', value: roleSummary });
  if (factionSummary) rows.push({ key: 'factions', label: '阵营', value: factionSummary });
  if (scenario.currentTurnActorId) rows.push({ key: 'currentTurn', label: '当前轮次', value: members.find((item) => item.id === scenario.currentTurnActorId)?.name || '成员' });
  return rows;
}

function projectBoardRows(chat: GroupChat, language: string): RuntimeStructureRow[] {
  const board = chat.scenarioState?.board;
  if (!board) return [];
  return [
    { key: 'boardKind', label: '棋盘', value: formatScenarioBoardKind(board.schema.kind, language) },
    { key: 'boardSize', label: '尺寸', value: `${board.schema.columns || 0} × ${board.schema.rows || 0}` },
    { key: 'pieces', label: '棋子', value: `${board.pieces?.length || 0}` },
  ];
}

export function projectRuntimeStructureRows(chat: GroupChat, members: AICharacter[], language: string): RuntimeStructureRow[] {
  return [...projectScenarioRows(chat, members, language), ...projectBoardRows(chat, language)];
}
