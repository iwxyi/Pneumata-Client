import type { Message } from '../types/message';
import { projectMessageRuntimeClues, type MessageRuntimeClueSection } from './messageRuntimeClues';
import { formatBeatType, formatDirectorSource, formatNarrativeLineType } from './runtimeInsightPresentation';

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
  runtimeClueSections: MessageRuntimeClueSection[];
}

function clip(value: string, max = 72) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
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

function formatPrimaryLineLabel(line: RuntimeDecisionLineMeta) {
  const type = typeof line.type === 'string' ? formatNarrativeLineType(line.type as never) : '线索';
  return `${type} · ${line.title} · 显著 ${formatPressure(line.salience)}`;
}

function formatInnerTone(tone: string | undefined) {
  const labels: Record<string, string> = {
    casual: '随意',
    defensive: '防御',
    teasing: '调侃',
    serious: '认真',
    tired: '疲惫',
    vulnerable: '脆弱',
  };
  return tone ? labels[tone] || tone : '未定';
}

function formatResponseSurfaceKind(kind: string | undefined) {
  const labels: Record<string, string> = {
    chat: '聊天气泡',
    professional: '专业表达',
    creative: '创作表达',
    longform: '长文表达',
  };
  return kind ? labels[kind] || kind : '未定';
}

function formatRoleFit(roleFit: string | undefined) {
  const labels: Record<string, string> = {
    limited: '角色不适合长篇',
    ordinary: '普通匹配',
    capable: '角色能力支持',
  };
  return roleFit ? labels[roleFit] || roleFit : '普通匹配';
}

function formatSurfaceBasis(reason: string) {
  const labels: Record<string, string> = {
    'topic:creative-task': '主题请求创作',
    'topic:professional-task': '主题请求专业表达',
    'style:roleplay-creative': '角色扮演风格支持创作',
    'style:debate-structured': '辩论风格支持结构化',
    'style:brainstorm-structured': '头脑风暴支持结构化',
    'style:debate-reasoning': '辩论风格需要推理',
    'style:brainstorm-reasoning': '头脑风暴需要推理',
    'style:free': '自由聊天风格',
    'style:debate': '辩论风格',
    'style:brainstorm': '头脑风暴风格',
    'style:roleplay': '角色扮演风格',
    'role:limited': '角色能力限制长文',
    'role:ordinary': '角色普通匹配',
    'role:capable': '角色能力支持长文',
    'mode:interview': '面试模式',
    'mode:classroom': '课堂模式',
    'mode:group_discussion': '小组讨论模式',
    'mode:roundtable': '圆桌模式',
    'context:chat': '上下文指定聊天',
    'context:professional': '上下文指定专业',
    'context:creative': '上下文指定创作',
    'context:longform': '上下文指定长文',
  };
  return labels[reason] || reason;
}

function formatExpressionLength(length: string | undefined) {
  const labels: Record<string, string> = {
    micro: '极短',
    short: '短句',
    normal: '常规',
    long: '长句',
  };
  return length ? labels[length] || length : '未定';
}

