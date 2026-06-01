import type { RuntimeDecisionTraceItem } from './runtimeDecisionTrace';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { formatFeedbackStatusLabel } from './runtimeStatusPresentation';

export interface RuntimeDecisionReasonGroup {
  key: string;
  label: string;
  items: string[];
  hint?: string;
  tone?: string;
  statusLabel?: string;
  statusHint?: string;
}

function cleanText(text: string, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(text, members);
}

function reasonTone(reason: string) {
  if (/矛盾|冲突|挑战|对立|升级|压力/.test(reason)) return 'rgba(244, 67, 54, 0.08)';
  if (/关系|维护|共情|降温|安慰|亲近/.test(reason)) return 'rgba(46, 125, 50, 0.08)';
  if (/内在|面子|证明|想被看见|找补|回避|沉默/.test(reason)) return 'rgba(156, 39, 176, 0.08)';
  if (/被点名|回应|邀请|待回应/.test(reason)) return 'rgba(25, 118, 210, 0.08)';
  return 'action.hover';
}

function runtimeClueTone(statusKind: string) {
  if (statusKind === 'prompt_context') return 'rgba(255, 152, 0, 0.08)';
  if (statusKind === 'applied_signal') return 'rgba(46, 125, 50, 0.08)';
  if (statusKind === 'soft_signal') return 'rgba(255, 152, 0, 0.08)';
  return 'rgba(25, 118, 210, 0.08)';
}

export function buildDecisionReasonGroups(item: RuntimeDecisionTraceItem, members: DisplayTextMember[] = []): RuntimeDecisionReasonGroup[] {
  const groups: RuntimeDecisionReasonGroup[] = [];
  const speakerReasons = item.reasonLabels.slice(0, 4).map((reason) => cleanText(reason, members));
  if (speakerReasons.length) {
    groups.push({
      key: 'speaker',
      label: '发言原因',
      items: speakerReasons,
      hint: item.rawReasons.map((reason) => cleanText(reason, members)).join(' / '),
      tone: reasonTone(speakerReasons.join(' ')),
    });
  }
  item.runtimeClueSections.forEach((section) => {
    const items = section.items.slice(0, 4).map((text) => cleanText(text, members));
    if (!items.length) return;
    const shouldWarn = section.key === 'guidance_execution' && section.statusKind !== 'applied_signal';
    groups.push({
      key: `clue:${section.key}`,
      label: cleanText(section.label, members),
      items,
      hint: section.items.map((text) => cleanText(text, members)).join(' / '),
      statusLabel: section.statusLabel,
      statusHint: section.statusHint,
      tone: shouldWarn ? 'rgba(244, 67, 54, 0.08)' : runtimeClueTone(section.statusKind),
    });
  });
  if (item.primaryLineLabel || item.directorLabel !== '无调度意图') {
    groups.push({
      key: 'narrative',
      label: '剧情压力',
      items: [item.directorLabel !== '无调度意图' ? cleanText(item.directorLabel, members) : '', item.primaryLineLabel ? cleanText(item.primaryLineLabel, members) : ''].filter(Boolean),
      hint: [item.rawDirector, item.rawPrimaryLine].filter(Boolean).map((text) => cleanText(text || '', members)).join(' / '),
      tone: 'rgba(25, 118, 210, 0.06)',
    });
  }
  if (item.executionRelationLabel) {
    groups.push({
      key: 'execution',
      label: '执行与发言',
      items: [cleanText(item.executionRelationLabel, members)],
      hint: item.rawExecutionRelation ? cleanText(item.rawExecutionRelation, members) : undefined,
      tone: 'rgba(3, 105, 161, 0.08)',
    });
  }
  if (item.innerLifeLabel) {
    groups.push({
      key: 'inner',
      label: '内心冲动',
      items: [cleanText(item.innerLifeLabel, members)],
      hint: [item.innerLifeReason, ...item.innerLifeEvidence].filter(Boolean).map((text) => cleanText(text || '', members)).join(' / '),
      tone: 'rgba(156, 39, 176, 0.06)',
    });
  }
  if (item.surfaceLabel || item.expressionLabel) {
    groups.push({
      key: 'expression',
      label: '表达形态',
      items: [item.surfaceLabel ? cleanText(item.surfaceLabel, members) : '', item.expressionLabel ? cleanText(item.expressionLabel, members) : ''].filter(Boolean),
      hint: [...item.surfaceBasis, ...item.expressionReasons].map((reason) => cleanText(reason, members)).join(' / '),
      tone: 'rgba(245, 124, 0, 0.06)',
    });
  }
  if (item.expressionFeedbackRetrievedLabels.length || item.expressionFeedbackAppliedLabels.length) {
    groups.push({
      key: 'feedback',
      label: '表达反馈',
      items: [
        ...item.expressionFeedbackRetrievedLabels.slice(0, 2).map((label) => `${formatFeedbackStatusLabel(false)} ${cleanText(label, members)}`),
        ...item.expressionFeedbackAppliedLabels.slice(0, 2).map((label) => `${formatFeedbackStatusLabel(true)} ${cleanText(label, members)}`),
      ],
      hint: [...item.expressionFeedbackRetrievedReasons, ...item.expressionFeedbackAppliedReasons].map((reason) => cleanText(reason, members)).join(' / '),
      tone: 'rgba(255, 152, 0, 0.08)',
    });
  }
  return groups;
}
