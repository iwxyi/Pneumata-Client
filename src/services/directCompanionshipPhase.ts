import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { CompanionshipPhase, CompanionshipPhaseEventPayload, CompanionshipStyle } from '../types/companionship';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';

function compactPhaseEvidence(text: string, max = 120) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

type PhaseDecisionSource = 'model' | 'local_fallback';
type PhaseDecision = {
  phase: CompanionshipPhase;
  style?: CompanionshipStyle;
  reason: string;
  confidence: number;
  evidence: string[];
  decisionSource: PhaseDecisionSource;
};

const PHASES: CompanionshipPhase[] = ['stranger', 'curious', 'fond', 'ambiguous', 'confessing', 'confirmed', 'passionate', 'deep', 'cooling', 'crisis', 'reconciling'];
const STYLES: CompanionshipStyle[] = ['romantic', 'ambiguous', 'friend', 'family', 'mentor', 'custom'];

function isCompanionshipPhase(value: unknown): value is CompanionshipPhase {
  return typeof value === 'string' && PHASES.includes(value as CompanionshipPhase);
}

function isCompanionshipStyle(value: unknown): value is CompanionshipStyle {
  return typeof value === 'string' && STYLES.includes(value as CompanionshipStyle);
}

function cleanJsonCandidate(raw: string) {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  return object?.[0] || text;
}

function detectCompanionshipPhaseFromUserText(content: string): Omit<PhaseDecision, 'decisionSource' | 'confidence' | 'evidence'> | null {
  const text = content.trim();
  if (!text) return null;
  if (/(分开|结束这段关系|不想继续|冷静一下|先别聊|你让我失望|你刚刚.*不舒服|那句话.*不舒服|我很受伤|别这样)/.test(text)) {
    return { phase: 'crisis', reason: '用户明确表达受伤、失望、暂停或关系危机。' };
  }
  if (/(和好|重新来|重新开始|慢慢说|好好说开|原谅你|给彼此.*台阶|我也有不对|我们别冷战)/.test(text)) {
    return { phase: 'reconciling', reason: '用户表达和好、修复或愿意重新沟通。' };
  }
  if (/(我们.*(在一起|确认关系|算情侣|是情侣|恋人关系|对象关系)|按.*(恋人|情侣|对象).*相处|你是我的(男朋友|女朋友|对象|恋人)|我愿意.*(做你|和你).*(男朋友|女朋友|对象|恋人)|可以.*(在一起|确认关系))/.test(text)) {
    return { phase: 'confirmed', style: 'romantic', reason: '用户明确确认亲密/恋爱关系边界。' };
  }
  if (/(我喜欢你|我爱你|对你心动|想和你在一起|想认真靠近你|有点喜欢你|可能喜欢上你了)/.test(text)) {
    return { phase: 'confessing', style: 'ambiguous', reason: '用户明确表达心意但尚未形成确认关系事件。' };
  }
  return null;
}

function buildLocalFallbackDecision(content: string): PhaseDecision | null {
  const detected = detectCompanionshipPhaseFromUserText(content);
  if (!detected) return null;
  return {
    ...detected,
    confidence: 0.62,
    evidence: [compactPhaseEvidence(content)],
    decisionSource: 'local_fallback',
  };
}

function normalizeModelDecision(raw: unknown, userContent: string): PhaseDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const shouldCreate = value.shouldCreate === true;
  if (!shouldCreate) return null;
  if (!isCompanionshipPhase(value.phase)) return null;
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence > 1 ? value.confidence / 100 : value.confidence))
    : 0;
  if (confidence < 0.7) return null;
  const reason = typeof value.reason === 'string' ? compactPhaseEvidence(value.reason, 140) : '';
  const evidence = Array.isArray(value.evidence)
    ? value.evidence.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => compactPhaseEvidence(item, 120)).slice(0, 3)
    : [];
  return {
    phase: value.phase,
    style: isCompanionshipStyle(value.style) ? value.style : undefined,
    reason: reason || '模型判断用户明确表达了关系阶段变化。',
    confidence,
    evidence: evidence.length ? evidence : [compactPhaseEvidence(userContent)],
    decisionSource: 'model',
  };
}

