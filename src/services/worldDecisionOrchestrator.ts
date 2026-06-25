import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';

export interface WorldDecisionCandidate<TMeta = Record<string, unknown>> {
  id: string;
  kind: string;
  reasonType?: string;
  localScore: number;
  summary?: string;
  meta?: TMeta;
}

export interface WorldDecisionTraceV2 {
  eventType: 'world_decision_v2';
  domain: 'proactive_care' | 'open_chat' | 'calendar_patch_queue';
  selectedId: string;
  selectedKind: string;
  selectedReasonType?: string;
  decisionSource: 'local' | 'model';
  modelReason?: string;
  confidenceDelta?: number;
  candidateCount: number;
}

async function chooseByModel(params: {
  config: APIConfig;
  domain: WorldDecisionTraceV2['domain'];
  candidates: WorldDecisionCandidate[];
}) {
  const systemPrompt = [
    '你是世界决策编排器中的模型裁决器。',
    '只允许在候选集合内选择，不得发明新选项。',
    '返回 JSON: {"selectedId":"...","confidenceDelta":number,"reason":"..."}',
    'confidenceDelta 范围 -0.06 到 0.06。',
  ].join('\n');
  const content = JSON.stringify({
    domain: params.domain,
    candidates: params.candidates.map((item) => ({
      id: item.id,
      kind: item.kind,
      reasonType: item.reasonType || null,
      localScore: item.localScore,
      summary: item.summary || '',
    })),
  });
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content }], {
    aiUsage: { type: 'world_decision', label: '世界决策', scope: 'world' },
  });
  const parsed = JSON.parse(raw) as { selectedId?: string; confidenceDelta?: number; reason?: string };
  const selectedId = typeof parsed.selectedId === 'string' ? parsed.selectedId : '';
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 180) : '';
  const deltaRaw = typeof parsed.confidenceDelta === 'number' && Number.isFinite(parsed.confidenceDelta) ? parsed.confidenceDelta : 0;
  const confidenceDelta = Math.max(-0.06, Math.min(0.06, deltaRaw));
  return {
    selectedId,
    reason,
    confidenceDelta,
  };
}

export async function orchestrateWorldDecision(params: {
  domain: WorldDecisionTraceV2['domain'];
  candidates: WorldDecisionCandidate[];
  textApiConfig?: APIConfig | null;
}) {
  const sorted = [...params.candidates].sort((a, b) => b.localScore - a.localScore);
  const local = sorted[0] || null;
  if (!local) return null;
  if (!params.textApiConfig || sorted.length < 2) {
    return {
      selected: local,
      confidenceDelta: 0,
      trace: {
        eventType: 'world_decision_v2' as const,
        domain: params.domain,
        selectedId: local.id,
        selectedKind: local.kind,
        selectedReasonType: local.reasonType,
        decisionSource: 'local' as const,
        candidateCount: sorted.length,
      },
    };
  }
  try {
    const modelPick = await chooseByModel({
      config: params.textApiConfig,
      domain: params.domain,
      candidates: sorted,
    });
    const selected = sorted.find((item) => item.id === modelPick.selectedId) || local;
    const modelUsed = selected.id === modelPick.selectedId;
    return {
      selected,
      confidenceDelta: modelUsed ? modelPick.confidenceDelta : 0,
      trace: {
        eventType: 'world_decision_v2' as const,
        domain: params.domain,
        selectedId: selected.id,
        selectedKind: selected.kind,
        selectedReasonType: selected.reasonType,
        decisionSource: modelUsed ? 'model' as const : 'local' as const,
        modelReason: modelUsed ? modelPick.reason : undefined,
        confidenceDelta: modelUsed ? modelPick.confidenceDelta : undefined,
        candidateCount: sorted.length,
      },
    };
  } catch {
    return {
      selected: local,
      confidenceDelta: 0,
      trace: {
        eventType: 'world_decision_v2' as const,
        domain: params.domain,
        selectedId: local.id,
        selectedKind: local.kind,
        selectedReasonType: local.reasonType,
        decisionSource: 'local' as const,
        candidateCount: sorted.length,
      },
    };
  }
}
