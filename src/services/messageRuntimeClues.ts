import type { Message } from '../types/message';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { formatInnerImpulseLabel, formatInnerToneLabel, formatResponseSurfaceKindLabel, formatRoleFitLabel, formatSurfaceBasisLabel } from './runtimeDecisionLabels';
import { formatBeatType, formatKnownReason } from './runtimeInsightPresentation';
import { formatGuidanceExecutionReasonLabel, formatGuidanceExecutionStatusLabel, formatGuidanceKindLabel } from './guidancePresentation';
import { classifyActorKindLabel } from './actorRefPresentation';
import { formatFeedbackStatusLabel, formatGuidanceInputStatusLabel, resolveGuidanceExecutionStatus } from './runtimeStatusPresentation';
import { hasHighRiskPrivateRuntimeText, safeRuntimePrivateText, sanitizeRuntimePrivateItems } from './runtimePrivateTextPrivacy';

export interface MessageRuntimeClueSection {
  key: 'memory' | 'companionship' | 'inner' | 'surface' | 'director' | 'guidance' | 'guidance_execution' | 'world_influence' | 'narrative' | 'feedback' | 'generation_runtime';
  label: string;
  promptLabel: string;
  statusKind: 'prompt_context' | 'debug_explanation' | 'soft_signal' | 'applied_signal';
  statusLabel: string;
  statusHint: string;
  items: string[];
}

function cleanRuntimeText(text: string | undefined | null, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(text || '', members).trim();
}

function compactItems(items: Array<string | undefined | null>, maxItems = 5, members: DisplayTextMember[] = []) {
  return items.map((item) => cleanRuntimeText(item, members)).filter(Boolean).slice(0, maxItems);
}

function pushSection(
  sections: MessageRuntimeClueSection[],
  section: Omit<MessageRuntimeClueSection, 'items'> & { items: Array<string | undefined | null>; maxItems?: number },
  members: DisplayTextMember[] = [],
) {
  const items = compactItems(section.items, section.maxItems, members);
  if (!items.length) return;
  sections.push({
    key: section.key,
    label: section.label,
    promptLabel: section.promptLabel,
    statusKind: section.statusKind,
    statusLabel: section.statusLabel,
    statusHint: section.statusHint,
    items,
  });
}

function formatMemberNames(ids: string[] | undefined, members: DisplayTextMember[] = []) {
  if (!ids?.length) return '';
  return ids.map((id) => members.find((member) => member.id === id)?.name || '成员').join('、');
}

function formatActorKinds(ids: string[] | undefined, members: DisplayTextMember[] = []) {
  if (!ids?.length) return '';
  const knownIds = new Set(members.map((member) => member.id));
  const kinds = Array.from(new Set(ids.map((id) => classifyActorKindLabel(id, { knownIds }))));
  return kinds.join('、');
}

