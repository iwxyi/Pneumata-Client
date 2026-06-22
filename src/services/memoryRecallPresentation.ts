import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { retrieveRelevantMemories } from './memoryRetrieval';
import { parseRuntimeEvent } from './runtimeEventFactory';
import { safeRuntimePrivateText } from './runtimePrivateTextPrivacy';

function cleanText(text: string | undefined | null, members: DisplayTextMember[] = [], fallback = '有一条私域记忆线索已隐藏原文') {
  return sanitizeUserFacingText(safeRuntimePrivateText(text, fallback), members).trim();
}

function memberName(id: string, members: AICharacter[]) {
  return members.find((item) => item.id === id)?.name || '成员';
}

function buildRecallCue(messages: Message[], members: AICharacter[]) {
  const memberNames = members.map((member) => member.name).join('、');
  const recentText = messages
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-6)
    .map((message) => `${message.senderName || memberName(message.senderId, members)}：${message.content}`)
    .join('\n');
  return [memberNames, recentText].filter(Boolean).join('\n').slice(-1000);
}

function latestCharacterTargetId(messages: Message[], member: AICharacter, members: AICharacter[]) {
  const memberIds = new Set(members.map((item) => item.id));
  return messages
    .filter((message) => !message.isDeleted && message.senderId !== member.id && memberIds.has(message.senderId))
    .slice()
    .reverse()[0]?.senderId || null;
}

function buildTooltip(lines: Array<string | undefined | null>) {
  return lines.filter((item): item is string => Boolean(item?.trim())).join('\n');
}

export interface ProjectedMemoryRecallItem {
  key: string;
  memberName: string;
  status: 'actual' | 'candidate';
  statusLabel: string;
  secondaryLabel?: string;
  summary: string;
  caption: string;
  tokens: string[];
  tooltip: string;
}

export interface ProjectedMemoryReactivationItem {
  key: string;
  memberName: string;
  summary: string;
  matchedTokens: string[];
  reason?: string;
  createdAt?: number;
  tooltip: string;
}

