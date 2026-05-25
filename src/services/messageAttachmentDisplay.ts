type AttachmentDisplayLike = {
  kind?: 'image' | 'audio' | 'sticker' | string;
  status?: 'placeholder' | 'queued' | 'generating' | 'ready' | 'failed' | 'deleted' | string;
  error?: string;
};

function formatKind(kind: AttachmentDisplayLike['kind']) {
  if (kind === 'audio') return '语音';
  if (kind === 'sticker') return '表情';
  return '图片';
}

export function getAttachmentErrorText(attachment: { error?: string }) {
  const text = attachment.error?.trim();
  return text || '生成任务失败，请检查模型配置或稍后重试。';
}

export function getAttachmentStatusLabel(attachment: AttachmentDisplayLike) {
  const kind = formatKind(attachment.kind);
  if (attachment.status === 'placeholder' || attachment.status === 'queued') return `${kind}排队中`;
  if (attachment.status === 'generating') return `${kind}生成中`;
  if (attachment.status === 'ready') return `${kind}已生成`;
  if (attachment.status === 'failed') return `${kind}生成失败`;
  if (attachment.status === 'deleted') return `${kind}已删除`;
  return `${kind}处理中`;
}

export function getAttachmentStatusDetail(attachment: AttachmentDisplayLike) {
  const kind = formatKind(attachment.kind);
  if (attachment.status === 'failed') return getAttachmentErrorText(attachment);
  if (attachment.status === 'placeholder' || attachment.status === 'queued') return `${kind}已加入生成队列，等待开始。`;
  if (attachment.status === 'generating') return `正在生成${kind}，完成后会自动更新。`;
  if (attachment.status === 'ready') return `${kind}已生成。`;
  if (attachment.status === 'deleted') return `${kind}已删除。`;
  return `${kind}正在处理。`;
}
