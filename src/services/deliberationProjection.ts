import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { formatScenarioRoleLabel } from './scenarioPresentation';
import { resolveSessionFamilyKey } from './sessionEngineKeys';

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

function formatReason(reason: string | null | undefined, clean: (text: string) => string) {
  return reason ? `（因：${clean(reason)}）` : '';
}

function compactDisplayText(value: string, clean: (text: string) => string, max = 92) {
  const normalized = clean(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function normalizeArtifactText(value: string | null | undefined, max: number) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function mergeByIdOrSignature<T extends { id: string; text: string; sourceMessageId?: string }>(base: T[] = [], additions: T[] = []) {
  const seen = new Set(base.map((item) => item.id));
  const signatureSeen = new Set(base.map((item) => `${item.sourceMessageId || ''}:${item.text}`));
  const merged = [...base];
  additions.forEach((item) => {
    const signature = `${item.sourceMessageId || ''}:${item.text}`;
    if (seen.has(item.id) || signatureSeen.has(signature)) return;
    seen.add(item.id);
    signatureSeen.add(signature);
    merged.push(item);
  });
  return merged;
}

function projectMessageArtifacts(chat: GroupChat, messages: Message[] = []) {
  const validMemberIds = new Set(chat.memberIds);
  const visible = messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event');
  const claims: NonNullable<NonNullable<GroupChat['scenarioState']>['deliberationClaims']> = [];
  const evidence: NonNullable<NonNullable<GroupChat['scenarioState']>['deliberationEvidence']> = [];
  const issues: NonNullable<NonNullable<GroupChat['scenarioState']>['deliberationIssues']> = [];
  const verdicts: NonNullable<NonNullable<GroupChat['scenarioState']>['deliberationVerdicts']> = [];
  let summaryText = '';

  visible.forEach((message) => {
    const artifacts = message.metadata?.deliberationArtifacts;
    if (!artifacts) return;
    const sourceMessageId = message.id;
    const createdAt = message.timestamp;
    artifacts.claims?.forEach((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      if (!text) return;
      claims.push({
        id: `claim-${sourceMessageId}-${index}`,
        actorId: message.senderId,
        stance: item.stance || 'neutral',
        text,
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: item.confidence,
        sourceMessageId,
        createdAt,
      });
    });
    artifacts.evidence?.forEach((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      if (!text) return;
      evidence.push({
        id: `evidence-${sourceMessageId}-${index}`,
        actorId: message.senderId,
        text,
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: item.confidence,
        sourceMessageId,
        createdAt,
      });
    });
    artifacts.issues?.forEach((item, index) => {
      const text = normalizeArtifactText(item.text, 96);
      if (!text) return;
      issues.push({
        id: `issue-${sourceMessageId}-${index}`,
        targetActorId: item.targetActorId && validMemberIds.has(item.targetActorId) ? item.targetActorId : null,
        text,
        status: 'open',
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: item.confidence,
        sourceMessageId,
        createdAt,
      });
    });
    artifacts.verdicts?.forEach((item, index) => {
      const text = normalizeArtifactText(item.text, 110);
      if (!text) return;
      verdicts.push({
        id: `verdict-${sourceMessageId}-${index}`,
        actorId: message.senderId,
        text,
        tendency: item.tendency || 'mixed',
        reason: normalizeArtifactText(item.reason, 100) || undefined,
        confidence: item.confidence,
        sourceMessageId,
        createdAt,
      });
    });
    if (artifacts.summary?.text) summaryText = normalizeArtifactText(artifacts.summary.text, 220);
  });

  return { claims, evidence, issues, verdicts, summaryText };
}

export function countProjectedDeliberationArtifacts(
  chat: GroupChat,
  messages: Array<Pick<Message, 'id' | 'senderId' | 'timestamp' | 'type' | 'content' | 'metadata' | 'isDeleted'>> = [],
) {
  const projected = projectMessageArtifacts(chat, messages as Message[]);
  return {
    claims: projected.claims.length,
    evidence: projected.evidence.length,
    issues: projected.issues.length,
    verdicts: projected.verdicts.length,
    summaries: projected.summaryText ? 1 : 0,
  };
}

export interface DeliberationSidebarArtifactItem {
  key: string;
  label: string;
  text: string;
  reason?: string;
  confidence?: number;
}

export interface DeliberationSidebarSection {
  key: 'claims' | 'evidence' | 'issues' | 'verdicts';
  title: string;
  emptyText: string;
  totalCount: number;
  windowLimit: number;
  defaultVisible: number;
  items: DeliberationSidebarArtifactItem[];
}

export interface DeliberationSidebarModel {
  phaseLabel: string;
  topic: string;
  seats: string[];
  currentSpeaker: string;
  progress: string;
  latestInquiry: string;
  counts: {
    claims: number;
    evidence: number;
    issues: number;
    verdicts: number;
  };
  sections: DeliberationSidebarSection[];
  momentum: string;
  summaryText: string;
}

export function projectDeliberationSidebarModel(chat: GroupChat, members: AICharacter[], messages: Message[] = []): DeliberationSidebarModel | null {
  if (resolveSessionFamilyKey(chat) !== 'analysis') return null;
  const displayMembers: DisplayTextMember[] = [{ id: 'user', name: '我' }, ...members.map((member) => ({ id: member.id, name: member.name }))];
  const clean = (text: string) => sanitizeUserFacingText(text, displayMembers);
  const messageArtifacts = projectMessageArtifacts(chat, messages);
  const progress = chat.scenarioState?.progress?.find((item) => item.key === 'speeches' || item.key === 'analysis-progress');
  const roleAssignments = chat.scenarioState?.roleAssignments || [];
  const claims = mergeByIdOrSignature(chat.scenarioState?.deliberationClaims || [], messageArtifacts.claims);
  const evidence = mergeByIdOrSignature(chat.scenarioState?.deliberationEvidence || [], messageArtifacts.evidence);
  const issues = mergeByIdOrSignature(chat.scenarioState?.deliberationIssues || [], messageArtifacts.issues).filter((item) => item.status !== 'answered');
  const verdicts = mergeByIdOrSignature(chat.scenarioState?.deliberationVerdicts || [], messageArtifacts.verdicts);
  const momentum = chat.scenarioState?.deliberationMomentum;
  const progressLabel = progress
    ? (typeof progress.target === 'number' && progress.target > 0
      ? `${progress.label || '审议进展'} ${progress.value || 0}/${progress.target}`
      : `${progress.label || '审议进展'} ${progress.value || 0}`)
    : '';

  const mapReason = (reason: string | null | undefined) => reason ? compactDisplayText(reason, clean, 82) : undefined;
  const artifactWindowLimit = 12;
  return {
    phaseLabel: formatDeliberationPhaseLabel(chat.scenarioState?.phase, chat.scenarioState?.discussionMode || chat.mode),
    topic: compactDisplayText(String(chat.scenarioState?.goals?.[0]?.label || chat.topic || ''), clean, 120),
    seats: roleAssignments.slice(0, 4).map((item) => `${memberName(item.actorId, members)}${item.roleId ? `：${formatDeliberationRoleLabel(chat, item.roleId)}` : ''}`),
    currentSpeaker: chat.scenarioState?.currentTurnActorId ? memberName(chat.scenarioState.currentTurnActorId, members) : '',
    progress: progressLabel,
    latestInquiry: latestInquiryLine(chat, members, clean),
    counts: {
      claims: claims.length,
      evidence: evidence.length,
      issues: issues.length,
      verdicts: verdicts.length,
    },
    sections: [
      {
        key: 'claims',
        title: '核心论点',
        emptyText: '暂无结构化论点',
        totalCount: claims.length,
        windowLimit: artifactWindowLimit,
        defaultVisible: 3,
        items: claims.slice(-artifactWindowLimit).reverse().map((item) => ({
          key: item.id,
          label: `${formatClaimStance(item.stance)}${item.actorId ? ` · ${memberName(item.actorId, members)}` : ''}`,
          text: compactDisplayText(item.text, clean),
          reason: mapReason(item.reason),
          confidence: item.confidence,
        })),
      },
      {
        key: 'issues',
        title: '待质询',
        emptyText: '暂无待回应漏洞',
        totalCount: issues.length,
        windowLimit: artifactWindowLimit,
        defaultVisible: 2,
        items: issues.slice(-artifactWindowLimit).reverse().map((item) => ({
          key: item.id,
          label: item.targetActorId ? `对象 · ${memberName(item.targetActorId, members)}` : '未指定对象',
          text: compactDisplayText(item.text, clean),
          reason: mapReason(item.reason),
          confidence: item.confidence,
        })),
      },
      {
        key: 'evidence',
        title: '证据',
        emptyText: '暂无证据',
        totalCount: evidence.length,
        windowLimit: artifactWindowLimit,
        defaultVisible: 2,
        items: evidence.slice(-artifactWindowLimit).reverse().map((item) => ({
          key: item.id,
          label: item.actorId ? memberName(item.actorId, members) : '来源未指定',
          text: compactDisplayText(item.text, clean),
          reason: mapReason(item.reason),
          confidence: item.confidence,
        })),
      },
      {
        key: 'verdicts',
        title: '阶段判断',
        emptyText: '暂无裁决记录',
        totalCount: verdicts.length,
        windowLimit: artifactWindowLimit,
        defaultVisible: 2,
        items: verdicts.slice(-artifactWindowLimit).reverse().map((item) => ({
          key: item.id,
          label: item.actorId ? memberName(item.actorId, members) : '裁决',
          text: compactDisplayText(item.text, clean),
          reason: mapReason(item.reason),
          confidence: item.confidence,
        })),
      },
    ],
    momentum: momentum && (momentum.support || momentum.oppose || momentum.inquiry || momentum.review)
      ? `${momentum.label || '持续推进'} · 支持${momentum.support} / 反对${momentum.oppose} / 质询${momentum.inquiry} / 评审${momentum.review}`
      : '',
    summaryText: compactDisplayText(chat.scenarioState?.summaryText || messageArtifacts.summaryText || '', clean, 120),
  };
}

export function projectDeliberationSidebarRows(chat: GroupChat, members: AICharacter[], messages: Message[] = []) {
  if (resolveSessionFamilyKey(chat) !== 'analysis') return [];
  const displayMembers: DisplayTextMember[] = [{ id: 'user', name: '我' }, ...members.map((member) => ({ id: member.id, name: member.name }))];
  const clean = (text: string) => sanitizeUserFacingText(text, displayMembers);
  const messageArtifacts = projectMessageArtifacts(chat, messages);
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
  const claims = mergeByIdOrSignature(chat.scenarioState?.deliberationClaims || [], messageArtifacts.claims);
  if (claims.length) {
    rows.push(`论点树 ${claims.slice(-3).map((item) => `${formatClaimStance(item.stance)}·${formatActorPrefix(item.actorId, members)}${clean(item.text)}${formatReason(item.reason, clean)}`).join(' / ')}`);
  }
  const evidence = mergeByIdOrSignature(chat.scenarioState?.deliberationEvidence || [], messageArtifacts.evidence);
  if (evidence.length) {
    rows.push(`证据 ${evidence.slice(-2).map((item) => `${formatActorPrefix(item.actorId, members)}${clean(item.text)}${formatReason(item.reason, clean)}`).join(' / ')}`);
  }
  const issues = mergeByIdOrSignature(chat.scenarioState?.deliberationIssues || [], messageArtifacts.issues).filter((item) => item.status !== 'answered');
  if (issues.length) {
    rows.push(`待回应漏洞 ${issues.slice(-2).map((item) => `${item.targetActorId ? `${memberName(item.targetActorId, members)} · ` : ''}${clean(item.text)}${formatReason(item.reason, clean)}`).join(' / ')}`);
  }
  const verdicts = mergeByIdOrSignature(chat.scenarioState?.deliberationVerdicts || [], messageArtifacts.verdicts);
  if (verdicts.length) {
    rows.push(`裁决记录 ${verdicts.slice(-2).map((item) => `${formatActorPrefix(item.actorId, members)}${clean(item.text)}${formatReason(item.reason, clean)}`).join(' / ')}`);
  }
  const momentum = chat.scenarioState?.deliberationMomentum;
  if (momentum && (momentum.support || momentum.oppose || momentum.inquiry || momentum.review)) {
    rows.push(`审议势头 ${momentum.label || '持续推进'} · 支持${momentum.support} / 反对${momentum.oppose} / 质询${momentum.inquiry} / 评审${momentum.review}`);
  }
  const summaryText = chat.scenarioState?.summaryText || messageArtifacts.summaryText;
  if (summaryText) rows.push(`审议总结 ${clean(summaryText)}`);
  return rows;
}