function buildExpressionTrace(innerLife: NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['innerLife'] | undefined, surface: NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['responseSurface'] | undefined) {
  const plan = innerLife?.expressionPlan;
  if (!plan && !surface) return { label: null, reasons: [], raw: null };
  const messageCount = typeof plan?.messageCount === 'number' ? plan.messageCount : 1;
  const delayMs = typeof plan?.delayMs === 'number' ? plan.delayMs : 0;
  const typoLevel = typeof plan?.typoLevel === 'number' ? plan.typoLevel : 0;
  const allowWithdraw = Boolean(plan?.allowWithdraw);
  const length = formatExpressionLength(plan?.length);
  const labelParts = [
    `表达 ${length}`,
    messageCount > 1 ? `${messageCount} 条气泡倾向` : '单条倾向',
    surface?.allowMarkdown ? '富文本' : '',
    allowWithdraw ? '可撤回' : '',
  ].filter(Boolean);
  const reasons = [
    innerLife?.impulse ? formatSpeakerScoreReason(`inner:${innerLife.impulse}`) : '',
    innerLife?.tone ? `语气：${formatInnerTone(innerLife.tone)}` : '',
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
    'inner:answer': '内在冲动：回应',
    'inner:show_off': '内在冲动：证明自己',
    'inner:defend_face': '内在冲动：维护面子',
    'inner:seek_attention': '内在冲动：想被看见',
    'inner:comfort': '内在冲动：安慰',
    'inner:repair': '内在冲动：找补/靠近',
    'inner:mock': '内在冲动：调侃/挑刺',
    'inner:avoid': '内在冲动：回避',
    'inner:stay_silent': '内在冲动：沉默',
  };
  if (labels[reason]) return labels[reason];
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

export function projectRuntimeDecisionTrace(messages: Message[], limit = 6): RuntimeDecisionTraceItem[] {
  return messages
    .filter((message) => !message.isDeleted && Boolean(message.metadata?.runtimeDecision))
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((message) => {
      const decision = message.metadata?.runtimeDecision;
      const director = decision?.directorIntent
        ? `${decision.directorIntent.source}/${decision.directorIntent.beatType} · ${formatPressure(decision.directorIntent.pressure)} · ${clip(decision.directorIntent.reason || '')}`
        : 'none';
      const directorLabel = formatDirectorLabel(decision?.directorIntent);
      const primaryLine = decision?.narrativeLines?.[0]
        ? `${decision.narrativeLines[0].type}:${decision.narrativeLines[0].title} · 显著 ${formatPressure(decision.narrativeLines[0].salience)}`
        : null;
      const primaryLineLabel = decision?.narrativeLines?.[0] ? formatPrimaryLineLabel(decision.narrativeLines[0]) : null;
      const score = decision?.speakerScore
        ? `得分 ${formatPressure(typeof decision.speakerScore.finalScore === 'number' ? decision.speakerScore.finalScore : undefined)}`
        : null;
      const reasons = Array.isArray(decision?.speakerScore?.reasons)
        ? decision.speakerScore.reasons.filter((item): item is string => typeof item === 'string')
        : [];
      const reasonLabels = reasons.map(formatSpeakerScoreReason);
      const innerLife = decision?.innerLife;
      const innerLifeLabel = innerLife
        ? `${formatSpeakerScoreReason(`inner:${innerLife.impulse}`)} · ${formatInnerTone(innerLife.tone)} · 压力 ${formatPressure(innerLife.pressure)}`
        : null;
      const surface = decision?.responseSurface;
      const surfaceBasis = Array.isArray(surface?.basis)
        ? surface.basis.filter((item): item is string => typeof item === 'string').map(formatSurfaceBasis)
        : [];
      const rawSurface = surface
        ? `${surface.kind}/${surface.roleFit}${surface.allowMarkdown ? '/markdown' : ''}`
        : null;
      const surfaceLabel = surface
        ? `${formatResponseSurfaceKind(surface.kind)} · ${formatRoleFit(surface.roleFit)}${surface.allowMarkdown ? ' · Markdown' : ''}`
        : null;
      const expression = buildExpressionTrace(innerLife, surface);
      const runtimeClueSections = projectMessageRuntimeClues(message);
      const expressionFeedback = Array.isArray(decision?.expressionFeedback) ? decision.expressionFeedback : [];
      const expressionFeedbackRetrievedLabels = expressionFeedback
        .map((item) => typeof item.label === 'string' ? item.label : '')
        .filter(Boolean);
      const expressionFeedbackRetrievedReasons = expressionFeedback
        .map((item) => {
          const label = typeof item.label === 'string' ? item.label : '表达反馈';
          const text = typeof item.text === 'string' ? item.text : '';
          const evidence = typeof item.evidence === 'string' ? item.evidence : '';
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
          const text = typeof item.text === 'string' ? item.text : '';
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
        innerLifeReason: typeof innerLife?.reason === 'string' ? innerLife.reason : null,
        innerLifeEvidence: Array.isArray(innerLife?.evidence) ? innerLife.evidence.filter((item): item is string => typeof item === 'string') : [],
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
        runtimeClueSections,
      };
    });
}

export function summarizeLatestRuntimeDecision(messages: Message[]) {
  const [latest] = projectRuntimeDecisionTrace(messages, 1);
  if (!latest) return null;
  return [latest.senderName, latest.directorLabel, latest.primaryLineLabel, latest.score].filter(Boolean).join(' / ');
}
