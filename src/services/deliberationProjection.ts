import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { formatScenarioRoleLabel } from './scenarioPresentation';

function memberName(id: string | null | undefined, members: AICharacter[]) {
  if (!id) return '成员';
  return members.find((member) => member.id === id)?.name || '成员';
}

export function formatDeliberationPhaseLabel(phase: string | null | undefined, mode: string | null | undefined) {
  if (phase === 'synthesis') return '结论整理';
  if (mode === 'roundtable') return '圆桌审议';
  if (mode === 'debate') return '角色辩论';
  if (mode === 'courtroom') return '法庭攻防';
  if (mode === 'expert_review') return '专家评审';
  if (mode === 'public_inquiry') return '公开质询';
  if (mode === 'brainstorm') return '创意发散';
  if (mode === 'retrospective') return '复盘改进';
  return '观点审议';
}

function latestInquiryLine(chat: GroupChat, members: AICharacter[], clean: (text: string) => string) {
  const event = (chat.runtimeEventsV2 || [])
    .filter((item) => item.kind === 'director_intervention' && typeof item.summary === 'string' && item.summary.includes('审议质询'))
    .at(-1);
  if (!event) return '';
  const targetNames = (event.targetIds || []).map((id) => memberName(id, members)).filter(Boolean).join('、');
  return `最新质询 ${targetNames ? `${targetNames} · ` : ''}${clean(event.summary)}`;
}

function formatDeliberationRoleLabel(chat: GroupChat, roleId: string | null | undefined) {
  if (chat.scenarioState?.discussionMode === 'courtroom' && roleId === 'judge') return '法官';
  return formatScenarioRoleLabel(roleId);
}

function formatClaimStance(stance: string | null | undefined) {
  if (stance === 'support') return '支持';
  if (stance === 'oppose') return '反对';
  if (stance === 'inquiry') return '质询';
  if (stance === 'review') return '评审';
  return '观点';
}

function formatActorPrefix(actorId: string | null | undefined, members: AICharacter[]) {
  return actorId ? `${memberName(actorId, members)}：` : '';
}

export function projectDeliberationSidebarRows(chat: GroupChat, members: AICharacter[]) {
  if (chat.sessionKind?.family !== 'analysis') return [];
  const displayMembers: DisplayTextMember[] = [{ id: 'user', name: '我' }, ...members.map((member) => ({ id: member.id, name: member.name }))];
  const clean = (text: string) => sanitizeUserFacingText(text, displayMembers);
  const progress = chat.scenarioState?.progress?.find((item) => item.key === 'speeches' || item.key === 'analysis-progress');
  const roleAssignments = chat.scenarioState?.roleAssignments || [];
  const rows = [
    `阶段 ${formatDeliberationPhaseLabel(chat.scenarioState?.phase, chat.scenarioState?.discussionMode || chat.mode)}`,
  ];
  if (chat.scenarioState?.goals?.[0]?.label || chat.topic) {
    rows.push(`议题 ${clean(String(chat.scenarioState?.goals?.[0]?.label || chat.topic))}`);
  }
  if (roleAssignments.length) {
    rows.push(`审议席位 ${roleAssignments.slice(0, 4).map((item) => `${memberName(item.actorId, members)}${item.roleId ? `：${formatDeliberationRoleLabel(chat, item.roleId)}` : ''}`).join(' / ')}`);
  }
  if (chat.scenarioState?.currentTurnActorId) rows.push(`当前发言 ${memberName(chat.scenarioState.currentTurnActorId, members)}`);
  if (progress) {
    const progressLabel = progress.label || '审议进展';
    const progressValue = progress.value || 0;
    rows.push(typeof progress.target === 'number' && progress.target > 0
      ? `${progressLabel} ${progressValue}/${progress.target}`
      : `${progressLabel} ${progressValue}`);
  }
  const inquiry = latestInquiryLine(chat, members, clean);
  if (inquiry) rows.push(inquiry);
  const claims = chat.scenarioState?.deliberationClaims || [];
  if (claims.length) {
    rows.push(`论点树 ${claims.slice(-3).map((item) => `${formatClaimStance(item.stance)}·${formatActorPrefix(item.actorId, members)}${clean(item.text)}`).join(' / ')}`);
  }
  const evidence = chat.scenarioState?.deliberationEvidence || [];
  if (evidence.length) {
    rows.push(`证据 ${evidence.slice(-2).map((item) => `${formatActorPrefix(item.actorId, members)}${clean(item.text)}`).join(' / ')}`);
  }
  const issues = (chat.scenarioState?.deliberationIssues || []).filter((item) => item.status !== 'answered');
  if (issues.length) {
    rows.push(`待回应漏洞 ${issues.slice(-2).map((item) => `${item.targetActorId ? `${memberName(item.targetActorId, members)} · ` : ''}${clean(item.text)}`).join(' / ')}`);
  }
  const verdicts = chat.scenarioState?.deliberationVerdicts || [];
  if (verdicts.length) {
    rows.push(`裁决记录 ${verdicts.slice(-2).map((item) => `${formatActorPrefix(item.actorId, members)}${clean(item.text)}`).join(' / ')}`);
  }
  const momentum = chat.scenarioState?.deliberationMomentum;
  if (momentum && (momentum.support || momentum.oppose || momentum.inquiry || momentum.review)) {
    rows.push(`审议势头 ${momentum.label || '持续推进'} · 支持${momentum.support} / 反对${momentum.oppose} / 质询${momentum.inquiry} / 评审${momentum.review}`);
  }
  if (chat.scenarioState?.summaryText) rows.push(`审议总结 ${clean(chat.scenarioState.summaryText)}`);
  return rows;
}
