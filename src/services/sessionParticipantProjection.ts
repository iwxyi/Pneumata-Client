import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { createDefaultConversationParticipants } from '../types/sessionEngine';
import { formatSystemAgentSubtypeLabel } from './actorRefPresentation';

export interface SessionParticipantBadge {
  id: string;
  label: string;
  capabilityLabels: string[];
  capabilities?: string[];
}

export interface SessionParticipantTopologyProjection {
  memberBadges: SessionParticipantBadge[];
  operatorBadges: SessionParticipantBadge[];
}

function formatCapabilityLabel(capability: string, isZh: boolean) {
  if (capability === 'speak') return isZh ? '发言' : 'Speak';
  if (capability === 'guide') return isZh ? '引导' : 'Guide';
  if (capability === 'moderate') return isZh ? '主持' : 'Moderate';
  if (capability === 'judge') return isZh ? '裁决' : 'Judge';
  if (capability === 'observe') return isZh ? '旁观' : 'Observe';
  return capability;
}

export function projectNonAiParticipantBadges(chat: GroupChat, members: AICharacter[], isZh = true): SessionParticipantBadge[] {
  const aiIds = new Set(members.map((item) => item.id));
  return createDefaultConversationParticipants(chat)
    .filter((participant) => !aiIds.has(participant.entityRefId) && participant.entityType !== 'ai')
    .map((participant) => {
      const capabilityLabels = String(participant.flags.actorCapabilities || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => formatCapabilityLabel(item, isZh));
      if (participant.entityType === 'user') {
        return {
          id: participant.entityRefId,
          label: isZh ? '用户' : 'User',
          capabilityLabels,
          capabilities: String(participant.flags.actorCapabilities || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        };
      }
      const subtype = typeof participant.flags.systemAgentSubtype === 'string' ? participant.flags.systemAgentSubtype : '';
      return {
        id: participant.entityRefId,
        label: subtype ? formatSystemAgentSubtypeLabel(subtype as never) : (isZh ? '系统' : 'System'),
        capabilityLabels,
        capabilities: String(participant.flags.actorCapabilities || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
    });
}

function isOperatorBadge(badge: SessionParticipantBadge) {
  return (badge.capabilities || []).some((capability) => capability === 'guide' || capability === 'moderate' || capability === 'judge');
}

export function projectSessionParticipantTopology(chat: GroupChat, members: AICharacter[], isZh = true): SessionParticipantTopologyProjection {
  const badges = projectNonAiParticipantBadges(chat, members, isZh);
  return {
    memberBadges: badges.filter((badge) => !isOperatorBadge(badge)),
    operatorBadges: badges.filter(isOperatorBadge),
  };
}