function projectActualMemoryRecallItems(members: AICharacter[], messages: Message[]) {
  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const seen = new Set<string>();
  return messages
    .filter((message) => !message.isDeleted && message.type === 'ai')
    .slice(-8)
    .flatMap((message) => {
      const member = memberById.get(message.senderId);
      const recalled = message.metadata?.runtimeDecision?.memoryContext?.recalledArchives || [];
      if (!member || !recalled.length) return [];
      return recalled.map((item) => {
        const key = `${message.id}:${item.id}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const tokens = (item.recallTokens || []).map((token) => cleanText(token, members)).filter(Boolean).slice(0, 3);
        const summary = cleanText(item.summary, members);
        const reason = cleanText(item.recallReason, members);
        return {
          key,
          memberName: member.name,
          status: 'actual' as const,
          statusLabel: '本轮注入',
          summary,
          caption: reason || '旧档已进入本轮生成上下文',
          tokens,
          tooltip: buildTooltip([
            '本轮生成 prompt 已注入这条旧档。',
            reason,
            typeof item.recallScore === 'number' ? `召回强度 ${item.recallScore.toFixed(2)}` : '',
          ]),
        };
      }).filter(Boolean) as ProjectedMemoryRecallItem[];
    })
    .slice(-8)
    .reverse();
}

function projectCandidateMemoryRecallItems(chat: GroupChat, members: AICharacter[], messages: Message[]) {
  const cueText = buildRecallCue(messages, members);
  if (!cueText.trim()) return [];
  return members.flatMap((member) => {
    const recalled = retrieveRelevantMemories(member.layeredMemories || [], {
      speakerId: member.id,
      targetId: latestCharacterTargetId(messages, member, members),
      conversationId: chat.id,
      maxItems: 4,
      cueText,
      includeArchivedRecall: true,
      maxArchivedItems: 2,
      preferredLayers: ['long_term', 'episodic', 'working'],
      preferredScopes: ['relationship', 'character_self', 'conversation', 'thread', 'system_runtime'],
    }).filter((item) => item.archivedAt && item.recallReason);
    return recalled.slice(0, 2).map((item): ProjectedMemoryRecallItem => {
      const reason = cleanText(item.recallReason, members);
      const cue = item.recallCue ? `线索：${cleanText(item.recallCue, members)}` : '';
      const evidence = item.evidenceText ? `证据：${cleanText(item.evidenceText, members)}` : '';
      return {
        key: `${member.id}:candidate:${item.id}`,
        memberName: member.name,
        status: 'candidate',
        statusLabel: '候选线索',
        secondaryLabel: '未注入',
        summary: cleanText(item.summary || item.text, members),
        caption: '仅当前线索命中旧档，尚未进入本轮 prompt',
        tokens: (item.recallTokens || []).map((token) => cleanText(token, members)).filter(Boolean).slice(0, 3),
        tooltip: buildTooltip([
          '候选命中：这条旧档只是被当前上下文线索匹配到，尚未进入本轮 prompt，也不会自动强化。',
          reason,
          cue,
          evidence,
          typeof item.recallScore === 'number' ? `召回强度 ${item.recallScore.toFixed(2)}` : '',
        ]),
      };
    });
  }).slice(0, 8);
}

export function projectMemoryRecallItems(chat: GroupChat, members: AICharacter[], messages: Message[]) {
  const actual = projectActualMemoryRecallItems(members, messages);
  return actual.length ? actual : projectCandidateMemoryRecallItems(chat, members, messages);
}

function readReactivationMetrics(metrics: unknown) {
  if (!metrics || typeof metrics !== 'object') return null;
  const record = metrics as Record<string, unknown>;
  const recalledMemories = Array.isArray(record.recalledMemories)
    ? record.recalledMemories.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    : [];
  return {
    characterId: typeof record.characterId === 'string' ? record.characterId : '',
    characterName: typeof record.characterName === 'string' ? record.characterName : '',
    matchedTokens: Array.isArray(record.matchedTokens)
      ? record.matchedTokens.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 6)
      : [],
    recalledMemories,
  };
}

export function projectMemoryReactivationItems(members: AICharacter[], messages: Message[]): ProjectedMemoryReactivationItem[] {
  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const eventItems = messages
    .filter((message) => !message.isDeleted && message.type === 'event')
    .flatMap((message): ProjectedMemoryReactivationItem[] => {
      const event = parseRuntimeEvent(message.content);
      if (event?.eventType !== 'memory_reactivation') return [];
      const metrics = readReactivationMetrics(event.metrics);
      if (!metrics) return [];
      const memories = metrics.recalledMemories
        .map((item) => ({
          summary: typeof item.summary === 'string' ? cleanText(item.summary, members) : '',
          reason: typeof item.recallReason === 'string' ? cleanText(item.recallReason, members) : '',
          matchedTokens: Array.isArray(item.matchedTokens)
            ? item.matchedTokens
              .filter((token): token is string => typeof token === 'string' && Boolean(token.trim()))
              .map((token) => cleanText(token, members))
              .filter(Boolean)
              .slice(0, 4)
            : [],
        }))
        .filter((item) => item.summary);
      const memberLabel = memberById.get(metrics.characterId)?.name || cleanText(metrics.characterName, members) || '某成员';
      const summary = memories.slice(0, 2).map((item) => item.summary).join(' / ') || cleanText(event.summary, members);
      const reason = memories.find((item) => item.reason)?.reason;
      const matchedTokens = metrics.matchedTokens.length
        ? metrics.matchedTokens.map((token) => cleanText(token, members)).filter(Boolean)
        : Array.from(new Set(memories.flatMap((item) => item.matchedTokens))).slice(0, 6);
      return [{
        key: `${message.id}-${metrics.characterId || memberLabel}`,
        memberName: memberLabel,
        summary,
        reason,
        matchedTokens,
        createdAt: event.createdAt || message.timestamp,
        tooltip: buildTooltip([
          event.createdAt || message.timestamp ? new Date(event.createdAt || message.timestamp).toLocaleString() : '',
          reason,
          summary,
        ]),
      }];
    })
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, 6);
  if (eventItems.length) return eventItems;

  return members
    .flatMap((member) => (member.runtimeTimeline || [])
      .filter((item) => item.type === 'memory' && /旧记忆.*重新唤醒|重新激活|回温/.test(item.text))
      .map((item) => {
        const summary = cleanText(item.text, members);
        return {
          key: `${member.id}-${item.createdAt}-${item.text}`,
          memberName: member.name,
          summary,
          matchedTokens: [],
          createdAt: item.createdAt,
          tooltip: buildTooltip([item.createdAt ? new Date(item.createdAt).toLocaleString() : '', summary]),
        };
      }))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, 6);
}
