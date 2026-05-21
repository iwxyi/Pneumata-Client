import type { Message } from '../types/message';
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

export function formatSpeakerScoreReason(reason: string) {
  const labels: Record<string, string> = {
    pending_reply: '有待回应对象',
    conflict: '卷入当前矛盾',
    relationship: '关系压力较高',
    repetition_penalty: '近期发言过多，被降权',
    'director:defend:relationship': '适合维护相关对象',
    'director:summarizer': '适合收束总结',
    'director:proactive': '主动性适合接话',
    'director:cool_down:empathy': '共情较高，适合降温',
    'director:faction:shared': '与目标存在同阵营倾向',
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
      };
    });
}

export function summarizeLatestRuntimeDecision(messages: Message[]) {
  const [latest] = projectRuntimeDecisionTrace(messages, 1);
  if (!latest) return null;
  return [latest.senderName, latest.directorLabel, latest.primaryLineLabel, latest.score].filter(Boolean).join(' / ');
}
