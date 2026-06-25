import type { GroupChat, MessageBranchState } from '../types/chat';
import type { Message, MessageMetadata } from '../types/message';

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

const ENABLED_SCENARIO_IDS = new Set([
  'open-chat',
  'direct-chat',
  'ai-private-thread',
  'group-discussion',
  'roundtable-discussion',
  'brainstorm-workshop',
  'retrospective-room',
  'debate-arena',
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
  return ENABLED_SCENARIO_IDS.has(scenarioId);
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
  const nodes: ResolvedBranchingNode[] = [];
  let previousNodeId: string | null = null;
  for (const message of visibleMessages) {
    const branching = getBranchingMetadata(message);
    const explicitParent = branching && Object.prototype.hasOwnProperty.call(branching, 'parentNodeId');
    const node = resolveBranchingNode(message, previousNodeId);
    nodes.push({
      ...node,
      parentNodeId: explicitParent ? node.parentNodeId : previousNodeId,
    });
    previousNodeId = node.nodeId;
  }
  return nodes;
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
  return children.at(-1)?.nodeId || children[0]?.nodeId || null;
}

export function projectActiveBranchMessages(chat: BranchableChat | null | undefined, messages: Message[]) {
  if (!isMessageBranchingEnabled(chat)) {
    return messages
      .filter((message) => !isDeletedMessage(message))
      .slice()
      .sort(compareMessageOrder);
  }
  const nodes = resolveMessageBranchNodes(messages);
  if (!nodes.length) return [];
  const childrenByParent = buildChildrenByParent(nodes);
  const roots = nodes.filter((node) => !node.parentNodeId);
  const activePath: Message[] = [];
  const visited = new Set<string>();
  let current = roots[0] || nodes[0] || null;
  while (current && !visited.has(current.nodeId)) {
    visited.add(current.nodeId);
    activePath.push(current.message);
    const children = childrenByParent.get(current.nodeId) || [];
    if (!children.length) break;
    const siblingRootId = resolveSiblingGroupRootId(children);
    const selectedChildId = resolveSelectedChildId(chat, current.nodeId, siblingRootId, children);
    const next = children.find((child) => child.nodeId === selectedChildId) || children[0] || null;
    if (!next) break;
    current = next;
  }
  return activePath;
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
  const activeMessages = projectActiveBranchMessages(chat, messages);
  const group = getBranchRevisionGroup(messages, messageId);
  if (!group.length) return null;
  const sortedGroup = group.slice().sort(compareMessageOrder);
  const index = sortedGroup.findIndex((message) => message.id === messageId || message.clientKey === messageId || message.serverId === messageId);
  const activeNodeId = getActiveBranchTail(chat, messages)?.id || '';
  const target = nodesFromMessages(messages).find((node) => node.message.id === messageId || node.nodeId === messageId);
  const rootId = target?.revisionRootId || target?.message.id || messageId;
  return {
    rootId,
    index: index >= 0 ? index + 1 : 1,
    total: sortedGroup.length,
    isActive: activeMessages.some((message) => message.id === messageId || message.clientKey === messageId || message.serverId === messageId),
    activeNodeId,
    nodeIds: sortedGroup.map((message) => message.id),
  };
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
