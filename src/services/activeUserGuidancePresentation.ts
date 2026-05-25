import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getPreferredAIProfile, type AIModelProfile } from '../types/settings';
import { projectRuntimePressure } from './runtimeDecision';
import { formatBeatType } from './runtimeInsightPresentation';
import { getGuidanceMemoryTargetActorIds } from './userGuidanceIntent';

export interface ActiveUserGuidanceProjection {
  title: string;
  rawText: string;
  effectText: string;
  statusLabel: string;
  statusHint: string;
  sourceLabel: string;
  emphasisLabel: string;
  detailRows: Array<{
    label: string;
    value: string;
    tone?: 'primary' | 'success' | 'warning' | 'neutral';
  }>;
  chips: string[];
  debugChips: string[];
  warning?: string;
}

function formatMemberNames(ids: string[] | undefined, members: AICharacter[]) {
  if (!ids?.length) return '';
  return ids.map((id) => members.find((member) => member.id === id)?.name || '成员').join('、');
}

function formatGuidanceKind(kind: string | undefined) {
  const labels: Record<string, string> = {
    topic_shift: '话题引导',
    direct_reply: '点名回应',
    media_request: '图片请求',
  };
  return kind ? labels[kind] || kind : '用户引导';
}

function resolveImageProfile(character: AICharacter | undefined, aiProfiles: AIModelProfile[]) {
  if (!character) return null;
  const profileId = getCharacterModelProfileId(character, 'image');
  const profile = profileId
    ? aiProfiles.find((item) => item.id === profileId && item.type === 'image')
    : getPreferredAIProfile(aiProfiles, 'image');
  return profile?.apiKey && profile.model ? profile : null;
}

function buildImageCapabilityLabel(actorIds: string[], members: AICharacter[], aiProfiles: AIModelProfile[]) {
  if (!actorIds.length) {
    const preferred = getPreferredAIProfile(aiProfiles, 'image');
    return preferred?.apiKey && preferred.model
      ? { label: '图片模型可用', warning: '', tone: 'success' as const }
      : { label: '未配置图片模型', warning: '当前没有可用图片模型，角色只能文字回应，不能真正生成图片。', tone: 'warning' as const };
  }
  const actors = actorIds.map((id) => members.find((member) => member.id === id)).filter(Boolean) as AICharacter[];
  const capableNames = actors.filter((actor) => resolveImageProfile(actor, aiProfiles)).map((actor) => actor.name);
  if (actors.length && capableNames.length === actors.length) return { label: '图片能力可用', warning: '', tone: 'success' as const };
  if (capableNames.length) return { label: `部分可用：${capableNames.join('、')}`, warning: '只有部分被点名角色具备图片模型，其他角色会按文本能力回应。', tone: 'warning' as const };
  return { label: '未配置图片模型', warning: '被点名角色没有可用图片模型，无法真正生成图片。', tone: 'warning' as const };
}

function latestHumanGuidanceSource(messages: Message[], rawText: string) {
  const latest = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .slice()
    .reverse()
    .find((message) => message.content.trim() === rawText.trim());
  if (!latest) return '用户引导';
  return latest.type === 'god' ? '开发者引导' : '用户引导';
}

function clipText(text: string, max = 28) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function buildGuidanceEffectText(params: {
  guidanceKind: string;
  focusText: string;
  activeTargetNames: string;
  completedActorNames: string;
  subjectNames: string;
}) {
  if (params.guidanceKind === 'media_request') {
    if (params.activeTargetNames) {
      const subject = params.subjectNames ? `，图片对象是${params.subjectNames}` : '';
      return `${params.activeTargetNames}需要先完成这次图片请求${subject}；非目标角色不会抢占这次请求。`;
    }
    if (params.completedActorNames) return `${params.completedActorNames}已经回应过这次图片请求，之后会恢复普通聊天。`;
    return '这是一条图片请求，调度会优先让相关角色接住，而不是继续旧话题。';
  }
  if (params.guidanceKind === 'direct_reply') {
    if (params.activeTargetNames) return `${params.activeTargetNames}需要先回应这次点名；其他角色会在这之后再接话。`;
    if (params.completedActorNames) return `${params.completedActorNames}已经回应过这次点名，之后会恢复普通聊天。`;
    return '这是一条点名回应，引导会先压过旧梗和关系压力。';
  }
  return `旧话题已被覆盖，下一轮需要先围绕“${clipText(params.focusText)}”回答、表态或追问；旧梗只能顺手收束，不能继续带跑。`;
}

