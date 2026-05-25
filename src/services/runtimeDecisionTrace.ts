import type { Message } from '../types/message';
import { projectMessageRuntimeClues, type MessageRuntimeClueSection } from './messageRuntimeClues';
import { formatExpressionLengthLabel, formatInnerImpulseLabel, formatInnerToneLabel, formatResponseSurfaceKindLabel, formatRoleFitLabel, formatSurfaceBasisLabel } from './runtimeDecisionLabels';
import { formatBeatType, formatDirectorSource, formatKnownReason, formatNarrativeLineType } from './runtimeInsightPresentation';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';

type RuntimeDecisionDirectorIntentMeta = NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['directorIntent'];
type RuntimeDecisionLineMeta = {
  id: string;
  type: string;
  title: string;
  salience: number;
  tension: number;
  status: string;
  participantIds?: string[];
};

export interface RuntimeDecisionTraceItem {
  messageId: string;
  timestamp: number;
  senderId: string;
  senderName: string;
  director: string;
  directorLabel: string;
  rawDirector: string;
  primaryLine: string | null;
  primaryLineLabel: string | null;
  rawPrimaryLine: string | null;
  score: string | null;
  reasons: string[];
  reasonLabels: string[];
  rawReasons: string[];
  innerLifeLabel: string | null;
  innerLifeReason: string | null;
  innerLifeEvidence: string[];
  innerLifeState?: Record<string, unknown> | null;
  expressionLabel: string | null;
  expressionReasons: string[];
  expressionFeedbackRetrievedLabels: string[];
  expressionFeedbackAppliedLabels: string[];
  expressionFeedbackRetrievedReasons: string[];
  expressionFeedbackAppliedReasons: string[];
  rawExpression: string | null;
  surfaceLabel: string | null;
  surfaceBasis: string[];
  rawSurface: string | null;
  debugDetailLabel: string | null;
  rawDebugHint: string | null;
  runtimeClueSections: MessageRuntimeClueSection[];
}

function clip(value: string, max = 72) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function cleanTraceText(value: string | undefined | null, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(value || '', members);
}

