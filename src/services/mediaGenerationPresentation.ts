import type { Message, MessageAttachment, MessageAttachmentStatus } from '../types/message';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';

export interface ProjectedMediaGenerationItem {
  key: string;
  messageId: string;
  senderName: string;
  kindLabel: string;
  status: MessageAttachmentStatus;
  statusLabel: string;
  title: string;
  summary: string;
  chips: string[];
  debugHint: string;
  tone: string;
  updatedAt: number;
}

function clean(text: string | undefined | null, members: DisplayTextMember[] = []) {
  return sanitizeUserFacingText(text || '', members).replace(/\s+/g, ' ').trim();
}

function clip(text: string, max = 96) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatKind(kind: MessageAttachment['kind']) {
  const labels: Record<MessageAttachment['kind'], string> = {
    image: '图片',
    audio: '语音',
    sticker: '表情',
  };
  return labels[kind] || kind;
}

function formatStatus(status: MessageAttachmentStatus) {
  const labels: Record<MessageAttachmentStatus, string> = {
    placeholder: '等待生成',
    queued: '排队中',
    generating: '生成中',
    ready: '已生成',
    failed: '生成失败',
    deleted: '已删除',
  };
  return labels[status] || status;
}

function statusTone(status: MessageAttachmentStatus) {
  if (status === 'ready') return 'rgba(46, 125, 50, 0.08)';
  if (status === 'failed') return 'rgba(244, 67, 54, 0.08)';
  if (status === 'generating' || status === 'queued' || status === 'placeholder') return 'rgba(25, 118, 210, 0.08)';
  return 'action.hover';
}

function buildDecisionChip(message: Message, attachment: MessageAttachment) {
  const decision = message.metadata?.generationDecision;
  if (attachment.kind === 'image' && decision?.image?.shouldGenerate) return 'AI 决策：生成图片';
  if (attachment.kind === 'audio' && decision?.audio?.shouldGenerate) return 'AI 决策：生成语音';
  return '';
}

function buildGuidanceChip(message: Message) {
  const guidance = message.metadata?.runtimeDecision?.directorIntent?.userGuidance;
  if (!guidance) return '';
  if (guidance.kind === 'media_request') return '来自显式发图请求';
  if (guidance.kind === 'direct_reply') return '来自点名回应';
  return '来自话题引导';
}

function buildAttachmentItem(message: Message, attachment: MessageAttachment, members: DisplayTextMember[]): ProjectedMediaGenerationItem {
  const kindLabel = formatKind(attachment.kind);
  const statusLabel = formatStatus(attachment.status);
  const altText = clean(attachment.altText, members);
  const content = clean(message.content, members);
  const summary = clip(altText || content || `${kindLabel}附件`);
  const decisionChip = buildDecisionChip(message, attachment);
  const guidanceChip = buildGuidanceChip(message);
  const error = attachment.status === 'failed' && attachment.error ? `失败原因：${clean(attachment.error, members)}` : '';
  const size = typeof attachment.sizeBytes === 'number' && attachment.sizeBytes > 0 ? `${Math.round(attachment.sizeBytes / 1024)}KB` : '';
  const chips = [
    statusLabel,
    kindLabel,
    guidanceChip,
    decisionChip,
    size,
    error,
  ].filter(Boolean);
  const prompt = clean(attachment.promptText, members);
  return {
    key: `${message.id}:${attachment.id}`,
    messageId: message.id,
    senderName: clean(message.senderName, members) || '成员',
    kindLabel,
    status: attachment.status,
    statusLabel,
    title: `${clean(message.senderName, members) || '成员'} · ${kindLabel}`,
    summary,
    chips,
    debugHint: [
      prompt ? `提示词：${prompt}` : '',
      error,
      `附件 ${attachment.id}`,
      attachment.assetId ? `资产 ${attachment.assetId}` : '',
      attachment.url ? '已有资源地址' : '',
    ].filter(Boolean).join('\n'),
    tone: statusTone(attachment.status),
    updatedAt: attachment.updatedAt || message.timestamp,
  };
}

export function projectMediaGenerationItems(messages: Message[], members: DisplayTextMember[] = [], limit = 6): ProjectedMediaGenerationItem[] {
  return messages
    .filter((message) => !message.isDeleted && Boolean(message.metadata?.attachments?.length))
    .flatMap((message) => (message.metadata?.attachments || []).map((attachment) => buildAttachmentItem(message, attachment, members)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