function buildGuidanceEmphasis(params: {
  kind: string;
  activeTargetNames: string;
  subjectNames: string;
  focusText: string;
}) {
  if (params.kind === 'media_request') {
    if (params.activeTargetNames && params.subjectNames) return `等待 ${params.activeTargetNames} 发出 ${params.subjectNames} 的图片`;
    if (params.activeTargetNames) return `等待 ${params.activeTargetNames} 完成图片请求`;
    return '图片请求正在生效';
  }
  if (params.kind === 'direct_reply') {
    if (params.activeTargetNames) return `等待 ${params.activeTargetNames} 回应点名`;
    return '点名回应正在生效';
  }
  return `当前焦点：${clipText(params.focusText, 36)}`;
}

function buildGuidanceDetailRows(params: {
  guidanceKind: string;
  focusText: string;
  activeTargetNames: string;
  actorNames: string;
  completedActorNames: string;
  subjectNames: string;
  memoryTargetNames: string;
  imageCapability?: ReturnType<typeof buildImageCapabilityLabel> | null;
}) {
  if (params.guidanceKind === 'media_request') {
    return [
      params.activeTargetNames ? { label: '锁定角色', value: params.activeTargetNames, tone: 'primary' as const } : null,
      params.subjectNames ? { label: '图片对象', value: params.subjectNames, tone: 'neutral' as const } : null,
      params.memoryTargetNames && params.memoryTargetNames !== params.subjectNames ? { label: '记忆对象', value: params.memoryTargetNames, tone: 'neutral' as const } : null,
      params.imageCapability ? { label: '图片能力', value: params.imageCapability.label, tone: params.imageCapability.tone } : null,
      params.completedActorNames ? { label: '已完成', value: params.completedActorNames, tone: 'success' as const } : null,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
  if (params.guidanceKind === 'direct_reply') {
    return [
      params.activeTargetNames ? { label: '锁定角色', value: params.activeTargetNames, tone: 'primary' as const } : null,
      params.memoryTargetNames ? { label: '记忆对象', value: params.memoryTargetNames, tone: 'neutral' as const } : null,
      params.actorNames && !params.activeTargetNames ? { label: '点名角色', value: params.actorNames, tone: 'neutral' as const } : null,
      params.completedActorNames ? { label: '已回应', value: params.completedActorNames, tone: 'success' as const } : null,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
  return [
    { label: '当前焦点', value: clipText(params.focusText, 48), tone: 'primary' as const },
    params.memoryTargetNames ? { label: '记忆对象', value: params.memoryTargetNames, tone: 'neutral' as const } : null,
    { label: '调度要求', value: '先回应新问题，旧梗只作收束', tone: 'neutral' as const },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function projectActiveUserGuidance(params: {
  chat: GroupChat;
  members: AICharacter[];
  messages: Message[];
  aiProfiles: AIModelProfile[];
  now?: number;
}): ActiveUserGuidanceProjection | null {
  const projection = projectRuntimePressure({
    chat: params.chat,
    characters: params.members,
    messages: params.messages,
    now: params.now,
  });
  const intent = projection.directorIntent;
  const guidance = intent?.userGuidance || null;
  if (!intent || intent.source !== 'user_message' || !guidance) return null;

  const actorNames = formatMemberNames(guidance.actorIds, params.members);
  const activeTargetNames = formatMemberNames(intent.targetActorIds, params.members);
  const completedActorIds = guidance.actorIds.filter((id) => !intent.targetActorIds.includes(id));
  const completedActorNames = formatMemberNames(completedActorIds, params.members);
  const subjectNames = guidance.mediaRequest?.subjectActorIds?.length
    ? formatMemberNames(guidance.mediaRequest.subjectActorIds, params.members)
    : guidance.mediaRequest?.subjectText || '';
  const memoryTargetIds = getGuidanceMemoryTargetActorIds(guidance, params.members)
    .filter((id) => !guidance.actorIds.includes(id) || Boolean(guidance.mediaRequest?.subjectActorIds?.includes(id)));
  const memoryTargetNames = formatMemberNames(memoryTargetIds, params.members);
  const shouldShowMemoryTarget = Boolean(memoryTargetNames && memoryTargetNames !== subjectNames);
  const imageCapability = guidance.kind === 'media_request'
    ? buildImageCapabilityLabel(guidance.actorIds, params.members, params.aiProfiles)
    : null;

  const chips = [
    formatGuidanceKind(guidance.kind),
    guidance.kind === 'topic_shift' ? '旧话题已覆盖' : '',
    guidance.kind === 'topic_shift' ? '先回答新问题' : '',
    guidance.kind === 'topic_shift' ? '旧梗收束' : '',
    guidance.actorIds.length && activeTargetNames ? '锁定待回应' : '',
    guidance.actorIds.length ? '非目标不抢占' : '',
    activeTargetNames ? `待回应：${activeTargetNames}` : '',
    actorNames ? `执行：${actorNames}` : '',
    completedActorNames ? `已回应：${completedActorNames}` : '',
    subjectNames ? `图片对象：${subjectNames}` : '',
    shouldShowMemoryTarget ? `记忆对象：${memoryTargetNames}` : '',
    imageCapability?.label || '',
  ].filter(Boolean);

  const title = guidance.kind === 'media_request'
    ? subjectNames ? `图片请求：${subjectNames}` : '图片请求'
    : guidance.kind === 'direct_reply'
      ? actorNames ? `点名回应：${actorNames}` : '点名回应'
      : `话题切换：${clipText(guidance.focusText || guidance.rawText, 18)}`;
  const effectText = buildGuidanceEffectText({
    guidanceKind: guidance.kind,
    focusText: guidance.focusText || guidance.rawText,
    activeTargetNames,
    completedActorNames,
    subjectNames,
  });
  const focusText = guidance.focusText || guidance.rawText;

  return {
    title,
    rawText: guidance.rawText,
    effectText,
    sourceLabel: latestHumanGuidanceSource(params.messages, guidance.rawText),
    statusLabel: guidance.kind === 'media_request' ? '显式请求' : '生效中',
    statusHint: '这条引导优先于叙事线、矛盾线、关系压力和最近接梗；点名执行者时，调度会先锁定尚未回应的目标角色。',
    emphasisLabel: buildGuidanceEmphasis({
      kind: guidance.kind,
      activeTargetNames,
      subjectNames,
      focusText,
    }),
    detailRows: buildGuidanceDetailRows({
      guidanceKind: guidance.kind,
      focusText,
      activeTargetNames,
      actorNames,
      completedActorNames,
      subjectNames,
      memoryTargetNames: shouldShowMemoryTarget ? memoryTargetNames : '',
      imageCapability,
    }),
    chips,
    debugChips: [
      `动作 ${formatBeatType(guidance.beatType as never)}`,
      `压力 ${(guidance.pressure * 100).toFixed(0)}%`,
      `持续 ${guidance.maxTurns} 轮`,
      `source ${intent.source}`,
      `kind ${guidance.kind}`,
    ],
    warning: imageCapability?.warning || undefined,
  };
}
