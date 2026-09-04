import type { GroupChat } from '../types/chat';

export interface ResolvedChatAgentCapabilities {
  enabled: boolean; chatArtifactRead: boolean; chatArtifactWrite: boolean; fileUpload: boolean; fileDownload: boolean;
  workspaceRead: boolean; workspaceWrite: boolean; officeTransform: boolean; commandExecution: boolean; systemActions: boolean; webSearch: boolean;
}
const defaults: ResolvedChatAgentCapabilities = { enabled:false, chatArtifactRead:false, chatArtifactWrite:false, fileUpload:false, fileDownload:false, workspaceRead:false, workspaceWrite:false, officeTransform:false, commandExecution:false, systemActions:false, webSearch:false };
export function resolveChatAgentCapabilities(chat: Pick<GroupChat, 'modeState'>): ResolvedChatAgentCapabilities {
  const generic = chat.modeState.agentCapabilities;
  if (generic?.enabled === true) return { ...defaults, ...generic, enabled: true };
  const legacy = chat.modeState.assistantCapabilities;
  if (!legacy?.agent) return defaults;
  return { ...defaults, enabled:true, chatArtifactRead: legacy.artifacts !== false, chatArtifactWrite: legacy.artifacts !== false, workspaceRead:true, webSearch:Boolean(legacy.webSearch) };
}
