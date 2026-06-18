import type { Message, MessageMetadata } from '../types/message';

const MAX_TEXT = {
  contextText: 240,
  reason: 180,
  evidence: 160,
  label: 120,
  listItem: 140,
};

function compactText(value: unknown, max = MAX_TEXT.listItem) {
  if (typeof value !== 'string') return value;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function compactStringArray(value: unknown, maxItems: number, maxChars = MAX_TEXT.listItem) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => compactText(item, maxChars) as string)
    .slice(0, maxItems);
}

function compactRecordArray<T extends Record<string, unknown>>(value: unknown, maxItems: number, mapper: (item: T) => Record<string, unknown>) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is T => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map(mapper)
    .slice(0, maxItems);
}

function omitEmpty<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = {};
  Object.entries(record).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) return;
    next[key] = value;
  });
  return next as T;
}

function compactEvidenceHistory(value: unknown, maxItems: number) {
  return compactRecordArray(value, maxItems, (item) => omitEmpty({
    id: item.id,
    action: item.action,
    kind: item.kind,
    status: item.status,
    anchorId: item.anchorId,
    secretId: item.secretId,
    publicMask: compactText(item.publicMask, MAX_TEXT.reason),
    leakState: item.leakState,
    consequenceKind: item.consequenceKind,
    phase: item.phase,
    style: item.style,
    title: compactText(item.title, MAX_TEXT.label),
    summary: compactText(item.summary, MAX_TEXT.reason),
    text: compactText(item.text, MAX_TEXT.reason),
    reason: compactText(item.reason, MAX_TEXT.reason),
    evidence: compactStringArray(item.evidence, 2, MAX_TEXT.evidence),
    sourceMessageIds: compactStringArray(item.sourceMessageIds, 3, 80),
    confidence: item.confidence,
    occurredAt: item.occurredAt,
  }));
}

function compactCompanionshipContext(context: NonNullable<NonNullable<MessageMetadata['runtimeDecision']>['companionshipContext']>) {
  return omitEmpty({
    style: context.style,
    phase: context.phase,
    currentAddress: compactText(context.currentAddress, 80),
    sharedAnchors: compactStringArray(context.sharedAnchors, 3),
    sharedPhrases: compactStringArray(context.sharedPhrases, 3),
    sharedSecrets: compactStringArray(context.sharedSecrets, 2),
    rituals: compactStringArray(context.rituals, 2),
    intimateConflict: context.intimateConflict ? omitEmpty({
      kind: context.intimateConflict.kind,
      severity: context.intimateConflict.severity,
      repairReadiness: context.intimateConflict.repairReadiness,
      summary: compactText(context.intimateConflict.summary, MAX_TEXT.reason),
    }) : undefined,
    pendingCareTopics: compactStringArray(context.pendingCareTopics, 3),
    pendingPromises: compactStringArray(context.pendingPromises, 3),
    rememberedUserPlans: compactStringArray(context.rememberedUserPlans, 3),
    boundaries: compactStringArray(context.boundaries, 3),
    boundaryReasons: compactStringArray(context.boundaryReasons, 3),
    userProfileCues: compactRecordArray(context.userProfileCues, 4, (item) => omitEmpty({
      kind: item.kind,
      text: compactText(item.text, MAX_TEXT.reason),
      evidence: compactText(item.evidence, MAX_TEXT.evidence),
      confidence: item.confidence,
      sensitive: item.sensitive,
    })),
    addressingHistory: compactEvidenceHistory(context.addressingHistory, 3),
    careTopicHistory: compactEvidenceHistory(context.careTopicHistory, 3),
    promiseHistory: compactEvidenceHistory(context.promiseHistory, 3),
    sharedAnchorHistory: compactEvidenceHistory(context.sharedAnchorHistory, 3),
    sharedSecretHistory: compactEvidenceHistory(context.sharedSecretHistory, 3),
    ritualHistory: compactEvidenceHistory(context.ritualHistory, 3),
    carePolicy: context.carePolicy,
    attachmentProfile: context.attachmentProfile ? omitEmpty({
      inferredStyle: context.attachmentProfile.inferredStyle,
      confidence: context.attachmentProfile.confidence,
      evidence: compactStringArray(context.attachmentProfile.evidence, 2, MAX_TEXT.evidence),
      adaptations: compactStringArray(context.attachmentProfile.adaptations, 3, MAX_TEXT.reason),
    }) : undefined,
    phaseHistory: compactEvidenceHistory(context.phaseHistory, 3),
    userProfileHistory: compactEvidenceHistory(context.userProfileHistory, 3),
    conflictHistory: compactEvidenceHistory(context.conflictHistory, 3),
    attachmentHistory: compactEvidenceHistory(context.attachmentHistory, 3),
    diagnostics: compactStringArray(context.diagnostics, 4, MAX_TEXT.reason),
    evidence: compactStringArray(context.evidence, 3, MAX_TEXT.evidence),
    intimacy: context.intimacy,
    userProfileConfidence: context.userProfileConfidence,
  }) as unknown as NonNullable<MessageMetadata['runtimeDecision']>['companionshipContext'];
}

