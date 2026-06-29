import type { GroupChat, MessageBranchState } from '../types/chat';
import type { Message, MessageMetadata } from '../types/message';
import { logDeveloperDiagnostic, measureDeveloperDiagnostic } from './developerDiagnostics';

export interface ResolvedBranchingNode {
  message: Message;
  nodeId: string;
  parentNodeId: string | null;
  revisionRootId: string;
  revisionOfMessageId: string | null;
}

export interface MessageBranchVersionInfo {
  rootId: string;
  index: number;
  total: number;
  isActive: boolean;
  activeNodeId: string;
  nodeIds: string[];
}

const DISABLED_SCENARIO_IDS = new Set([
  'story-reader',
  'werewolf-classic',
  'murder-mystery',
  'board-game',
]);

const DISABLED_MODES = new Set([
  'scripted_play',
  'werewolf',
  'murder_mystery',
  'board_game',
]);

type BranchableChat = Pick<GroupChat, 'sessionKind' | 'messageBranchState'> & Partial<Pick<GroupChat, 'mode'>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDeletedMessage(message: Message) {
  return Boolean(message.isDeleted);
}

function compareMessageOrder(left: Message, right: Message) {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  return left.id.localeCompare(right.id);
}

function normalizeBranchState(state: MessageBranchState | null | undefined): MessageBranchState {
  return {
    enabled: state?.enabled,
    activeLeafNodeId: state?.activeLeafNodeId ?? null,
    activeChildByParentNodeId: state?.activeChildByParentNodeId || {},
    selectedRevisionByRootId: state?.selectedRevisionByRootId || {},
    updatedAt: state?.updatedAt,
  };
}

export function isMessageBranchingEnabled(chat: BranchableChat | null | undefined) {
  if (!chat) return false;
  if (chat.messageBranchState?.enabled === false) return false;
  const scenarioId = chat.sessionKind?.scenarioId;
  if (!scenarioId) return false;
  if (DISABLED_SCENARIO_IDS.has(scenarioId)) return false;
  if (chat.mode && DISABLED_MODES.has(chat.mode)) return false;
  return true;
}

function getBranchingMetadata(message: Message): NonNullable<MessageMetadata['branching']> | null {
  const branching = message.metadata?.branching;
  return isRecord(branching) ? branching as NonNullable<MessageMetadata['branching']> : null;
}

function resolveBranchingNode(message: Message, parentNodeId: string | null): ResolvedBranchingNode {
  const branching = getBranchingMetadata(message);
  return {
    message,
    nodeId: typeof branching?.nodeId === 'string' && branching.nodeId.trim() ? branching.nodeId.trim() : message.id,
    parentNodeId: branching && Object.prototype.hasOwnProperty.call(branching, 'parentNodeId')
      ? (typeof branching.parentNodeId === 'string' && branching.parentNodeId.trim() ? branching.parentNodeId.trim() : null)
      : parentNodeId,
    revisionRootId: typeof branching?.revisionRootId === 'string' && branching.revisionRootId.trim()
      ? branching.revisionRootId.trim()
      : message.id,
    revisionOfMessageId: typeof branching?.revisionOfMessageId === 'string' && branching.revisionOfMessageId.trim()
      ? branching.revisionOfMessageId.trim()
      : null,
  };
}

export function resolveMessageBranchNodes(messages: Message[]) {
  const visibleMessages = messages
    .filter((message) => !isDeletedMessage(message))
    .slice()
    .sort(compareMessageOrder);
  const rawNodes: ResolvedBranchingNode[] = [];
  let previousNodeId: string | null = null;
  for (const message of visibleMessages) {
    const branching = getBranchingMetadata(message);
    const explicitParent = branching && Object.prototype.hasOwnProperty.call(branching, 'parentNodeId');
    const node = resolveBranchingNode(message, previousNodeId);
    rawNodes.push({
      ...node,
      parentNodeId: explicitParent ? node.parentNodeId : previousNodeId,
    });
    previousNodeId = node.nodeId;
  }
  const availableNodeIds = new Set(rawNodes.map((node) => node.nodeId));
  return rawNodes.map((node, index) => {
    if (!node.parentNodeId || availableNodeIds.has(node.parentNodeId)) return node;
    return {
      ...node,
      parentNodeId: rawNodes[index - 1]?.nodeId || null,
    };
  });
}

