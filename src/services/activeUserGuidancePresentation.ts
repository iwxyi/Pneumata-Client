import { getCharacterModelProfileId, type AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { getPreferredAIProfile, type AIModelProfile } from '../types/settings';
import { projectRuntimePressure } from './runtimeDecision';
import { formatBeatType } from './runtimeInsightPresentation';

export interface ActiveUserGuidanceProjection {
  title: string;
  rawText: string;
  effectText: string;
  statusLabel: string;
  statusHint: string;
  sourceLabel: string;
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
      ? { label: '图片模型可用', warning: '' }
      : { label: '未配置图片模型', warning: '当前没有可用图片模型，角色只能文字回应，不能真正生成图片。' };
  }
  const actors = actorIds.map((id) => members.find((member) => member.id === id)).filter(Boolean) as AICharacter[];
  const capableNames = actors.filter((actor) => resolveImageProfile(actor, aiProfiles)).map((actor) => actor.name);
  if (actors.length && capableNames.length === actors.length) return { label: '图片能力可用', warning: '' };
  if (capableNames.length) return { label: `部分可用：${capableNames.join('、')}`, warning: '只有部分被点名角色具备图片模型，其他角色会按文本能力回应。' };
  return { label: '未配置图片模型', warning: '被点名角色没有可用图片模型，无法真正生成图片。' };
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
  return `旧话题已被覆盖，接下来会按“${clipText(params.focusText)}”重新选择发言者。`;
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
  const imageCapability = guidance.kind === 'media_request'
    ? buildImageCapabilityLabel(guidance.actorIds, params.members, params.aiProfiles)
    : null;

  const chips = [
    formatGuidanceKind(guidance.kind),
    guidance.kind === 'topic_shift' ? '旧话题已覆盖' : '',
    guidance.kind === 'topic_shift' ? '按新话题调度' : '',
    guidance.actorIds.length && activeTargetNames ? '锁定待回应' : '',
    guidance.actorIds.length ? '非目标不抢占' : '',
    activeTargetNames ? `待回应：${activeTargetNames}` : '',
    actorNames ? `执行：${actorNames}` : '',
    completedActorNames ? `已回应：${completedActorNames}` : '',
    subjectNames ? `图片对象：${subjectNames}` : '',
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

  return {
    title,
    rawText: guidance.rawText,
    effectText,
    sourceLabel: latestHumanGuidanceSource(params.messages, guidance.rawText),
    statusLabel: guidance.kind === 'media_request' ? '显式请求' : '生效中',
    statusHint: '这条引导优先于叙事线、矛盾线、关系压力和最近接梗；点名执行者时，调度会先锁定尚未回应的目标角色。',
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