function formatPressure(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatDirectorLabel(intent: RuntimeDecisionDirectorIntentMeta) {
  if (!intent) return '无调度意图';
  const source = typeof intent.source === 'string' ? formatDirectorSource(intent.source as never) : '未知来源';
  const beat = typeof intent.beatType === 'string' ? formatBeatType(intent.beatType as never) : '未知动作';
  return `${source} · ${beat} · 压力 ${formatPressure(intent.pressure)}`;
}

function formatPrimaryLineLabel(line: RuntimeDecisionLineMeta, members: DisplayTextMember[] = []) {
  const type = typeof line.type === 'string' ? formatNarrativeLineType(line.type as never) : '线索';
  return `${type} · ${cleanTraceText(line.title, members) || '未命名线索'} · 显著 ${formatPressure(line.salience)}`;
}

function formatDirectorReason(reason: string | undefined) {
  return reason ? formatKnownReason(reason) : null;
}

function buildExpressionTrace(innerLife: NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['innerLife'] | undefined, surface: NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['responseSurface'] | undefined) {
  const plan = innerLife?.expressionPlan;
  if (!plan && !surface) return { label: null, reasons: [], raw: null };
  const messageCount = typeof plan?.messageCount === 'number' ? plan.messageCount : 1;
  const delayMs = typeof plan?.delayMs === 'number' ? plan.delayMs : 0;
  const typoLevel = typeof plan?.typoLevel === 'number' ? plan.typoLevel : 0;
  const allowWithdraw = Boolean(plan?.allowWithdraw);
  const length = formatExpressionLengthLabel(plan?.length);
  const labelParts = [
    `表达 ${length}`,
    messageCount > 1 ? `${messageCount} 条气泡倾向` : '单条倾向',
    surface?.allowMarkdown ? '富文本' : '',
    allowWithdraw ? '可撤回' : '',
  ].filter(Boolean);
  const reasons = [
    innerLife?.impulse ? formatSpeakerScoreReason(`inner:${innerLife.impulse}`) : '',
    innerLife?.tone ? `语气：${formatInnerToneLabel(innerLife.tone)}` : '',
    delayMs >= 1800 ? `延迟较长：${delayMs}ms` : delayMs > 0 ? `延迟：${delayMs}ms` : '',
    typoLevel >= 5 ? `手滑/粗糙度较高：${typoLevel}` : typoLevel > 0 ? `手滑/粗糙度：${typoLevel}` : '',
    messageCount > 1 ? '内心表达计划倾向拆成几拍' : '当前更适合一条说完',
    surface?.allowMarkdown ? '输出形态允许 Markdown / 段落保留' : '',
    surface?.roleFit === 'limited' ? '角色适配度限制长篇或正式格式' : '',
  ].filter(Boolean);
  const raw = [
    plan?.length || 'unset',
    `count:${messageCount}`,
    `delay:${delayMs}`,
    `typo:${typoLevel}`,
    `withdraw:${allowWithdraw}`,
  ].join('/');
  return {
    label: labelParts.join(' · '),
    reasons,
    raw,
  };
}

export function formatSpeakerScoreReason(reason: string) {
  const labels: Record<string, string> = {
    pending_reply: '有待回应对象',
    conflict: '卷入当前矛盾',
    relationship: '关系压力较高',
    'emotion:tension': '情绪后效：想反驳或防备',
    'emotion:warmth': '情绪后效：想接话或靠近',
    'emotion:energy': '情绪后效：兴奋想参与',
    repetition_penalty: '近期发言过多，被降权',
    'director:defend:relationship': '适合维护相关对象',
    'director:summarizer': '适合收束总结',
    'director:proactive': '主动性适合接话',
    'director:cool_down:empathy': '共情较高，适合降温',
    'director:faction:shared': '与目标存在同阵营倾向',
  };
  if (labels[reason]) return labels[reason];
  const innerImpulse = reason.match(/^inner:(.+)$/);
  if (innerImpulse) return `内在冲动：${formatInnerImpulseLabel(innerImpulse[1])}`;
  const directorTarget = reason.match(/^director:([^:]+):target$/);
  if (directorTarget) {
    const beatLabels: Record<string, string> = {
      answer: '被点名回应',
      challenge: '适合挑战当前目标',
      defend: '适合维护当前目标',
      escalate: '适合推进冲突升级',
      cool_down: '适合接住降温',
      reveal: '适合揭示信息',
      deflect: '适合转移焦点',
      summarize: '适合收束讨论',
      invite: '适合被邀请接话',
    };
    return beatLabels[directorTarget[1]] || '符合当前导演意图';
  }
  const directorOpposition = reason.match(/^director:([^:]+):opposition$/);
  if (directorOpposition) return directorOpposition[1] === 'escalate' ? '与目标存在对立，适合升级' : '与目标存在对立，适合挑战';
  return reason;
}

export function projectRuntimeDecisionTrace(messages: Message[], limit = 6, members: DisplayTextMember[] = []): RuntimeDecisionTraceItem[] {
  return messages
    .filter((message) => !message.isDeleted && Boolean(message.metadata?.runtimeDecision))
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((message) => {
      const decision = message.metadata?.runtimeDecision;
      const directorReason = cleanTraceText(decision?.directorIntent?.reason, members);
      const director = decision?.directorIntent
        ? `${decision.directorIntent.source}/${decision.directorIntent.beatType} · ${formatPressure(decision.directorIntent.pressure)} · ${clip(directorReason)}`
        : 'none';
      const directorLabel = formatDirectorLabel(decision?.directorIntent);
      const primaryLine = decision?.narrativeLines?.[0]
        ? `${decision.narrativeLines[0].type}:${cleanTraceText(decision.narrativeLines[0].title, members) || '未命名线索'} · 显著 ${formatPressure(decision.narrativeLines[0].salience)}`
        : null;
      const primaryLineLabel = decision?.narrativeLines?.[0] ? formatPrimaryLineLabel(decision.narrativeLines[0], members) : null;
      const score = decision?.speakerScore
        ? `得分 ${formatPressure(typeof decision.speakerScore.finalScore === 'number' ? decision.speakerScore.finalScore : undefined)}`
        : null;
      const reasons = Array.isArray(decision?.speakerScore?.reasons)
        ? decision.speakerScore.reasons.filter((item): item is string => typeof item === 'string')
        : [];
      const reasonLabels = reasons.map(formatSpeakerScoreReason);
      const innerLife = decision?.innerLife;
      const innerLifeLabel = innerLife
        ? `${formatSpeakerScoreReason(`inner:${innerLife.impulse}`)} · ${formatInnerToneLabel(innerLife.tone)} · 压力 ${formatPressure(innerLife.pressure)}`
        : null;
      const surface = decision?.responseSurface;
      const surfaceBasis = Array.isArray(surface?.basis)
        ? surface.basis.filter((item): item is string => typeof item === 'string').map((reason) => formatSurfaceBasisLabel(reason))
        : [];
      const rawSurface = surface
        ? `${surface.kind}/${surface.roleFit}${surface.allowMarkdown ? '/markdown' : ''}`
        : null;
      const surfaceLabel = surface
        ? `${formatResponseSurfaceKindLabel(surface.kind)} · ${formatRoleFitLabel(surface.roleFit)}${surface.allowMarkdown ? ' · Markdown' : ''}`
        : null;
      const expression = buildExpressionTrace(innerLife, surface);
      const readableDirectorReason = cleanTraceText(formatDirectorReason(decision?.directorIntent?.reason) || directorReason, members);
      const debugDetailLabel = [
        directorLabel !== '无调度意图' ? `调度：${directorLabel}${readableDirectorReason ? ` · ${readableDirectorReason}` : ''}` : '',
        primaryLineLabel ? `线索：${primaryLineLabel}` : '',
        surfaceLabel ? `表达：${surfaceLabel}` : '',
        expression.label ? `节奏：${expression.label}` : '',
      ].filter(Boolean).join(' / ') || null;
      const rawDebugHint = [
        decision?.directorIntent ? `director=${director}` : '',
        primaryLine ? `line=${primaryLine}` : '',
        rawSurface ? `surface=${rawSurface}` : '',
        expression.raw ? `expression=${expression.raw}` : '',
      ].filter(Boolean).join(' / ') || null;
      const runtimeClueSections = projectMessageRuntimeClues(message, members);
      const expressionFeedback = Array.isArray(decision?.expressionFeedback) ? decision.expressionFeedback : [];
      const expressionFeedbackRetrievedLabels = expressionFeedback
        .map((item) => typeof item.label === 'string' ? item.label : '')
        .filter(Boolean);
      const expressionFeedbackRetrievedReasons = expressionFeedback
        .map((item) => {
          const label = typeof item.label === 'string' ? item.label : '表达反馈';
          const text = cleanTraceText(typeof item.text === 'string' ? item.text : '', members);
          const evidence = cleanTraceText(typeof item.evidence === 'string' ? item.evidence : '', members);
          const confidence = typeof item.confidence === 'number' ? `强度 ${(item.confidence * 100).toFixed(0)}%` : '';
          const count = typeof item.count === 'number' ? `次数 ${item.count}` : '';
          const positiveCount = typeof item.positiveCount === 'number' && item.positiveCount > 0 ? `正向 ${item.positiveCount}` : '';
          return ['已检索', label, count, positiveCount, confidence, text, evidence ? `证据：${evidence}` : ''].filter(Boolean).join(' · ');
        })
        .filter(Boolean);
      const appliedFeedback = expressionFeedback.filter((item) => item.applied);
      const expressionFeedbackAppliedLabels = appliedFeedback
        .map((item) => typeof item.label === 'string' ? item.label : '')
        .filter(Boolean);
      const expressionFeedbackAppliedReasons = appliedFeedback
        .map((item) => {
          const label = typeof item.label === 'string' ? item.label : '表达反馈';
          const effects = Array.isArray(item.effects) ? item.effects.filter((effect): effect is string => typeof effect === 'string') : [];
          const text = cleanTraceText(typeof item.text === 'string' ? item.text : '', members);
          return ['已影响', label, effects.length ? `影响：${effects.join('、')}` : '', text].filter(Boolean).join(' · ');
        })
        .filter(Boolean);
      return {
        messageId: message.id,
        timestamp: message.timestamp,
        senderId: message.senderId,
        senderName: message.senderName,
        director,
        directorLabel,
        rawDirector: director,
        primaryLine,
        primaryLineLabel,
        rawPrimaryLine: primaryLine,
        score,
        reasons,
        reasonLabels,
        rawReasons: reasons,
        innerLifeLabel,
        innerLifeReason: typeof innerLife?.reason === 'string' ? cleanTraceText(innerLife.reason, members) : null,
        innerLifeEvidence: Array.isArray(innerLife?.evidence) ? innerLife.evidence.filter((item): item is string => typeof item === 'string').map((item) => cleanTraceText(item, members)) : [],
        innerLifeState: innerLife?.state || null,
        expressionLabel: expression.label,
        expressionReasons: expression.reasons,
        expressionFeedbackRetrievedLabels,
        expressionFeedbackAppliedLabels,
        expressionFeedbackRetrievedReasons,
        expressionFeedbackAppliedReasons,
        rawExpression: expression.raw,
        surfaceLabel,
        surfaceBasis,
        rawSurface,
        debugDetailLabel,
        rawDebugHint,
        runtimeClueSections,
      };
    });
}

export function summarizeLatestRuntimeDecision(messages: Message[]) {
  const [latest] = projectRuntimeDecisionTrace(messages, 1);
  if (!latest) return null;
  return [latest.senderName, latest.directorLabel, latest.primaryLineLabel, latest.score].filter(Boolean).join(' / ');
}
