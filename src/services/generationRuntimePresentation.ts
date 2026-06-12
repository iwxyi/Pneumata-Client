import type { Message } from '../types/message';

export interface GenerationRuntimeDebugRow {
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'warning';
}

export function buildGenerationRuntimeDebugRows(message: Message): GenerationRuntimeDebugRow[] {
  const runtime = message.metadata?.runtimeDecision?.generationRuntime as {
    turnPlan?: { moveClass?: string; targetScope?: string; depth?: string; reason?: string };
    expressionPlan?: { surface?: string; texture?: string; rhythm?: string };
    trace?: { policyHits?: string[]; scenarioChecks?: string[]; duplicateDecision?: string | null };
  } | undefined;
  if (!runtime) return [];
  const rows: GenerationRuntimeDebugRow[] = [];
  if (runtime.turnPlan?.moveClass) rows.push({ label: 'Move', value: runtime.turnPlan.moveClass, tone: 'primary' });
  if (runtime.turnPlan?.targetScope) rows.push({ label: 'Target', value: runtime.turnPlan.targetScope });
  if (runtime.turnPlan?.depth) rows.push({ label: 'Depth', value: runtime.turnPlan.depth });
  if (runtime.expressionPlan?.surface) rows.push({ label: 'Surface', value: runtime.expressionPlan.surface });
  if (runtime.expressionPlan?.rhythm) rows.push({ label: 'Rhythm', value: runtime.expressionPlan.rhythm });
  if (runtime.trace?.policyHits?.length) rows.push({ label: 'Policies', value: runtime.trace.policyHits.join(' / ') });
  if (runtime.trace?.scenarioChecks?.length) rows.push({ label: 'Scenario', value: runtime.trace.scenarioChecks.join(' / ') });
  if (runtime.trace?.duplicateDecision) rows.push({ label: 'Validator', value: runtime.trace.duplicateDecision, tone: 'warning' });
  return rows;
}
