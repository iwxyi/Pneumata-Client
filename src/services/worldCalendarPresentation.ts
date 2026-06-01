import type { ParticipantScheduleState } from './worldRuntimeProjection';

export function formatParticipantScheduleStateLabel(state: ParticipantScheduleState, isZh: boolean) {
  if (isZh) {
    const zh: Record<ParticipantScheduleState, string> = {
      mentioned: '提及',
      invited: '已邀请',
      interested: '感兴趣',
      maybe: '可能参加',
      going: '确认参加',
      late: '可能迟到',
      left_early: '提前离场',
      declined: '已拒绝',
      withdrawn: '已退出',
      no_show: '未到场',
      cancelled_by_dependency: '依赖取消',
    };
    return zh[state];
  }
  const en: Record<ParticipantScheduleState, string> = {
    mentioned: 'Mentioned',
    invited: 'Invited',
    interested: 'Interested',
    maybe: 'Maybe',
    going: 'Going',
    late: 'Late',
    left_early: 'Left early',
    declined: 'Declined',
    withdrawn: 'Withdrawn',
    no_show: 'No-show',
    cancelled_by_dependency: 'Cancelled by dependency',
  };
  return en[state];
}

export function summarizeParticipantStateCounts(
  states: Record<string, ParticipantScheduleState>,
  isZh: boolean,
) {
  const counts = new Map<ParticipantScheduleState, number>();
  Object.values(states).forEach((state) => {
    counts.set(state, (counts.get(state) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => `${formatParticipantScheduleStateLabel(state, isZh)} ×${count}`);
}