function compactRuntimeDecision(decision: NonNullable<MessageMetadata['runtimeDecision']>): NonNullable<MessageMetadata['runtimeDecision']> {
  return omitEmpty({
    ...decision,
    directorIntent: decision.directorIntent ? omitEmpty({
      ...decision.directorIntent,
      reason: compactText(decision.directorIntent.reason, MAX_TEXT.reason),
      userGuidance: decision.directorIntent.userGuidance ? omitEmpty({
        ...decision.directorIntent.userGuidance,
        rawText: compactText(decision.directorIntent.userGuidance.rawText, MAX_TEXT.reason),
        focusText: compactText(decision.directorIntent.userGuidance.focusText, MAX_TEXT.reason),
        reason: compactText(decision.directorIntent.userGuidance.reason, MAX_TEXT.reason),
        mediaRequest: decision.directorIntent.userGuidance.mediaRequest ? omitEmpty({
          ...decision.directorIntent.userGuidance.mediaRequest,
          subjectText: compactText(decision.directorIntent.userGuidance.mediaRequest.subjectText, MAX_TEXT.label),
          actionText: compactText(decision.directorIntent.userGuidance.mediaRequest.actionText, MAX_TEXT.label),
        }) : undefined,
      }) : undefined,
    }) : undefined,
    speakerScore: decision.speakerScore ? {
      ...decision.speakerScore,
      reasons: compactStringArray(decision.speakerScore.reasons, 6, MAX_TEXT.reason),
    } : undefined,
    innerLife: decision.innerLife ? {
      ...decision.innerLife,
      reason: compactText(decision.innerLife.reason, MAX_TEXT.reason) as string,
      evidence: compactStringArray(decision.innerLife.evidence, 4, MAX_TEXT.evidence),
    } : undefined,
    memoryContext: decision.memoryContext ? omitEmpty({
      ...decision.memoryContext,
      targetReason: compactText(decision.memoryContext.targetReason, MAX_TEXT.reason),
      recalledArchives: compactRecordArray(decision.memoryContext.recalledArchives, 4, (item) => omitEmpty({
        id: item.id,
        scope: item.scope,
        kind: item.kind,
        layer: item.layer,
        summary: compactText(item.summary, MAX_TEXT.reason),
        recallReason: compactText(item.recallReason, MAX_TEXT.reason),
        recallTokens: compactStringArray(item.recallTokens, 4, 48),
        recallScore: item.recallScore,
      })),
    }) : undefined,
    companionshipContext: decision.companionshipContext ? compactCompanionshipContext(decision.companionshipContext) : undefined,
    expressionFeedback: compactRecordArray(decision.expressionFeedback, 3, (item) => omitEmpty({
      ...item,
      label: compactText(item.label, MAX_TEXT.label),
      text: compactText(item.text, MAX_TEXT.reason),
      evidence: compactText(item.evidence, MAX_TEXT.evidence),
      effects: compactStringArray(item.effects, 3, MAX_TEXT.label),
    })) as NonNullable<MessageMetadata['runtimeDecision']>['expressionFeedback'],
    generationRuntime: decision.generationRuntime ? omitEmpty({
      turnPlan: decision.generationRuntime.turnPlan,
      expressionPlan: decision.generationRuntime.expressionPlan,
      realizationPlan: decision.generationRuntime.realizationPlan,
      trace: decision.generationRuntime.trace ? omitEmpty({
        ...(decision.generationRuntime.trace as Record<string, unknown>),
        policyHits: compactStringArray((decision.generationRuntime.trace as { policyHits?: unknown }).policyHits, 8, MAX_TEXT.label),
        scenarioChecks: compactStringArray((decision.generationRuntime.trace as { scenarioChecks?: unknown }).scenarioChecks, 8, MAX_TEXT.label),
        duplicateDecision: compactText((decision.generationRuntime.trace as { duplicateDecision?: unknown }).duplicateDecision, MAX_TEXT.reason),
      }) : undefined,
    }) : undefined,
  }) as unknown as NonNullable<MessageMetadata['runtimeDecision']>;
}

export function compactMessageMetadata(metadata: MessageMetadata | undefined, options: { dropContextText?: boolean } = {}) {
  if (!metadata) return undefined;
  return omitEmpty({
    ...metadata,
    contextText: options.dropContextText ? undefined : compactText(metadata.contextText, MAX_TEXT.contextText),
    runtimeDecision: metadata.runtimeDecision ? compactRuntimeDecision(metadata.runtimeDecision) : undefined,
  }) as MessageMetadata;
}

export function compactMessage(message: Message, options: { dropContextText?: boolean } = {}) {
  return {
    ...message,
    metadata: compactMessageMetadata(message.metadata, options),
  };
}