async function judgeCompanionshipPhaseWithModel(params: {
  config: APIConfig;
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  recentMessages?: Message[];
}): Promise<PhaseDecision | null> {
  const recentTranscript = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-8)
    .map((item) => `${item.senderName || item.senderId}: ${compactPhaseEvidence(item.content, 160)}`)
    .join('\n');
  const systemPrompt = [
    '你是亲密陪伴运行时的关系阶段裁决器。',
    '任务：判断“用户这一条新消息”是否明确产生了用户-角色关系阶段事件。',
    '必须保守：普通玩笑、假设、角色扮演台词、讨论别人关系、泛泛喜欢、日常冷静诉求、普通不舒服，都不要创建事件。',
    '只有用户明确把自己和当前角色的关系推进/降级/修复时才 shouldCreate=true。',
    'confirmed 必须是明确确认恋人/对象/情侣等关系边界；confessing 是明确表白但未确认；passionate 是确认关系后用户明确表达高频陪伴、热恋式靠近或强烈想念；deep 是长期稳定、信任、共同承诺或成熟陪伴被明确说出；cooling 是用户明确降温、疏离、想减少互动但未到危机；crisis 是明确受伤、暂停或关系危机；reconciling 是明确和好或修复。',
    '返回 JSON: {"shouldCreate":boolean,"phase":"confessing|confirmed|passionate|deep|cooling|crisis|reconciling|none","style":"romantic|ambiguous|friend|family|mentor|custom|null","confidence":number,"reason":"...","evidence":["..."]}',
    'confidence 取 0-1。拿不准必须 shouldCreate=false 或 confidence<0.7。',
  ].join('\n');
  const payload = {
    chatName: params.chat.name,
    character: {
      id: params.character.id,
      name: params.character.name,
      background: params.character.background || '',
      speakingStyle: params.character.speakingStyle || '',
    },
    recentTranscript,
    userMessage: params.message.content,
  };
  const raw = await generateJsonResponse(params.config, systemPrompt, [{ role: 'user', content: JSON.stringify(payload) }]);
  const parsed = JSON.parse(cleanJsonCandidate(raw)) as unknown;
  return normalizeModelDecision(parsed, params.message.content);
}

function buildCompanionshipPhaseEvent(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  decision: PhaseDecision;
}): RuntimeEventV2 | null {
  if (params.chat.type !== 'direct') return null;
  const payload: CompanionshipPhaseEventPayload = {
    eventType: 'companionship_phase_event',
    characterId: params.character.id,
    userId: 'user',
    phase: params.decision.phase,
    style: params.decision.style,
    reason: params.decision.reason,
    initiatedBy: 'user',
    evidence: params.decision.evidence,
    confidence: params.decision.confidence,
    decisionSource: params.decision.decisionSource,
  };
  return {
    id: `evt-companionship-phase-${params.message.id}`,
    conversationId: params.chat.id,
    kind: 'phase_transition',
    createdAt: params.message.timestamp || Date.now(),
    actorIds: ['user'],
    targetIds: [params.character.id],
    evidenceMessageIds: [params.message.id],
    summary: params.decision.reason,
    eventClass: 'phase',
    visibility: 'pair_private',
    payload,
  };
}

export function buildCompanionshipPhaseEventFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
}): RuntimeEventV2 | null {
  const decision = buildLocalFallbackDecision(params.message.content);
  if (!decision) return null;
  return buildCompanionshipPhaseEvent({ ...params, decision });
}

export async function resolveCompanionshipPhaseEventFromDirectUserMessage(params: {
  chat: GroupChat;
  character: AICharacter;
  message: Message;
  textApiConfig?: APIConfig | null;
  recentMessages?: Message[];
}): Promise<RuntimeEventV2 | null> {
  if (params.chat.type !== 'direct') return null;
  if (params.textApiConfig) {
    try {
      const decision = await judgeCompanionshipPhaseWithModel({
        config: params.textApiConfig,
        chat: params.chat,
        character: params.character,
        message: params.message,
        recentMessages: params.recentMessages,
      });
      if (decision) return buildCompanionshipPhaseEvent({ ...params, decision });
      return null;
    } catch {
      const fallback = buildLocalFallbackDecision(params.message.content);
      return fallback ? buildCompanionshipPhaseEvent({ ...params, decision: fallback }) : null;
    }
  }
  const fallback = buildLocalFallbackDecision(params.message.content);
  return fallback ? buildCompanionshipPhaseEvent({ ...params, decision: fallback }) : null;
}