function buildChildrenByParent(nodes: ResolvedBranchingNode[]) {
  const map = new Map<string, ResolvedBranchingNode[]>();
  for (const node of nodes) {
    const key = node.parentNodeId || '';
    const list = map.get(key) || [];
    list.push(node);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => compareMessageOrder(left.message, right.message));
  }
  return map;
}

function logBranchProjectionDebug(payload: Record<string, unknown>) {
  logDeveloperDiagnostic('message-branch:project', payload, 'info', 'message-window');
}

function resolveSiblingGroupRootId(children: ResolvedBranchingNode[]) {
  const explicitRoot = children.find((child) => child.revisionRootId)?.revisionRootId;
  return explicitRoot || children[0]?.message.id || '';
}

function resolveSelectedChildId(
  chat: BranchableChat | null | undefined,
  parentNodeId: string | null,
  siblingGroupRootId: string,
  children: ResolvedBranchingNode[],
) {
  const state = normalizeBranchState(chat?.messageBranchState);
  const byRoot = state.selectedRevisionByRootId?.[siblingGroupRootId];
  if (byRoot && children.some((child) => child.nodeId === byRoot)) return byRoot;
  if (parentNodeId) {
    const byParent = state.activeChildByParentNodeId?.[parentNodeId];
    if (byParent && children.some((child) => child.nodeId === byParent)) return byParent;
  }
  const original = children.find((child) => child.nodeId === siblingGroupRootId)
    || children.find((child) => !child.revisionOfMessageId);
  return original?.nodeId || children[0]?.nodeId || null;
}

export function projectActiveBranchMessages(chat: BranchableChat | null | undefined, messages: Message[]) {
  return measureDeveloperDiagnostic('message-branch:project-duration', () => projectActiveBranchMessagesInternal(chat, messages), {
    inputMessages: messages.length,
    branchingEnabled: isMessageBranchingEnabled(chat),
  }, 'message-window');
}

function projectActiveBranchMessagesInternal(chat: BranchableChat | null | undefined, messages: Message[]) {
  if (!isMessageBranchingEnabled(chat)) {
    return messages
      .filter((message) => !isDeletedMessage(message))
      .slice()
      .sort(compareMessageOrder);
  }
  const nodes = resolveMessageBranchNodes(messages);
  if (!nodes.length) return [];
  const childrenByParent = buildChildrenByParent(nodes);
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const revisionGroups = new Map<string, ResolvedBranchingNode[]>();
  for (const node of nodes) {
    if (!node.revisionOfMessageId && node.revisionRootId === node.message.id) continue;
    const group = revisionGroups.get(node.revisionRootId) || [];
    group.push(node);
    const rootNode = nodeById.get(node.revisionRootId);
    if (rootNode && !group.some((item) => item.nodeId === rootNode.nodeId)) group.push(rootNode);
    revisionGroups.set(node.revisionRootId, group);
  }

  const inactiveNodeIds = new Set<string>();
  for (const [revisionRootId, rawGroup] of revisionGroups.entries()) {
    const group = Array.from(new Map(rawGroup.map((node) => [node.nodeId, node])).values())
      .sort((left, right) => compareMessageOrder(left.message, right.message));
    if (group.length <= 1) continue;
    const parentNodeId = group.find((node) => node.parentNodeId)?.parentNodeId || null;
    const selectedNodeId = resolveSelectedChildId(chat, parentNodeId, revisionRootId, group);
    for (const node of group) {
      if (node.nodeId !== selectedNodeId) inactiveNodeIds.add(node.nodeId);
    }
  }

  const excludedNodeIds = new Set<string>();
  const excludeSubtree = (nodeId: string) => {
    if (excludedNodeIds.has(nodeId)) return;
    excludedNodeIds.add(nodeId);
    for (const child of childrenByParent.get(nodeId) || []) excludeSubtree(child.nodeId);
  };
  for (const nodeId of inactiveNodeIds) excludeSubtree(nodeId);

  const activeMessages = nodes
    .filter((node) => !excludedNodeIds.has(node.nodeId))
    .map((node) => node.message)
    .sort(compareMessageOrder);
  if (activeMessages.length < Math.min(messages.filter((message) => !isDeletedMessage(message)).length, 10)) {
    logBranchProjectionDebug({
      inputMessages: messages.length,
      nodes: nodes.length,
      activePathMessages: activeMessages.length,
      inactiveNodeIds: Array.from(inactiveNodeIds).slice(0, 20),
      excludedNodeIds: Array.from(excludedNodeIds).slice(0, 20),
      revisionGroups: Array.from(revisionGroups.entries()).slice(0, 12).map(([rootId, group]) => ({
        rootId,
        nodeIds: group.map((node) => node.nodeId),
      })),
      activeLeafNodeId: chat?.messageBranchState?.activeLeafNodeId,
      selectedRevisionByRootId: chat?.messageBranchState?.selectedRevisionByRootId,
      activeChildByParentNodeId: chat?.messageBranchState?.activeChildByParentNodeId,
    });
  }
  return activeMessages;
}