function formatMemoryTargetName(memoryContext: NonNullable<NonNullable<Message['metadata']>['runtimeDecision']>['memoryContext'], members: DisplayTextMember[] = []) {
  if (!memoryContext?.targetActorId && !memoryContext?.targetActorName) return '';
  if (memoryContext.targetActorName) return memoryContext.targetActorName;
  const matched = members.find((member) => member.id === memoryContext.targetActorId);
  return matched?.name || '成员';
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function projectMessageRuntimeClues(message: Pick<Message, 'metadata'> | null | undefined, members: DisplayTextMember[] = []): MessageRuntimeClueSection[] {
  const decision = message?.metadata?.runtimeDecision;
  if (!decision) return [];

  const sections: MessageRuntimeClueSection[] = [];
  const recalled = decision.memoryContext?.recalledArchives || [];
  const sharedSecretGuards = decision.memoryContext?.sharedSecretGuards || [];
  const memoryTargetName = formatMemoryTargetName(decision.memoryContext, members);
  const hasInjectedMemory = Boolean(recalled.length || sharedSecretGuards.length);
  pushSection(sections, {
    key: 'memory',
    label: '记忆',
    promptLabel: '记忆线索',
    statusKind: 'prompt_context',
    statusLabel: hasInjectedMemory ? '本轮注入' : '召回目标',
    statusHint: hasInjectedMemory
      ? '这些旧档已经进入本轮生成上下文，可用于解释角色为什么想起旧事。'
      : '本轮 prompt 已按这个对象检索关系和记忆；如果没有命中旧档，只表示目标解析已生效。',
    items: [
      memoryTargetName ? `召回对象：${memoryTargetName}` : '',
      decision.memoryContext?.targetReason ? `对象依据：${safeRuntimePrivateText(decision.memoryContext.targetReason, '有一条私域召回依据已隐藏原文')}` : '',
      ...recalled.flatMap((item) => [
      item.summary ? `旧档注入：${safeRuntimePrivateText(item.summary, '有一条私域旧档摘要已隐藏原文')}` : '',
      item.recallReason ? `原因：${safeRuntimePrivateText(item.recallReason, '有一条私域召回原因已隐藏原文')}` : '',
      ]),
      ...sharedSecretGuards.map((item) => `秘密边界：${safeRuntimePrivateText(item, '有一条私域秘密边界已隐藏原文')}`),
    ],
    maxItems: 10,
  }, members);
  const companionship = decision.companionshipContext;
  const sharedAnchors = asStringArray(companionship?.sharedAnchors);
  const sharedPhrases = asStringArray(companionship?.sharedPhrases);
  const pendingCareTopics = asStringArray(companionship?.pendingCareTopics);
  const pendingPromises = asStringArray(companionship?.pendingPromises);
  const rememberedUserPlans = asStringArray(companionship?.rememberedUserPlans);
  const boundaries = asStringArray(companionship?.boundaries);
  const boundaryReasons = asStringArray(companionship?.boundaryReasons);
  const diagnostics = asStringArray(companionship?.diagnostics);
  const evidence = asStringArray(companionship?.evidence);
  const attachmentAdaptations = asStringArray(companionship?.attachmentProfile?.adaptations);
  const safeSharedAnchors = sanitizeRuntimePrivateItems(sharedAnchors, '有一条私域共同经历已隐藏原文');
  const safeSharedPhrases = sanitizeRuntimePrivateItems(sharedPhrases, '有一句私域共同话语已隐藏原文');
  const safePendingPromises = sanitizeRuntimePrivateItems(pendingPromises, '有一条私域约定已隐藏原文');
  const safeBoundaries = sanitizeRuntimePrivateItems(boundaries, '有一条私域边界已隐藏原文');
  const safeBoundaryReasons = sanitizeRuntimePrivateItems(boundaryReasons, '有一条私域克制原因已隐藏原文');
  const safeEvidence = sanitizeRuntimePrivateItems(evidence, '有一条私域证据已隐藏原文');
  const intimateConflictSummary = companionship?.intimateConflict?.summary || '';
  const safeIntimateConflictSummary = safeRuntimePrivateText(intimateConflictSummary, '有一条私域冲突摘要已隐藏原文');
  pushSection(sections, {
    key: 'companionship',
    label: '陪伴',
    promptLabel: '陪伴上下文',
    statusKind: 'prompt_context',
    statusLabel: companionship ? `${companionship.phase} · ${companionship.style}` : '无',
    statusHint: '用于解释单聊中角色如何理解与用户的持续关系、称呼、关心事项和边界。',
    items: companionship ? [
      `阶段：${companionship.phase}`,
      `称呼：${companionship.currentAddress}`,
      safeSharedAnchors.length ? `共同锚点：${safeSharedAnchors.join(' / ')}` : '',
      safeSharedPhrases.length ? `共同话语：${safeSharedPhrases.join(' / ')}` : '',
      companionship.intimateConflict ? `亲密冲突：${safeIntimateConflictSummary}（强度 ${companionship.intimateConflict.severity}，修复成熟度 ${companionship.intimateConflict.repairReadiness}）` : '',
      companionship.attachmentProfile ? `依恋适配：${companionship.attachmentProfile.inferredStyle} · 置信 ${companionship.attachmentProfile.confidence}%${attachmentAdaptations.length ? ` · ${attachmentAdaptations.join(' / ')}` : ''}` : '',
      pendingCareTopics.length ? `关心事项：${pendingCareTopics.join(' / ')}` : '',
      safePendingPromises.length ? `未完成约定：${safePendingPromises.join(' / ')}` : '',
      rememberedUserPlans.length ? `记得计划：${rememberedUserPlans.join(' / ')}` : '',
      safeBoundaries.length ? `用户边界：${safeBoundaries.join(' / ')}` : '',
      safeBoundaryReasons.length ? `克制原因：${safeBoundaryReasons.join(' / ')}` : '',
      diagnostics.length ? `运行诊断：${diagnostics.join(' / ')}` : '',
      `画像置信：${companionship.userProfileConfidence}%`,
      safeEvidence.length ? `证据：${safeEvidence.join(' / ')}` : '',
    ] : [],
    maxItems: 12,
  }, members);
  pushSection(sections, {
    key: 'inner',
    label: '内心',
    promptLabel: '内心线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮语气、冲动和余波，不等于公开剧情事实。',
    items: decision.innerLife ? [
      decision.innerLife.tone ? `语气倾向：${formatInnerToneLabel(decision.innerLife.tone)}` : '',
      decision.innerLife.impulse ? `表达冲动：${formatInnerImpulseLabel(decision.innerLife.impulse)}` : '',
      decision.innerLife.reason ? `内在原因：${safeRuntimePrivateText(decision.innerLife.reason, '有一条私域内心原因已隐藏原文')}` : '',
    ] : [],
  }, members);
  pushSection(sections, {
    key: 'surface',
    label: '表达',
    promptLabel: '表达形态',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮为什么采用闲聊、长文、富文本或专业表达。',
    items: decision.responseSurface ? [
      formatResponseSurfaceKindLabel(decision.responseSurface.kind, 'zh', 'clue'),
      formatRoleFitLabel(decision.responseSurface.roleFit, 'zh', 'clue'),
      decision.responseSurface.allowMarkdown ? '允许富文本' : '',
      decision.intentionalRepeat ? '有意复沓/引用' : '',
      ...(decision.responseSurface.basis || []).map((reason) => formatSurfaceBasisLabel(reason)),
    ] : [],
  }, members);
  const generationRuntime = decision.generationRuntime as {
    turnPlan?: { moveClass?: string; targetScope?: string; depth?: string; reason?: string };
    expressionPlan?: { surface?: string; texture?: string; rhythm?: string };
    trace?: {
      policyHits?: string[];
      scenarioChecks?: string[];
      duplicateDecision?: string | null;
      humanAppraisal?: {
        moveBias?: string;
        strength?: string;
        publicSafe?: boolean;
        reasonTags?: string[];
        sourceEventCount?: number;
      } | null;
    };
  } | undefined;
  const humanAppraisal = generationRuntime?.trace?.humanAppraisal;
  const humanAppraisalLabel = humanAppraisal?.moveBias && humanAppraisal.moveBias !== 'none'
    ? [
      humanAppraisal.moveBias,
      humanAppraisal.strength && humanAppraisal.strength !== 'none' ? humanAppraisal.strength : '',
      ...(Array.isArray(humanAppraisal.reasonTags) ? humanAppraisal.reasonTags.slice(0, 3) : []),
      humanAppraisal.sourceEventCount ? `sources:${humanAppraisal.sourceEventCount}` : '',
    ].filter(Boolean).join(' / ')
    : '';
  pushSection(sections, {
    key: 'generation_runtime',
    label: '生成运行时',
    promptLabel: '运行时计划',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释 room kernel、scenario、style 和 validator 如何共同决定这一条消息。',
    items: generationRuntime ? [
      generationRuntime.turnPlan?.moveClass ? `动作：${generationRuntime.turnPlan.moveClass}` : '',
      generationRuntime.turnPlan?.targetScope ? `目标：${generationRuntime.turnPlan.targetScope}` : '',
      generationRuntime.turnPlan?.depth ? `深度：${generationRuntime.turnPlan.depth}` : '',
      generationRuntime.expressionPlan?.surface ? `表面：${generationRuntime.expressionPlan.surface}` : '',
      generationRuntime.expressionPlan?.texture ? `质地：${generationRuntime.expressionPlan.texture}` : '',
      generationRuntime.expressionPlan?.rhythm ? `节奏：${generationRuntime.expressionPlan.rhythm}` : '',
      humanAppraisalLabel ? `人性评估：${humanAppraisalLabel}` : '',
      generationRuntime.trace?.policyHits?.length ? `策略：${generationRuntime.trace.policyHits.join(' / ')}` : '',
      generationRuntime.trace?.scenarioChecks?.length ? `场景：${generationRuntime.trace.scenarioChecks.join(' / ')}` : '',
      generationRuntime.trace?.duplicateDecision ? `校验：${generationRuntime.trace.duplicateDecision}` : '',
    ] : [],
    maxItems: 10,
  }, members);
  pushSection(sections, {
    key: 'director',
    label: '调度',
    promptLabel: '调度线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮调度和推进压力，不是角色公开说出的事实。',
    items: decision.directorIntent ? [
      decision.directorIntent.beatType ? `推进动作：${formatBeatType(decision.directorIntent.beatType as never)}` : '',
      decision.directorIntent.reason ? `原因：${formatKnownReason(decision.directorIntent.reason)}` : '',
    ] : [],
  }, members);
  const guidance = decision.directorIntent?.userGuidance || null;
  pushSection(sections, {
    key: 'guidance',
    label: '用户引导',
    promptLabel: '用户引导',
    statusKind: 'debug_explanation',
    statusLabel: formatGuidanceInputStatusLabel(guidance?.kind),
    statusHint: '用于解释用户输入如何影响本轮发言者、话题焦点和媒体生成。',
    items: guidance ? [
      guidance.kind ? `类型：${formatGuidanceKindLabel(guidance.kind)}` : '',
      guidance.rawText ? `用户要求：${safeRuntimePrivateText(guidance.rawText, '有一条私域用户引导已隐藏原文')}` : '',
      guidance.actorIds?.length ? `执行角色：${formatMemberNames(guidance.actorIds, members)}` : '',
      guidance.actorIds?.length ? `执行身份：${formatActorKinds(guidance.actorIds, members)}` : '',
      guidance.mediaRequest?.subjectActorIds?.length ? `图片对象：${formatMemberNames(guidance.mediaRequest.subjectActorIds, members)}` : '',
      guidance.mediaRequest?.subjectText && !guidance.mediaRequest.subjectActorIds?.length ? `图片对象：${safeRuntimePrivateText(guidance.mediaRequest.subjectText, '有一条私域图片对象已隐藏原文')}` : '',
      guidance.mediaRequest?.actionText ? `图片动作：${safeRuntimePrivateText(guidance.mediaRequest.actionText, '有一条私域图片动作已隐藏原文')}` : '',
    ] : [],
    maxItems: 8,
  }, members);
  const execution = decision.guidanceExecution;
  const guidanceExecutionStatus = resolveGuidanceExecutionStatus(execution);
  pushSection(sections, {
    key: 'guidance_execution',
    label: '引导执行',
    promptLabel: '引导执行',
    statusKind: guidanceExecutionStatus.statusKind,
    statusLabel: guidanceExecutionStatus.statusLabel,
    statusHint: guidanceExecutionStatus.statusHint,
    items: execution ? [
      execution.status ? `状态：${formatGuidanceExecutionStatusLabel(execution.status)}` : '',
      typeof execution.retryCount === 'number' && execution.retryCount > 0 ? `重试：${execution.retryCount} 次` : '',
      execution.rejectedReasons?.length ? `丢弃原因：${execution.rejectedReasons.map(formatGuidanceExecutionReasonLabel).join('、')}` : '',
      execution.finalReason ? `最终校验：${formatGuidanceExecutionReasonLabel(execution.finalReason)}` : '',
      execution.forcedMediaQueued ? '媒体动作：已按显式请求补入图片队列' : '',
    ] : [],
    maxItems: 8,
  }, members);
  const worldInfluence = decision.worldInfluence;
  pushSection(sections, {
    key: 'world_influence',
    label: '世界影响',
    promptLabel: '世界影响规则',
    statusKind: worldInfluence?.activeRuleIds?.length ? 'applied_signal' : 'soft_signal',
    statusLabel: worldInfluence?.activeRuleIds?.length ? '规则命中' : '无命中规则',
    statusHint: worldInfluence?.activeRuleIds?.length
      ? '这些规则来自世界事件投影，会影响本轮发言顺序与侧重点。'
      : '本轮没有命中世界影响规则。',
    items: worldInfluence ? [
      typeof worldInfluence.attentionScore === 'number' ? `关注强度：${Math.round(worldInfluence.attentionScore * 100)}%` : '',
      typeof worldInfluence.attentionRestraint === 'number' ? `克制强度：${Math.round(worldInfluence.attentionRestraint * 100)}%` : '',
      ...(worldInfluence.activeRuleTexts || []).map((text) => `规则：${safeRuntimePrivateText(text, '有一条私域世界规则已隐藏原文')}`),
    ] : [],
    maxItems: 10,
  }, members);
  pushSection(sections, {
    key: 'narrative',
    label: '叙事线',
    promptLabel: '叙事线索',
    statusKind: 'debug_explanation',
    statusLabel: '调试解释',
    statusHint: '用于解释本轮关注了哪些线索，不代表剧情已经确定。',
    items: (decision.narrativeLines || []).map((item) => safeRuntimePrivateText(item.title, '有一条私域叙事线索已隐藏原文')),
  }, members);
  const feedback = decision.expressionFeedback || [];
  const feedbackApplied = feedback.some((item) => item.applied);
  pushSection(sections, {
    key: 'feedback',
    label: '反馈',
    promptLabel: '表达反馈',
    statusKind: feedbackApplied ? 'applied_signal' : 'soft_signal',
    statusLabel: formatFeedbackStatusLabel(feedbackApplied),
    statusHint: feedbackApplied
      ? '这些用户表达反馈已经影响本轮提示词或表达约束。'
      : '这些用户表达反馈只是被检索到，属于软信号，不一定影响本轮。',
    items: feedback.map((item) => safeRuntimePrivateText(item.label || item.text, '有一条私域表达反馈已隐藏原文')),
  }, members);

  return sections;
}

export function formatMessageRuntimeCluesForPrompt(message: Pick<Message, 'metadata'> | null | undefined, members: DisplayTextMember[] = []) {
  return projectMessageRuntimeClues(message, members)
    .map((section) => {
      if (section.key === 'memory') return `${section.promptLabel}：\n${section.items.map((item) => `- ${item}`).join('\n')}`;
      return `${section.promptLabel}：${section.items.join('；')}`;
    })
    .join('\n');
}
