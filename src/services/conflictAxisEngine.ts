import type { GroupChat, ConversationConflictAxis } from '../types/chat';
import type { ConflictFocusPayload } from '../types/runtimeEvent';

const AXIS_DECAY_STEP = 8;
const AXIS_DISPLAY_THRESHOLD = 12;

function clampTilt(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function relaxTilt(value: number) {
  if (Math.abs(value) <= AXIS_DECAY_STEP) return 0;
  return value > 0 ? value - AXIS_DECAY_STEP : value + AXIS_DECAY_STEP;
}

function isMeaningfulTilt(value: number | undefined) {
  return Math.abs(value || 0) >= AXIS_DISPLAY_THRESHOLD;
}

function formatAxisSummary(axis: ConversationConflictAxis) {
  if (!isMeaningfulTilt(axis.currentTilt)) return null;
  return `${axis.title} ${(axis.currentTilt || 0) > 0 ? axis.poles[0] : axis.poles[1]}`;
}

function readAxisDelta(axis: ConversationConflictAxis, conflict: ConflictFocusPayload | null | undefined) {
  if (!conflict?.present) return 0;
  const severity = typeof conflict.severity === 'number' && Number.isFinite(conflict.severity)
    ? Math.max(0, Math.min(1, conflict.severity))
    : 0.55;
  const pressure = conflict.nextPressure;
  const sign = pressure === 'cool' || pressure === 'stabilize' ? 1 : -1;
  const magnitude = Math.round(8 + severity * 22);
  if (axis.title === '归属/身份冲突') {
    if (conflict.type === 'identity_ownership' || conflict.type === 'alliance_boundary') return sign * magnitude;
    return conflict.type === 'authority_challenge' || conflict.type === 'status_competition' ? sign * Math.round(magnitude * 0.7) : 0;
  }
  if (conflict.type === 'contradiction_exposure' || conflict.type === 'value_conflict' || conflict.type === 'goal_conflict' || conflict.type === 'tone_escalation') {
    return sign * Math.round(magnitude * 0.7);
  }
  return 0;
}

export function createDefaultConflictAxes(chat: Pick<GroupChat, 'topic' | 'style' | 'dramaRules'>): ConversationConflictAxis[] {
  const axes: ConversationConflictAxis[] = [];
  if (chat.style === 'debate') {
    axes.push({ title: '立场冲突', poles: ['支持', '反对'], currentTilt: 0 });
  }
  if (chat.style === 'brainstorm') {
    axes.push({ title: '方法冲突', poles: ['发散创意', '收敛执行'], currentTilt: 10 });
  }
  axes.push({ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'], currentTilt: 0 });
  if (chat.dramaRules.allowCliques) {
    axes.push({ title: '群体关系', poles: ['结盟', '拆台'], currentTilt: 0 });
  }
  if (chat.dramaRules.allowMockery || chat.dramaRules.allowContempt) {
    axes.push({ title: '表达风格', poles: ['克制', '尖锐'], currentTilt: 20 });
  }
  return axes;
}

export function evolveConflictAxes(chat: GroupChat, conflict: ConflictFocusPayload | null | undefined) {
  const axes = (chat.worldState.conflictAxes || []).length ? (chat.worldState.conflictAxes || []) : createDefaultConflictAxes(chat);
  return axes.map((axis) => ({
    ...axis,
    currentTilt: clampTilt(relaxTilt(axis.currentTilt || 0) + readAxisDelta(axis, conflict)),
  }));
}

export function summarizeConflictAxes(axes: ConversationConflictAxis[]) {
  return axes
    .slice()
    .sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0))
    .map(formatAxisSummary)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join('；');
}

export function getConflictAxesPriority(axes: ConversationConflictAxis[]) {
  return axes.slice().sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0));
}

export function getConflictAxesSummaryLines(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes)
    .map(formatAxisSummary)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
}

export function getConflictAxesNarrative(axes: ConversationConflictAxis[]) {
  return getConflictAxesSummaryLines(axes).join('；');
}

export function getConflictAxesTopSummary(axes: ConversationConflictAxis[]) {
  return summarizeConflictAxes(axes);
}