export function getActiveBranchTail(chat: BranchableChat | null | undefined, messages: Message[]) {
  return projectActiveBranchMessages(chat, messages).at(-1) || null;
}

export function getActiveBranchTailNode(chat: BranchableChat | null | undefined, messages: Message[]) {
  const activeTail = getActiveBranchTail(chat, messages);
  if (!activeTail) return null;
  return resolveMessageBranchNodes(messages).find((node) => node.message.id === activeTail.id || node.nodeId === activeTail.id) || null;
}

export function attachMessageToActiveBranch<T extends { metadata?: MessageMetadata } & Record<string, unknown>>(
  chat: Pick<GroupChat, 'messageBranchState' | 'sessionKind'> | null | undefined,
  activeMessages: Message[],
  message: T,
) {
  if (!isMessageBranchingEnabled(chat)) return message;
  if (message.metadata?.branching?.parentNodeId !== undefined) return message;
  const tailNode = getActiveBranchTailNode(chat, activeMessages);
  if (!tailNode) return message;
  return {
    ...message,
    metadata: {
      ...(message.metadata || {}),
      branching: {
        ...(message.metadata?.branching || {}),
        parentNodeId: tailNode?.nodeId || null,
      },
    } as MessageMetadata,
  };
}

export function getBranchRevisionGroup(messages: Message[], messageId: string) {
  const nodes = resolveMessageBranchNodes(messages);
  const targetNode = nodes.find((node) => node.message.id === messageId || node.nodeId === messageId);
  if (!targetNode) return [];
  const groupRootId = targetNode.revisionRootId || targetNode.message.id;
  return nodes
    .filter((node) => node.revisionRootId === groupRootId || node.message.id === groupRootId)
    .map((node) => node.message)
    .sort(compareMessageOrder);
}

export function getMessageBranchVersionInfo(chat: BranchableChat | null | undefined, messages: Message[], messageId: string): MessageBranchVersionInfo | null {
  return buildMessageBranchVersionInfoByMessageId(chat, messages, [messageId])[messageId] || null;
}

export function buildMessageBranchVersionInfoByMessageId(
  chat: BranchableChat | null | undefined,
  messages: Message[],
  messageIds?: string[],
) {
  return measureDeveloperDiagnostic('message-branch:version-info-duration', () => {
    const nodes = nodesFromMessages(messages);
    if (!nodes.length) return {} as Record<string, MessageBranchVersionInfo>;
    const nodesByMessageKey = new Map<string, ResolvedBranchingNode>();
    const groupsByRootId = new Map<string, ResolvedBranchingNode[]>();
    for (const node of nodes) {
      nodesByMessageKey.set(node.message.id, node);
      if (node.message.clientKey) nodesByMessageKey.set(node.message.clientKey, node);
      if (node.message.serverId) nodesByMessageKey.set(node.message.serverId, node);
      nodesByMessageKey.set(node.nodeId, node);
      const group = groupsByRootId.get(node.revisionRootId) || [];
      group.push(node);
      groupsByRootId.set(node.revisionRootId, group);
    }
    const branchedRootIds = new Set<string>();
    for (const [rootId, group] of groupsByRootId.entries()) {
      const uniqueNodeIds = new Set(group.map((node) => node.nodeId));
      if (uniqueNodeIds.size > 1) branchedRootIds.add(rootId);
    }
    if (!branchedRootIds.size) return {} as Record<string, MessageBranchVersionInfo>;

    const activeMessages = projectActiveBranchMessagesInternal(chat, messages);
    const activeMessageKeys = new Set<string>();
    for (const message of activeMessages) {
      activeMessageKeys.add(message.id);
      if (message.clientKey) activeMessageKeys.add(message.clientKey);
      if (message.serverId) activeMessageKeys.add(message.serverId);
    }
    const activeNodeId = activeMessages.at(-1)?.id || '';
    const requestedIds = messageIds?.length ? messageIds : messages.map((message) => message.id);
    const result: Record<string, MessageBranchVersionInfo> = {};
    const cachedGroupInfo = new Map<string, { sortedGroup: ResolvedBranchingNode[]; nodeIds: string[] }>();
    for (const messageId of requestedIds) {
      const target = nodesByMessageKey.get(messageId);
      if (!target) continue;
      const rootId = target.revisionRootId || target.message.id || messageId;
      if (!branchedRootIds.has(rootId)) continue;
      let groupInfo = cachedGroupInfo.get(rootId);
      if (!groupInfo) {
        const sortedGroup = (groupsByRootId.get(rootId) || [])
          .filter((node) => node.revisionRootId === rootId || node.message.id === rootId)
          .sort((left, right) => compareMessageOrder(left.message, right.message));
        groupInfo = {
          sortedGroup,
          nodeIds: sortedGroup.map((node) => node.message.id),
        };
        cachedGroupInfo.set(rootId, groupInfo);
      }
      if (!groupInfo.sortedGroup.length) continue;
      const index = groupInfo.sortedGroup.findIndex((node) => (
        node.message.id === messageId
        || node.message.clientKey === messageId
        || node.message.serverId === messageId
        || node.nodeId === messageId
      ));
      result[messageId] = {
        rootId,
        index: index >= 0 ? index + 1 : 1,
        total: groupInfo.sortedGroup.length,
        isActive: activeMessageKeys.has(target.message.id)
          || Boolean(target.message.clientKey && activeMessageKeys.has(target.message.clientKey))
          || Boolean(target.message.serverId && activeMessageKeys.has(target.message.serverId)),
        activeNodeId,
        nodeIds: groupInfo.nodeIds,
      };
    }
    return result;
  }, {
    inputMessages: messages.length,
    requestedMessages: messageIds?.length ?? messages.length,
  }, 'message-window');
}

function nodesFromMessages(messages: Message[]) {
  return resolveMessageBranchNodes(messages);
}

export function createMessageRevisionDraft(params: {
  sourceMessage: Message;
  parentNodeId: string | null;
  content: string;
  timestamp?: number;
  senderId?: string;
  senderName?: string;
  emotion?: number;
  metadata?: MessageMetadata;
  nodeId?: string;
  revisionRootId?: string | null;
}) {
  const sourceBranching = getBranchingMetadata(params.sourceMessage);
  const revisionRootId = params.revisionRootId || sourceBranching?.revisionRootId || params.sourceMessage.id;
  const branching = {
    ...(params.sourceMessage.metadata?.branching || {}),
    ...(params.metadata?.branching || {}),
    ...(params.nodeId ? { nodeId: params.nodeId } : {}),
    parentNodeId: params.parentNodeId,
    revisionRootId,
    revisionOfMessageId: params.sourceMessage.id,
    createdFromMessageId: params.sourceMessage.id,
  };
  return {
    chatId: params.sourceMessage.chatId,
    type: params.sourceMessage.type,
    senderId: params.senderId || params.sourceMessage.senderId,
    senderName: params.senderName || params.sourceMessage.senderName,
    content: params.content,
    metadata: {
      ...(params.sourceMessage.metadata || {}),
      ...(params.metadata || {}),
      branching,
    } as MessageMetadata,
    emotion: typeof params.emotion === 'number' ? params.emotion : params.sourceMessage.emotion,
    timestamp: typeof params.timestamp === 'number' ? params.timestamp : Date.now(),
  };
}

export function getRevisionSiblingIndex(chat: BranchableChat | null | undefined, messages: Message[], messageId: string) {
  const info = getMessageBranchVersionInfo(chat, messages, messageId);
  return info ? `${info.index}/${info.total}` : null;
}
